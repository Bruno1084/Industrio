import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

const HOME = path.resolve("home-de-prueba");
const APPDATA = path.resolve("appdata-de-prueba");

function load(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = "win32") {
  return loadConfig({ APPDATA, ...env }, platform, HOME);
}

function assertConfigError(fn: () => unknown, ...fragments: string[]): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ConfigError, "se esperaba ConfigError");
    for (const fragment of fragments) assert.match(error.message, new RegExp(fragment));
    return true;
  });
}

describe("loadConfig", () => {
  it("usa los valores por defecto", () => {
    const config = load({});
    assert.deepEqual(config, {
      factorioDataDir: path.join(APPDATA, "Factorio"),
      telemetryFile: path.join(APPDATA, "Factorio", "script-output", "scada-bridge", "latest.json"),
      host: "127.0.0.1",
      port: 4000,
      pollIntervalMs: 1000,
      staleAfterMs: 5000,
      rateWindowSeconds: 60,
      corsOrigin: "http://localhost:3000",
      logLevel: "info",
    });
  });

  it("deduce la carpeta de datos en Linux y macOS", () => {
    assert.equal(load({}, "linux").factorioDataDir, path.join(HOME, ".factorio"));
    assert.equal(
      load({}, "darwin").factorioDataDir,
      path.join(HOME, "Library", "Application Support", "factorio"),
    );
  });

  it("respeta FACTORIO_DATA_DIR", () => {
    const dir = path.resolve("datos-temporales");
    const config = load({ FACTORIO_DATA_DIR: dir });
    assert.equal(config.telemetryFile, path.join(dir, "script-output", "scada-bridge", "latest.json"));
  });

  it("falla con un mensaje claro si en Windows no hay APPDATA ni FACTORIO_DATA_DIR", () => {
    assertConfigError(() => loadConfig({}, "win32", HOME), "FACTORIO_DATA_DIR");
  });

  it("lee valores numericos validos", () => {
    const config = load({
      GATEWAY_PORT: "4001",
      POLL_INTERVAL_MS: "500",
      STALE_AFTER_MS: "3000",
      RATE_WINDOW_SECONDS: "30",
    });
    assert.equal(config.port, 4001);
    assert.equal(config.pollIntervalMs, 500);
    assert.equal(config.staleAfterMs, 3000);
    assert.equal(config.rateWindowSeconds, 30);
  });

  it("trata una variable vacia como no definida", () => {
    assert.equal(load({ GATEWAY_PORT: "" }).port, 4000);
  });

  it("acepta LOG_LEVEL sin importar mayusculas", () => {
    assert.equal(load({ LOG_LEVEL: "DEBUG" }).logLevel, "debug");
  });

  it("rechaza numeros mal formados o fuera de rango", () => {
    assertConfigError(() => load({ GATEWAY_PORT: "abc" }), "GATEWAY_PORT", "entero");
    assertConfigError(() => load({ GATEWAY_PORT: "1e3" }), "GATEWAY_PORT");
    assertConfigError(() => load({ GATEWAY_PORT: "70000" }), "GATEWAY_PORT", "65535");
    assertConfigError(() => load({ RATE_WINDOW_SECONDS: "0" }), "RATE_WINDOW_SECONDS");
  });

  it("rechaza STALE_AFTER_MS que no supere a POLL_INTERVAL_MS", () => {
    assertConfigError(
      () => load({ POLL_INTERVAL_MS: "5000", STALE_AFTER_MS: "5000" }),
      "STALE_AFTER_MS",
      "POLL_INTERVAL_MS",
    );
  });

  it("rechaza un CORS_ORIGIN que no sea un origen", () => {
    assertConfigError(() => load({ CORS_ORIGIN: "http://localhost:3000/" }), "CORS_ORIGIN");
    assertConfigError(() => load({ CORS_ORIGIN: "localhost:3000" }), "CORS_ORIGIN");
  });

  it("rechaza un LOG_LEVEL desconocido", () => {
    assertConfigError(() => load({ LOG_LEVEL: "verbose" }), "LOG_LEVEL", "debug, info, warn, error");
  });

  it("informa todos los errores juntos", () => {
    assertConfigError(() => load({ GATEWAY_PORT: "x", LOG_LEVEL: "x" }), "GATEWAY_PORT", "LOG_LEVEL");
  });
});
