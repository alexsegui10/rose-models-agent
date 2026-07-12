/**
 * Guardia "mismo origen" para los endpoints SENSIBLES del navegador (disparar una llamada de PAGO, borrar una
 * candidata) tras retirar el candado global de contraseña (decisión de Alex, 12-jul-2026). Sin el candado,
 * esos endpoints quedaban abiertos a cualquiera con la URL; esta guardia acepta la petición SOLO si viene de
 * la propia web del CRM (mismo origen), sin añadir ninguna fricción a Alex: su navegador manda el header
 * `Origin` correcto en los POST/DELETE de la propia app.
 *
 * Bloquea el vector real de abuso cross-site: una web o script de un tercero haciendo `fetch` contra el
 * endpoint (el navegador FUERZA el header `Origin` en peticiones cross-site, así que ahí se caza). Si no hay
 * `Origin` (petición no-navegador tipo curl) se deja pasar: no es el caso que esta guardia protege, y bloquearlo
 * podría romper clientes legítimos; la protección fuerte de ese vector es la allowlist de números (pendiente).
 *
 * Puro y testeable: recibe los valores de cabecera, no el request.
 */
export function sameOriginAllowed(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader) return true; // sin Origin: no es un fetch cross-site de navegador
  if (!hostHeader) return false; // hay Origin pero no sabemos contra qué comparar -> denegar
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false; // Origin malformado -> denegar
  }
}
