/**
 * Detecta si una cuenta de Instagram es PRIVADA vía un proveedor de terceros (HikerAPI por defecto), que
 * hace el scraping con SU infraestructura: el riesgo de baneo recae en el proveedor, NUNCA en las cuentas
 * de Rose Models. Meta no expone is_private en su API oficial; esta es la unica via para el dato literal
 * sin tocar nuestras cuentas. Best-effort: si no hay clave configurada o el proveedor falla, devuelve null
 * (el CRM lo trata como "desconocido"). La clave vive en .env.local; jamas se loguea ni va al repo.
 *
 * RGPD: solo se envia el @usuario (dato publico) y se guarda solo el flag privada/publica (minimizacion).
 */
export async function fetchInstagramIsPrivate(
  username: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<boolean | null> {
  const key = env.HIKERAPI_KEY?.trim();
  const handle = username?.replace(/^@/, "").trim();
  if (!key || !handle) return null;

  const base = env.HIKERAPI_BASE?.trim() || "https://api.hikerapi.com";
  const url = `${base}/v1/user/by/username?username=${encodeURIComponent(handle)}`;
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { "x-access-key": key, accept: "application/json" } });
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
 * Extrae is_private de la respuesta del proveedor de forma DEFENSIVA: distintos proveedores/versiones lo
 * anidan distinto (raiz, .user, .data, etc.). Solo devuelve un booleano si lo encuentra con certeza.
 */
export function extractIsPrivate(data: unknown): boolean | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const container of [record, record.user, record.data]) {
    if (typeof container === "object" && container !== null) {
      const value = (container as Record<string, unknown>).is_private;
      if (typeof value === "boolean") return value;
    }
  }
  return null;
}
