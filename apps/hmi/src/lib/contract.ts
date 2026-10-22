import { z } from "zod";

// ---------------------------------------------------------------------------
// Contrato de salida del gateway (gateway -> clientes), version 1.
// Copia de la forma: la fuente de verdad es `PlantStateView` en
// apps/gateway/src/domain/plant-state.ts (documentado en apps/gateway/README.md).
// No se importa desde el gateway: las apps no comparten codigo hasta que haya
// un segundo consumidor (entonces se extrae a packages/).
// ---------------------------------------------------------------------------

// Unica version del contrato que esta HMI sabe interpretar.
export const SUPPORTED_API_VERSION = 1;

export const LINK_STATUSES = ["no_data", "incompatible", "online", "stale"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

const countSchema = z.number().int("debe ser un entero").nonnegative("no puede ser negativo");
const isoDateSchema = z.iso.datetime("debe ser una fecha ISO 8601");

const productionSchema = z.object({
  total: z.number().nonnegative("no puede ser negativo"),
  // Sin restriccion de signo: es una diferencia de totales, no una cantidad.
  perMinute: z.number().nullable(),
});

const plantSchema = z.object({
  tick: countSchema,
  gameTimeSeconds: countSchema,
  furnaces: z.object({
    total: countSchema,
    byStatus: z.record(z.string(), countSchema),
  }),
  production: z.record(z.string(), productionSchema),
});

/** Esquema del evento `state` del stream. Los campos desconocidos se descartan. */
export const plantStateViewSchema = z.object({
  apiVersion: z.literal(
    SUPPORTED_API_VERSION,
    `version de API no soportada (esta HMI solo acepta ${SUPPORTED_API_VERSION})`,
  ),
  link: z.object({
    status: z.enum(LINK_STATUSES),
    lastTickChangeAt: isoDateSchema.nullable(),
    lastReadAt: isoDateSchema.nullable(),
  }),
  plant: plantSchema.nullable(),
});

export type PlantStateView = z.output<typeof plantStateViewSchema>;
export type PlantView = NonNullable<PlantStateView["plant"]>;
export type ProductionView = z.output<typeof productionSchema>;

export type ParseStateResult = { ok: true; state: PlantStateView } | { ok: false; reason: string };

/** Valida el `data` de un evento SSE (texto). `reason` es una linea legible para mostrar al operador. */
export function parseStateEvent(data: string): ParseStateResult {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return { ok: false, reason: "el evento no es JSON valido" };
  }

  const result = plantStateViewSchema.safeParse(raw);
  if (result.success) return { ok: true, state: result.data };

  const reason = result.error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
  return { ok: false, reason };
}
