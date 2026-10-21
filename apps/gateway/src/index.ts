import { ConfigError, loadConfig, type Config } from "./config.js";
import { createLogger } from "./logger.js";

// Si el apagado ordenado se traba (por ejemplo, una conexion que no cierra), salimos igual.
const SHUTDOWN_TIMEOUT_MS = 5000;

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

function main(): void {
  const config = readConfigOrExit();
  const logger = createLogger(config.logLevel);

  logger.info("Gateway iniciando", { config });

  // Temporal: hasta que exista la fuente de snapshots (tarea 4) nada mantiene vivo el proceso.
  const keepAlive = setInterval(() => {}, 60_000);

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
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

    clearInterval(keepAlive);
    // Sin process.exit(0): el proceso termina solo cuando no quedan recursos abiertos.
    // Si algo queda colgado, salta el timeout de arriba y queda registrado.
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
