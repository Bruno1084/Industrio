import type { Logger } from "../logger.js";
import { appendSample, ratesPerMinute, TICKS_PER_SECOND, type Sample } from "./rates.js";
import type { Snapshot } from "./snapshot.js";

export type LinkStatus = "no_data" | "incompatible" | "online" | "stale";

// ---------------------------------------------------------------------------
// Contrato de salida (gateway -> clientes), version 1.
// Es independiente del JSON del mod: los clientes dependen de esto, nunca de latest.json.
// ---------------------------------------------------------------------------

export const API_VERSION = 1;

export interface ProductionView {
  total: number;
  /** Por minuto de juego. `null` mientras no haya dos muestras para comparar. */
  perMinute: number | null;
}

export interface PlantView {
  tick: number;
  gameTimeSeconds: number;
  furnaces: { total: number; byStatus: Record<string, number> };
  production: Record<string, ProductionView>;
}

export interface PlantStateView {
  apiVersion: typeof API_VERSION;
  link: {
    status: LinkStatus;
    /** Ultima vez que se vio avanzar el tick. `null` si todavia no se vio avanzar. */
    lastTickChangeAt: string | null;
    /** Ultima lectura de un snapshot valido. */
    lastReadAt: string | null;
  };
  /** Ultimo estado valido conocido. `null` si nunca hubo un snapshot valido. */
  plant: PlantView | null;
}

// ---------------------------------------------------------------------------

export interface PlantStateStoreOptions {
  staleAfterMs: number;
  rateWindowSeconds: number;
  logger: Logger;
  /** Reloj en ms desde epoch. Inyectable para los tests. */
  now?: () => number;
}

export type StateListener = (state: PlantStateView) => void;

/** Resultado de la ultima lectura de la fuente; define el estado del enlace junto con el reloj. */
type LastRead = "none" | "missing" | "invalid" | "valid";

/**
 * Estado en memoria de la planta: ultimo snapshot valido, historial para tasas y estado del enlace.
 * Notifica a los suscriptores solo cuando cambia el tick o el estado del enlace.
 */
export class PlantStateStore {
  private readonly staleAfterMs: number;
  private readonly rateWindowSeconds: number;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly listeners = new Set<StateListener>();

  private lastRead: LastRead = "none";
  private snapshot: Snapshot | null = null;
  private history: Sample[] = [];
  private lastTickChangeAt: number | null = null;
  private lastReadAt: number | null = null;
  private invalidReason: string | null = null;
  private partialReads = 0;

  private status: LinkStatus = "no_data";
  private view: PlantStateView;

  constructor(options: PlantStateStoreOptions) {
    this.staleAfterMs = options.staleAfterMs;
    this.rateWindowSeconds = options.rateWindowSeconds;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.view = this.buildView();
  }

  /** Estado actual segun el contrato de salida. */
  getState(): PlantStateView {
    return this.view;
  }

  /** Cantidad de lecturas descartadas por JSON incompleto (el juego estaba escribiendo). */
  getPartialReadCount(): number {
    return this.partialReads;
  }

  /** Suscribe a cambios de estado. Devuelve la funcion para desuscribirse. */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Llego un snapshot que paso la validacion. */
  acceptSnapshot(snapshot: Snapshot): void {
    const now = this.now();
    const previousTick = this.snapshot?.tick ?? null;

    if (previousTick !== null && snapshot.tick < previousTick) {
      this.logger.info("El tick retrocedio: se cargo otra partida, se reinicia el historial de tasas", {
        previousTick,
        tick: snapshot.tick,
      });
      this.history = [];
    }

    // Con el juego pausado el archivo no cambia: mismo tick, nada nuevo que procesar.
    // El primer snapshot no cuenta como avance: el archivo puede ser de una partida ya cerrada.
    if (snapshot.tick !== previousTick) {
      if (previousTick !== null) this.lastTickChangeAt = now;
      this.snapshot = snapshot;
      this.history = appendSample(
        this.history,
        { tick: snapshot.tick, totals: snapshot.production },
        this.rateWindowSeconds,
      );
    }

    if (this.lastRead === "invalid") {
      this.logger.info("Snapshot valido otra vez", { tick: snapshot.tick });
    }
    this.lastRead = "valid";
    this.invalidReason = null;
    this.lastReadAt = now;
    this.refresh();
  }

  /** El archivo existe pero no pasa la validacion. Se conserva el ultimo estado valido. */
  rejectSnapshot(reason: string): void {
    // Solo se loguea cuando cambia el motivo, no en cada ciclo de lectura.
    if (reason !== this.invalidReason) {
      this.logger.warn("Snapshot incompatible, se conserva el ultimo estado valido", { reason });
      this.invalidReason = reason;
    }
    this.lastRead = "invalid";
    this.refresh();
  }

  /** El archivo no existe (juego nunca iniciado con el mod, o carpeta equivocada). */
  reportMissing(): void {
    this.lastRead = "missing";
    this.invalidReason = null;
    this.refresh();
  }

  /** JSON incompleto leido mientras el juego escribia. No cambia el estado: se reintenta en el proximo ciclo. */
  reportPartialRead(): void {
    this.partialReads += 1;
    this.logger.debug("JSON incompleto, se reintenta en el proximo ciclo", { partialReads: this.partialReads });
    this.refresh();
  }

  /**
   * Reevalua el estado del enlace con el reloj actual. Lo llaman todas las operaciones;
   * tambien se puede llamar periodicamente para detectar `stale` aunque la fuente no responda.
   */
  refresh(): void {
    const status = this.computeStatus();
    const previous = this.view;
    if (status !== this.status) {
      this.logger.info("Estado del enlace", { from: this.status, to: status });
      this.status = status;
    }
    this.view = this.buildView();

    const changed = status !== previous.link.status || this.view.plant?.tick !== previous.plant?.tick;
    if (changed) this.emit();
  }

  private computeStatus(): LinkStatus {
    switch (this.lastRead) {
      case "none":
      case "missing":
        return "no_data";
      case "invalid":
        return "incompatible";
      case "valid":
        return this.lastTickChangeAt !== null && this.now() - this.lastTickChangeAt <= this.staleAfterMs
          ? "online"
          : "stale";
    }
  }

  private buildView(): PlantStateView {
    return {
      apiVersion: API_VERSION,
      link: {
        status: this.status,
        lastTickChangeAt: toIso(this.lastTickChangeAt),
        lastReadAt: toIso(this.lastReadAt),
      },
      plant: this.snapshot ? this.buildPlantView(this.snapshot) : null,
    };
  }

  private buildPlantView(snapshot: Snapshot): PlantView {
    const rates = ratesPerMinute(this.history);
    const production: Record<string, ProductionView> = {};
    for (const [item, total] of Object.entries(snapshot.production)) {
      production[item] = { total, perMinute: rates[item] ?? null };
    }
    return {
      tick: snapshot.tick,
      gameTimeSeconds: Math.floor(snapshot.tick / TICKS_PER_SECOND),
      furnaces: { total: snapshot.furnaces.total, byStatus: { ...snapshot.furnaces.by_status } },
      production,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      // Un suscriptor con errores no debe cortar la notificacion al resto ni la lectura.
      try {
        listener(this.view);
      } catch (error) {
        this.logger.error("Error en un suscriptor de cambios de estado", { error });
      }
    }
  }
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
