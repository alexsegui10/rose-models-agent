import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Decision de Alex 22-jun: el bot SIEMPRE responde primero a lo que pregunte la candidata (tambien lo social/
// identidad: "y tu?", "quien eres?", "como estas?") y LUEGO reconduce a la cualificacion. Antes esas preguntas
// se ignoraban en los turnos canonicos. Modo determinista en tests (en prod OpenAI redacta el mismo plan).
// Invariantes: la seguridad (IA/bot, desconfianza) y el negocio (%, paises) NUNCA se tratan como social.

function setup() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

async function seedQualifying(repository: InMemoryCandidateRepository, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `social_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      currentState: "QUALIFYING" as CandidateState,
      ...overrides
    })
  );
}

describe("Responder SIEMPRE primero a preguntas personales/sociales y reconducir (Alex 22-jun)", () => {
  it("'Y tu?' tras dar el nombre: responde identidad (Alex/Rose Models) y reconduce con una pregunta", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "Y tu?" }] });
    expect(r.response.toLowerCase()).toMatch(/alex|rose models/);
    expect(r.response).toMatch(/\?/);
  });

  it("'quien eres?' responde identidad y reconduce", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "quien eres?" }] });
    expect(r.response.toLowerCase()).toMatch(/alex|rose models/);
  });

  it("'de donde sos?' dirigido al bot: identidad espanola/Rose Models, NO la FAQ de paises de la candidata", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "de donde sos?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/alex|rose models|espanola/);
    expect(r.response.toLowerCase()).not.toMatch(/varios paises|poder adquisitivo/);
  });

  it("'como estas?' acusa la cortesia (no la ignora) y reconduce", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "hola, como estas?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/bien|gracias/);
  });

  it("'y tu cuantos anos tienes?' NO inventa la edad del bot (respuesta evasiva calida) y reconduce", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "y tu cuantos anos tienes?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/alex|agencia/);
  });

  // INVARIANTE 2 (lo mas critico): una MENOR que ademas pregunta algo social NO recibe la respuesta social;
  // cierra por edad. El plan pone pendingPersonalQuestion=null para menores y el cierre CLOSED es determinista
  // (no depende del LLM ni siquiera en modo OpenAI).
  it("'tengo 16, y tu?' CIERRA por edad y NO responde lo social (invariante 2)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository, { firstName: undefined });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo 16, y tu?" }]
    });
    expect(r.candidate.currentState).toBe("CLOSED");
    expect(r.response.toLowerCase()).not.toMatch(/agencia espanola|agencia española/);
  });

  // NO-REGRESION: la seguridad y el negocio NUNCA se convierten en social.
  it("'sos un bot?' sigue escalando a intervencion humana (no es social)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "sos un bot?" }] });
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("'cuanto os quedais?' sigue siendo pregunta de reparto (no social)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository, { age: 30, isAdultConfirmed: true });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "cuanto os quedais?" }]
    });
    expect(r.response).toMatch(/70|reparto|porcentaje/);
    expect(r.response.toLowerCase()).not.toMatch(/muy bien, gracias/);
  });

  it("'de que paises trabajais?' sigue siendo la FAQ de paises (negocio), no identidad del bot", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository, { age: 30, isAdultConfirmed: true });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "de que paises trabajais?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/paises|espanol|publico/);
  });
});
