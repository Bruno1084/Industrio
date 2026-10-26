import type { PlantStateView } from "./contract";

// Funciones puras: el tiempo se mide en ticks del juego, como en el gateway.

export const TICKS_PER_SECOND = 60;

/** Ventana de la tendencia en vivo, en segundos de juego. */
export const TREND_WINDOW_SECONDS = 600;

/** Produccion por minuto de cada item en un instante del juego. `null` corta la linea. */
export interface TrendPoint {
  tick: number;
  values: Readonly<Record<string, number | null>>;
}

/**
 * Agrega el punto del estado recibido y descarta los que quedaron fuera de la ventana.
 * Si el tick retrocede, los puntos anteriores son de otra partida y se descartan.
 * Si el tick se repite (p. ej. solo cambio el estado del enlace), reemplaza al ultimo punto.
 * Sin planta no hay nada que graficar: devuelve los puntos sin cambios.
 */
export function appendTrendPoint(
  points: readonly TrendPoint[],
  state: PlantStateView,
  windowSeconds: number,
): readonly TrendPoint[] {
  const plant = state.plant;
  if (!plant) return points;

  const values: Record<string, number | null> = {};
  for (const [item, production] of Object.entries(plant.production)) {
    values[item] = production.perMinute;
  }
  const point: TrendPoint = { tick: plant.tick, values };

  const last = points.at(-1);
  let base = points;
  if (last && point.tick < last.tick) base = [];
  else if (last && point.tick === last.tick) base = points.slice(0, -1);

  const minTick = point.tick - windowSeconds * TICKS_PER_SECOND;
  return [...base.filter((p) => p.tick >= minTick), point];
}
