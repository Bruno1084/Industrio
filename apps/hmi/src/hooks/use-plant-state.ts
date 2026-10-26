import { useCallback, useSyncExternalStore } from "react";
import { GatewayClient } from "@/lib/gateway-client";
import { initialHmiState, type HmiState } from "@/lib/hmi-state";

// Espera antes de cerrar la conexion cuando se va el ultimo suscriptor. En desarrollo,
// Strict Mode y Fast Refresh desmontan y vuelven a montar enseguida: sin esta espera
// se cerraria y reabriria el stream en cada montaje.
const STOP_GRACE_MS = 1000;

interface SharedClient {
  client: GatewayClient;
  subscribers: number;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

// Un cliente por URL compartido por todos los componentes: una sola conexion SSE por pestaña.
const shared = new Map<string, SharedClient>();

function getShared(streamUrl: string): SharedClient {
  let entry = shared.get(streamUrl);
  if (entry === undefined) {
    entry = { client: new GatewayClient(streamUrl), subscribers: 0, stopTimer: null };
    shared.set(streamUrl, entry);
  }
  return entry;
}

function acquire(entry: SharedClient): void {
  entry.subscribers += 1;
  if (entry.stopTimer !== null) {
    clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }
  entry.client.start();
}

function release(entry: SharedClient): void {
  entry.subscribers -= 1;
  if (entry.subscribers > 0) return;
  entry.stopTimer = setTimeout(() => {
    entry.stopTimer = null;
    entry.client.stop();
  }, STOP_GRACE_MS);
}

// En el servidor no hay conexion: se renderiza el estado inicial (`connecting`).
const getServerSnapshot = (): HmiState => initialHmiState;

/** Estado de la HMI en vivo. La conexion se abre con el primer componente que lo usa. */
export function usePlantState(streamUrl: string): HmiState {
  const entry = getShared(streamUrl);

  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribe = entry.client.subscribe(listener);
      acquire(entry);
      return () => {
        unsubscribe();
        release(entry);
      };
    },
    [entry],
  );

  return useSyncExternalStore(subscribe, entry.client.getSnapshot, getServerSnapshot);
}
