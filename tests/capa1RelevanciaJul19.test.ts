import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// CAPA 1 (barrido 19-jul con terra vía suscripción). Raíz común de los 5 fallos: el bot elegía MAL la ficha
// (relevancia por keyword) y, en pausa, ROTABA fichas ajenas turno tras turno ("cosas raras": Pinterest,
// seguidores, identidad) en vez de responder de frente o escalar limpio. Aquí quedan las regresiones.

function mkEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

function candidateIn(state: CandidateState): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "relev_" + state }),
    currentState: state
  } as unknown as Candidate);
}

async function retrieve(question: string, state: CandidateState) {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidateIn(state), intent: "OTHER", question });
  return entries.map((entry) => entry.id);
}

async function toSocioPause(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo romina" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 29" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 13" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca tuve of" }] });
  const socio = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok gracias" }] });
  expect(socio.response.toLowerCase()).toContain("mi socio");
}

describe("Cara: pedir OCULTAR el rostro sin nombrar 'cara' surfacea la ficha de imprescindible (Priscila)", () => {
  const faceHidingPhrasings = [
    "se puede tapar un poco o es si o si mostrarla?",
    "no hay forma de taparla un poco?",
    "se puede difuminar la cara?",
    "y si no muestro la cara, se puede?",
    "hay forma de que no se me vea la cara?"
  ];

  it("en QUALIFYING, cada fraseo de ocultación trae la ficha face-requirement-mandatory", async () => {
    for (const phrasing of faceHidingPhrasings) {
      const ids = await retrieve(phrasing, "QUALIFYING");
      expect(ids, phrasing).toContain("face-requirement-mandatory");
    }
  });

  it("y TAMBIÉN en pausa (HIR): antes la ficha no era respondible ahí y el bot rotaba Pinterest/identidad", async () => {
    const ids = await retrieve("dale pero se puede tapar o no? me preocupa que me reconozcan", "HUMAN_INTERVENTION_REQUIRED");
    expect(ids).toContain("face-requirement-mandatory");
    // La rotación consistía en colar fichas de geo/identidad ante la pregunta de la cara: ya no deben ganar.
    expect(ids).not.toContain("geo-privacy-identity");
  });
});

describe("Glosario: pedir el SIGNIFICADO de la jerga trae la definición llana, no el pitch (Marta 45)", () => {
  it("'que es monetizar?' trae glossary-monetizar (y solo ese término)", async () => {
    const ids = await retrieve("perdona no te entiendo, que es monetizar?", "WAITING_HUMAN_REVIEW");
    expect(ids).toContain("glossary-monetizar");
    expect(ids).not.toContain("glossary-chatter");
  });

  it("'que es un chatter?' trae glossary-chatter", async () => {
    const ids = await retrieve("ay che, que es un chatter?", "WAITING_HUMAN_REVIEW");
    expect(ids).toContain("glossary-chatter");
  });

  it("'no entiendo lo del trafico' trae glossary-trafico", async () => {
    const ids = await retrieve("no entiendo lo del trafico eso que es?", "QUALIFYING");
    expect(ids).toContain("glossary-trafico");
  });

  it("los dos términos a la vez traen ambas definiciones (Marta preguntó las dos juntas)", async () => {
    const ids = await retrieve("no te entiendo bien, que es monetizar? y que es un chatter?", "WAITING_HUMAN_REVIEW");
    expect(ids).toContain("glossary-monetizar");
    expect(ids).toContain("glossary-chatter");
  });

  it("mencionar el término SIN pedir su significado NO dispara el glosario (no es un volcado)", async () => {
    const ids = await retrieve("cuando empezaria a monetizar mi cuenta?", "QUALIFYING");
    expect(ids).not.toContain("glossary-monetizar");
  });

  it("una pregunta de coste ('es gratis?') NO arrastra las definiciones del glosario", async () => {
    const ids = await retrieve("esto es gratis o tengo que pagar algo?", "QUALIFYING");
    expect(ids).not.toContain("glossary-monetizar");
    expect(ids).not.toContain("glossary-chatter");
    expect(ids).not.toContain("glossary-trafico");
  });
});

