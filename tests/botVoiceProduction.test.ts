import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine };
}

// r2: tras reconducir la 1a objecion de cara, si reinsiste con OTRA formulacion ("no LA quiero ensenar")
// debe CERRAR educadamente, no soltar un "Okeyy" pelado (el pronombre intercalado rompia la deteccion).
describe("Cara: reinsistir con 'no la quiero ensenar' cierra educadamente (no 'Okeyy')", () => {
  it("dos turnos de rechazo de cara terminan en CLOSED con cierre educado", async () => {
    const { engine } = createEngine();
    let candidateId: string | undefined;
    const seq = [
      "ana",
      "23",
      "pero yo no quiero salir con la cara, se puede tapar?",
      "ya pero es que la cara no la quiero enseñar de verdad"
    ];
    let last;
    for (const message of seq) {
      last = await engine.handleIncomingMessage({
        candidateId,
        instagramUsername: "face_insist",
        profileVisibility: "PUBLIC",
        message
      });
      candidateId = last.candidate.id;
    }
    expect(last!.candidate.currentState).toBe("CLOSED");
    const text = last!.response.toLowerCase();
    expect(text.trim()).not.toBe("okeyy");
    expect(/manera de trabajar|no podemos seguir|te deseo lo mejor/.test(text)).toBe(true);
  });
});

// r7: miedo a que la RECONOZCA gente conocida (familia) es una duda de privacidad: debe reconducir con
// el angulo de identidad/privacidad, no ignorarlo y seguir con la siguiente pregunta del guion.
describe("Privacidad: 'me da miedo que me vea mi familia' reconduce con privacidad, no lo ignora", () => {
  it("atiende la duda de privacidad antes de seguir cualificando", async () => {
    const { engine } = createEngine();
    let candidateId: string | undefined;
    let last;
    for (const message of ["ana", "26", "me da miedo que me vea mi familia o gente conocida"]) {
      last = await engine.handleIncomingMessage({
        candidateId,
        instagramUsername: "fam_privacy",
        profileVisibility: "PUBLIC",
        message
      });
      candidateId = last.candidate.id;
    }
    expect(last!.candidate.currentState).not.toBe("CLOSED");
    const text = last!.response.toLowerCase();
    // Reconduce con el contenido de privacidad/identidad (no es el simple "Te entiendo | has tenido OF").
    expect(/identidad|privacidad|pinterest|imagen/.test(text)).toBe(true);
  });
});

// Preguntas sin cobertura: reconocer + deferir a la llamada + puente, en vez de "Okeyy | como te llamas".
describe("Preguntas sin cobertura: deferir a la llamada, no despachar con un acuse vacio", () => {
  it("confusion total se atiende y defiere, con puente al guion", async () => {
    const { engine } = createEngine();
    let candidateId: string | undefined;
    let last;
    for (const message of ["hola", "no entiendo nada de lo que dices, que es esto?"]) {
      last = await engine.handleIncomingMessage({
        candidateId,
        instagramUsername: "confused_case",
        profileVisibility: "PUBLIC",
        message
      });
      candidateId = last.candidate.id;
    }
    const text = last!.response.toLowerCase();
    expect(text.trim()).not.toBe("okeyy");
    expect(text).toContain("en la llamada");
    expect(text).toContain("como te llamas");
  });

  it("'cuanto se puede ganar' defiere SIN dar cifras ni prometer ingresos (invariante)", async () => {
    const { engine } = createEngine();
    let candidateId: string | undefined;
    let last;
    for (const message of ["hola", "cuanto se puede llegar a ganar con esto?"]) {
      last = await engine.handleIncomingMessage({
        candidateId,
        instagramUsername: "earnings_case",
        profileVisibility: "PUBLIC",
        message
      });
      candidateId = last.candidate.id;
    }
    const text = last!.response.toLowerCase();
    expect(text).toContain("depende");
    expect(text).toContain("llamada");
    // Nunca una cifra de dinero ni un porcentaje proactivo.
    expect(/\d+\s?(?:euros?|€|\$|mil|%)/.test(text)).toBe(false);
  });
});

// Decision de Alex (16-jun): desconfianza (incluida la leve) y agresion -> escalan a el (y le llega aviso).
describe("Escaladas a Alex: desconfianza y agresion van a revision humana", () => {
  async function lastStateAfter(messages: string[], username: string): Promise<string> {
    const { engine } = createEngine();
    let candidateId: string | undefined;
    let last;
    for (const message of messages) {
      last = await engine.handleIncomingMessage({
        candidateId,
        instagramUsername: username,
        profileVisibility: "PUBLIC",
        message
      });
      candidateId = last.candidate.id;
    }
    return last!.candidate.currentState;
  }

  it("'como se que es real?' escala a HUMAN_INTERVENTION_REQUIRED", async () => {
    expect(await lastStateAfter(["hola", "y esto como se que es real?"], "trust1")).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("insultos/agresion escalan a HUMAN_INTERVENTION_REQUIRED", async () => {
    expect(await lastStateAfter(["hola", "esto es una mierda, sois unos estafadores de mierda"], "angry1")).toBe(
      "HUMAN_INTERVENTION_REQUIRED"
    );
  });

  it("'me da mala espina' tambien escala", async () => {
    expect(await lastStateAfter(["hola", "uy esto me da mala espina la verdad"], "trust2")).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("entusiasmo ('esto es real, que ganas') NO escala (no es desconfianza)", async () => {
    expect(await lastStateAfter(["hola", "buah esto es real? que ganas la verdad"], "happy1")).not.toBe(
      "HUMAN_INTERVENTION_REQUIRED"
    );
  });
});
