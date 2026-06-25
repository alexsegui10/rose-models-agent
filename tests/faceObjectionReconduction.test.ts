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
  return { engine, repository };
}

// Frases que NUNCA debe usar la reconduccion: prometer ocultar/difuminar/tapar la cara o anonimato
// (invariante de negocio innegociable: la cara es imprescindible, jamas se promete esconderla).
function neverPromisesHidingTheFace(response: string): void {
  const normalized = response.toLowerCase();
  expect(normalized).not.toContain("anonimat");
  expect(normalized).not.toContain("difumin");
  expect(normalized).not.toContain("tapar");
  expect(normalized).not.toMatch(/sin (mostrar|ensenar)\w* la cara/);
  expect(normalized).not.toMatch(/no (hace falta|necesitas) (mostrar|ensenar)/);
}

describe("Cara: reconducir primero, rechazar solo si insiste (peticion de Alex #2)", () => {
  it("la PRIMERA objecion de cara no cierra: reconduce con calidez", async () => {
    const { engine } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "face_first",
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "face_first",
      message: "no quiero mostrar la cara"
    });

    expect(result.candidate.currentState).not.toBe("CLOSED");
    expect(result.candidate.faceObjectionCount).toBe(1);
    // No es el cierre seco generico ni el script de rechazo.
    expect(result.response.toLowerCase()).not.toContain("no te molesto mas");
    expect(result.response.toLowerCase()).not.toContain("no podemos seguir");
    // Reconduce con el porque (trafico / confianza).
    expect(result.response.toLowerCase()).toMatch(/trafico|confianza/);
    neverPromisesHidingTheFace(result.response);
  });

  it("la SEGUNDA objecion de cara (insiste) cierra con un rechazo educado", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "face_insist",
      profileVisibility: "PUBLIC",
      message: "no quiero mostrar la cara"
    });
    expect(first.candidate.currentState).not.toBe("CLOSED");

    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "face_insist",
      message: "ya pero es que no quiero mostrar la cara igualmente"
    });

    expect(second.candidate.currentState).toBe("CLOSED");
    // Cierre educado, deja la puerta abierta, sin valoraciones personales.
    expect(second.response.toLowerCase()).toMatch(/manera de trabajar|no podemos|un saludo|lo mejor/);
    neverPromisesHidingTheFace(second.response);
  });

  it("una duda de privacidad ('que me vean en mi pais') reconduce, no cierra", async () => {
    const { engine } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "face_privacy",
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "face_privacy",
      message: "y si no quiero que me vean en mi pais?"
    });

    expect(result.candidate.currentState).not.toBe("CLOSED");
    // Reconduce con las capas reales de privacidad (identidad espanola / redireccion / bloqueo).
    expect(result.response.toLowerCase()).toMatch(/identidad espanola|pinterest|bloque/);
    neverPromisesHidingTheFace(result.response);
  });

  it("proponer mostrar la cara solo en parte va a revision humana (Alex decide)", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "face_partial",
      profileVisibility: "PUBLIC",
      message: "puedo mostrar la cara solo en algunas fotos?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    neverPromisesHidingTheFace(result.response);
  });

  it("si tras reconducir acepta mostrar la cara, el proceso continua", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "face_accepts",
      profileVisibility: "PUBLIC",
      message: "es que me da corte mostrar la cara"
    });
    expect(first.candidate.currentState).not.toBe("CLOSED");

    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "face_accepts",
      message: "vale, lo entiendo, entonces si la muestro sin problema"
    });

    expect(second.candidate.currentState).not.toBe("CLOSED");
  });

  it("cierra ante una insistencia EVASIVA tras reconducir ('sigo sin querer mostrar la cara')", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "face_evasive",
      profileVisibility: "PUBLIC",
      message: "no quiero mostrar la cara"
    });
    expect(first.candidate.currentState).not.toBe("CLOSED");

    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "face_evasive",
      message: "es que sigo sin querer mostrar la cara"
    });

    expect(second.candidate.currentState).toBe("CLOSED");
    neverPromisesHidingTheFace(second.response);
  });

  it("una duda de privacidad recurrente no reconduce sin fin: tras varias vueltas la decide Alex", async () => {
    const { engine } = createEngine();
    let candidateId: string | undefined;
    let last;
    for (let turn = 0; turn < 4; turn += 1) {
      last = await engine.handleIncomingMessage({
        candidateId,
        instagramUsername: "face_loop",
        profileVisibility: "PUBLIC",
        message: "y si no quiero que me vean en mi pais?"
      });
      candidateId = last.candidate.id;
    }
    // No queda en bucle de reconduccion infinita: termina en revision humana (Alex decide).
    expect(last!.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    neverPromisesHidingTheFace(last!.response);
  });

  it("un rechazo general que NO es de cara sigue cerrando (no se debilita DECLINES)", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "general_decline",
      profileVisibility: "PUBLIC",
      message: "no me interesa, gracias"
    });

    expect(result.candidate.currentState).toBe("CLOSED");
    expect(result.candidate.faceObjectionCount).toBe(0);
  });
});
