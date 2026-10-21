/**
 * Resultado de un intento de lectura, ya clasificado. La fuente no valida el contenido:
 * entrega el JSON crudo y la validacion queda del lado del dominio, igual para cualquier transporte.
 */
export type SourceResult =
  | { kind: "snapshot"; raw: unknown }
  /** Todavia no hay datos (archivo inexistente, juego nunca iniciado con el mod). Esperable. */
  | { kind: "missing" }
  /** Lectura cortada a mitad de una escritura del juego. Esperable: se reintenta. */
  | { kind: "partial" }
  /** Falla no prevista (permisos, disco, etc.). */
  | { kind: "error"; error: unknown };

export type SourceListener = (result: SourceResult) => void;

/**
 * Origen de snapshots de la planta. Hoy es un archivo; mas adelante puede ser UDP u otro transporte
 * sin que el resto del gateway cambie.
 */
export interface SnapshotSource {
  start(): void;
  /** Deja de leer. Resuelve cuando termino la lectura en curso, si habia una. */
  stop(): Promise<void>;
  /** Devuelve la funcion para desuscribirse. */
  subscribe(listener: SourceListener): () => void;
}