describe("Cifra (Ale): los fraseos naturales de la CIFRA reciben 70/30 aunque el intent venga mal etiquetado", () => {
  it("'de cuanto seria la parte de la agencia?' responde la cifra", async () => {
    const { engine } = mkEngine();
    const u = "cifra_parte_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y de cuanto seria la parte de la agencia?" }]
    });
    expect(r.response).toMatch(/70/);
  });

  it("'de cuanto porcentaje estamos hablando?' responde la cifra", async () => {
    const { engine } = mkEngine();
    const u = "cifra_estamos_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "ok y de cuanto porcentaje estamos hablando?" }]
    });
    expect(r.response).toMatch(/70/);
  });

  it("la pregunta del MODELO de pago ('sueldo fijo o porcentaje?') sigue SIN soltar la cifra", async () => {
    const { engine } = mkEngine();
    const u = "modelo_pago_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo lucia" }] });
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "oye esto es un sueldo fijo o porcentaje?" }]
    });
    expect(r.response).not.toMatch(/70/);
    expect(r.response).not.toMatch(/30/);
  });

  it("EXIGIR una cifra ('quiero el 50 para mi') NO libera 70/30: escala (invariante 3)", async () => {
    const { engine } = mkEngine();
    const u = "negocia_50_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "quiero el 50 para mi, si no no me interesa" }]
    });
    expect(r.response).not.toMatch(/\b70\s?%|30\s?%|70\/30\b/);
  });

  // Fuga cazada por el revisor 19-jul: "la parte de la agencia" es SUBCADENA, asi que dentro de una AFIRMACION,
  // OBJECION o NEGOCIACION (no una pregunta) NO debe soltar el 70/30. Antes del gate interrogativo, sí lo hacía.
  const noEsPreguntaDeCifra = [
    "quiero que sea menor la parte de la agencia", // negociacion
    "no me digas la parte de la agencia todavia", // rechaza el dato
    "me parece cara la parte de la agencia", // objecion
    "no me gusta la parte de la agencia" // objecion
  ];
  for (const message of noEsPreguntaDeCifra) {
    it(`'${message}' (no es pregunta) NO suelta la cifra proactivamente`, async () => {
      const { engine } = mkEngine();
      const u = "no_pregunta_" + Math.random().toString().slice(2, 8);
      await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
      await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo carla" }] });
      await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
      const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: message }] });
      expect(r.response, message).not.toMatch(/\b70\s?%|30\s?%|70\/30\b/);
    });
  }

  it("pero preguntarlo de verdad ('la parte de la agencia de cuanto es?') SÍ da la cifra", async () => {
    const { engine } = mkEngine();
    const u = "parte_pregunta_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "la parte de la agencia de cuanto es?" }]
    });
    expect(r.response).toMatch(/70/);
  });

  // 2ª tanda del revisor 19-jul: NEGOCIACIÓN en forma de PREGUNTA. Un "?" no la convierte en pregunta de cifra:
  // negociar/bajar/menor sobre la parte es negociación -> revisión humana (invariante 3), NUNCA la cifra estándar.
  const negociacionComoPregunta = [
    "se puede negociar la parte de la agencia?",
    "no podeis bajar la parte de la agencia?",
    "no podria ser menor la parte de la agencia?",
    "y no bajais un poco la parte de la agencia?",
    "me parece cara la parte de la agencia, no?"
  ];
  for (const message of negociacionComoPregunta) {
    it(`negociar/objetar la parte en forma de pregunta ('${message}') NO da la cifra y escala`, async () => {
      const { engine } = mkEngine();
      const u = "negopreg_" + Math.random().toString().slice(2, 8);
      await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
      await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo carla" }] });
      await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
      const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: message }] });
      expect(r.response, message).not.toMatch(/\b70\s?%|30\s?%|70\/30\b/);
      // Escala a revisión humana (el plan lo marca; no sigue el funnel como si fuera una pregunta de cifra).
      expect(r.responsePlan?.requiresHumanReview, message).toBe(true);
    });
  }

  it("'podeis mejorar mi parte?' (subir/mejorar el reparto) escala como negociación", async () => {
    const { engine } = mkEngine();
    const u = "mejorar_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo carla" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
    const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "podeis mejorar mi parte?" }] });
    expect(r.response).not.toMatch(/\b70\s?%|30\s?%|70\/30\b/);
    expect(r.responsePlan?.requiresHumanReview).toBe(true);
  });

  it("PERO 'explicame mejor el reparto' (aclaración, no negociación) NO escala: 'mejor' adverbio no cuenta", async () => {
    const { engine } = mkEngine();
    const u = "aclara_mejor_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo carla" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "no lo pillo, explicame mejor el reparto" }]
    });
    expect(r.responsePlan?.requiresHumanReview).toBe(false);
  });

  // NOTAs del revisor (sobre-escalado que perdía al lead IDEAL): "cara" (rostro) chocaba con car[oa] (caro), y
  // "menos" con la muletilla "mas o menos". La candidata que ACEPTA la cara y pregunta la cifra, o pregunta
  // "mas o menos", debe recibir 70/30, NO escalar. (El plan lleva la cifra y NO marca revisión.)
  const preguntaLegitimaNoEscala = [
    "la parte de la agencia de cuanto es mas o menos?",
    "cuanto es la parte de la agencia mas o menos?",
    "muchas gracias! de cuanto es la parte de la agencia?"
  ];
  for (const message of preguntaLegitimaNoEscala) {
    it(`'${message}' NO escala y da la cifra (falso positivo cara/mas-o-menos/muchas)`, async () => {
      const { engine } = mkEngine();
      const u = "nofp_" + Math.random().toString().slice(2, 8);
      await toSocioPause(engine, u);
      const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: message }] });
      expect(r.responsePlan?.requiresHumanReview, message).toBe(false);
      expect(r.response, message).toMatch(/70/);
    });
  }

  // La candidata IDEAL: acepta mostrar la cara Y pregunta la cifra. NO debe atascarse en revisión por la
  // colisión "cara"/caro. Se comprueba el plan (no escala); el texto puede liderar con el % o un acuse de cara.
  const idealAceptaCaraYPreguntaCifra = [
    "no me importa dar la cara, y la parte de la agencia de cuanto es?",
    "me da igual mostrar la cara. cual es el porcentaje?",
    "la cara la enseno sin problema, de cuanto seria la parte de la agencia?"
  ];
  for (const message of idealAceptaCaraYPreguntaCifra) {
    it(`candidata ideal ('${message}') NO se atasca en revisión por 'cara'`, async () => {
      const { engine } = mkEngine();
      const u = "ideal_" + Math.random().toString().slice(2, 8);
      await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
      await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo carla" }] });
      await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
      const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: message }] });
      expect(r.responsePlan?.requiresHumanReview, message).toBe(false);
    });
  }
});

