import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger, type LogLevel } from "../src/logger.js";

function capture(minLevel: LogLevel) {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = createLogger(minLevel, (level, line) => lines.push({ level, line }));
  return { logger, lines };
}

describe("createLogger", () => {
  it("descarta los niveles por debajo del minimo", () => {
    const { logger, lines } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    assert.deepEqual(
      lines.map((l) => l.level),
      ["warn", "error"],
    );
  });

  it("formatea fecha, nivel, mensaje y contexto en una linea", () => {
    const { logger, lines } = capture("debug");
    logger.info("Enlace online", { tick: 120 });
    assert.match(lines[0].line, /^\d{4}-\d{2}-\d{2}T\S+Z INFO  Enlace online \{"tick":120\}$/);
  });

  it("serializa los Error con sus datos utiles", () => {
    const { logger, lines } = capture("debug");
    const error = Object.assign(new Error("sin permiso"), { code: "EACCES" });
    logger.error("Fallo de lectura", { error });
    assert.match(lines[0].line, /"message":"sin permiso"/);
    assert.match(lines[0].line, /"code":"EACCES"/);
  });
});
