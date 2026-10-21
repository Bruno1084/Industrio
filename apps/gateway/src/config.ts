import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logger.js";

export interface Config {
  factorioDataDir: string;
  telemetryFile: string;
  host: string;
  port: number;
  pollIntervalMs: number;
  staleAfterMs: number;
  rateWindowSeconds: number;
  corsOrigin: string;
  logLevel: LogLevel;
}

/** Configuracion invalida: el proceso no debe arrancar. El mensaje ya esta listo para mostrar. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

// Entero estricto: rechaza "1e3", "0x10" o "12abc", que Number() aceptaria o truncaria en silencio.
function intVar(min: number, max: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, "debe ser un numero entero")
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, `debe ser mayor o igual a ${min}`)
        .max(max, `debe ser menor o igual a ${max}`),
    );
}

const originVar = z
  .string()
  .trim()
  .refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
    "debe ser un origen como http://localhost:3000 (esquema, host y puerto; sin ruta ni barra final)",
  );

const EnvSchema = z
  .object({
    FACTORIO_DATA_DIR: z.string().optional(),
    GATEWAY_HOST: z.string().trim().min(1, "no puede estar vacia").default("127.0.0.1"),
    GATEWAY_PORT: intVar(1, 65_535).default(4000),
    POLL_INTERVAL_MS: intVar(100, 60_000).default(1000),
    STALE_AFTER_MS: intVar(1000, 3_600_000).default(5000),
    RATE_WINDOW_SECONDS: intVar(1, 3600).default(60),
    CORS_ORIGIN: originVar.default("http://localhost:3000"),
    LOG_LEVEL: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(LOG_LEVELS, `debe ser uno de: ${LOG_LEVELS.join(", ")}`))
      .default("info"),
  })
  // Con un umbral menor que el intervalo de lectura, el enlace oscilaria entre online y stale.
  .refine((env) => env.STALE_AFTER_MS > env.POLL_INTERVAL_MS, {
    path: ["STALE_AFTER_MS"],
    message: "debe ser mayor que POLL_INTERVAL_MS",
  });

/** Carpeta de datos de Factorio segun el sistema operativo. */
function defaultFactorioDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  switch (platform) {
    case "win32":
      if (!env.APPDATA) {
        throw new ConfigError(
          "Configuracion invalida:\n  - FACTORIO_DATA_DIR: no esta definida y tampoco APPDATA para deducirla",
        );
      }
      return path.join(env.APPDATA, "Factorio");
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", "factorio");
    default:
      return path.join(homeDir, ".factorio");
  }
}

/**
 * Lee y valida la configuracion desde variables de entorno.
 * Recibe el entorno y la plataforma como parametros para poder testearla.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): Config {
  // Una variable vacia se trata como no definida: es lo que se espera de `VAR=` en un shell.
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ""));

  const result = EnvSchema.safeParse(defined);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`Configuracion invalida:\n${lines.join("\n")}`);
  }
  const parsed = result.data;

  const factorioDataDir = path.resolve(parsed.FACTORIO_DATA_DIR ?? defaultFactorioDataDir(env, platform, homeDir));

  return {
    factorioDataDir,
    telemetryFile: path.join(factorioDataDir, "script-output", "scada-bridge", "latest.json"),
    host: parsed.GATEWAY_HOST,
    port: parsed.GATEWAY_PORT,
    pollIntervalMs: parsed.POLL_INTERVAL_MS,
    staleAfterMs: parsed.STALE_AFTER_MS,
    rateWindowSeconds: parsed.RATE_WINDOW_SECONDS,
    corsOrigin: parsed.CORS_ORIGIN,
    logLevel: parsed.LOG_LEVEL,
  };
}