describe("Red de seguridad: en pausa NO se rotan fichas ajenas turno tras turno (desconfiada / Daiana)", () => {
  it("tras varias fichas en pausa, seguir insistiendo por algo que el bot no tiene ya no suelta 'cosas raras'", async () => {
    const { engine } = mkEngine();
    const u = "desconf_web_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    // Tres preguntas de negocio (se responden con fichas documentadas) para superar el umbral del tramo.
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "y como son los pagos?" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "y el trafico como lo haceis?" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "y la cuenta de quien es?" }] });
    // A partir de aquí, insistir por algo no cubierto (nombre legal/web) debe escalar limpio, no rotar fichas.
    const later = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "pasame el nombre legal de la empresa y la web, si no no avanzo" }]
    });
    const text = later.response.toLowerCase();
    // Ni Pinterest, ni el rango de seguidores, ni la identidad española: eso era la espiral.
    expect(text).not.toContain("pinterest");
    expect(text).not.toMatch(/5\.?000|20\.?000|seguidores/);
    expect(text).not.toContain("identidad espanola");
    // Es un holding/visto (escalada limpia): o vacío (visto) o con marca de socio.
    const isCleanHolding = text.trim() === "" || /socio|te digo|lo veo|revis/.test(text);
    expect(isCleanHolding, `respuesta inesperada: ${later.response}`).toBe(true);
  });
});
