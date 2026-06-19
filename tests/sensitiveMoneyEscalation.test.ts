import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, type Candidate } from "@/domain/candidate";

// Decision de Alex 19-jun (analisis de conversaciones reales): las peticiones sensibles de PRUEBAS
// (capturas del panel de ganancias, "muestrame cuentas que llevais") y de MECANICA DEL DINERO ("eres tu
// la que recibe los pagos?") deben ESCALAR a Alex (el bot se para -> HUMAN_INTERVENTION_REQUIRED y el
// webhook le manda un WhatsApp). El bot nunca improvisa con dinero ni inventa/promete capturas.

const retriever = new LocalBusinessKnowledgeRetriever();
function candidate(): Candidate {
  return { ...createCandidate({ instagramUsername: "money_guard", profileVisibility: "PUBLIC" }), currentState: "QUALIFYING" };
}
async function escalates(question: string): Promise<boolean> {
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "REQUESTS_INFORMATION", question });
  return entries.some((entry) => entry.requiresHumanReview);
}

describe("escalada de peticiones sensibles de dinero/pruebas", () => {
  it.each([
    "puedes mostrarme capturas del panel de ganancias de otras cuentas?",
    "ensename cuentas que llevais para ver resultados",
    "quiero ver pruebas de otras modelos que gestionais",
    "tengo que ver el backend de la cuenta antes"
  ])("ESCALA una peticion de pruebas: %s", async (q) => {
    expect(await escalates(q)).toBe(true);
  });

  it.each(["eres tu la que recibe los pagos?", "el dinero pasa por vosotros o me llega a mi?", "quien cobra el dinero de of?"])(
    "ESCALA una pregunta de mecanica del dinero: %s",
    async (q) => {
      expect(await escalates(q)).toBe(true);
    }
  );

  it.each(["como trabajais exactamente?", "cuanto me pagais al mes?", "que tengo que hacer yo?"])(
    "NO escala una pregunta normal: %s",
    async (q) => {
      expect(await escalates(q)).toBe(false);
    }
  );
});
