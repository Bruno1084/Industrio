import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { furnaceBreakdown } from "../src/lib/furnaces";

describe("furnaceBreakdown", () => {
  it("ordena de mayor a menor y calcula la fraccion sobre el total", () => {
    const rows = furnaceBreakdown({ no_fuel: 12, working: 36 }, 48);
    assert.deepEqual(
      rows.map((r) => [r.status, r.count, r.fraction]),
      [
        ["working", 36, 0.75],
        ["no_fuel", 12, 0.25],
      ],
    );
  });

  it("marca los estados anormales y traduce la etiqueta", () => {
    const [working, noFuel] = furnaceBreakdown({ working: 2, no_fuel: 1 }, 3);
    assert.equal(working?.abnormal, false);
    assert.equal(noFuel?.abnormal, true);
    assert.equal(noFuel?.label, "Sin combustible");
  });

  it("los empates se ordenan por nombre", () => {
    const rows = furnaceBreakdown({ no_power: 1, full_output: 1 }, 2);
    assert.deepEqual(
      rows.map((r) => r.status),
      ["full_output", "no_power"],
    );
  });

  it("sin hornos la fraccion es null", () => {
    assert.equal(furnaceBreakdown({ working: 0 }, 0)[0]?.fraction, null);
  });

  it("sin estados devuelve una lista vacia", () => {
    assert.deepEqual(furnaceBreakdown({}, 0), []);
  });
});
