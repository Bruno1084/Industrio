import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendTrendPoint, type TrendPoint } from "../src/lib/trend";
import { emptyState, plantState } from "./helpers";

const WINDOW_SECONDS = 60;

/** Agrega estados en orden, como lo hace el reductor. */
function build(states: ReturnType<typeof plantState>[]): readonly TrendPoint[] {
  return states.reduce<readonly TrendPoint[]>((points, s) => appendTrendPoint(points, s, WINDOW_SECONDS), []);
}

describe("appendTrendPoint", () => {
  it("guarda la produccion por minuto de cada item", () => {
    const points = build([plantState(60, { iron_plate: 120, copper_plate: 30 })]);
    assert.deepEqual(points, [{ tick: 60, values: { iron_plate: 120, copper_plate: 30 } }]);
  });

  it("descarta los puntos fuera de la ventana medida en ticks", () => {
    const points = build([
      plantState(0), // queda fuera: 3660 - 0 > 3600 ticks
      plantState(60), // limite exacto de la ventana: queda dentro
      plantState(1860),
      plantState(3660),
    ]);
    assert.deepEqual(
      points.map((p) => p.tick),
      [60, 1860, 3660],
    );
  });

  it("vacia la tendencia si el tick retrocede (otra partida)", () => {
    const points = build([plantState(6000), plantState(6060), plantState(120, { iron_plate: null })]);
    assert.deepEqual(points, [{ tick: 120, values: { iron_plate: null } }]);
  });

  it("un tick repetido reemplaza al ultimo punto", () => {
    const points = build([plantState(60), plantState(120, { iron_plate: 100 }), plantState(120, { iron_plate: 90 })]);
    assert.deepEqual(
      points.map((p) => [p.tick, p.values.iron_plate]),
      [
        [60, 120],
        [120, 90],
      ],
    );
  });

  it("conserva null: no lo convierte en 0", () => {
    const points = build([plantState(60, { iron_plate: null }), plantState(120, { iron_plate: 10 })]);
    assert.equal(points[0].values.iron_plate, null);
    assert.equal(points[1].values.iron_plate, 10);
  });

  it("un item nuevo aparece sin cambiar codigo", () => {
    const points = build([plantState(60, { iron_plate: 1 }), plantState(120, { iron_plate: 2, steel_plate: 3 })]);
    assert.deepEqual(points[1].values, { iron_plate: 2, steel_plate: 3 });
    assert.equal(Object.hasOwn(points[0].values, "steel_plate"), false);
  });

  it("sin planta devuelve los mismos puntos", () => {
    const points = build([plantState(60)]);
    assert.equal(appendTrendPoint(points, emptyState(), WINDOW_SECONDS), points);
  });

  it("no modifica el arreglo recibido", () => {
    const points = build([plantState(60)]);
    const copy = structuredClone(points);
    appendTrendPoint(points, plantState(120), WINDOW_SECONDS);
    assert.deepEqual(points, copy);
  });
});
