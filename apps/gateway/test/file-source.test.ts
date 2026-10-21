import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { FileSnapshotSource } from "../src/sources/file-source.js";
import type { SourceResult } from "../src/sources/snapshot-source.js";
import { memoryLogger, rawSnapshot } from "./helpers.js";

// Intervalo largo: en estos tests solo cuenta la lectura inmediata de start().
const LONG_INTERVAL_MS = 60_000;

/** Arranca la fuente, espera el primer resultado y la detiene. */
async function readOnce(filePath: string, readText?: (filePath: string) => Promise<string>): Promise<SourceResult> {
  const source = new FileSnapshotSource({
    filePath,
    intervalMs: LONG_INTERVAL_MS,
    logger: memoryLogger().logger,
    readText,
  });
  const result = new Promise<SourceResult>((resolve) => source.subscribe(resolve));
  source.start();
  try {
    return await result;
  } finally {
    await source.stop();
  }
}

/** Promesa que se resuelve desde afuera, para simular una lectura lenta. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("FileSnapshotSource", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gateway-test-"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("entrega el JSON crudo, sin validarlo", async () => {
    const file = path.join(dir, "valido.json");
    const raw = { ...rawSnapshot(60), schema_version: 99 };
    await writeFile(file, JSON.stringify(raw));
    assert.deepEqual(await readOnce(file), { kind: "snapshot", raw });
  });

  it("clasifica el archivo inexistente como missing", async () => {
    assert.deepEqual(await readOnce(path.join(dir, "no-existe.json")), { kind: "missing" });
  });

  it("clasifica el JSON cortado o vacio como partial", async () => {
    const cut = path.join(dir, "cortado.json");
    await writeFile(cut, JSON.stringify(rawSnapshot(60)).slice(0, 25));
    assert.deepEqual(await readOnce(cut), { kind: "partial" });

    const empty = path.join(dir, "vacio.json");
    await writeFile(empty, "");
    assert.deepEqual(await readOnce(empty), { kind: "partial" });
  });

  it("clasifica las demas fallas como error", async () => {
    // Leer una carpeta como archivo: EISDIR en Linux/macOS, EISDIR o EPERM en Windows.
    const result = await readOnce(dir);
    assert.equal(result.kind, "error");

    const denied = Object.assign(new Error("permiso denegado"), { code: "EACCES" });
    const injected = await readOnce("x", () => Promise.reject(denied));
    assert.deepEqual(injected, { kind: "error", error: denied });
  });

  it("no superpone lecturas si una tarda mas que el intervalo", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      let pending = deferred<string>();
      let reads = 0;
      const source = new FileSnapshotSource({
        filePath: "x",
        intervalMs: 1000,
        logger: memoryLogger().logger,
        readText: () => {
          reads += 1;
          return pending.promise;
        },
      });
      const results: SourceResult[] = [];
      source.subscribe((result) => results.push(result));

      source.start();
      mock.timers.tick(1000);
      mock.timers.tick(1000);
      mock.timers.tick(1000);
      assert.equal(reads, 1, "la primera lectura sigue en curso");

      pending.resolve(JSON.stringify(rawSnapshot(60)));
      await flush();
      assert.equal(results.length, 1);

      pending = deferred<string>();
      mock.timers.tick(1000);
      assert.equal(reads, 2, "termino la anterior: vuelve a leer");

      // stop() espera la lectura en curso.
      let stopped = false;
      const stopping = source.stop().then(() => {
        stopped = true;
      });
      await flush();
      assert.equal(stopped, false);
      pending.resolve(JSON.stringify(rawSnapshot(120)));
      await stopping;
      assert.equal(results.length, 2);

      mock.timers.tick(5000);
      assert.equal(reads, 2, "detenida: no vuelve a leer");
    } finally {
      mock.timers.reset();
    }
  });

  it("aisla a los suscriptores que fallan", async () => {
    const { logger, lines } = memoryLogger();
    const source = new FileSnapshotSource({
      filePath: path.join(dir, "no-existe.json"),
      intervalMs: LONG_INTERVAL_MS,
      logger,
    });
    source.subscribe(() => {
      throw new Error("suscriptor roto");
    });
    const result = new Promise<SourceResult>((resolve) => source.subscribe(resolve));
    source.start();
    assert.deepEqual(await result, { kind: "missing" });
    await source.stop();
    assert.ok(lines.some((l) => l.level === "error" && /suscriptor roto/.test(l.line)));
  });
});
