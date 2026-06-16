/**
 * Detecta si una cuenta de Instagram es PRIVADA vía un proveedor de terceros (Apify por defecto), que
 * hace el scraping con SU infraestructura: el riesgo de baneo recae en el proveedor, NUNCA en las cuentas
 * de Rose Models. Meta no expone is_private en su API oficial; esta es la unica via para el dato literal
 * sin tocar nuestras cuentas. Best-effort: si no hay token configurado o el proveedor falla, devuelve null
 * (el CRM lo trata como "desconocido"). El token vive en .env.local; jamas se loguea ni va al repo.
 *
 * Apify: free plan con 5$/mes de credito (sin tarjeta, sin minimo de recarga), ~2,60$/1000 perfiles. El
 * "Instagram Profile Scraper" devuelve el flag `private`. RGPD: solo se envia el @usuario (dato publico) y
 * se guarda solo el flag privada/publica (minimizacion).
 */
export async function fetchInstagramIsPrivate(
  username: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<boolean | null> {
  const token = env.APIFY_TOKEN?.trim();
  const handle = username?.replace(/^@/, "").trim();
  if (!token || !handle) return null;

  // Actor configurable por si se cambia de scraper; por defecto el oficial de Apify. El endpoint sincrono
  // devuelve directamente los items del dataset (un array con el/los perfil/es).
  const actor = env.APIFY_ACTOR?.trim() || "apify~instagram-profile-scraper";
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ usernames: [handle] }),
      // El actor puede tardar unos segundos; cortamos para no colgar la ruta del CRM.
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) {
      console.warn("[ig-privacy] el proveedor rechazo la consulta", { status: response.status });
      return null;
    }
    const data = (await response.json()) as unknown;
    return extractIsPrivate(data);
  } catch (error) {
    console.warn("[ig-privacy] error de red al consultar el proveedor", {
      error: error instanceof Error ? error.name : "unknown"
    });
    return null;
  }
}

/**
 * Extrae is_private de la respuesta del proveedor de forma DEFENSIVA y agnostica: Apify devuelve un ARRAY
 * de items con el campo `private`; otros proveedores devuelven un objeto (raiz, .user o .data) con
 * `is_private`. Solo devuelve un booleano si lo encuentra con certeza.
 */
export function extractIsPrivate(data: unknown): boolean | null {
  const items: unknown[] = Array.isArray(data) ? data : [data];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    for (const container of [record, record.user, record.data]) {
      if (typeof container === "object" && container !== null) {
        const value = (container as Record<string, unknown>).is_private ?? (container as Record<string, unknown>).private;
        if (typeof value === "boolean") return value;
      }
    }
  }
  return null;
}
