import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { alexStyleProfile } from "@/content/style/alex-style-profile";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

// Decisiones de Alex del 18-jul (respuestas a las 4 preguntas de criterio):
// 1. "Sisi" FUERA del perfil de estilo (el redactor lo combinaba raro).
// 2. Identidad de la cuenta: "si, iria con OTRO nombre" -> respuesta directa en la ficha geo.
// 3. "¿como me pagan?" se queda como esta (metodo + 70/30 reactivo) — sin cambios, cubierto por tests previos.
// 4. Pausa del socio: responder UNA vez las preguntas cubiertas y volver al visto (sustituye pausa total 6-jul).

function mk() {
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

async function toSocioPause(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca he tenido of" }] }); // pitch
  const socio = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok gracias" }] });
  expect(socio.response.toLowerCase()).toContain("mi socio");
}

describe("decision 1: 'Sisi' fuera del perfil de estilo", () => {
  it("el perfil de estilo ya no lleva 'Sisi' entre las expresiones", () => {
    expect(alexStyleProfile.signatureExpressions).not.toContain("Sisi");
  });
});

describe("decision 2: '¿iria con otro nombre?' recibe el SI directo (caso real Daiana)", () => {
  it("la ficha geo responde 'Si, la cuenta va con otro nombre' y surfacea para 'otra historia'", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "otro_nombre" }),
      currentState: "QUALIFYING"
    } as unknown as Candidate);
    // "otra historia" exige contexto de identidad cerca (revisor: el modismo "eso ya es otra historia"
    // no debe soltar la politica), por eso ambos fraseos llevan fotos/identidad.
    for (const q of ["usan otro nombre y otra historia con mis fotos?", "seria con una identidad falsa?"]) {
      const entries = await retriever.retrieve({
        candidate,
        intent: "REQUESTS_INFORMATION",
        question: q,
        ignoreStateGating: true
      });
      const entry = entries.find((e) => e.id === "geo-privacy-three-layers");
      expect(entry, q).toBeDefined();
      expect(entry?.approvedAnswerPoints[0]).toContain("Si, la cuenta va con otro nombre");
    }
  });
});

describe("decision 4: en la pausa del socio, las preguntas cubiertas se responden UNA vez", () => {
  it("pregunta cubierta en pausa -> se responde (antes: visto); re-preguntar no repite nada y converge al visto", async () => {
    const { engine } = mk();
    const u = "pausa1vez_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);

    const first = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y de la edicion de los videos quien se encarga?" }]
    });
    expect(first.response.trim().length).toBeGreaterThan(0);
    const seen = new Set(first.response.split(/\n{2,}/).map((b) => b.trim()));
    let last = first.response;
    for (let i = 0; i < 8 && last.trim().length > 0; i += 1) {
      const again = await engine.handleIncomingTurn({
        instagramUsername: u,
        messages: [{ content: "y de la edicion de los videos quien se encarga?" }]
      });
      last = again.response;
      for (const bubble of last
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter(Boolean)) {
        expect(seen.has(bubble), `burbuja repetida: ${bubble}`).toBe(false);
        seen.add(bubble);
      }
    }
    expect(last.trim()).toBe("");
  });

  it("pregunta NO cubierta en pausa -> defer honesto al socio y escalada (no se inventa nada)", async () => {
    // Comportamiento preexistente que se conserva: lo no cubierto escala a revision humana con el defer
    // honesto — jamas una respuesta inventada.
    const { engine } = mk();
    const u = "pausa_unc_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "La agencia se encarga tambien de mis impuestos?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/^$|dejame que lo hable con mi socio/);
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("acuses y datos en pausa -> visto (esto no cambia: solo preguntas)", async () => {
    const { engine } = mk();
    const u = "pausa_ack_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    for (const msg of ["ok dale", "perfecto", "soy de rosario"]) {
      const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: msg }] });
      expect(r.response.trim(), msg).toBe("");
    }
  });

  it("pedir la LLAMADA en pausa -> visto (agendar sin el Encaja se difiere, invariante 4)", async () => {
    const { engine } = mk();
    const u = "pausa_call_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "dale, llamame ya si quieres" }]
    });
    expect(r.response.trim()).toBe("");
  });
});
