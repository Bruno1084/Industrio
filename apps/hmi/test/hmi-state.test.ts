import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkStatus } from "../src/lib/contract";
import { deriveCommStatus, initialHmiState, reduceHmi, type HmiAction, type HmiState } from "../src/lib/hmi-state";
import { emptyState, plantState } from "./helpers";

function run(actions: HmiAction[], from: HmiState = initialHmiState): HmiState {
  return actions.reduce(reduceHmi, from);
}

const received = (tick: number, status: LinkStatus = "online"): HmiAction => ({
  type: "event-received",
  state: plantState(tick, undefined, status),
});

describe("reduceHmi", () => {
  it("arranca en connecting sin datos", () => {
    assert.deepEqual(initialHmiState, {
      gateway: "connecting",
      lastState: null,
      hadDataBefore: false,
      incompatibleReason: null,
      trend: [],
    });
  });

  it("abrir la conexion no alcanza: sigue en connecting hasta el primer evento", () => {
    assert.equal(reduceHmi(initialHmiState, { type: "opened" }), initialHmiState);
  });

  it("pasa a connected con el primer evento valido", () => {
    const state = run([{ type: "opened" }, received(600)]);
    assert.equal(state.gateway, "connected");
    assert.equal(state.lastState?.plant?.tick, 600);
    assert.equal(state.hadDataBefore, true);
    assert.equal(state.trend.length, 1);
  });

  it("un corte despues de datos vuelve a connecting conservando el ultimo estado", () => {
    const before = run([received(600), received(660)]);
    const state = reduceHmi(before, { type: "error" });
    assert.equal(state.gateway, "connecting");
    assert.equal(state.lastState, before.lastState);
    assert.equal(state.trend, before.trend);
    assert.equal(deriveCommStatus(state).label, "Sin conexión con el gateway");
  });

  it("errores repetidos devuelven la misma referencia", () => {
    const state = run([received(600), { type: "error" }]);
    assert.equal(reduceHmi(state, { type: "error" }), state);
  });

  it("un evento invalido pasa a incompatible conservando el ultimo estado valido", () => {
    const before = run([received(600)]);
    const state = reduceHmi(before, { type: "event-invalid", reason: "apiVersion: no soportada" });
    assert.equal(state.gateway, "incompatible");
    assert.equal(state.incompatibleReason, "apiVersion: no soportada");
    assert.equal(state.lastState, before.lastState);
    assert.equal(state.trend, before.trend);
  });

  it("el mismo motivo de rechazo devuelve la misma referencia", () => {
    const state = run([{ type: "event-invalid", reason: "x" }]);
    assert.equal(reduceHmi(state, { type: "event-invalid", reason: "x" }), state);
  });

  it("vuelve a connected con un evento valido", () => {
    const state = run([received(600), { type: "event-invalid", reason: "x" }, received(660)]);
    assert.equal(state.gateway, "connected");
    assert.equal(state.incompatibleReason, null);
    assert.equal(state.lastState?.plant?.tick, 660);
    assert.deepEqual(
      state.trend.map((p) => p.tick),
      [600, 660],
    );
  });

  it("reconecta tras un corte con el primer evento de la nueva conexion", () => {
    const state = run([received(600), { type: "error" }, { type: "opened" }, received(900)]);
    assert.equal(state.gateway, "connected");
    assert.equal(state.lastState?.plant?.tick, 900);
  });

  it("un evento sin planta conserva la tendencia", () => {
    const before = run([received(600)]);
    const state = reduceHmi(before, { type: "event-received", state: emptyState() });
    assert.equal(state.trend, before.trend);
    assert.equal(state.lastState?.plant, null);
  });

  it("no modifica el estado recibido", () => {
    const before = run([received(600)]);
    const copy = structuredClone(before);
    run([{ type: "error" }, received(660), { type: "event-invalid", reason: "x" }], before);
    assert.deepEqual(before, copy);
  });
});

describe("deriveCommStatus", () => {
  const rows: { name: string; state: HmiState; label: string; severity: string; live: boolean }[] = [
    {
      name: "corte con datos previos",
      state: run([received(600), { type: "error" }]),
      label: "Sin conexión con el gateway",
      severity: "critical",
      live: false,
    },
    {
      name: "arranque sin datos",
      state: initialHmiState,
      label: "Conectando con el gateway…",
      severity: "info",
      live: false,
    },
    {
      name: "corte tras un evento invalido (ya hubo conexion)",
      state: run([{ type: "event-invalid", reason: "x" }, { type: "error" }]),
      label: "Sin conexión con el gateway",
      severity: "critical",
      live: false,
    },
    {
      name: "evento con apiVersion incompatible",
      state: run([received(600), { type: "event-invalid", reason: "x" }]),
      label: "Versión de API incompatible",
      severity: "critical",
      live: false,
    },
    {
      name: "link no_data",
      state: run([{ type: "event-received", state: emptyState("no_data") }]),
      label: "Sin datos de la planta",
      severity: "critical",
      live: false,
    },
    {
      name: "link incompatible",
      state: run([received(600, "incompatible")]),
      label: "Telemetría incompatible",
      severity: "critical",
      live: false,
    },
    {
      name: "link stale",
      state: run([received(600, "stale")]),
      label: "Planta sin respuesta",
      severity: "warning",
      live: false,
    },
    {
      name: "link online",
      state: run([received(600, "online")]),
      label: "En línea",
      severity: "normal",
      live: true,
    },
  ];

  for (const row of rows) {
    it(`${row.name} -> "${row.label}"`, () => {
      assert.deepEqual(deriveCommStatus(row.state), {
        label: row.label,
        severity: row.severity,
        valuesAreLive: row.live,
      });
    });
  }

  it("la conexion con el gateway tiene prioridad sobre el enlace con la planta", () => {
    // Ultimo estado online, pero el gateway se corto: no se puede afirmar que siga online.
    const state = run([received(600, "online"), { type: "error" }]);
    assert.equal(deriveCommStatus(state).valuesAreLive, false);
  });
});
