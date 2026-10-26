import type { ReactNode } from "react";
import styles from "./panel.module.css";

interface PanelProps {
  title: string;
  /** Leyenda de valor no vigente; si existe, el contenido se atenúa. */
  staleCaption: string | null;
  children: ReactNode;
  footer?: ReactNode;
}

/** Marco común de los paneles de la vista general. */
export function Panel({ title, staleCaption, children, footer }: PanelProps) {
  return (
    <section className={styles.panel} aria-label={title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {staleCaption !== null && <p className={styles.staleCaption}>{staleCaption}</p>}
      </header>
      <div className={staleCaption === null ? styles.body : `${styles.body} ${styles.stale}`}>{children}</div>
      {footer !== undefined && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}
