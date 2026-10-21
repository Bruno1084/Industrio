import { z } from "zod";

// Unica version del contrato del mod que este gateway sabe interpretar.
export const SUPPORTED_SCHEMA_VERSION = 1;

const TOTAL_SUFFIX = "_total";

const countSchema = z.number().int("debe ser un entero").nonnegative("no puede ser negativo");

/**
 * `production` trae totales acumulados con el nombre `<item>_total`.
 * Se normaliza a `{ <item>: total }` y se ignoran los campos sin el sufijo: el mod puede
 * agregar campos nuevos sin subir `schema_version`, y un campo desconocido no debe tirar abajo el enlace.
 */
const productionSchema = z.record(z.string(), z.unknown()).transform((raw, ctx) => {
  const totals: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.endsWith(TOTAL_SUFFIX) || key.length === TOTAL_SUFFIX.length) continue;
    // Sin exigir entero: los fluidos se miden en unidades fraccionarias.
    const result = z.number().nonnegative().safeParse(value);
    if (!result.success) {
      ctx.addIssue({ code: "custom", path: [key], message: "debe ser un numero no negativo" });
      continue;
    }
    totals[key.slice(0, -TOTAL_SUFFIX.length)] = result.data;
  }
  return totals;
});

/** Esquema del `latest.json` que escribe el mod `scada-bridge`. Los campos desconocidos se descartan. */
export const snapshotSchema = z.object({
  schema_version: z.literal(
    SUPPORTED_SCHEMA_VERSION,
    `version no soportada (este gateway solo acepta ${SUPPORTED_SCHEMA_VERSION})`,
  ),
  tick: countSchema,
  furnaces: z.object({
    total: countSchema,
    by_status: z.record(z.string(), countSchema),
  }),
  production: productionSchema,
});

/** Snapshot ya validado. Ojo: `production` queda indexado por nombre de item, sin el sufijo `_total`. */
export type Snapshot = z.output<typeof snapshotSchema>;

export type ParseResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

/** Valida un JSON ya parseado. `reason` es una linea legible para el log, p. ej. "tick: debe ser un entero". */
export function parseSnapshot(raw: unknown): ParseResult {
  const result = snapshotSchema.safeParse(raw);
  if (result.success) return { ok: true, snapshot: result.data };

  const reason = result.error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
  return { ok: false, reason };
}
