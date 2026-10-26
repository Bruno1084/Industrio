import { TICKS_PER_SECOND, type TrendPoint } from "./trend";

/** Punto normalizado: `x` 0..1 de izquierda a derecha, `y` 0..1 de abajo hacia arriba. */
export interface ChartPoint {
  x: number;
  y: number;
}

export interface TrendChartModel {
  /** Tramos continuos: un `null` (o un item ausente) corta la linea en vez de dibujarse como 0. */
  segments: ChartPoint[][];
  /** Minimo y maximo reales de la serie dentro de la ventana. */
  min: number;
  max: number;
}

/**
 * Geometria de la tendencia de un item, independiente del tamaño del grafico.
 * El eje X es la ventana fija de juego que termina en el ultimo punto, asi la
 * linea crece desde la derecha. Devuelve `null` con menos de dos valores.
 */
export function buildTrendChart(
  points: readonly TrendPoint[],
  item: string,
  windowSeconds: number,
): TrendChartModel | null {
  const last = points.at(-1);
  if (!last) return null;

  const samples = points.map((p) => ({ tick: p.tick, value: p.values[item] ?? null }));
  const values = samples.flatMap((s) => (s.value === null ? [] : [s.value]));
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Serie plana: se abre el rango para que la linea quede centrada y no pegada a un borde.
  const pad = max === min ? Math.abs(max) * 0.1 || 1 : 0;
  const low = min - pad;
  const span = max + pad - low;

  const windowTicks = windowSeconds * TICKS_PER_SECOND;
  const startTick = last.tick - windowTicks;

  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const sample of samples) {
    if (sample.value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ x: (sample.tick - startTick) / windowTicks, y: (sample.value - low) / span });
  }
  if (current.length > 0) segments.push(current);

  return { segments, min, max };
}
