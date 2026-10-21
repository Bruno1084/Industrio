import assert from "node:assert/strict";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PlantStateStore, type PlantStateView } from "../src/domain/plant-state.js";
import { createHttpServer } from "../src/http/server.js";
import { SseBroadcaster } from "../src/http/sse.js";
import { fakeClock, memoryLogger, snapshot } from "./helpers.js";

const CORS_ORIGIN = "http://localhost:3000";

interface SseEvent {
  id: string;
  event: string;
  data: string;
}

/** Cliente SSE minimo: separa el stream en bloques ("\n\n") y los devuelve de a uno. */
async function openStream(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.ok(response.body, "la respuesta SSE no tiene cuerpo");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  async function nextBlock(): Promise<string | null> {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return block;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += value;
    }
  }

  async function nextEvent(): Promise<SseEvent> {
    for (;;) {
      const block = await nextBlock();
      if (block === null) throw new Error("el stream se cerro antes de recibir un evento");
      if (!block.includes("event:")) continue; // "retry:" o comentarios de heartbeat
      const fields = Object.fromEntries(
        block.split("\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
      );
      return { id: fields.id, event: fields.event, data: fields.data };
    }
  }

  return { response, nextBlock, nextEvent, close: () => controller.abort() };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timeout esperando la condicion");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("servidor HTTP", () => {
  let store: PlantStateStore;
  let sse: SseBroadcaster;
  let server: http.Server;
  let baseUrl: string;
  let clock: ReturnType<typeof fakeClock>;

  async function start(heartbeatMs = 15_000): Promise<void> {
    const { logger } = memoryLogger();
    clock = fakeClock();
    store = new PlantStateStore({ staleAfterMs: 5000, rateWindowSeconds: 60, logger, now: clock.now });
    sse = new SseBroadcaster({ heartbeatMs, logger });
    store.subscribe((state) => sse.broadcast(state));
    server = createHttpServer({ state: store, sse, corsOrigin: CORS_ORIGIN, logger });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => start());

  afterEach(async () => {
    sse.closeAll();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("GET /health responde ok con el uptime", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; uptimeSeconds: number };
    assert.equal(body.status, "ok");
    assert.ok(Number.isInteger(body.uptimeSeconds) && body.uptimeSeconds >= 0);
  });

  it("GET /api/state devuelve el contrato de salida", async () => {
    let response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      apiVersion: 1,
      link: { status: "no_data", lastTickChangeAt: null, lastReadAt: null },
      plant: null,
    });

    store.acceptSnapshot(snapshot(60, { iron_plate: 1 }));
    response = await fetch(`${baseUrl}/api/state?ignorado=1`);
    assert.deepEqual(await response.json(), store.getState());
  });

  it("incluye el encabezado CORS en todas las respuestas", async () => {
    for (const path of ["/health", "/api/state", "/no-existe"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.headers.get("access-control-allow-origin"), CORS_ORIGIN, path);
      await response.body?.cancel();
    }
  });

  it("responde OPTIONS con 204", async () => {
    const response = await fetch(`${baseUrl}/api/state`, { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), CORS_ORIGIN);
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /GET/);
  });

  it("responde 404 en rutas desconocidas", async () => {
    const response = await fetch(`${baseUrl}/api/nada`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  });

  it("responde 405 a metodos no soportados", async () => {
    const response = await fetch(`${baseUrl}/api/state`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, OPTIONS");
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  });

  describe("GET /api/stream", () => {
    it("usa los encabezados SSE y manda el estado actual al conectarse", async () => {
      store.acceptSnapshot(snapshot(60, { iron_plate: 1 }));
      const stream = await openStream(`${baseUrl}/api/stream`);
      assert.equal(stream.response.headers.get("content-type"), "text/event-stream");
      assert.equal(stream.response.headers.get("cache-control"), "no-cache");
      assert.equal(stream.response.headers.get("access-control-allow-origin"), CORS_ORIGIN);

      const event = await stream.nextEvent();
      assert.equal(event.event, "state");
      assert.deepEqual(JSON.parse(event.data), store.getState());
      stream.close();
    });

    it("difunde un evento por cada cambio, con id incremental", async () => {
      const stream = await openStream(`${baseUrl}/api/stream`);
      const initial = await stream.nextEvent();

      store.acceptSnapshot(snapshot(60, { iron_plate: 1 }));
      store.acceptSnapshot(snapshot(60, { iron_plate: 1 })); // identico: no genera evento
      clock.advance(1000);
      store.acceptSnapshot(snapshot(120, { iron_plate: 3 }));

      const first = await stream.nextEvent();
      const second = await stream.nextEvent();
      const ids = [initial, first, second].map((e) => Number(e.id));
      assert.deepEqual(ids, [0, 1, 2]);

      const states = [first, second].map((e) => JSON.parse(e.data) as PlantStateView);
      assert.deepEqual(
        states.map((s) => [s.link.status, s.plant?.tick]),
        [
          ["stale", 60],
          ["online", 120],
        ],
      );
      stream.close();
    });

    it("libera el cliente al desconectarse", async () => {
      const a = await openStream(`${baseUrl}/api/stream`);
      const b = await openStream(`${baseUrl}/api/stream`);
      await a.nextEvent();
      await b.nextEvent();
      assert.equal(sse.clientCount, 2);

      a.close();
      await waitFor(() => sse.clientCount === 1);
      b.close();
      await waitFor(() => sse.clientCount === 0);

      // Difundir sin clientes no falla.
      store.acceptSnapshot(snapshot(60));
    });

    it("cierra los streams abiertos con closeAll", async () => {
      const stream = await openStream(`${baseUrl}/api/stream`);
      await stream.nextEvent();
      sse.closeAll();
      assert.equal(sse.clientCount, 0);
      assert.equal(await stream.nextBlock(), null, "el stream termino");
    });
  });
});

describe("heartbeat SSE", () => {
  it("manda comentarios periodicos mientras no hay cambios", async () => {
    const { logger } = memoryLogger();
    const store = new PlantStateStore({ staleAfterMs: 5000, rateWindowSeconds: 60, logger });
    const sse = new SseBroadcaster({ heartbeatMs: 20, logger });
    const server = createHttpServer({ state: store, sse, corsOrigin: CORS_ORIGIN, logger });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const stream = await openStream(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stream`);
      await stream.nextEvent();
      assert.equal(await stream.nextBlock(), ": ping");
      assert.equal(await stream.nextBlock(), ": ping");
      stream.close();
    } finally {
      sse.closeAll();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
