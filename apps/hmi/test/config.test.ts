import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGatewayConfig } from "../src/lib/config";

describe("readGatewayConfig", () => {
  it("usa el gateway local por defecto", () => {
    assert.deepEqual(readGatewayConfig(undefined), {
      ok: true,
      baseUrl: "http://127.0.0.1:4000",
      streamUrl: "http://127.0.0.1:4000/api/stream",
    });
  });

  it("acepta un origen http(s) y recorta espacios", () => {
    const config = readGatewayConfig(" https://gateway.planta.local:8443 ");
    assert.deepEqual(config, {
      ok: true,
      baseUrl: "https://gateway.planta.local:8443",
      streamUrl: "https://gateway.planta.local:8443/api/stream",
    });
  });

  for (const value of ["", "127.0.0.1:4000", "http://127.0.0.1:4000/", "http://127.0.0.1:4000/api", "ftp://host:21"]) {
    it(`rechaza ${JSON.stringify(value)} con un motivo legible`, () => {
      const config = readGatewayConfig(value);
      assert.equal(config.ok, false);
      assert.match(config.ok ? "" : config.reason, /NEXT_PUBLIC_GATEWAY_URL inválida/);
    });
  }
});
