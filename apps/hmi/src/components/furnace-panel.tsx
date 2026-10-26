import { formatNumber, formatPercent } from "@/lib/format";
import { furnaceBreakdown } from "@/lib/furnaces";
import type { PlantView } from "@/lib/contract";
import { Panel } from "./panel";
import styles from "./furnace-panel.module.css";

interface FurnacePanelProps {
  furnaces: PlantView["furnaces"] | null;
  staleCaption: string | null;
  /** Mensaje cuando no hay datos de planta. */
  unavailableMessage: string;
}

export function FurnacePanel({ furnaces, staleCaption, unavailableMessage }: FurnacePanelProps) {
  const rows = furnaces === null ? [] : furnaceBreakdown(furnaces.byStatus, furnaces.total);
  const visible = rows.filter((row) => row.count > 0);

  return (
    <Panel title="Hornos" staleCaption={staleCaption}>
      <p className={styles.total}>
        <span className={styles.totalLabel}>Total</span>
        <span className={styles.totalValue}>{formatNumber(furnaces?.total ?? null)}</span>
        <span className={styles.unit}>hornos</span>
      </p>

      {furnaces === null ? (
        <p className={styles.message}>{unavailableMessage}</p>
      ) : (
        <>
          {visible.length > 0 && (
            <div
              className={styles.bar}
              role="img"
              aria-label={`Distribución: ${visible.map((row) => `${row.label} ${row.count}`).join(", ")}`}
            >
              {visible.map((row) => (
                <span
                  key={row.status}
                  className={row.abnormal ? `${styles.segment} ${styles.abnormal}` : styles.segment}
                  style={{ flexGrow: row.count }}
                  title={`${row.label}: ${row.count}`}
                />
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <p className={styles.message}>No hay hornos registrados.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Estado</th>
                  <th scope="col" className={styles.number}>
                    Cantidad
                  </th>
                  <th scope="col" className={styles.number}>
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.status}>
                    <td>
                      {row.abnormal ? (
                        <span className={styles.abnormalStatus}>
                          <span aria-hidden="true">▲ </span>
                          {row.label}
                        </span>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td className={styles.number}>{formatNumber(row.count)}</td>
                    <td className={styles.number}>{formatPercent(row.fraction)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}
