// Funciones puras: sin reloj ni archivos, el tiempo se mide en ticks del juego.

export const TICKS_PER_SECOND = 60;

/** Totales acumulados por item en un instante del juego. */
export interface Sample {
  tick: number;
  totals: Readonly<Record<string, number>>;
}

/**
 * Agrega una muestra y descarta las que quedaron fuera de la ventana (en segundos de juego).
 * Si el tick retrocede, el historial anterior pertenece a otra partida y se descarta.
 * Si el tick se repite, la muestra nueva reemplaza a la anterior.
 */
export function appendSample(history: readonly Sample[], sample: Sample, windowSeconds: number): Sample[] {
  const last = history.at(-1);
  let base: readonly Sample[] = history;
  if (last && sample.tick < last.tick) base = [];
  else if (last && sample.tick === last.tick) base = history.slice(0, -1);

  const minTick = sample.tick - windowSeconds * TICKS_PER_SECOND;
  return [...base.filter((s) => s.tick >= minTick), sample];
}

/**
 * Produccion por minuto de juego de cada item de la muestra mas nueva, usando la diferencia
 * con la muestra mas vieja que tenga ese item. `null` si todavia no hay dos muestras para comparar.
 */
export function ratesPerMinute(history: readonly Sample[]): Record<string, number | null> {
  const newest = history.at(-1);
  if (!newest) return {};

  const rates: Record<string, number | null> = {};
  for (const [item, newestTotal] of Object.entries(newest.totals)) {
    // Un item puede aparecer a mitad del historial si se actualizo el mod.
    const oldest = history.find((s) => Object.hasOwn(s.totals, item));
    const elapsedTicks = oldest ? newest.tick - oldest.tick : 0;
    if (!oldest || elapsedTicks <= 0) {
      rates[item] = null;
      continue;
    }
    const elapsedMinutes = elapsedTicks / TICKS_PER_SECOND / 60;
    rates[item] = (newestTotal - oldest.totals[item]) / elapsedMinutes;
  }
  return rates;
}
