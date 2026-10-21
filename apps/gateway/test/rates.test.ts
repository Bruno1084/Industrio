import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendSample, ratesPerMinute, type Sample } from "../src/domain/rates.js";

const WINDOW_SECONDS = 60;

/** Construye un historial agregando muestras en orden, como lo hace el store. */
function build(samples: Sample[]): Sample[] {
  return samples.reduce<Sample[]>((history, s) => appendSample(history, s, WINDOW_SECONDS), []);
}

describe("ratesPerMinute", () => {
  it("devuelve un objeto vacio sin muestras", () => {
    assert.deepEqual(ratesPerMinute([]), {});
  });

  it("devuelve null con una sola muestra", () => {
    assert.deepEqual(ratesPerMinute(build([{ tick: 60, totals: { iron_plate: 10 } }])), { iron_plate: null });
  });

  it("calcula por minuto de juego a partir de los ticks", () => {
    // 2 placas en 1 s de juego (60 ticks) = 120 por minuto.
    const history = build([
      { tick: 60, totals: { iron_plate: 10, copper_plate: 0 } },
      { tick: 120, totals: { iron_plate: 12, copper_plate: 0 } },
    ]);
    assert.deepEqual(ratesPerMinute(history), { iron_plate: 120, copper_plate: 0 });
  });

  it("usa la muestra mas vieja dentro de la ventana", () => {
    const history = build([
      { tick: 0, totals: { iron_plate: 0 } }, // queda fuera: 3660 - 0 > 3600 ticks
      { tick: 60, totals: { iron_plate: 1000 } }, // limite exacto de la ventana: queda dentro
      { tick: 1860, totals: { iron_plate: 1030 } },
      { tick: 3660, totals: { iron_plate: 1060 } },
    ]);
    assert.deepEqual(
      history.map((s) => s.tick),
      [60, 1860, 3660],
    );
    // 60 placas en 60 s de juego = 60 por minuto (con la muestra descartada daria 1060).
    assert.deepEqual(ratesPerMinute(history), { iron_plate: 60 });
  });

  it("devuelve null para un item que aparece en la ultima muestra", () => {
    const history = build([
      { tick: 60, totals: { iron_plate: 10 } },
      { tick: 120, totals: { iron_plate: 11, steel_plate: 3 } },
    ]);
    assert.deepEqual(ratesPerMinute(history), { iron_plate: 60, steel_plate: null });
  });
});

describe("appendSample", () => {
  it("descarta el historial si el tick retrocede", () => {
    const history = build([
      { tick: 6000, totals: { iron_plate: 500 } },
      { tick: 6060, totals: { iron_plate: 510 } },
      { tick: 60, totals: { iron_plate: 2 } },
    ]);
    assert.deepEqual(history, [{ tick: 60, totals: { iron_plate: 2 } }]);
  });

  it("reemplaza la muestra si el tick se repite", () => {
    const history = build([
      { tick: 60, totals: { iron_plate: 1 } },
      { tick: 60, totals: { iron_plate: 2 } },
    ]);
    assert.deepEqual(history, [{ tick: 60, totals: { iron_plate: 2 } }]);
  });

  it("no modifica el historial recibido", () => {
    const original: Sample[] = [{ tick: 60, totals: { iron_plate: 1 } }];
    appendSample(original, { tick: 120, totals: { iron_plate: 2 } }, WINDOW_SECONDS);
    assert.equal(original.length, 1);
  });
});
