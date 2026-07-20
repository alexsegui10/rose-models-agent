import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// /loop Fase 1a (barrido 20-jul, medidor de elección de tema): el retriever elegía la ficha por solapamiento
// de palabras y fallaba el tema en ~45% de preguntas limpias (baseline 55% -> 92% tras estos fixes). Cada
// caso de abajo elegía una ficha equivocada o NINGUNA (nulo) antes del fix. Son rutas deterministas (sin IA):
// la Fase 1b llevará la relevancia a la IA con contexto; esto sube el SUELO y quita el ruido de palabra suelta.

function candidate(state: CandidateState = "QUALIFYING"): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "tr_" + Math.random().toString().slice(2, 6) }),
    firstName: "Test",
    age: 40,
    isAdultConfirmed: true,
    currentState: state
  } as unknown as Candidate);
}

async function topId(question: string): Promise<string | null> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "OTHER", question });
  return entries[0]?.id ?? null;
}

async function ids(question: string): Promise<string[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "OTHER", question });
  return entries.map((e) => e.id);
}

describe("Fase 1a: elección de tema — desambiguación y nulos (barrido 20-jul)", () => {
  // Glosario gana al pitch de servicios cuando piden el SIGNIFICADO del término.
  it("'eso del trafico que es? no lo cacho' -> glosario, no el pitch de servicios", async () => {
    expect(await topId("eso del trafico que es? no lo cacho")).toBe("glossary-trafico");
  });

  // "trafico" de TRÁNSITO en smalltalk no dispara el pitch (no-sequitur).
  it("'el trafico en el centro estaba imposible' (tránsito) NO trae el pitch de servicios", async () => {
    expect(await ids("uff el trafico en el centro hoy estaba imposible jaja")).not.toContain("services-agency-management");
  });

  // TIMING del pago -> liquidación (cada 14 días), no "no hay salario fijo" ni lanzamiento.
  it("'cada cuanto me pagan?' -> liquidación, no la ficha de no-salario", async () => {
    expect(await topId("cada cuanto me pagan?")).toBe("commercial-revenue-share-settlement");
  });
  it("'cuanto tarda en caerme la plata?' -> liquidación, no no-salario ni lanzamiento", async () => {
    expect(await topId("cuanto tarda en caerme la plata cuando me pagan?")).toBe("commercial-revenue-share-settlement");
  });

  // Miedo al coste de entrada ("caro para arrancar") -> no hay coste para ti.
  it("'no me sale muy caro para arrancar?' -> faq-no-cost-to-join", async () => {
    expect(await topId("y esto no me sale muy caro para arrancar?")).toBe("faq-no-cost-to-join");
  });

  // Verificación de OF -> ficha dedicada de ayuda, no la de quién abre la cuenta.
  it("'no pude verificar mi onlyfans' -> faq-of-verification-help", async () => {
    expect(await topId("no pude verificar mi onlyfans, me tira un error")).toBe("faq-of-verification-help");
  });

  // OF abandonado ("lo dejé tirado") -> ficha de OF existente/abandonado.
  it("'tenia un onlyfans pero lo deje tirado' -> onlyfans-existing-or-abandoned", async () => {
    expect(await topId("tenia un onlyfans pero lo deje tirado hace banda")).toBe("onlyfans-existing-or-abandoned");
  });

  // Nulos que ahora enrutan a fichas aprobadas (antes: sin ficha -> el motor deferia).
  it("'tengo que viajar a españa?' -> agencia online (no desplazarse)", async () => {
    expect(await topId("tengo que viajar a españa para trabajar?")).toBe("agency-online-no-office");
  });
  it("'me dan un adelanto para arrancar?' trae la ficha comercial (no-salario/reparto)", async () => {
    expect(await ids("me dan un adelanto para arrancar?")).toContain("commercial-no-fixed-salary");
  });
  it("'necesito experiencia previa?' trae el perfil objetivo", async () => {
    expect(await ids("necesito tener experiencia previa en esto?")).toContain("candidate-requirements-target-profile");
  });
  it("'necesito muchos seguidores?' trae el perfil objetivo", async () => {
    expect(await ids("necesito tener muchos seguidores para que me tomen?")).toContain("candidate-requirements-target-profile");
  });

  // Fotos VIEJAS/reutilizar -> material antiguo, no el volumen diario de producción.
  it("'las fotos viejas que tengo las puedo usar?' -> content-new-and-old-material", async () => {
    expect(await topId("las fotos viejas re subidas de tono que tengo las puedo usar?")).toBe("content-new-and-old-material");
  });

  // "en cuanto tiempo estaría LANZADA la cuenta" -> lanzamiento, no dedicación de tiempo.
  it("'en cuanto tiempo estaria lanzada la cuenta?' -> launch-timeline", async () => {
    expect(await topId("en cuanto tiempo estaria lanzada la cuenta mas o menos?")).toBe("launch-timeline");
  });

  // "elegir a las chicas" -> proceso de selección, no el genérico how-it-works.
  it("'que proceso hacen para elegir a las chicas?' trae faq-selection-process arriba", async () => {
    const top3 = (await ids("que proceso hacen para elegir a las chicas?")).slice(0, 2);
    expect(top3).toContain("faq-selection-process");
  });

  // NO-REGRESIÓN: la pregunta legítima de la cifra sigue trayendo la comercial (el % lo gatea el planner).
  it("no-regresión: 'de cuanto es el reparto?' sigue trayendo conocimiento comercial", async () => {
    expect(await ids("de cuanto es el reparto?")).toContain("commercial-revenue-share-general");
  });

  // NO-REGRESIÓN: el pitch real de servicios sigue saliendo cuando SÍ lo piden.
  it("no-regresión: 'como trabajais? que haceis por mi?' sigue trayendo servicios", async () => {
    expect(await ids("como trabajais? que haceis por mi exactamente?")).toContain("services-agency-management");
  });

  // NO-REGRESIÓN: definir "chatter" sigue funcionando (glosario).
  it("no-regresión: 'que es un chatter?' -> glosario", async () => {
    expect(await topId("che y que es un chatter?")).toBe("glossary-chatter");
  });
});
