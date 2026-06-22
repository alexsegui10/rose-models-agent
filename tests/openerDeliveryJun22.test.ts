import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import type { ProfilePrivacyProvider } from "@/application/profilePrivacyProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";

// Bug 22-jun: a Instagram solo llegaba 1 mensaje del opener. Causas: (1) el texto "hemos revisado tu
// perfil" lo rechazaba el validador factual (honestidad: sin revision humana) -> fallback "lo hablo con
// mi socio"; (2) demasiados chunks + deteccion lenta agotaban el techo de 10s de Vercel. Estos tests fijan
// que el opener PASA el validador y se parte en POCOS mensajes (entrega fiable de la rafaga entera).

function engineWith(provider: ProfilePrivacyProvider | undefined) {
  const repository = new InMemoryCandidateRepository();
  return new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    profilePrivacyProvider: provider
  });
}
const detect = (value: boolean | null): ProfilePrivacyProvider => ({
  async detectIsPrivate() {
    return value;
  }
});

describe("Opener: entrega fiable (pocos chunks) y pasa el validador factual (bug 22-jun)", () => {
  it("PUBLICO/desconocido: NO cae al fallback del validador y se parte en <=3 mensajes", async () => {
    let i = 0;
    for (const provider of [detect(false), detect(null), undefined]) {
      const engine = engineWith(provider);
      const result = await engine.handleIncomingMessage({
        instagramUsername: `1784140000000002${i}`,
        message: "hola"
      });
      i += 1;
      // El fallback del validador es "Vale, dejame que lo hable con mi socio...": el opener NO debe caer ahi.
      expect(result.response.toLowerCase()).not.toContain("lo hable con mi socio");
      expect(result.response.toLowerCase()).toContain("como te llamas");
      expect(splitIntoMessageBurst(result.response).length).toBeLessThanOrEqual(3);
    }
  });

  it("PRIVADO: pide aceptar la solicitud y se parte en <=2 mensajes", async () => {
    const engine = engineWith(detect(true));
    const result = await engine.handleIncomingMessage({ instagramUsername: "17841400000000031", message: "hola" });
    expect(result.response.toLowerCase()).toContain("solicitud de seguimiento");
    expect(result.response.toLowerCase()).not.toContain("lo hable con mi socio");
    expect(splitIntoMessageBurst(result.response).length).toBeLessThanOrEqual(2);
  });
});
