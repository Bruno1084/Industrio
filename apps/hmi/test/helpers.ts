import type { LinkStatus, PlantStateView } from "../src/lib/contract";

/** Estado del contrato v1 con planta, para un tick y tasas dadas. */
export function plantState(
  tick: number,
  perMinute: Record<string, number | null> = { iron_plate: 120, copper_plate: null },
  status: LinkStatus = "online",
): PlantStateView {
  const production: Record<string, { total: number; perMinute: number | null }> = {};
  for (const [item, rate] of Object.entries(perMinute)) {
    production[item] = { total: tick / 30, perMinute: rate };
  }
  return {
    apiVersion: 1,
    link: {
      status,
      lastTickChangeAt: "2026-10-21T18:04:12.000Z",
      lastReadAt: "2026-10-21T18:04:12.500Z",
    },
    plant: {
      tick,
      gameTimeSeconds: Math.floor(tick / 60),
      furnaces: { total: 48, byStatus: { working: 33, no_fuel: 15 } },
      production,
    },
  };
}

/** Estado del contrato v1 sin planta (el gateway nunca leyo un snapshot valido). */
export function emptyState(status: LinkStatus = "no_data"): PlantStateView {
  return { apiVersion: 1, link: { status, lastTickChangeAt: null, lastReadAt: null }, plant: null };
}
