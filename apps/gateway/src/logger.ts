export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/** Destino de las lineas ya formateadas. Inyectable para los tests. */
export type LogSink = (level: LogLevel, line: string) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// warn y error van a stderr para poder separarlos de la salida normal.
const defaultSink: LogSink = (level, line) => {
  if (level === "warn" || level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

// JSON.stringify convierte un Error en "{}"; lo reemplazamos por sus datos utiles.
function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    const { code } = value as NodeJS.ErrnoException;
    return { name: value.name, message: value.message, ...(code ? { code } : {}), stack: value.stack };
  }
  return value;
}

/** Logger minimo de una linea por evento: "<ISO> <NIVEL> <mensaje> <contexto JSON>". */
export function createLogger(minLevel: LogLevel, sink: LogSink = defaultSink): Logger {
  const log = (level: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
    if (context && Object.keys(context).length > 0) {
      line += " " + JSON.stringify(context, errorReplacer);
    }
    sink(level, line);
  };

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
  };
}
