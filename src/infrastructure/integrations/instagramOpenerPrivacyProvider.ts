import type { ProfilePrivacyProvider } from "@/application/profilePrivacyProvider";
import { getInstagramConfig } from "@/application/instagramConfig";
import { fetchInstagramProfile } from "./instagramProfileProvider";
import { fetchInstagramIsPrivate } from "./instagramPrivacyProvider";

// 1500ms (antes 4500): la deteccion va en el CAMINO CRITICO del primer mensaje, antes de enviar la
// rafaga del opener. Con el techo de ~10s de Vercel Hobby, un detector lento se comia el presupuesto y
// solo llegaba 1 mensaje a Instagram (bug 22-jun). Con 1500ms, si no resuelve rapido se cae a PUBLICO
// (default calido) y queda tiempo de sobra para entregar la rafaga entera. Ajustable por env.
const DEFAULT_TIMEOUT_MS = 1500;

/**
 * Detecta privada/pública para el OPENER. Como Meta no expone is_private, hay que: (1) resolver el
 * @usuario desde el IGSID con la Graph API y (2) consultar el flag privada en el proveedor (Apify). Lleva
 * un LÍMITE DE TIEMPO corto (red de seguridad): si las dos llamadas no terminan a tiempo, devuelve null
 * (→ opener neutro) en vez de retrasar la respuesta al primer mensaje y arriesgar el timeout de Vercel.
 * Best-effort: cualquier fallo → null. Solo actúa con candidatas reales (IGSID numérico); el simulador no.
 */
export class InstagramOpenerPrivacyProvider implements ProfilePrivacyProvider {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly timeoutMs: number = Number(process.env.OPENER_PRIVACY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  ) {}

  async detectIsPrivate(igsid: string): Promise<boolean | null> {
    if (!/^\d{5,}$/.test(igsid)) return null; // solo IGSID real; el simulador no tiene perfil que mirar
    return Promise.race([this.detect(igsid), delayNull(this.timeoutMs)]);
  }

  private async detect(igsid: string): Promise<boolean | null> {
    try {
      const profile = await fetchInstagramProfile(igsid, getInstagramConfig());
      const username = profile?.username;
      if (!username) return null;
      return await fetchInstagramIsPrivate(username, this.env);
    } catch {
      return null;
    }
  }
}

/** Resuelve a null pasados `ms` (la mitad lenta de la carrera): la red de seguridad del opener. */
function delayNull(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}
