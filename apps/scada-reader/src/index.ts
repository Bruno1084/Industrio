import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

/** Carpeta de datos de Factorio segun el sistema operativo (se puede forzar con FACTORIO_DATA_DIR). */
function defaultFactorioDataDir(): string {
  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA ?? "", "Factorio");
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "factorio");
    default:
      return path.join(os.homedir(), ".factorio");
  }
}

const DATA_DIR = process.env.FACTORIO_DATA_DIR ?? defaultFactorioDataDir();
const TELEMETRY_FILE = path.join(DATA_DIR, "script-output", "scada-bridge", "latest.json");

const POLL_INTERVAL_MS = 1000; // cada cuanto leemos el archivo
const STALE_AFTER_MS = 5000; // si el tick no cambia en este tiempo, la planta "no responde"
const TICKS_PER_SECOND = 60; // el juego simula 60 ticks por segundo
const RATE_WINDOW_SECONDS = 60; // ventana para calcular produccion por minuto

// ---------------------------------------------------------------------------
// Tipos: forma del JSON que escribe el mod
// ---------------------------------------------------------------------------

interface Snapshot {
  tick: number;
  furnaces: {
    total: number;
    by_status: Record<string, number>;
  };
  production: {
    iron_plate_total: number;
    copper_plate_total: number;
  };
}

interface Sample {
  tick: number;
  iron: number;
  copper: number;
}

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------

let history: Sample[] = []; // muestras recientes para calcular tasas
let lastTick: number | null = null;
let lastTickChangeAt = Date.now();

// ---------------------------------------------------------------------------
// Logica
// ---------------------------------------------------------------------------

async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await readFile(TELEMETRY_FILE, "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null; // el archivo todavia no existe
    if (error instanceof SyntaxError) return null; // lo leimos mientras el juego lo escribia; se reintenta
    throw error;
  }
}

/** Produccion por minuto de juego, calculada con la diferencia entre la muestra mas vieja y la mas nueva. */
function ratePerMinute(key: "iron" | "copper"): number | null {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const elapsedSeconds = (last.tick - first.tick) / TICKS_PER_SECOND;
  if (elapsedSeconds <= 0) return null;
  return ((last[key] - first[key]) / elapsedSeconds) * 60;
}

function updateHistory(snapshot: Snapshot): void {
  // Si el tick retrocede, se cargo otra partida o una partida vieja: empezamos de cero.
  if (lastTick !== null && snapshot.tick < lastTick) {
    history = [];
  }

  if (snapshot.tick !== lastTick) {
    lastTick = snapshot.tick;
    lastTickChangeAt = Date.now();
    history.push({
      tick: snapshot.tick,
      iron: snapshot.production.iron_plate_total,
      copper: snapshot.production.copper_plate_total,
    });
  }

  // Conservamos solo la ventana de tiempo de juego que nos interesa.
  const minTick = snapshot.tick - RATE_WINDOW_SECONDS * TICKS_PER_SECOND;
  history = history.filter((s) => s.tick >= minTick);
}

function formatGameTime(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function formatRate(value: number | null): string {
  return value === null ? "calculando..." : `${value.toFixed(1)} / min`;
}

function render(snapshot: Snapshot): void {
  const stale = Date.now() - lastTickChangeAt > STALE_AFTER_MS;

  console.clear();
  console.log("=== SCADA Reader ===");
  console.log(`Archivo: ${TELEMETRY_FILE}`);
  console.log(
    stale
      ? "Estado de la planta: SIN RESPUESTA (juego pausado, cerrado o en el menu)"
      : "Estado de la planta: EN LINEA",
  );
  console.log(`Tiempo de juego: ${formatGameTime(snapshot.tick)}`);
  console.log("");

  console.log(`Hornos: ${snapshot.furnaces.total}`);
  const statuses = Object.entries(snapshot.furnaces.by_status).sort((a, b) => b[1] - a[1]);
  for (const [status, count] of statuses) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }
  console.log("");

  console.log("Produccion (ultimo minuto de juego):");
  console.log(`  Placas de hierro   ${formatRate(ratePerMinute("iron"))}`);
  console.log(`  Placas de cobre    ${formatRate(ratePerMinute("copper"))}`);
  console.log("");
  console.log("Totales acumulados:");
  console.log(`  Placas de hierro   ${snapshot.production.iron_plate_total}`);
  console.log(`  Placas de cobre    ${snapshot.production.copper_plate_total}`);
}

async function tick(): Promise<void> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    console.clear();
    console.log(`Esperando datos en: ${TELEMETRY_FILE}`);
    console.log("Verifica que Factorio este abierto, con la partida cargada y el mod activo.");
    return;
  }
  updateHistory(snapshot);
  render(snapshot);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

setInterval(() => {
  tick().catch((error) => {
    console.error("Error inesperado leyendo la telemetria:", error);
  });
}, POLL_INTERVAL_MS);
