import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { GatewayClient, type EventSourceLike } from "../src/lib/gateway-client";
import { plantState } from "./helpers";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** Doble de EventSource que el test maneja a mano. */
class FakeEventSource implements EventSourceLike {
  readyState = CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private stateListeners: ((event: MessageEvent) => void)[] = [];

  constructor(readonly url: string) {}

  addEventListener(_type: "state", listener: (event: MessageEvent) => void): void {
    this.stateListeners.push(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
  }

  open(): void {
    this.readyState = OPEN;
    this.onopen?.(new Event("open"));
  }

  emit(data: unknown): void {
    const event = new MessageEvent("state", { data });
    for (const listener of this.stateListeners) listener(event);
  }

  fail(readyState: number = CONNECTING): void {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
}

const STREAM_URL = "http://127.0.0.1:4000/api/stream";

function setup() {
  const sources: FakeEventSource[] = [];
  const client = new GatewayClient(STREAM_URL, {
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    recreateDelayMs: 5000,
  });
  let notifications = 0;
  client.subscribe(() => {
    notifications += 1;
  });
  return { client, sources, notifications: () => notifications };
}

describe("GatewayClient", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("no abre nada hasta start(), y start() es idempotente", () => {
    const { client, sources } = setup();
    assert.equal(sources.length, 0);
    client.start();
    client.start();
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.url, STREAM_URL);
  });

  it("un evento valido pasa a connected y notifica", () => {
    const { client, sources, notifications } = setup();
    client.start();
    sources[0]?.open();
    assert.equal(notifications(), 0, "abrir no cambia el estado");
    sources[0]?.emit(JSON.stringify(plantState(600)));
    assert.equal(client.getSnapshot().gateway, "connected");
    assert.equal(client.getSnapshot().lastState?.plant?.tick, 600);
    assert.equal(notifications(), 1);
  });

  it("getSnapshot devuelve la misma referencia si el estado no cambia", () => {
    const { client, sources, notifications } = setup();
    client.start();
    const before = client.getSnapshot();
    sources[0]?.fail();
    assert.equal(client.getSnapshot(), before, "un error sin datos previos no cambia nada");
    assert.equal(notifications(), 0);
  });

  it("un evento invalido pasa a incompatible conservando el ultimo estado valido", () => {
    const { client, sources } = setup();
    client.start();
    sources[0]?.emit(JSON.stringify(plantState(600)));
    sources[0]?.emit(JSON.stringify({ ...plantState(660), apiVersion: 2 }));
    const state = client.getSnapshot();
    assert.equal(state.gateway, "incompatible");
    assert.equal(state.lastState?.plant?.tick, 600);
    assert.match(state.incompatibleReason ?? "", /apiVersion/);
  });

  it("rechaza un evento sin texto", () => {
    const { client, sources } = setup();
    client.start();
    sources[0]?.emit(42);
    assert.equal(client.getSnapshot().gateway, "incompatible");
  });

  it("ante un corte deja reconectar a EventSource sin recrearlo", () => {
    const { client, sources } = setup();
    client.start();
    sources[0]?.emit(JSON.stringify(plantState(600)));
    sources[0]?.fail(CONNECTING);
    assert.equal(client.getSnapshot().gateway, "connecting");
    assert.equal(client.getSnapshot().hadDataBefore, true);
    mock.timers.tick(10_000);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.closed, false);

    sources[0]?.open();
    sources[0]?.emit(JSON.stringify(plantState(660)));
    assert.equal(client.getSnapshot().gateway, "connected");
  });

  it("si el navegador abandona la conexion (CLOSED) la recrea a los 5 s", () => {
    const { client, sources } = setup();
    client.start();
    sources[0]?.fail(CLOSED);
    assert.equal(sources[0]?.closed, true);
    mock.timers.tick(4999);
    assert.equal(sources.length, 1);
    mock.timers.tick(1);
    assert.equal(sources.length, 2);

    sources[1]?.emit(JSON.stringify(plantState(600)));
    assert.equal(client.getSnapshot().gateway, "connected");
  });

  it("stop() cierra la conexion, cancela la recreacion pendiente y conserva el estado", () => {
    const { client, sources } = setup();
    client.start();
    sources[0]?.emit(JSON.stringify(plantState(600)));
    sources[0]?.fail(CLOSED);
    client.stop();
    mock.timers.tick(10_000);
    assert.equal(sources.length, 1);
    assert.equal(client.getSnapshot().lastState?.plant?.tick, 600);

    client.start();
    assert.equal(sources.length, 2);
    client.stop();
    assert.equal(sources[1]?.closed, true);
  });

  it("deja de notificar a un suscriptor dado de baja", () => {
    const { client, sources } = setup();
    let calls = 0;
    const unsubscribe = client.subscribe(() => {
      calls += 1;
    });
    client.start();
    sources[0]?.emit(JSON.stringify(plantState(600)));
    unsubscribe();
    sources[0]?.emit(JSON.stringify(plantState(660)));
    assert.equal(calls, 1);
  });
});
