import { timingSafeEqual } from "node:crypto";

/**
 * Compara el bearer del header Authorization con el secreto esperado en tiempo (casi) constante, para no
 * filtrar el secreto por timing. Devuelve false si no hay header "Bearer <token>" o si no coincide.
 */
export function bearerMatches(authHeader: string | null, secret: string): boolean {
  const header = authHeader ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);
  // timingSafeEqual exige misma longitud; la guarda de longitud no es secreta (la longitud del secreto no
  // es el secreto), y evita la excepción.
  if (tokenBuffer.length !== secretBuffer.length) {
    return false;
  }
  return timingSafeEqual(tokenBuffer, secretBuffer);
}
