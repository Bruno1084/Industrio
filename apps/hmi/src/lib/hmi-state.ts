import type { PlantStateView } from "./contract";
import { appendTrendPoint, TREND_WINDOW_SECONDS, type TrendPoint } from "./trend";

/** Conexion navegador <-> gateway. */
export type GatewayConnection = "connecting" | "connected" | "incompatible";

export interface HmiState {
  gateway: GatewayConnection;
  /** Ultimo estado valido recibido. `null` si todavia no llego ninguno. */
  lastState: PlantStateView | null;
  /**
   * Ya llego algun evento del gateway (valido o no). Distingue el arranque
   * ("Conectando...") de un corte ("Sin conexion"), que es una falla.
   */
  hadDataBefore: boolean;
  /** Motivo del ultimo evento rechazado, mientras `gateway` sea `incompatible`. */
  incompatibleReason: string | null;
  trend: readonly TrendPoint[];
}

export type HmiAction =
  /** Se abrio la conexion HTTP del stream. */
  | { type: "opened" }
  /** Se corto la conexion; EventSource esta reconectando (o se va a recrear). */
  | { type: "error" }
  | { type: "event-received"; state: PlantStateView }
  | { type: "event-invalid"; reason: string };

export const initialHmiState: HmiState = {
  gateway: "connecting",
  lastState: null,
  hadDataBefore: false,
  incompatibleReason: null,
  trend: [],
};

/**
 * Reductor puro e inmutable. Devuelve la misma referencia si nada cambio,
 * asi los suscriptores (useSyncExternalStore) no vuelven a renderizar en vano.
 */
export function reduceHmi(state: HmiState, action: HmiAction): HmiState {
  switch (action.type) {
    case "opened":
      // Abrir la conexion no confirma que el gateway hable este contrato:
      // se sigue en `connecting` hasta el primer evento valido.
      return state;

    case "error":
      if (state.gateway === "connecting") return state;
      return { ...state, gateway: "connecting", incompatibleReason: null };

    case "event-received":
      return {
        gateway: "connected",
        lastState: action.state,
        hadDataBefore: true,
        incompatibleReason: null,
        trend: appendTrendPoint(state.trend, action.state, TREND_WINDOW_SECONDS),
      };

    case "event-invalid":
      // Se conserva el ultimo estado valido y su tendencia.
      if (state.gateway === "incompatible" && state.incompatibleReason === action.reason) return state;
      return { ...state, gateway: "incompatible", hadDataBefore: true, incompatibleReason: action.reason };
  }
}

export type Severity = "normal" | "info" | "warning" | "critical";

export interface CommStatus {
  label: string;
  severity: Severity;
  /** Los valores solo se presentan como vigentes con la planta en linea. */
  valuesAreLive: boolean;
}

/** Combina la conexion con el gateway y el enlace gateway <-> planta en un solo indicador. */
export function deriveCommStatus(state: HmiState): CommStatus {
  if (state.gateway === "connecting") {
    return state.hadDataBefore
      ? { label: "Sin conexión con el gateway", severity: "critical", valuesAreLive: false }
      : { label: "Conectando con el gateway…", severity: "info", valuesAreLive: false };
  }
  if (state.gateway === "incompatible") {
    return { label: "Versión de API incompatible", severity: "critical", valuesAreLive: false };
  }

  // `connected` implica un evento valido; el chequeo es solo para el tipo.
  const link = state.lastState?.link.status;
  switch (link) {
    case "no_data":
      return { label: "Sin datos de la planta", severity: "critical", valuesAreLive: false };
    case "incompatible":
      return { label: "Telemetría incompatible", severity: "critical", valuesAreLive: false };
    case "stale":
      return { label: "Planta sin respuesta", severity: "warning", valuesAreLive: false };
    case "online":
      return { label: "En línea", severity: "normal", valuesAreLive: true };
    case undefined:
      return { label: "Conectando con el gateway…", severity: "info", valuesAreLive: false };
  }
}
