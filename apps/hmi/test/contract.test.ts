import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStateEvent } from "../src/lib/contract";

// Ejemplo de apps/gateway/README.md, seccion "Contrato de salida".
const README_EXAMPLE = {
  apiVersion: 1,
  link: {
    status: "online",
    lastTickChangeAt: "2026-10-21T18:04:12.000Z",
    lastReadAt: "2026-10-21T18:04:12.500Z",
  },
  plant: {
    tick: 69840,
    gameTimeSeconds: 1164,
    furnaces: { total: 48, byStatus: { working: 33, no_fuel: 15 } },
    production: {
      iron_plate: { total: 203, perMinute: 120.5 },
      copper_plate: { total: 0, perMinute: null },
    },
  },
};

function parse(value: unknown) {
  return parseStateEvent(JSON.stringify(value));
}

function reasonOf(value: unknown): string {
  const result = parse(value);
  assert.equal(result.ok, false);
  return result.ok ? "" : result.reason;
}

describe("parseStateEvent", () => {
  it("acepta el ejemplo del README del gateway", () => {
    const result = parse(README_EXAMPLE);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.state, README_EXAMPLE);
  });

  it("acepta plant: null y fechas null", () => {
    const result = parse({
      apiVersion: 1,
      link: { status: "no_data", lastTickChangeAt: null, lastReadAt: null },
      plant: null,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.state.plant, null);
  });

  it("rechaza un apiVersion distinto de 1", () => {
    assert.match(reasonOf({ ...README_EXAMPLE, apiVersion: 2 }), /apiVersion: version de API no soportada/);
  });

  it("rechaza JSON roto", () => {
    const result = parseStateEvent('{"apiVersion": 1, "link": ');
    assert.deepEqual(result, { ok: false, reason: "el evento no es JSON valido" });
  });

  it("rechaza tipos incorrectos indicando el campo", () => {
    const plant = { ...README_EXAMPLE.plant, tick: "69840" };
    assert.match(reasonOf({ ...README_EXAMPLE, plant }), /plant\.tick/);

    const production = { iron_plate: { total: -1, perMinute: 1 } };
    assert.match(reasonOf({ ...README_EXAMPLE, plant: { ...README_EXAMPLE.plant, production } }), /iron_plate\.total/);

    assert.match(reasonOf({ ...README_EXAMPLE, link: { ...README_EXAMPLE.link, status: "unknown" } }), /link\.status/);
    assert.match(
      reasonOf({ ...README_EXAMPLE, link: { ...README_EXAMPLE.link, lastReadAt: "ayer" } }),
      /link\.lastReadAt/,
    );
  });

  it("rechaza un valor que no es un objeto", () => {
    assert.equal(parse(null).ok, false);
    assert.equal(parse([]).ok, false);
  });

  it("ignora campos extra y los descarta", () => {
    const result = parse({ ...README_EXAMPLE, extra: true, link: { ...README_EXAMPLE.link, latencyMs: 3 } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.state, README_EXAMPLE);
  });

  it("acepta items y estados que no conoce", () => {
    const plant = {
      ...README_EXAMPLE.plant,
      furnaces: { total: 2, byStatus: { low_temperature: 2 } },
      production: { steel_plate: { total: 5, perMinute: 1.5 } },
    };
    assert.equal(parse({ ...README_EXAMPLE, plant }).ok, true);
  });
});
