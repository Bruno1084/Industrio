import { createLogger, type Logger, type LogLevel } from "../src/logger.js";
import type { Snapshot } from "../src/domain/snapshot.js";

/** JSON crudo tal como lo escribe el mod. */
export function rawSnapshot(tick: number, production: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    tick,
    furnaces: { total: 48, by_status: { working: 33, no_fuel: 15 } },
    production,
  };
}

/** Snapshot ya validado (production sin el sufijo `_total`). */
export function snapshot(tick: number, production: Record<string, number> = {}): Snapshot {
  return {
    schema_version: 1,
    tick,
    furnaces: { total: 48, by_status: { working: 33, no_fuel: 15 } },
    production,
  };
}

/** Reloj controlable a mano. */
export function fakeClock(start = Date.parse("2026-10-21T18:00:00.000Z")) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Logger que guarda las lineas para poder inspeccionarlas. */
export function memoryLogger(): { logger: Logger; lines: { level: LogLevel; line: string }[] } {
  const lines: { level: LogLevel; line: string }[] = [];
  return { logger: createLogger("debug", (level, line) => lines.push({ level, line })), lines };
}
