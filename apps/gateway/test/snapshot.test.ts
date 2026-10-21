import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSnapshot } from "../src/domain/snapshot.js";
import { rawSnapshot } from "./helpers.js";

function assertRejected(raw: unknown, fragment: string): void {
  const result = parseSnapshot(raw);
  assert.equal(result.ok, false, "se esperaba un snapshot rechazado");
  if (!result.ok) assert.match(result.reason, new RegExp(fragment));
}

describe("parseSnapshot", () => {
  it("acepta el contrato del mod y normaliza production", () => {
    const result = parseSnapshot(rawSnapshot(69840, { iron_plate_total: 203, copper_plate_total: 0 }));
    assert.ok(result.ok);
    assert.deepEqual(result.snapshot, {
      schema_version: 1,
      tick: 69840,
      furnaces: { total: 48, by_status: { working: 33, no_fuel: 15 } },
      production: { iron_plate: 203, copper_plate: 0 },
    });
  });

  it("ignora campos desconocidos sin rechazar el snapshot", () => {
    const raw = { ...rawSnapshot(60, { iron_plate_total: 1, iron_plate_rate: "x" }), power: { mw: 3 } };
    const result = parseSnapshot(raw);
    assert.ok(result.ok);
    assert.deepEqual(result.snapshot.production, { iron_plate: 1 });
    assert.equal("power" in result.snapshot, false);
  });

  it("rechaza schema_version ausente", () => {
    const { schema_version: _omitted, ...raw } = rawSnapshot(60);
    assertRejected(raw, "schema_version");
  });

  it("rechaza schema_version distinto de 1", () => {
    assertRejected({ ...rawSnapshot(60), schema_version: 2 }, "schema_version: version no soportada");
    assertRejected({ ...rawSnapshot(60), schema_version: "1" }, "schema_version");
  });

  it("rechaza tipos incorrectos", () => {
    assertRejected({ ...rawSnapshot(60), tick: "60" }, "tick");
    assertRejected({ ...rawSnapshot(60), tick: 1.5 }, "tick: debe ser un entero");
    assertRejected({ ...rawSnapshot(60), tick: -1 }, "tick");
    assertRejected({ ...rawSnapshot(60), furnaces: { total: 1, by_status: { working: "1" } } }, "furnaces.by_status.working");
    assertRejected({ ...rawSnapshot(60), furnaces: null }, "furnaces");
    assertRejected(rawSnapshot(60, { iron_plate_total: "203" }), "production.iron_plate_total");
    assertRejected(rawSnapshot(60, { iron_plate_total: -5 }), "production.iron_plate_total");
  });

  it("rechaza algo que no es un objeto", () => {
    assert.equal(parseSnapshot(null).ok, false);
    assert.equal(parseSnapshot([]).ok, false);
    assert.equal(parseSnapshot("hola").ok, false);
  });
});
