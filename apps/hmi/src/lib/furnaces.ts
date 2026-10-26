import { furnaceStatusLabel, isAbnormalFurnaceStatus } from "./format";

export interface FurnaceRow {
  status: string;
  label: string;
  count: number;
  /** Fraccion del total (0..1); `null` si no hay hornos. */
  fraction: number | null;
  abnormal: boolean;
}

/** Hornos por estado para la barra y la tabla: de mayor a menor cantidad, empates por nombre. */
export function furnaceBreakdown(byStatus: Readonly<Record<string, number>>, total: number): FurnaceRow[] {
  return Object.entries(byStatus)
    .map(([status, count]) => ({
      status,
      label: furnaceStatusLabel(status),
      count,
      fraction: total > 0 ? count / total : null,
      abnormal: isAbnormalFurnaceStatus(status),
    }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}
