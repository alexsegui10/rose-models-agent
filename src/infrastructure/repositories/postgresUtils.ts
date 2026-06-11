import type { z } from "zod";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Las PK/FK de Postgres son columnas `uuid`: consultar con un id arbitrario (p. ej. un id legacy
 * llegado de la UI o del snapshot JSON) lanzaría `22P02 invalid_text_representation`. Los repos
 * InMemory devuelven null/[] para ids desconocidos; este guard preserva esa misma semántica de
 * contrato en las implementaciones Postgres.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Lectura defensiva: una fila que no pasa la validación Zod del dominio se ignora con un aviso,
 * nunca lanza (los payloads jsonb se rehidratan por Zod en el límite; si el schema del dominio
 * evoluciona, una fila antigua corrupta no debe tumbar la UI del simulador).
 */
export function warnInvalidRow(table: string, id: unknown, error: z.ZodError): void {
  console.warn(
    `[postgres] Fila inválida en ${table} (id=${String(id)}) ignorada al leer: no pasa la validación Zod del dominio.`,
    error.issues
  );
}
