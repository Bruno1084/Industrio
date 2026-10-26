"use client";

import { usePlantState } from "@/hooks/use-plant-state";
import { readGatewayConfig } from "@/lib/config";
import { deriveCommStatus } from "@/lib/hmi-state";

// Se evalua una vez: NEXT_PUBLIC_GATEWAY_URL queda incrustada en el build.
const config = readGatewayConfig();

export function PlantOverview() {
  if (!config.ok) {
    return (
      <section role="alert">
        <h2>Error de configuración</h2>
        <p>{config.reason}</p>
      </section>
    );
  }
  return <LiveState streamUrl={config.streamUrl} />;
}

// Vista temporal (tarea 3): estado crudo para verificar el cliente SSE.
function LiveState({ streamUrl }: { streamUrl: string }) {
  const state = usePlantState(streamUrl);
  const comm = deriveCommStatus(state);
  return (
    <>
      <p>
        <strong>{comm.label}</strong> ({comm.severity}) — {streamUrl}
      </p>
      <pre>{JSON.stringify({ ...state, trend: `${state.trend.length} puntos` }, null, 2)}</pre>
    </>
  );
}
