import { stat } from "node:fs/promises";
import type http from "node:http";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { PlantStateStore } from "./domain/plant-state.js";
import { parseSnapshot } from "./domain/snapshot.js";
import { createHttpServer } from "./http/server.js";
import { SseBroadcaster } from "./http/sse.js";
import { createLogger, type Logger } from "./logger.js";
import { FileSnapshotSource } from "./sources/file-source.js";
import type { SnapshotSource } from "./sources/snapshot-source.js";

// Si el apagado ordenado se traba (por ejemplo, una conexion que no cierra), salimos igual.
const SHUTDOWN_TIMEOUT_MS = 5000;
const SSE_HEARTBEAT_MS = 15_000;

function readConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** Fuente -> validacion -> store. Devuelve la funcion para desconectar. */
function connectSource(source: SnapshotSource, store: PlantStateStore, logger: Logger): () => void {
  // Una falla inesperada suele repetirse en cada ciclo: se loguea cuando cambia, no cada segundo.
  let lastErrorMessage: string | null = null;

  return source.subscribe((result) => {
    if (result.kind !== "error" && lastErrorMessage !== null) {
      logger.info("La lectura de telemetria se recupero");
      lastErrorMessage = null;
    }

    switch (result.kind) {
      case "snapshot": {
        const parsed = parseSnapshot(result.raw);
        if (parsed.ok) store.acceptSnapshot(parsed.snapshot);
        else store.rejectSnapshot(parsed.reason);
        break;
      }
      case "missing":
        store.reportMissing();
        break;
      case "partial":
        store.reportPartialRead();
        break;
      case "error": {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        if (message !== lastErrorMessage) {
          logger.error("Error inesperado leyendo la telemetria, se reintenta en el proximo ciclo", {
            error: result.error,
          });
          lastErrorMessage = message;
        }
        // Sin datos nuevos el enlace igual tiene que poder pasar a stale.
        store.refresh();
        break;
      }
    }
  });
}

/** Aviso temprano de una ruta mal configurada: si no, solo se veria no_data sin explicacion. */
async function warnIfDataDirMissing(config: Config, logger: Logger): Promise<void> {
  try {
    await stat(config.factorioDataDir);
  } catch {
    logger.warn("La carpeta de datos de Factorio no existe; revisa FACTORIO_DATA_DIR", {
      factorioDataDir: config.factorioDataDir,
    });
  }
}

function listen(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    // close() espera a que terminen las conexiones; las keep-alive ociosas se cierran ya.
    server.closeIdleConnections();
  });
}

async function main(): Promise<void> {
  const config = readConfigOrExit();
  const logger = createLogger(config.logLevel);

  logger.info("Gateway iniciando", { config });
  await warnIfDataDirMissing(config, logger);

  const store = new PlantStateStore({
    staleAfterMs: config.staleAfterMs,
    rateWindowSeconds: config.rateWindowSeconds,
    logger,
  });
  const source = new FileSnapshotSource({
    filePath: config.telemetryFile,
    intervalMs: config.pollIntervalMs,
    logger,
  });

  const sse = new SseBroadcaster({ heartbeatMs: SSE_HEARTBEAT_MS, logger });
  const unsubscribeSse = store.subscribe((state) => sse.broadcast(state));
  const server = createHttpServer({ state: store, sse, corsOrigin: config.corsOrigin, logger });

  // Primero el puerto: si esta ocupado, no tiene sentido empezar a leer.
  try {
    await listen(server, config.host, config.port);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const hint =
      code === "EADDRINUSE"
        ? "el puerto ya esta en uso; cerra el otro proceso o defini GATEWAY_PORT"
        : "no se pudo abrir el puerto; revisa GATEWAY_HOST y GATEWAY_PORT";
    logger.error(`No se pudo iniciar el servidor HTTP: ${hint}`, { host: config.host, port: config.port, error });
    process.exit(1);
  }
  server.on("error", (error) => logger.error("Error del servidor HTTP", { error }));
  logger.info("Servidor HTTP escuchando", { url: `http://${config.host}:${config.port}` });

  const disconnectSource = connectSource(source, store, logger);
  source.start();
  logger.info("Leyendo telemetria", { file: config.telemetryFile, intervalMs: config.pollIntervalMs });

  // El paso a stale depende del reloj, no de que llegue una lectura: se reevalua aunque la fuente se trabe.
  const linkWatchdog = setInterval(() => store.refresh(), config.pollIntervalMs);

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      logger.warn("Segunda senal durante el apagado: salida forzada", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("Apagando", { signal });

    const forceExit = setTimeout(() => {
      logger.error("El apagado ordenado excedio el tiempo limite: salida forzada", {
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // unref: este timer no debe ser lo que mantiene vivo al proceso.
    forceExit.unref();

    // Orden: dejar de producir datos, despues cortar a los clientes y por ultimo cerrar el puerto.
    clearInterval(linkWatchdog);
    await source.stop();
    disconnectSource();
    unsubscribeSse();
    sse.closeAll();
    await closeServer(server);
    logger.info("Gateway detenido", { partialReads: store.getPartialReadCount() });
    // Sin process.exit(0): el proceso termina solo cuando no quedan recursos abiertos.
    // Si algo queda colgado, salta el timeout de arriba y queda registrado.
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    shutdown(signal).catch((error: unknown) => {
      logger.error("Error durante el apagado", { error });
      process.exit(1);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

main().catch((error: unknown) => {
  console.error("Error fatal al iniciar el gateway:", error);
  process.exit(1);
});
