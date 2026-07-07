import { describe, expect, it } from "vitest";
import { sendInstagramBurst, type BurstMessageProvider } from "@/infrastructure/integrations/instagramBurstSender";

// Bug real (Laura, 7-jul): el pitch de 6 burbujas llegaba a Instagram como 4 (el flush cortaba a 9s con retardo
// fijo por burbuja). El emisor UNICO reparte el presupuesto de pausa y solo corta cerca del techo de 60s de
// Vercel: las 6 burbujas del pitch entran ENTERAS. Reloj y sleep inyectados -> test rapido y determinista.

function recordingProvider(opts?: { failWhenLength?: number }): {
  provider: BurstMessageProvider;
  sentTexts: string[];
} {
  const sentTexts: string[] = [];
  let failedOnce = false;
  const provider: BurstMessageProvider = {
    async sendTextMessage(_recipientId: string, text: string) {
      if (opts?.failWhenLength !== undefined && sentTexts.length === opts.failWhenLength && !failedOnce) {
        failedOnce = true;
        return false; // un fallo puntual (rapido) -> debe reintentarse
      }
      sentTexts.push(text);
      return true;
    }
  };
  return { provider, sentTexts };
}

const PITCH = [
  "Te explico rapido como trabajamos: tu solo te encargas de mandar el contenido.",
  "Nosotros hacemos el resto: la monetizacion, el trafico y toda la gestion.",
  "El trafico lo hacemos con cuentas de instagram que creamos con ubicaciones y nombres espanoles.",
  "Al tener bastantes seguidores ponemos el link a tu of y empezamos a monetizar con el equipo de chatters 24/7.",
  "En la llamada te lo explico todo mejor.",
  "Si tienes cualquier duda me preguntas sin problema."
];

const noopSleep = async (): Promise<void> => {};

describe("emisor de rafaga de Instagram (bug burbujas Laura 7-jul)", () => {
  it("entrega las 6 burbujas del pitch ENTERAS con un turno normal", async () => {
    const { provider, sentTexts } = recordingProvider();
    const res = await sendInstagramBurst(provider, "u1", PITCH, {
      turnStartedAt: 0,
      now: () => 0, // nunca se acerca al deadline
      sleep: noopSleep
    });
    expect(res).toEqual({ sent: 6, total: 6, truncated: false });
    expect(sentTexts).toEqual(PITCH);
    // Las 2 ultimas burbujas (las que se perdian en produccion) SI llegan.
    expect(sentTexts).toContain("En la llamada te lo explico todo mejor.");
    expect(sentTexts).toContain("Si tienes cualquier duda me preguntas sin problema.");
  });

  it("corta la rafaga (entrega parcial) solo al superar el techo duro de tiempo", async () => {
    const { provider, sentTexts } = recordingProvider();
    // El reloj salta muy por encima de los 32s en cuanto ya se enviaron 2 burbujas -> corta a partir de ahi.
    const now = (): number => (sentTexts.length >= 2 ? 40000 : 0);
    const res = await sendInstagramBurst(provider, "u2", PITCH, { turnStartedAt: 0, now, sleep: noopSleep });
    expect(res.truncated).toBe(true);
    expect(res.sent).toBe(2);
    expect(sentTexts).toEqual(PITCH.slice(0, 2));
  });

  it("reintenta UN chunk que falla rapido y termina enviando las 6", async () => {
    const { provider, sentTexts } = recordingProvider({ failWhenLength: 2 });
    const res = await sendInstagramBurst(provider, "u3", PITCH, {
      turnStartedAt: 0,
      now: () => 0,
      sleep: noopSleep
    });
    expect(res).toEqual({ sent: 6, total: 6, truncated: false });
    expect(sentTexts).toEqual(PITCH); // en orden, sin huecos
  });
});
