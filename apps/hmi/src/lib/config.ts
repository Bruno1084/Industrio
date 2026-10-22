import { z } from "zod";

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:4000";

export type GatewayConfig =
  | { ok: true; baseUrl: string; streamUrl: string }
  | { ok: false; reason: string };

const gatewayUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  }, "debe ser un origen http(s) como http://127.0.0.1:4000 (esquema, host y puerto; sin ruta ni barra final)")
  .default(DEFAULT_GATEWAY_URL);

/**
 * Configuracion del gateway. El valor por defecto del parametro usa el acceso literal
 * `process.env.NEXT_PUBLIC_GATEWAY_URL`, que es lo que Next reemplaza en el build;
 * los tests pasan el valor directamente.
 */
export function readGatewayConfig(raw: string | undefined = process.env.NEXT_PUBLIC_GATEWAY_URL): GatewayConfig {
  const result = gatewayUrlSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ");
    return { ok: false, reason: `NEXT_PUBLIC_GATEWAY_URL inválida (${JSON.stringify(raw)}): ${message}` };
  }
  return { ok: true, baseUrl: result.data, streamUrl: `${result.data}/api/stream` };
}
