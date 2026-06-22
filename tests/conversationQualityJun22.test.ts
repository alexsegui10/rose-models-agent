import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Calidad de conversacion (prueba E2E de Alex 22-jun). Fallos vistos: el bot derivaba a revision sin
// responder "cuanto me pagan" (deberia dar 70/30), saltaba a revision cortando su pregunta, y la frase del
// movil dudoso era negativa ("lo reviso yo / no me vale"). Modo determinista en tests (en prod redacta OpenAI
// dentro del mismo plan). Invariante 3: 70/30 solo si pregunta la cifra; negociacion -> revision.

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
      ...createCandidate({ instagramUsername: `quality_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Alba",
      age: 38,
      isAdultConfirmed: true,
      hasOnlyFans: false,
      deviceType: "IPHONE",
      deviceModel: "iphone 11",
      deviceEligibility: "PENDING_QUALITY_TEST",
      currentState: "QUALIFYING" as CandidateState,
      ...overrides
    })
  );
}

describe("Calidad: pregunta de pago, timing de revision y movil dudoso", () => {
  it("'¿y cuanto dinero me pagan?' responde 70/30 y NO salta a revision ese turno", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "y cuanto dinero me pagan?" }]
    });

    // Responde la politica (no la oculta ni deriva sin contestar).
    expect(r.response).toMatch(/70/);
    expect(r.response).toMatch(/30/);
    // Sigue en QUALIFYING: la revision ("lo comento con mi socio") NO corta su pregunta.
    expect(r.candidate.currentState).toBe("QUALIFYING");
  });

  it("tras responder, sin mas preguntas -> pasa a revision (el 'lo comento con mi socio' sale AL FINAL)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);
    await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "y cuanto dinero me pagan?" }]
    });

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale, gracias" }]
    });

    expect(r.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("NEGOCIACION ('dame el 50%') NO libera cifra y escala a revision humana (invariante 3)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository);

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "dame el 50% para mi" }]
    });

    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  // Fuga que cazo el revisor: negociacion SIN "%" mezclada con pregunta de pago. Garantia INNEGOCIABLE
  // (invariante 3): la pregunta de pago NO gana al escalado -> NUNCA se suelta la cifra 70/30 ante una
  // negociacion, y la candidata cae en revision humana (HIR o WAITING_HUMAN_REVIEW), nunca auto-resuelta.
  it.each(["cuanto me pagan? quiero el 50 para mi", "cuanto cobro? quiero ganar mas", "cuanto gano? quiero el 45 para mi"])(
    "negociacion disfrazada de pregunta de pago NO suelta el 70/30 y cae en revision: %s",
    async (message) => {
      const { engine, repository } = setup();
      const c = await seedQualifying(repository);

      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: message }] });

      // Lo critico: ni una cifra de reparto ante una negociacion.
      expect(r.response).not.toMatch(/70\s?%|30\s?%/);
      // Y no se auto-resuelve: queda en una decision humana (HIR o revision), nunca avanzando hacia la llamada.
      expect(["HUMAN_INTERVENTION_REQUIRED", "WAITING_HUMAN_REVIEW"]).toContain(r.candidate.currentState);
    }
  );

  it("movil dudoso (iPhone 11): la frase es suave ('mi socio'), sin 'lo reviso yo' ni 'no me vale'", async () => {
    const { engine, repository } = setup();
    // En QUALIFYING, recien preguntado el movil y con el OF AUN sin responder (como en el caso real: da el
    // movil antes del OF), para que quede una pregunta pendiente y se acuse el movil en vez de pasar al pitch.
    const c = await seedQualifying(repository, {
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined,
      hasOnlyFans: undefined
    });

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo un iphone 11" }]
    });

    expect(r.response.toLowerCase()).toContain("mi socio");
    expect(r.response.toLowerCase()).not.toContain("lo reviso yo");
    expect(r.response.toLowerCase()).not.toContain("no me vale");
  });

  it("movil CLARAMENTE malo (iPhone 8) PAUSA (HIR); DUDOSO (iPhone 11) sigue cualificando (Alex 22-jun)", async () => {
    const { engine, repository } = setup();
    const malo = await seedQualifying(repository, {
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined,
      hasOnlyFans: undefined
    });
    const rMalo = await engine.handleIncomingTurn({
      instagramUsername: malo.instagramUsername,
      messages: [{ content: "tengo un iphone 8" }]
    });
    expect(rMalo.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");

    const dudoso = await seedQualifying(repository, {
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined,
      hasOnlyFans: undefined
    });
    const rDudoso = await engine.handleIncomingTurn({
      instagramUsername: dudoso.instagramUsername,
      messages: [{ content: "tengo un iphone 11" }]
    });
    expect(rDudoso.candidate.currentState).toBe("QUALIFYING");
  });

  it("P2: turno 'tengo 30 / os sirve? / cuanto pagais?' acusa la edad antes de responder y encadena la siguiente pregunta", async () => {
    const { engine, repository } = setup();
    // Sin edad previa: la da AHORA (extraccion del turno), junto a "os sirve?" y la pregunta de pago.
    const c = await seedQualifying(repository, {
      age: undefined,
      isAdultConfirmed: false,
      hasOnlyFans: undefined,
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined
    });

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "pues tengo 30" }, { content: "os sirve?" }, { content: "y cuanto pagais?" }]
    });

    // Acusa la edad recien dada (responde "os sirve?" = si) ANTES de la respuesta de negocio.
    expect(r.response).toMatch(/con 30 perfecto/i);
    // Responde el pago (sin cifra, vago) y encadena la siguiente pregunta de cualificacion (movil).
    expect(r.response.toLowerCase()).toMatch(/reparto|porcentaje|salario/);
    expect(r.response.toLowerCase()).toMatch(/movil|telefono/);
  });

  it("OF OBLIGATORIO (bug cynthia 22-jun): con experiencia pero SIN responder OF, sigue preguntando OF y NO deriva al socio", async () => {
    const { engine, repository } = setup();
    // Como cynthia: nombre, edad y un movil aprobado, e incluso experiencia, pero OF AUN sin responder. Antes
    // 'experienceOrOnlyFans' se daba por cumplido con la experiencia (que en modo OpenAI el LLM podia INFERIR)
    // y el bot saltaba a "lo comento con mi socio" sin preguntar OF ni agencias. Ahora OF es explicito.
    const c = await seedQualifying(repository, {
      firstName: "Cynthia",
      age: 40,
      isAdultConfirmed: true,
      experienceDescription: "tengo experiencia creando contenido",
      hasOnlyFans: undefined,
      deviceModel: "iphone 12 pro max",
      deviceEligibility: "APPROVED"
    });

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "ok perfecto" }]
    });

    expect(r.candidate.currentState).toBe("QUALIFYING");
    expect(r.response.toLowerCase()).toMatch(/onlyfans|\bof\b/);
  });

  it("movil vago sin modelo: pide el modelo EXACTO una vez y luego PENDING (no repite identico; Alex 23-jun)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository, {
      hasOnlyFans: undefined,
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined
    });

    // Turno 1: el bot pregunta el movil.
    const r1 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale, listo" }]
    });
    expect(r1.response.toLowerCase()).toContain("que movil tienes");

    // Turno 2: responde vago SIN nombrar el aparato -> el bot pide el MODELO EXACTO (no repite identico).
    const r2 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "esta bien, hago buenas fotos" }]
    });
    expect(r2.response.toLowerCase()).toMatch(/marca y .*modelo|modelo .*exactamente/);

    // Turno 3: sigue sin modelo -> PENDING_QUALITY_TEST y AVANZA (deja de preguntar el movil).
    const r3 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "es muy bueno de verdad" }]
    });
    expect(r3.candidate.deviceEligibility).toBe("PENDING_QUALITY_TEST");
    expect(r3.response.toLowerCase()).not.toMatch(/que movil tienes|marca y .*modelo/);
  });

  it("movil declarado MALO tras pedir el modelo exacto sigue NOT_ELIGIBLE (no se suaviza a PENDING; revisor 23-jun)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository, {
      hasOnlyFans: undefined,
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined
    });
    // Turno 1: el bot pregunta el movil. Turno 2 (vago): pide el modelo exacto.
    await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "vale, listo" }] });
    await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "esta bien, hago buenas fotos" }]
    });
    // Turno 3: declara un movil MALO -> sigue NOT_ELIGIBLE (el gate de hardware manda; no se suaviza a PENDING).
    const r3 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "es viejo la verdad" }]
    });
    expect(r3.candidate.deviceEligibility).toBe("NOT_ELIGIBLE");
  });

  it("B-edad: '¿hay posibilidades con 21 años?' confirma que desde 18 vale (no lo ignora; Alex 22-jun)", async () => {
    const { engine, repository } = setup();
    const c = await seedQualifying(repository, {
      firstName: undefined,
      age: undefined,
      isAdultConfirmed: false,
      hasOnlyFans: undefined,
      deviceEligibility: "UNKNOWN",
      deviceModel: undefined
    });

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "hay posibilidades de trabajar teniendo 21 años?" }]
    });

    expect(r.response.toLowerCase()).toContain("21");
    expect(r.response.toLowerCase()).toMatch(/sin problema|trabajamos/);
  });
});
