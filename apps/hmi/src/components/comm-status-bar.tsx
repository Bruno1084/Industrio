import type { CommStatus, Severity } from "@/lib/hmi-state";
import styles from "./comm-status-bar.module.css";

// Forma además de color: el estado se distingue aunque no se perciba el color.
const SEVERITY_SYMBOL: Record<Severity, string> = {
  normal: "●",
  info: "○",
  warning: "▲",
  critical: "◆",
};

interface CommStatusBarProps {
  comm: CommStatus;
  /** Motivo del rechazo del último evento, si la API es incompatible. */
  detail: string | null;
  gameTime: string;
  lastChange: string;
  gatewayUrl: string;
}

export function CommStatusBar({ comm, detail, gameTime, lastChange, gatewayUrl }: CommStatusBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.status}>
        <p className={`${styles.indicator} ${styles[comm.severity]}`} role="status" aria-live="polite">
          <span className={styles.symbol} aria-hidden="true">
            {SEVERITY_SYMBOL[comm.severity]}
          </span>
          {comm.label}
        </p>
        {detail !== null && <p className={styles.detail}>{detail}</p>}
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Tiempo de juego</dt>
          <dd className={styles.value}>{gameTime}</dd>
        </div>
        <div>
          <dt>Último cambio</dt>
          <dd className={styles.value}>{lastChange}</dd>
        </div>
      </dl>

      <p className={styles.gateway}>Gateway: {gatewayUrl}</p>
    </header>
  );
}
