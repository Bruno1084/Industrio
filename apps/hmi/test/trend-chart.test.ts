import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TrendPoint } from "../src/lib/trend";
import { buildTrendChart } from "../src/lib/trend-chart";

const WINDOW_SECONDS = 10; // 600 ticks

const point = (tick: number, iron: number | null): TrendPoint => ({ tick, values: { iron_plate: iron } });

describe("buildTrendChart", () => {
  it("con menos de dos valores no hay grafico", () => {
    assert.equal(buildTrendChart([], "iron_plate", WINDOW_SECONDS), null);
    assert.equal(buildTrendChart([point(60, 10)], "iron_plate", WINDOW_SECONDS), null);
    assert.equal(buildTrendChart([point(60, 10), point(120, null)], "iron_plate", WINDOW_SECONDS), null);
  });

  it("normaliza X a la ventana que termina en el ultimo punto e Y al rango de la serie", () => {
    const chart = buildTrendChart([point(300, 10), point(600, 20)], "iron_plate", WINDOW_SECONDS);
    assert.deepEqual(chart, {
      segments: [
        [
          { x: 0.5, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
      min: 10,
      max: 20,
    });
  });

  it("un null corta la linea en tramos", () => {
    const chart = buildTrendChart(
      [point(60, 1), point(120, 2), point(180, null), point(240, 3), point(300, 4)],
      "iron_plate",
      WINDOW_SECONDS,
    );
    assert.deepEqual(
      chart?.segments.map((s) => s.length),
      [2, 2],
    );
  });

  it("un item ausente en un punto tambien corta la linea", () => {
    const points: TrendPoint[] = [point(60, 1), { tick: 120, values: {} }, point(180, 2)];
    assert.equal(buildTrendChart(points, "iron_plate", WINDOW_SECONDS)?.segments.length, 2);
  });

  it("una serie plana queda centrada", () => {
    const chart = buildTrendChart([point(60, 120), point(120, 120)], "iron_plate", WINDOW_SECONDS);
    assert.deepEqual(
      chart?.segments[0]?.map((p) => p.y),
      [0.5, 0.5],
    );
    assert.equal(chart?.min, 120);
    assert.equal(chart?.max, 120);
  });

  it("una serie plana en cero tambien queda centrada", () => {
    const chart = buildTrendChart([point(60, 0), point(120, 0)], "iron_plate", WINDOW_SECONDS);
    assert.deepEqual(
      chart?.segments[0]?.map((p) => p.y),
      [0.5, 0.5],
    );
  });
});
