import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { applyHumanReviewDecision } from "@/application/humanReview";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresiones cazadas por el barrido ADVERSARIAL del fix "Laura" (15-jul). Ninguna rompia un invariante
// duro, pero eran regresiones de conversacion reales que el fix original introducia. Estos tests fallan
// sin los arreglos de la 2a ronda y pinan el comportamiento correcto.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

const PITCH = /chatters|cuentas de instagram/;

describe("regresiones del fix Laura (barrido adversarial 15-jul)", () => {
  // HALLAZGO 2 (pitch PERDIDO): una inexperta de perfil PRIVADO que completa el guion en el MISMO turno en
  // que sale de PROFILE_READY_FOR_REVIEW -> QUALIFYING (salto multi-hop). El gate viejo "viene de QUALIFYING"
  // lo bloqueaba (candidateBefore = PROFILE_READY) -> reaparecia el bug de Laura por otra puerta. Ahora el
  // trigger `justCompleted` lo captura (el guion se completa EN este turno, aunque no venga de QUALIFYING).
  it("perfil privado que completa en el salto PROFILE_READY_FOR_REVIEW->QUALIFYING SIGUE recibiendo el pitch", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "priv_multihop", profileVisibility: "PRIVATE" }),
        firstName: "Rocio",
        age: 30,
        isAdultConfirmed: true,
        hasOnlyFans: false, // inexperta -> le toca el pitch
        deviceEligibility: "UNKNOWN", // el movil AUN falta: el guion se completa al darlo, en este turno
        declaredProfileVisibility: "PRIVATE",
        humanVerifiedProfileAccess: true,
        humanProfileReviewStatus: "POTENTIAL_FIT", // Alex ya reviso el perfil -> el turno saltara a QUALIFYING
        currentState: "PROFILE_READY_FOR_REVIEW" as CandidateState
      } as Candidate)
    );

    // Da el movil: PROFILE_READY_FOR_REVIEW -> QUALIFYING -> WAITING_HUMAN_REVIEW en el mismo turno, y el
    // guion esencial se COMPLETA (deviceEligibility deja de ser UNKNOWN). El pitch NO se puede perder.
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "priv_multihop",
      message: "tengo un iphone 14"
    });

    expect(result.response.toLowerCase()).toMatch(PITCH);
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  // HALLAZGO 1 (pitch DUPLICADO): tras REQUEST_MORE_INFO desde el CRM, la candidata vuelve a QUALIFYING con
  // los datos intactos. Si durante la pausa acumulo suficientes mensajes para empujar el pitch fuera de la
  // ventana corta (8), el beat lo re-soltaba ENTERO. El arreglo mira una ventana ANCHA (100) del historial.
  it("tras REQUEST_MORE_INFO y una pausa larga, el pitch NO se vuelve a soltar (no duplicado)", async () => {
    const { engine, repository } = createEngine();
    const username = "reentry_dup";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo vera" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 30" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "iphone 14" });
    const pitchTurn = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no nunca tuve of"
    });
    expect(pitchTurn.response.toLowerCase()).toMatch(PITCH); // el pitch se entrego aqui

    // Pausa larga: 12 mensajes (> ventana corta de 8) para que el pitch scrollee fuera de recentMessages(8).
    for (let i = 0; i < 12; i += 1) {
      await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: `hola? ${i}` });
    }

    // Alex pulsa REQUEST_MORE_INFO en el CRM -> QUALIFYING con datos intactos (ruta real de humanReview.ts).
    const current = await repository.findCandidateById(id);
    const { candidate: reopened } = applyHumanReviewDecision({ candidate: current!, decision: "REQUEST_MORE_INFO" });
    await repository.saveCandidate(reopened);

    // Primer turno tras la reentrada, sin pregunta: NO debe re-soltar el pitch entero.
    const afterReentry = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "vivo en madrid"
    });
    expect(afterReentry.response.toLowerCase()).not.toMatch(PITCH);
  });

  // HALLAZGO 4 (regex de dinero sin acentos): una pregunta de dinero/negociacion CON TILDES ("cuánto cobro?
  // quiero ganar más") no casaba el guard -> se colaba en el defer del pitch en vez de caer en revision. El
  // arreglo normaliza (quita tildes) antes del regex. Debe comportarse igual que la version sin acentos.
  it("negociacion con TILDES ('cuánto cobro? quiero ganar más') NO se difiere por el pitch: cae en revision sin cifra", async () => {
    const { engine } = createEngine();
    const username = "acentos_dinero";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "soy nadia" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 32" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "iphone 13" });
    const result = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no tengo of, ¿cuánto cobro? quiero ganar más"
    });

    // No se difiere en QUALIFYING esperando el pitch: cae en una decision humana, como la version sin tildes.
    expect(result.candidate.currentState).not.toBe("QUALIFYING");
    expect(["HUMAN_INTERVENTION_REQUIRED", "WAITING_HUMAN_REVIEW"]).toContain(result.candidate.currentState);
    // Invariante 3: ni una cifra de reparto ante una negociacion.
    expect(result.response).not.toMatch(/70\s?%|30\s?%/);
  });

  // HALLAZGO 3 (over-match del regex de dinero): al normalizar, "para mi"/"mejora*" sueltos casaban preguntas
  // de PROCESO legitimas ("me ayudais a mejorar mis fotos?") -> se marcaban como dinero -> se saltaba el defer
  // del pitch y el pitch se PERDIA (reabria Laura). El regex se estrecho: "para mi" exige cifra, "mejora*" fuera.
  it("pregunta de proceso con 'mejorar' NO se confunde con dinero: sigue el flujo Laura (responde -> pitch)", async () => {
    const { engine } = createEngine();
    const username = "mejorar_proceso";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "soy iris" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 33" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "iphone 14" });
    // Completa (OF) + pregunta de PROCESO que contiene "mejorar": se le responde y se difiere (sigue Laura).
    const answered = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no tengo of, me ayudais a mejorar mis fotos?"
    });
    expect(answered.candidate.currentState).toBe("QUALIFYING");
    expect(answered.response.toLowerCase()).not.toMatch(PITCH);

    // Turno siguiente sin pregunta: el pitch SI sale (no se perdio por el over-match).
    const pitch = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "ah vale gracias"
    });
    expect(pitch.response.toLowerCase()).toMatch(PITCH);
  });
});
