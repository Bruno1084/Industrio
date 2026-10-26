import type { PlantView } from "@/lib/contract";
import { formatNumber, formatRate, itemLabel, itemUnit } from "@/lib/format";
import type { TrendPoint } from "@/lib/trend";
import { Panel } from "./panel";
import { TrendChart } from "./trend-chart";
import styles from "./production-panel.module.css";

interface ProductionPanelProps {
  production: PlantView["production"] | null;
  trend: readonly TrendPoint[];
  trendWindowSeconds: number;
  staleCaption: string | null;
  /** Mensaje cuando no hay datos de planta. */
  unavailableMessage: string;
}

export function ProductionPanel({
  production,
  trend,
  trendWindowSeconds,
  staleCaption,
  unavailableMessage,
}: ProductionPanelProps) {
  const items = production === null ? [] : Object.entries(production);

  return (
    <Panel
      title="Producción"
      staleCaption={staleCaption}
      footer={`Tendencia de los últimos ${trendWindowSeconds / 60} min de juego, en memoria desde que se abrió la página.`}
    >
      {production === null ? (
        <p className={styles.message}>{unavailableMessage}</p>
      ) : items.length === 0 ? (
        <p className={styles.message}>La planta no informa producción.</p>
      ) : (
        items.map(([item, values]) => {
          const label = itemLabel(item);
          const unit = itemUnit(item);
          return (
            <article key={item} className={styles.item}>
              <h3 className={styles.itemTitle}>{label}</h3>
              <dl className={styles.values}>
                <div>
                  <dt>Total</dt>
                  <dd>
                    <span className={styles.value}>{formatNumber(values.total)}</span>
                    <span className={styles.unit}>{unit}</span>
                  </dd>
                </div>
                <div>
                  <dt>Por minuto</dt>
                  <dd>
                    <span className={styles.value}>{formatRate(values.perMinute)}</span>
                    <span className={styles.unit}>{unit}/min</span>
                  </dd>
                </div>
              </dl>
              <TrendChart
                points={trend}
                item={item}
                label={label}
                unit={`${unit}/min`}
                windowSeconds={trendWindowSeconds}
              />
            </article>
          );
        })
      )}
    </Panel>
  );
}
