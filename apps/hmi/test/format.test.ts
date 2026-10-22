import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAge,
  formatGameTime,
  formatNumber,
  formatPercent,
  formatRate,
  furnaceStatusLabel,
  isAbnormalFurnaceStatus,
  itemLabel,
} from "../src/lib/format";

describe("formatNumber", () => {
  it("usa separador de miles es-AR y sin decimales", () => {
    assert.equal(formatNumber(1234567), "1.234.567");
    assert.equal(formatNumber(203.6), "204");
    assert.equal(formatNumber(0), "0");
  });

  it("null -> —", () => {
    assert.equal(formatNumber(null), "—");
  });
});

describe("formatRate", () => {
  it("un decimal con coma", () => {
    assert.equal(formatRate(120.54), "120,5");
    assert.equal(formatRate(120), "120,0");
    assert.equal(formatRate(1500), "1.500,0");
  });

  it("null -> —", () => {
    assert.equal(formatRate(null), "—");
  });
});

describe("formatPercent", () => {
  it("porcentaje entero", () => {
    // El espacio antes de "%" depende de la version de ICU: se ignora.
    assert.equal(formatPercent(33 / 48).replace(/\s/g, ""), "69%");
    assert.equal(formatPercent(null), "—");
  });
});

describe("formatGameTime", () => {
  it("h:mm:ss", () => {
    assert.equal(formatGameTime(0), "0:00:00");
    assert.equal(formatGameTime(1164), "0:19:24");
    assert.equal(formatGameTime(3600), "1:00:00");
    assert.equal(formatGameTime(450_309), "125:05:09");
  });

  it("descarta fracciones", () => {
    assert.equal(formatGameTime(59.9), "0:00:59");
  });

  it("null o negativo -> —", () => {
    assert.equal(formatGameTime(null), "—");
    assert.equal(formatGameTime(-1), "—");
  });
});

describe("formatAge", () => {
  it("segundos, minutos y horas", () => {
    assert.equal(formatAge(0), "0 s");
    assert.equal(formatAge(12_900), "12 s");
    assert.equal(formatAge(185_000), "3 min 05 s");
    assert.equal(formatAge(2 * 3_600_000 + 7 * 60_000), "2 h 07 min");
  });

  it("un desfase negativo de relojes se muestra como 0 s", () => {
    assert.equal(formatAge(-300), "0 s");
  });

  it("null -> —", () => {
    assert.equal(formatAge(null), "—");
  });
});

describe("furnaceStatusLabel", () => {
  it("traduce estados conocidos", () => {
    assert.equal(furnaceStatusLabel("working"), "Trabajando");
    assert.equal(furnaceStatusLabel("no_fuel"), "Sin combustible");
  });

  it("estado desconocido -> nombre crudo", () => {
    assert.equal(furnaceStatusLabel("some_new_status"), "some_new_status");
  });

  it("no confunde propiedades heredadas con etiquetas", () => {
    assert.equal(furnaceStatusLabel("toString"), "toString");
  });
});

describe("isAbnormalFurnaceStatus", () => {
  it("working es normal; el resto, incluso desconocido, es anormal", () => {
    assert.equal(isAbnormalFurnaceStatus("working"), false);
    assert.equal(isAbnormalFurnaceStatus("no_fuel"), true);
    assert.equal(isAbnormalFurnaceStatus("full_output"), true);
    assert.equal(isAbnormalFurnaceStatus("some_new_status"), true);
  });
});

describe("itemLabel", () => {
  it("traduce items conocidos", () => {
    assert.equal(itemLabel("iron_plate"), "Placas de hierro");
  });

  it("item desconocido -> nombre del juego con espacios", () => {
    assert.equal(itemLabel("steel_plate"), "steel plate");
  });
});
