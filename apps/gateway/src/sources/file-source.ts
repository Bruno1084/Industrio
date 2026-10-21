import { readFile } from "node:fs/promises";
import type { Logger } from "../logger.js";
import type { SnapshotSource, SourceListener, SourceResult } from "./snapshot-source.js";

export interface FileSnapshotSourceOptions {
  filePath: string;
  intervalMs: number;
  logger: Logger;
  /** Lectura del archivo. Inyectable para los tests. */
  readText?: (filePath: string) => Promise<string>;
}

/**
 * Lee el archivo por polling. Se eligio polling y no fs.watch porque fs.watch es poco confiable
 * en Windows con archivos que se sobrescriben, y el juego escribe a 1 Hz: leer a 1 Hz alcanza.
 */
export class FileSnapshotSource implements SnapshotSource {
  private readonly filePath: string;
  private readonly intervalMs: number;
  private readonly logger: Logger;
  private readonly readText: (filePath: string) => Promise<string>;
  private readonly listeners = new Set<SourceListener>();

  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: FileSnapshotSourceOptions) {
    this.filePath = options.filePath;
    this.intervalMs = options.intervalMs;
    this.logger = options.logger;
    this.readText = options.readText ?? ((filePath) => readFile(filePath, "utf8"));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    // Primera lectura inmediata para no esperar un intervalo completo al arrancar.
    this.poll();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  subscribe(listener: SourceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Lanza una lectura, salvo que la anterior siga en curso: las lecturas nunca se superponen. */
  private poll(): void {
    if (this.inFlight) return;
    this.inFlight = this.read()
      .then((result) => this.emit(result))
      .finally(() => {
        this.inFlight = null;
      });
  }

  private async read(): Promise<SourceResult> {
    let text: string;
    try {
      text = await this.readText(this.filePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return { kind: "missing" };
      return { kind: "error", error };
    }

    try {
      return { kind: "snapshot", raw: JSON.parse(text) };
    } catch (error) {
      // El juego sobrescribe el archivo; si lo leemos a mitad de la escritura el JSON queda cortado.
      if (error instanceof SyntaxError) return { kind: "partial" };
      return { kind: "error", error };
    }
  }

  private emit(result: SourceResult): void {
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch (error) {
        this.logger.error("Error en un suscriptor de la fuente de snapshots", { error });
      }
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
