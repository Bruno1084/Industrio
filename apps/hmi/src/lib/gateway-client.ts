import { parseStateEvent } from "./contract";
import { initialHmiState, reduceHmi, type HmiAction, type HmiState } from "./hmi-state";

/** Espera antes de recrear un EventSource que el navegador dio por cerrado. */
export const RECREATE_DELAY_MS = 5000;

// Valor de `EventSource.CLOSED`. Se usa el literal para no depender del global
// (no existe en el servidor ni en los tests).
const READY_STATE_CLOSED = 2;

/** Lo minimo que el cliente usa de EventSource; permite inyectar un doble en los tests. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: "state", listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface GatewayClientOptions {
  createEventSource?: (url: string) => EventSourceLike;
  recreateDelayMs?: number;
}

/**
 * Conexion SSE con el gateway convertida en un store externo (subscribe/getSnapshot),
 * como lo espera `useSyncExternalStore`. No depende de React.
 *
 * La reconexion ante cortes la hace EventSource solo (el gateway manda `retry: 2000`);
 * el cliente solo interviene si el navegador abandona la conexion (`CLOSED`, por
 * ejemplo ante una respuesta HTTP que no es 200).
 */
export class GatewayClient {
  private readonly streamUrl: string;
  private readonly createEventSource: (url: string) => EventSourceLike;
  private readonly recreateDelayMs: number;
  private readonly listeners = new Set<() => void>();
  private state: HmiState = initialHmiState;
  private source: EventSourceLike | null = null;
  private recreateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(streamUrl: string, options: GatewayClientOptions = {}) {
    this.streamUrl = streamUrl;
    this.createEventSource = options.createEventSource ?? ((url) => new EventSource(url));
    this.recreateDelayMs = options.recreateDelayMs ?? RECREATE_DELAY_MS;
  }

  /** Abre la conexion. Idempotente. */
  start(): void {
    if (this.source !== null || this.recreateTimer !== null) return;
    this.open();
  }

  /** Cierra la conexion y cancela una recreacion pendiente. Conserva el ultimo estado. */
  stop(): void {
    if (this.recreateTimer !== null) {
      clearTimeout(this.recreateTimer);
      this.recreateTimer = null;
    }
    this.closeSource();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Misma referencia mientras el estado no cambie (requisito de useSyncExternalStore). */
  getSnapshot = (): HmiState => this.state;

  private open(): void {
    const source = this.createEventSource(this.streamUrl);
    this.source = source;

    source.onopen = () => this.dispatch({ type: "opened" });
    source.addEventListener("state", (event) => {
      if (typeof event.data !== "string") {
        this.dispatch({ type: "event-invalid", reason: "el evento no trae texto" });
        return;
      }
      const result = parseStateEvent(event.data);
      this.dispatch(
        result.ok ? { type: "event-received", state: result.state } : { type: "event-invalid", reason: result.reason },
      );
    });
    source.onerror = () => {
      this.dispatch({ type: "error" });
      if (source.readyState !== READY_STATE_CLOSED) return;
      // El navegador no va a reintentar: se recrea la conexion mas tarde.
      this.closeSource();
      this.recreateTimer = setTimeout(() => {
        this.recreateTimer = null;
        this.open();
      }, this.recreateDelayMs);
    };
  }

  private closeSource(): void {
    if (this.source === null) return;
    this.source.onopen = null;
    this.source.onerror = null;
    this.source.close();
    this.source = null;
  }

  private dispatch(action: HmiAction): void {
    const next = reduceHmi(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
