import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { deviceEligibilityForDescription, deviceModelForDescription } from "@/application/policyRules";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Caso REAL Janna (5-jul): (1) "iPhone pro 15" recibió "lo valoro con mi socio" (un iPhone 15 Pro es
// gama alta -> APROBADO); (2) dijo que trabaja con una agencia y el bot le RE-PREGUNTÓ la agencia dos
// veces (rompía la coherencia). Los dos son deterministas.

describe("móvil: 'iPhone pro 15' (modificador antes del número) -> APROBADO, no socio", () => {
  it("'iPhone pro 15' y 'iphone pro max 15' -> APPROVED", () => {
    expect(deviceEligibilityForDescription("iPhone pro 15")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("iphone pro max 15")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("iphone pro 14")).toBe("APPROVED");
  });
  it("el modelo queda legible en la ficha (reordenado)", () => {
    expect(deviceModelForDescription("iPhone pro 15")).toContain("iphone 15");
  });
  it("regresión: 'iphone 15 pro' y 'iphone 12' siguen APROBADOS; 'iphone 11' sigue en prueba", () => {
    expect(deviceEligibilityForDescription("iphone 15 pro")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("un iphone 12")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("iphone 11")).toBe("PENDING_QUALITY_TEST");
  });
});

describe("agencia: 'trabajando con una agencia' rellena el slot (no se re-pregunta)", () => {
  it("el gerundio se reconoce como que SÍ trabaja con agencia", () => {
    const u = extractDeterministicUnderstanding(
      "Tengo un perfil trabajando con una agencia, y tengo otro inactivo para empezar casi de cero !",
      { lastAgentMessage: "Has trabajado alguna vez con otras agencias?" }
    );
    expect(u.extractedData.worksWithAnotherAgency).toBe(true);
  });
  it("regresión: la negación sigue ganando ('no trabajo con ninguna agencia' -> false)", () => {
    const u = extractDeterministicUnderstanding("no trabajo con ninguna agencia", {
      lastAgentMessage: "Has trabajado alguna vez con otras agencias?"
    });
    expect(u.extractedData.worksWithAnotherAgency).toBe(false);
  });

  // El INFINITIVO ("trabajar") es futuro/hipotético/pregunta: un lead que QUIERE unirse a una agencia NO
  // trabaja ya con otra. No debe marcarse true (regresión cazada por el revisor 5-jul).
  it("un deseo futuro ('me gustaría trabajar con una agencia') NO marca que ya trabaja con otra", () => {
    for (const msg of [
      "me gustaria trabajar con una agencia algun dia",
      "quiero trabajar con una agencia como la vuestra",
      "estoy pensando en trabajar con una agencia"
    ]) {
      const u = extractDeterministicUnderstanding(msg, { lastAgentMessage: "Has trabajado alguna vez con otras agencias?" });
      expect(u.extractedData.worksWithAnotherAgency, msg).not.toBe(true);
    }
  });
});

describe("E2E Janna: no se repite la pregunta de la agencia", () => {
  it("tras 'trabajando con una agencia' el bot NO vuelve a preguntar por agencias", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      automationMode: "AUTOMATIC"
    });
    const o = await engine.handleIncomingMessage({
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "Hola quiero info"
    });
    const id = o.candidate.id;
    await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "Soy Janna"
    });
    await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "39"
    });
    const dev = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "iPhone pro 15"
    });
    // El iPhone 15 Pro NO deriva al socio.
    expect(dev.response.toLowerCase()).not.toContain("valorar");
    await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "Tengo of , pero está inactivo"
    });
    const ag = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "Tengo un perfil trabajando con una agencia, y tengo otro inactivo para empezar casi de cero !"
    });
    expect(ag.candidate.worksWithAnotherAgency).toBe(true);
    // El siguiente turno NO debe volver a preguntar por agencias.
    const next = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "janna",
      profileVisibility: "PUBLIC",
      message: "Sii"
    });
    expect(next.response.toLowerCase()).not.toContain("otras agencias");
  });
});
