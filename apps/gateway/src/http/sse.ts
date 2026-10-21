import type { ServerResponse } from "node:http";
import type { PlantStateView } from "../domain/plant-state.js";
import type { Logger } from "../logger.js";

// Cuanto espera el navegador antes de reconectar si se corta la conexion.
const RETRY_MS = 2000;
// Un cliente que no lee (red caida sin cerrar el socket) acumula datos en memoria: se lo corta.
const MAX_BUFFERED_BYTES = 1024 * 1024;

export interface SseBroadcasterOptions {
  /** Cada cuanto se manda un comentario para que proxies y navegadores no cierren la conexion. */
  heartbeatMs: number;
  logger: Logger;
}

interface SseClient {
  id: number;
  res: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

/** Registro de clientes SSE: envio inicial, difusion de cambios, heartbeat y limpieza. */
export class SseBroadcaster {
  private readonly heartbeatMs: number;
  private readonly logger: Logger;
  private readonly clients = new Set<SseClient>();
  private nextClientId = 1;
  private lastEventId = 0;

  constructor(options: SseBroadcasterOptions) {
    this.heartbeatMs = options.heartbeatMs;
    this.logger = options.logger;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Abre el stream y manda de inmediato el estado actual. Los encabezados ya fijados (CORS) se conservan. */
  addClient(res: ServerResponse, current: PlantStateView): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`retry: ${RETRY_MS}\n\n`);

    const client: SseClient = {
      id: this.nextClientId++,
      res,
      heartbeat: setInterval(() => this.write(client, ": ping\n\n"), this.heartbeatMs),
    };
    this.clients.add(client);
    res.on("close", () => this.remove(client));

    // Mismo id que el ultimo evento difundido: es el mismo estado, no uno nuevo.
    this.write(client, formatStateEvent(this.lastEventId, current));
    this.logger.info("Cliente SSE conectado", { clientId: client.id, clients: this.clients.size });
  }

  /** Envia el estado a todos los clientes como un evento nuevo. */
  broadcast(state: PlantStateView): void {
    this.lastEventId += 1;
    const event = formatStateEvent(this.lastEventId, state);
    for (const client of this.clients) this.write(client, event);
  }

  /** Cierra todas las conexiones (apagado del gateway). */
  closeAll(): void {
    const count = this.clients.size;
    for (const client of this.clients) {
      clearInterval(client.heartbeat);
      client.res.end();
    }
    this.clients.clear();
    if (count > 0) this.logger.info("Conexiones SSE cerradas", { clients: count });
  }

  private write(client: SseClient, chunk: string): void {
    if (client.res.writableLength > MAX_BUFFERED_BYTES) {
      this.logger.warn("Cliente SSE no consume los eventos, se lo desconecta", { clientId: client.id });
      client.res.destroy();
      return;
    }
    client.res.write(chunk);
  }

  private remove(client: SseClient): void {
    if (!this.clients.delete(client)) return;
    clearInterval(client.heartbeat);
    this.logger.info("Cliente SSE desconectado", { clientId: client.id, clients: this.clients.size });
  }
}

function formatStateEvent(id: number, state: PlantStateView): string {
  // JSON.stringify no genera saltos de linea, asi que entra en un unico campo "data".
  return `id: ${id}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;
}
