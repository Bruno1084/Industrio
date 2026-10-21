import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlantStateStore, type PlantStateView } from "../src/domain/plant-state.js";
import { fakeClock, memoryLogger, snapshot } from "./helpers.js";

const STALE_AFTER_MS = 5000;

function setup() {
  const clock = fakeClock();
  const { logger, lines } = memoryLogger();
  const store = new PlantStateStore({ staleAfterMs: STALE_AFTER_MS, rateWindowSeconds: 60, logger, now: clock.now });
  const emitted: PlantStateView[] = [];
  store.subscribe((state) => emitted.push(state));
  return { store, clock, lines, emitted };
}

/** Simula el juego corriendo: un snapshot por segundo real y de juego. */
function runGame(ctx: ReturnType<typeof setup>, fromTick: number, seconds: number, ironPerSecond = 2): void {
  for (let i = 0; i < seconds; i++) {
    const tick = fromTick + i * 60;
    ctx.store.acceptSnapshot(snapshot(tick, { iron_plate: (tick / 60) * ironPerSecond, copper_plate: 0 }));
    ctx.clock.advance(1000);
  }
}

describe("PlantStateStore", () => {
  it("arranca en no_data sin planta", () => {
    const { store } = setup();
    assert.deepEqual(store.getState(), {
      apiVersion: 1,
      link: { status: "no_data", lastTickChangeAt: null, lastReadAt: null },
      plant: null,
    });
  });

  it("sigue en no_data si el archivo no existe, sin emitir cambios", () => {
    const { store, emitted } = setup();
    store.reportMissing();
    store.reportMissing();
    assert.equal(store.getState().link.status, "no_data");
    assert.equal(emitted.length, 0);
  });

  it("el primer snapshot queda stale hasta ver avanzar el tick", () => {
    const { store, clock } = setup();
    store.acceptSnapshot(snapshot(600, { iron_plate: 20 }));
    const state = store.getState();
    assert.equal(state.link.status, "stale");
    assert.equal(state.link.lastTickChangeAt, null);
    assert.equal(state.link.lastReadAt, new Date(clock.now()).toISOString());
    assert.equal(state.plant?.tick, 600);
    assert.equal(state.plant?.production.iron_plate.perMinute, null);
  });

  it("genera el contrato de salida completo", () => {
    const ctx = setup();
    const start = ctx.clock.now();
    ctx.store.acceptSnapshot(snapshot(69780, { iron_plate: 201, copper_plate: 0 }));
    ctx.clock.advance(1000);
    ctx.store.acceptSnapshot(snapshot(69840, { iron_plate: 203, copper_plate: 0 }));

    assert.deepEqual(ctx.store.getState(), {
      apiVersion: 1,
      link: {
        status: "online",
        lastTickChangeAt: new Date(start + 1000).toISOString(),
        lastReadAt: new Date(start + 1000).toISOString(),
      },
      plant: {
        tick: 69840,
        gameTimeSeconds: 1164,
        furnaces: { total: 48, byStatus: { working: 33, no_fuel: 15 } },
        production: {
          iron_plate: { total: 203, perMinute: 120 },
          copper_plate: { total: 0, perMinute: 0 },
        },
      },
    });
  });

  it("transiciona online -> stale -> online", () => {
    const ctx = setup();
    runGame(ctx, 60, 3);
    assert.equal(ctx.store.getState().link.status, "online");

    // Juego pausado: el archivo sigue ahi con el mismo tick.
    const paused = snapshot(180, { iron_plate: 6, copper_plate: 0 });
    for (let i = 0; i < 4; i++) {
      ctx.store.acceptSnapshot(paused);
      ctx.clock.advance(1000);
    }
    // Ultimo avance hace exactamente STALE_AFTER_MS: todavia online.
    ctx.store.acceptSnapshot(paused);
    assert.equal(ctx.store.getState().link.status, "online");

    ctx.clock.advance(1);
    ctx.store.refresh();
    assert.equal(ctx.store.getState().link.status, "stale");

    runGame(ctx, 240, 1);
    assert.equal(ctx.store.getState().link.status, "online");

    assert.deepEqual(
      ctx.emitted.map((s) => s.link.status),
      ["stale", "online", "online", "stale", "online"],
    );
  });

  it("no emite cambios si el snapshot es identico", () => {
    const ctx = setup();
    runGame(ctx, 60, 2);
    const count = ctx.emitted.length;

    ctx.store.acceptSnapshot(snapshot(120, { iron_plate: 4, copper_plate: 0 }));
    ctx.store.acceptSnapshot(snapshot(120, { iron_plate: 4, copper_plate: 0 }));
    assert.equal(ctx.emitted.length, count);
  });

  it("reinicia el historial de tasas cuando el tick retrocede", () => {
    const ctx = setup();
    runGame(ctx, 60, 10);
    assert.equal(ctx.store.getState().plant?.production.iron_plate.perMinute, 120);

    // Se cargo otra partida, mas vieja.
    ctx.store.acceptSnapshot(snapshot(60, { iron_plate: 500, copper_plate: 0 }));
    const state = ctx.store.getState();
    assert.equal(state.plant?.tick, 60);
    assert.equal(state.plant?.production.iron_plate.perMinute, null);
    assert.equal(state.link.status, "online", "el cambio de tick cuenta como avance");
    assert.ok(ctx.lines.some((l) => l.level === "info" && /retrocedio/.test(l.line)));

    ctx.clock.advance(1000);
    ctx.store.acceptSnapshot(snapshot(120, { iron_plate: 501, copper_plate: 0 }));
    assert.equal(ctx.store.getState().plant?.production.iron_plate.perMinute, 60);
  });

  it("pasa a incompatible conservando el ultimo estado valido y loguea solo cuando cambia el motivo", () => {
    const ctx = setup();
    runGame(ctx, 60, 2);
    const lastPlant = ctx.store.getState().plant;

    ctx.store.rejectSnapshot("schema_version: version no soportada");
    ctx.store.rejectSnapshot("schema_version: version no soportada");
    ctx.store.rejectSnapshot("tick: debe ser un entero");

    const state = ctx.store.getState();
    assert.equal(state.link.status, "incompatible");
    assert.deepEqual(state.plant, lastPlant);

    const warnings = ctx.lines.filter((l) => l.level === "warn");
    assert.equal(warnings.length, 2);
    assert.match(warnings[0].line, /schema_version: version no soportada/);
    assert.match(warnings[1].line, /tick: debe ser un entero/);

    // Vuelve un snapshot valido.
    runGame(ctx, 180, 1);
    assert.equal(ctx.store.getState().link.status, "online");
  });

  it("pasa a no_data si el archivo desaparece, conservando la planta", () => {
    const ctx = setup();
    runGame(ctx, 60, 2);
    ctx.store.reportMissing();
    const state = ctx.store.getState();
    assert.equal(state.link.status, "no_data");
    assert.equal(state.plant?.tick, 120);
  });

  it("cuenta los JSON incompletos sin cambiar el estado", () => {
    const ctx = setup();
    runGame(ctx, 60, 2);
    const before = ctx.store.getState();
    const count = ctx.emitted.length;

    ctx.store.reportPartialRead();
    ctx.store.reportPartialRead();

    assert.equal(ctx.store.getPartialReadCount(), 2);
    assert.deepEqual(ctx.store.getState(), before);
    assert.equal(ctx.emitted.length, count);
    assert.ok(ctx.lines.some((l) => l.level === "debug" && /JSON incompleto/.test(l.line)));
  });

  it("permite desuscribirse y aisla a los suscriptores que fallan", () => {
    const ctx = setup();
    const received: number[] = [];
    ctx.store.subscribe(() => {
      throw new Error("suscriptor roto");
    });
    const unsubscribe = ctx.store.subscribe((state) => received.push(state.plant?.tick ?? -1));

    runGame(ctx, 60, 2);
    unsubscribe();
    runGame(ctx, 180, 1);

    assert.deepEqual(received, [60, 120]);
    assert.equal(ctx.emitted.length, 3, "el suscriptor de setup sigue recibiendo");
    assert.ok(ctx.lines.some((l) => l.level === "error" && /suscriptor roto/.test(l.line)));
  });
});
