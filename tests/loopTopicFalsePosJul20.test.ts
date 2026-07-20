import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// /loop Fase 1a — verificación ADVERSARIAL (barrido 20-jul por workflow): al subir el suelo determinista, mis
// detectores nuevos metían falsos positivos (mensajes que comparten vocabulario pero van de otra cosa). El
// panel adversarial cazó 29/55; abajo van los representativos por detector, ya apretados (0/55). Cada `it`
// falla si el detector vuelve a ser codicioso. Son la red que impide cambiar errores viejos por errores nuevos.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "fp_" + Math.random().toString().slice(2, 6) }),
    firstName: "Test",
    age: 40,
    isAdultConfirmed: true,
    currentState: "QUALIFYING" as CandidateState
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

describe("Fase 1a: falsos positivos NO reintroducidos (barrido adversarial 20-jul)", () => {
  // "caro" de OTRA cosa (device, alquiler, pasaje, editor) no dispara faq-no-cost-to-join.
  for (const m of [
    "el iphone que me piden me sale re caro, no se si lo compro",
    "la verdad el alquiler me sale caro, por eso busco un ingreso extra",
    "uf el pasaje me sale caro para moverme, pero bueno",
    "un editor de video bueno sale caro, el programa lo ponen ustedes?"
  ]) {
    it(`caro ajeno: '${m}' NO va a no-cost`, async () => {
      expect(await ids(m)).not.toContain("faq-no-cost-to-join");
    });
  }

  // "adelanto/anticipo" como verbo/cortesía/tráiler no dispara la ficha comercial.
  for (const m of [
    "uy perdon, me adelanto a los hechos jaja",
    "che mil gracias por adelantado por tomarte el tiempo",
    "no te adelanto nada mas de mi, mejor arrancamos",
    "vi el adelanto de la nueva temporada y estaba buenisimo",
    "si te va, adelanto la videollamada para hoy"
  ]) {
    it(`adelanto ajeno: '${m}' NO va a no-salario`, async () => {
      expect(await ids(m)).not.toContain("commercial-no-fixed-salary");
    });
  }

  // "trafico" de TRÁNSITO no dispara el pitch de servicios.
  for (const m of [
    "uf boludo, el trafico de la panamericana venia lentisimo",
    "che el bondi tardo banda, el trafico estaba tremendo hoy",
    "no sabes el trafico que habia en la autopista, camiones por todos lados",
    "habia un trafico de terror, un choque en la esquina y todo cortado"
  ]) {
    it(`tránsito: '${m}' NO trae el pitch de servicios`, async () => {
      expect(await ids(m)).not.toContain("services-agency-management");
    });
  }

  // …pero "trafico DE CLIENTES que traen" SÍ es negocio aunque diga "ciudad" (no falso negativo).
  it("tráfico de negocio: 'el trafico de clientes que traen va por la ciudad' SÍ trae servicios", async () => {
    expect(await ids("el trafico de clientes que traen ustedes va por la ciudad o como lo hacen?")).toContain(
      "services-agency-management"
    );
  });

  // "cada cuanto entra gente / cuando llega el frio" no es el pago (no dispara liquidación).
  for (const m of [
    "posta, cada cuanto entra gente nueva a suscribirse mas o menos?",
    "una consulta, cuando llega el frio en españa la gente compra mas?",
    "y cuando entra una clienta nueva quien le contesta, ustedes?"
  ]) {
    it(`timing ajeno: '${m}' NO va a liquidación`, async () => {
      expect(await ids(m)).not.toContain("commercial-revenue-share-settlement");
    });
  }

  // "que es LO QUE hacen/ofrecen" es PITCH, no definición (no dispara el glosario).
  it("'que es lo que hacen ustedes con el trafico?' NO va al glosario (es pitch)", async () => {
    expect(await topId("che y que es lo que hacen ustedes con el trafico? lo mandan a mi onlyfans?")).not.toBe(
      "glossary-trafico"
    );
  });
  it("'que es todo lo que ofrecen con la monetizacion' NO va al glosario (es pitch)", async () => {
    expect(await topId("no me quedo claro que es todo lo que ofrecen con la monetizacion, me explicas?")).not.toBe(
      "glossary-monetizar"
    );
  });

  // Dedicación vs lanzamiento: "una vez lanzada, cuantas horas dedico" es dedicación (no lanzamiento).
  it("'una vez lanzada la cuenta, cuantas horas al dia dedico?' -> dedicación, no lanzamiento", async () => {
    expect(await topId("una vez que este lanzada la cuenta, cuantas horas al dia le tengo que dedicar posta?")).toBe(
      "content-time-commitment"
    );
  });
  it("'cuanto tardan en dejar todo listo para arrancar?' -> lanzamiento", async () => {
    expect(await topId("che cuanto tiempo tardan en dejar todo listo para arrancar?")).toBe("launch-timeline");
  });

  // Volumen diario gana a material antiguo cuando la pregunta es de volumen.
  it("'aunque tenga fotos viejas, cuantas nuevas subo por dia?' -> producción, no material antiguo", async () => {
    expect(await topId("aunque tenga fotos viejas dando vueltas, cuantas fotos nuevas subo por dia?")).toBe(
      "content-production-volume"
    );
  });

  // "celu viejo" es calidad de equipo: no debe LIDERAR producción (la ficha de dispositivo entra al ranking).
  it("'las fotos con un celu bastante viejo, va la calidad?' NO lidera producción", async () => {
    const top3 = (await ids("las fotos me las saco con un celu bastante viejo, va a andar la calidad?")).slice(0, 3);
    expect(top3[0]).not.toBe("content-production-volume");
    expect(top3).toContain("candidate-requirements-device-quality");
  });

  // Queja de agencia pasada (aunque la queja preceda a "agencia") no dispara multi-agencia.
  it("'una experiencia horrible con la otra agencia, me dejaron tirada' NO trae multi-agencia", async () => {
    expect(await ids("posta que fue una experiencia horrible con la otra agencia, me dejaron tirada")).not.toContain(
      "multi-agency-different-traffic"
    );
  });

  // "viajar" smalltalk no dispara la ficha de online.
  it("'me encanta viajar por el mundo' NO trae agency-online-no-office", async () => {
    expect(await ids("me encanta viajar por el mundo che, algun dia me voy")).not.toContain("agency-online-no-office");
  });

  // "no tengo OF ni idea de que precio" es precio de suscripción, no onboarding de quién abre la cuenta.
  it("'no tengo OF ni idea de que precio ponerle' NO dispara la ficha de quién abre la cuenta", async () => {
    expect(await topId("no tengo onlyfans y ni idea de que precio ponerle a la suscripcion, cuanto se cobra?")).not.toBe(
      "faq-who-opens-of-account"
    );
  });
});
