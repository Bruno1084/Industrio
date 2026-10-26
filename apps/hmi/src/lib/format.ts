// Formato de valores para la pantalla. Funciones puras.

// Configuracion regional unica de la HMI: cambiarla aca cambia todos los numeros.
export const NUMBER_LOCALE = "es-AR";

const EMPTY = "—";

const integerFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 0 });
const rateFormat = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat(NUMBER_LOCALE, { style: "percent", maximumFractionDigits: 0 });

function isPresent(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Cantidades (totales, conteos). Sin decimales. */
export function formatNumber(value: number | null): string {
  return isPresent(value) ? integerFormat.format(value) : EMPTY;
}

/** Tasas por minuto, con un decimal. `null` (todavia sin dos muestras) -> "—". */
export function formatRate(value: number | null): string {
  return isPresent(value) ? rateFormat.format(value) : EMPTY;
}

/** Fraccion 0..1 como porcentaje entero. */
export function formatPercent(fraction: number | null): string {
  return isPresent(fraction) ? percentFormat.format(fraction) : EMPTY;
}

/** Tiempo de juego como h:mm:ss. Las horas no se acotan (una partida puede durar cientos). */
export function formatGameTime(seconds: number | null): string {
  if (!isPresent(seconds) || seconds < 0) return EMPTY;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad2(m)}:${pad2(s)}`;
}

/**
 * Antiguedad legible: "12 s", "3 min 05 s", "2 h 07 min".
 * Un valor negativo (relojes apenas desfasados) se muestra como 0 s.
 */
export function formatAge(ms: number | null): string {
  if (!isPresent(ms)) return EMPTY;
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${pad2(total % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${pad2(minutes % 60)} min`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// Nombres de `defines.entity_status` que pueden tener los hornos, mas "unknown"
// (lo usa el mod si no reconoce el numero). Un estado sin traduccion se muestra crudo.
const FURNACE_STATUS_LABELS: Readonly<Record<string, string>> = {
  working: "Trabajando",
  normal: "Normal",
  no_power: "Sin energía",
  low_power: "Energía baja",
  no_fuel: "Sin combustible",
  no_ingredients: "Sin materia prima",
  no_input_fluid: "Sin fluido de entrada",
  low_input_fluid: "Fluido de entrada bajo",
  no_recipe: "Sin receta",
  item_ingredient_shortage: "Faltan ingredientes",
  fluid_ingredient_shortage: "Falta fluido",
  full_output: "Salida llena",
  full_burnt_result_output: "Salida de residuos llena",
  disabled_by_control_behavior: "Deshabilitado por circuito",
  disabled_by_script: "Deshabilitado por script",
  marked_for_deconstruction: "Marcado para desmontar",
  frozen: "Congelado",
  low_temperature: "Temperatura baja",
  unknown: "Desconocido",
};

// Estados que se presentan como normales (gris). Cualquier otro, incluso uno
// nuevo sin traducir, se resalta: lo inesperado debe llamar la atencion.
const NORMAL_FURNACE_STATUSES: ReadonlySet<string> = new Set(["working", "normal"]);

export function furnaceStatusLabel(status: string): string {
  return Object.hasOwn(FURNACE_STATUS_LABELS, status) ? FURNACE_STATUS_LABELS[status] : status;
}

export function isAbnormalFurnaceStatus(status: string): boolean {
  return !NORMAL_FURNACE_STATUSES.has(status);
}

const ITEM_LABELS: Readonly<Record<string, string>> = {
  iron_plate: "Placas de hierro",
  copper_plate: "Placas de cobre",
};

/** Nombre del item para la pantalla; sin traduccion, el nombre del juego con espacios. */
export function itemLabel(item: string): string {
  return Object.hasOwn(ITEM_LABELS, item) ? ITEM_LABELS[item] : item.replaceAll("_", " ");
}

// Unidad de conteo de cada item: "placas" en el total, "placas/min" en la tasa.
const ITEM_UNITS: Readonly<Record<string, string>> = {
  iron_plate: "placas",
  copper_plate: "placas",
};

/** Unidad de conteo del item; sin traduccion, "unidades". */
export function itemUnit(item: string): string {
  return Object.hasOwn(ITEM_UNITS, item) ? ITEM_UNITS[item] : "unidades";
}
