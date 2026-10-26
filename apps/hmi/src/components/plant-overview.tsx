"use client";

import { useNow } from "@/hooks/use-now";
import { usePlantState } from "@/hooks/use-plant-state";
import { readGatewayConfig } from "@/lib/config";
import { formatAge, formatGameTime } from "@/lib/format";
import { deriveCommStatus, plantUnavailableMessage } from "@/lib/hmi-state";
import { TREND_WINDOW_SECONDS } from "@/lib/trend";
import { CommStatusBar } from "./comm-status-bar";
import { FurnacePanel } from "./furnace-panel";
import { ProductionPanel } from "./production-panel";
import styles from "./plant-overview.module.css";

// Se evalua una vez: NEXT_PUBLIC_GATEWAY_URL queda incrustada en el build.
const config = readGatewayConfig();

// Refresco de la antigüedad del dato.
const CLOCK_INTERVAL_MS = 1000;

export function PlantOverview() {
  if (!config.ok) {
    // Sin una URL valida no se intenta conectar: se explica el motivo.
    return (
      <section className={styles.configError} role="alert">
        <h2 className={styles.configErrorTitle}>
          <span aria-hidden="true">◆ </span>Error de configuración
        </h2>
        <p>{config.reason}</p>
        <p>
          Corregí la variable y reiniciá <code>npm run dev</code> (o volvé a ejecutar <code>npm run build</code>).
        </p>
      </section>
    );
  }
  return <LiveOverview baseUrl={config.baseUrl} streamUrl={config.streamUrl} />;
}

function LiveOverview({ baseUrl, streamUrl }: { baseUrl: string; streamUrl: string }) {
  const state = usePlantState(streamUrl);
  const now = useNow(CLOCK_INTERVAL_MS);

  const comm = deriveCommStatus(state);
  const plant = state.lastState?.plant ?? null;
  const lastTickChangeAt = state.lastState?.link.lastTickChangeAt ?? null;

  // Antigüedad con el reloj del navegador: gateway y HMI corren en la misma máquina.
  const lastChange =
    lastTickChangeAt === null ? "sin avances registrados" : `hace ${formatAge(now - Date.parse(lastTickChangeAt))}`;
  // Los valores solo se presentan como vigentes con la planta en linea.
  const staleCaption = comm.valuesAreLive || plant === null ? null : `Último valor conocido · último cambio ${lastChange}`;
  const unavailableMessage = plantUnavailableMessage(state);

  return (
    <div className={styles.overview}>
      <CommStatusBar
        comm={comm}
        detail={state.gateway === "incompatible" ? state.incompatibleReason : null}
        gameTime={formatGameTime(plant?.gameTimeSeconds ?? null)}
        lastChange={plant === null ? "—" : lastChange}
        gatewayUrl={baseUrl}
      />
      <div className={styles.grid}>
        <FurnacePanel
          furnaces={plant?.furnaces ?? null}
          staleCaption={staleCaption}
          unavailableMessage={unavailableMessage}
        />
        <ProductionPanel
          production={plant?.production ?? null}
          trend={state.trend}
          trendWindowSeconds={TREND_WINDOW_SECONDS}
          staleCaption={staleCaption}
          unavailableMessage={unavailableMessage}
        />
      </div>
    </div>
  );
}
