import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { PlantStateView } from "../domain/plant-state.js";
import type { Logger } from "../logger.js";
import type { SseBroadcaster } from "./sse.js";

export interface HttpServerDeps {
  state: { getState(): PlantStateView };
  sse: SseBroadcaster;
  corsOrigin: string;
  logger: Logger;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Servidor HTTP del gateway. Solo lectura por ahora: todas las rutas son GET. */
export function createHttpServer(deps: HttpServerDeps): http.Server {
  const { state, sse, corsOrigin, logger } = deps;

  const routes: Record<string, Handler> = {
    "/health": (_req, res) => {
      sendJson(res, 200, { status: "ok", uptimeSeconds: Math.floor(process.uptime()) });
    },
    "/api/state": (_req, res) => {
      sendJson(res, 200, state.getState());
    },
    "/api/stream": (_req, res) => {
      sse.addClient(res, state.getState());
    },
  };

  return http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    logger.debug("Solicitud HTTP", { method: req.method, path: pathname });

    // CORS en todas las respuestas, incluidos los errores, para que el navegador pueda leerlos.
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const handler = Object.hasOwn(routes, pathname) ? routes[pathname] : undefined;
    if (!handler) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (req.method === "OPTIONS") {
      // Respuesta a la consulta previa (preflight) que hace el navegador antes de ciertas solicitudes.
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, OPTIONS");
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    try {
      handler(req, res);
    } catch (error) {
      logger.error("Error atendiendo una solicitud HTTP", { method: req.method, path: pathname, error });
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
      else res.destroy();
    }
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // El estado cambia cada segundo: nunca servirlo desde una cache.
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
