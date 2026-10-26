import { formatRate } from "@/lib/format";
import type { TrendPoint } from "@/lib/trend";
import { buildTrendChart } from "@/lib/trend-chart";
import styles from "./trend-chart.module.css";

// Sistema de coordenadas del SVG; se escala al ancho disponible.
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 80;
// Margen vertical para que la línea no quede pegada a los bordes en el mínimo y el máximo.
const VIEW_PAD = 4;

interface TrendChartProps {
  points: readonly TrendPoint[];
  item: string;
  label: string;
  unit: string;
  windowSeconds: number;
}

/** Tendencia en vivo de la producción por minuto de un ítem. */
export function TrendChart({ points, item, label, unit, windowSeconds }: TrendChartProps) {
  const chart = buildTrendChart(points, item, windowSeconds);
  if (chart === null) return <p className={styles.empty}>Recolectando datos…</p>;

  const toSvg = ({ x, y }: { x: number; y: number }) =>
    `${(x * VIEW_WIDTH).toFixed(2)},${(VIEW_HEIGHT - VIEW_PAD - y * (VIEW_HEIGHT - 2 * VIEW_PAD)).toFixed(2)}`;

  return (
    <figure className={styles.chart}>
      {/* Serie plana: una sola etiqueta, a la altura de la línea (centrada). */}
      <div className={chart.min === chart.max ? `${styles.axis} ${styles.flat}` : styles.axis} aria-hidden="true">
        <span>{formatRate(chart.max)}</span>
        {chart.min !== chart.max && <span>{formatRate(chart.min)}</span>}
      </div>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: entre ${formatRate(chart.min)} y ${formatRate(chart.max)} ${unit} en los últimos ${windowSeconds / 60} min de juego`}
      >
        {chart.segments.map((segment, index) => (
          // Un tramo de un solo punto se dibuja como un punto (extremos redondeados).
          <polyline
            key={index}
            className={styles.line}
            points={(segment.length === 1 ? [segment[0], segment[0]] : segment).map(toSvg).join(" ")}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {/* Celda vacía bajo el eje Y: la leyenda queda alineada con el gráfico. */}
      <span />
      <figcaption className={styles.caption} aria-hidden="true">
        <span>−{windowSeconds / 60} min</span>
        <span>ahora</span>
      </figcaption>
    </figure>
  );
}
