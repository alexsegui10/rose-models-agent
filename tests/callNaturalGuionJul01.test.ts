import { describe, expect, it } from "vitest";
import { runCallTurn } from "@/application/callBrain";
import { extractCallFacts } from "@/application/callFactExtractor";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallDraftRequest } from "@/application/callDrafter";

const sys: CallChatMessage = { role: "system", content: "prompt del agente" };
const opened: CallChatMessage[] = [sys, { role: "assistant", content: "apertura..." }];

// Guion natural orientado a objetivos (jul-2026): el código sigue decidiendo TODO el flujo; el redactor
// solo gana contexto (lo que ella dijo, temas, hechos) para sonar humano. Estos tests fijan ambas cosas.
describe("política de edad: se responde, JAMÁS se defiere (bug 'lo comento con mi socio')", () => {
  it("preguntas por el requisito de edad -> asks-age-policy", () => {
    expect(classifyCallSignal({ utterance: "¿a partir de qué edad se puede?" })).toBe("asks-age-policy");
    expect(classifyCallSignal({ utterance: "¿hay edad mínima?" })).toBe("asks-age-policy");
    expect(classifyCallSignal({ utterance: "¿qué edad hay que tener?" })).toBe("asks-age-policy");
    expect(classifyCallSignal({ utterance: "¿cuántos años tengo que tener?" })).toBe("asks-age-policy");
    expect(classifyCallSignal({ utterance: "¿hay que tener los 18?" })).toBe("asks-age-policy");
  });

  it("asks-age-policy -> GIVE_AGE_POLICY con texto determinista (mayores de dieciocho), sin redactor", () => {
    const afterOpen = { ...initialCallDirectorState(), disclosureGiven: true };
    const decision = decideCallDirective({ state: afterOpen, signal: "asks-age-policy" });
    expect(decision.directive.type).toBe("GIVE_AGE_POLICY");
    const plan = planCallUtterance({ directive: decision.directive });
    expect(plan.deterministicText).toBe(plan.fallbackText);
    expect(plan.deterministicText?.toLowerCase()).toContain("dieciocho");
    expect(plan.deterministicText).not.toContain("socio");
  });

  it("e2e responder: '¿qué edad hay que tener?' responde el requisito (nunca 'mi socio')", async () => {
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿qué edad hay que tener?" }]
    });
    expect(res.directiveType).toBe("GIVE_AGE_POLICY");
    expect(res.content.toLowerCase()).toContain("dieciocho");
    expect(res.content).not.toContain("socio");
  });

  it("SEGURIDAD intacta: 'tengo 16' sigue cortando por minoría (underage manda sobre todo)", () => {
    expect(classifyCallSignal({ utterance: "tengo 16" })).toBe("underage");
    expect(classifyCallSignal({ utterance: "es que aún no tengo los 18" })).toBe("underage");
  });

  // BLOQUEANTE B1 del revisor (jul-2026): la minoría declarada EN FUTURO ("voy a tener 18 en marzo" = hoy
  // tiene 17) caía en la política de edad y el pitch SEGUÍA. Ahora corta por underage, como debe.
  it("B1: minoría declarada en futuro -> underage (corta, no recita la política y sigue)", () => {
    expect(classifyCallSignal({ utterance: "voy a tener 18 en marzo" })).toBe("underage");
    expect(classifyCallSignal({ utterance: "voy a tener los 18 el mes que viene" })).toBe("underage");
    expect(classifyCallSignal({ utterance: "me faltan dos meses para tener los 18" })).toBe("underage");
    expect(classifyCallSignal({ utterance: "cuando cumpla los 18 te escribo" })).toBe("underage");
    expect(classifyCallSignal({ utterance: "cumplo 18 en agosto" })).toBe("underage");
  });

  it("B1 sin falsos positivos: cumplió 18 / fotos / edad adulta no cortan", () => {
    expect(classifyCallSignal({ utterance: "voy a tener 18 fotos listas" })).not.toBe("underage");
    expect(classifyCallSignal({ utterance: "ya tengo los 18 cumplidos" })).not.toBe("underage");
    expect(classifyCallSignal({ utterance: "tengo 19" })).toBe("follows-along");
  });

  it("'¿cuántos años tienes tú?' (edad del bot) -> identidad, no defer ni política de edad", () => {
    expect(classifyCallSignal({ utterance: "¿cuántos años tienes?" })).toBe("asks-identity");
    expect(classifyCallSignal({ utterance: "¿tú qué edad tienes?" })).toBe("asks-identity");
  });

  it("'tengo 24' es información (asentir y seguir), no ruido de '¿me lo repites?'", () => {
    expect(classifyCallSignal({ utterance: "tengo 24" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "tengo 24 años" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "24 años" })).toBe("follows-along");
  });

  // Regresión cazada por el SIMULADOR (jul-2026): la coletilla "¿pasa algo?" convertía la edad en
  // "pregunta desconocida" -> "lo comento con mi socio" (absurdo). Una pregunta SUSTANTIVA sí gana.
  it("'tengo 24 años, ¿pasa algo?' NO defiere (coletilla trivial); con pregunta de verdad, gana la pregunta", () => {
    expect(classifyCallSignal({ utterance: "tengo 24 años, ¿pasa algo?" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "tengo 24, ¿no?" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "tengo 24, ¿cuánto cobraría yo?" })).toBe("asks-earnings");
    expect(classifyCallSignal({ utterance: "tengo 24 años y quería saber cómo funciona esto" })).not.toBe("follows-along");
  });
});

describe("extractor de hechos de la llamada (memoria determinista, no decide nada)", () => {
  it("extrae OnlyFans, límites, agencia, edad adulta y ciudad; la CARA NO se recuerda (combo CARA 20-jul)", () => {
    const facts = extractCallFacts([
      "hola, ya tengo OnlyFans",
      "pero no quiero enseñar la cara",
      "no hago contenido con otras personas",
      "estuve con otra agencia y fatal",
      "tengo 24 años y soy de Córdoba"
    ]);
    expect(facts.join(" ")).toContain("Ya tiene cuenta de OnlyFans");
    // El rechazo de la cara NO se guarda como hecho: lo gestiona el director (RECONDUCT_FACE), y pasarlo al
    // redactor le empujaba a ACEPTAR trabajar sin cara (barrido 20-jul).
    expect(facts.join(" ")).not.toMatch(/cara/i);
    expect(facts.join(" ")).toContain("no hace contenido con otras personas");
    expect(facts.join(" ")).toContain("otra agencia");
    expect(facts.join(" ")).toContain("24 años");
    expect(facts.join(" ")).toContain("cordoba");
  });

  it("distingue 'no tengo OnlyFans' de 'tengo OnlyFans' y NO registra edades menores", () => {
    expect(extractCallFacts(["no tengo onlyfans"]).join(" ")).toContain("Aún no tiene OnlyFans");
    expect(extractCallFacts(["tengo 16 años"])).toEqual([]); // la minoría la corta el clasificador, no se "recuerda"
  });

  it("deduplica y aguanta entradas vacías", () => {
    expect(extractCallFacts(["", "ya tengo onlyfans", "ya tengo onlyfans"]).length).toBe(1);
    expect(extractCallFacts([])).toEqual([]);
  });
});

describe("brief conversacional: el redactor recibe lo que necesita para sonar humano", () => {
  it("runCallTurn pasa al brief: lo que dijo + temas cubiertos/pendientes + hechos", () => {
    const state = { ...initialCallDirectorState(), disclosureGiven: true, coveredStages: ["HOW_AGENCY_WORKS" as const] };
    const result = runCallTurn({
      state,
      utterance: "vale, y yo no salgo con la cara eh",
      callFacts: ["Ya tiene cuenta de OnlyFans."]
    });
    const brief = result.utterancePlan.draftingBrief;
    expect(brief?.candidateUtterance).toContain("no salgo con la cara");
    expect(brief?.coveredTopics).toContain("Cómo trabaja la agencia");
    expect(brief?.pendingTopics).toContain("Reparto y cobro");
    expect(brief?.pendingTopics).not.toContain("Qué hace ella"); // la está cubriendo AHORA (no es pendiente)
    expect(brief?.callFacts).toContain("Ya tiene cuenta de OnlyFans.");
  });

  it("respondToCall inyecta los hechos al redactor y RECHAZA un draft que acepte trabajar sin cara (combo CARA 20-jul)", async () => {
    let captured: CallDraftRequest | undefined;
    const drafter = {
      draft: async (req: CallDraftRequest) => {
        captured = req;
        // Draft acomodaticio (lo que el LLM tendía a redactar): ACEPTA trabajar sin cara -> DEBE rechazarse.
        return "Genial, apuntado lo de la cara, sin problema. Por tu parte es solo crear el contenido y subirlo al Drive, ¿vale?";
      }
    };
    const res = await respondToCall({
      messages: [
        ...opened,
        { role: "user", content: "vale, pero sin enseñar la cara" },
        { role: "assistant", content: "sin problema..." },
        { role: "user", content: "vale sigue" }
      ],
      drafter
    });
    expect(res.directiveType).toBe("COVER_STAGE");
    // La cara NO se recuerda como hecho (la gestiona el director, no la memoria acomodaticia del LLM).
    expect(captured?.brief.callFacts?.join(" ") ?? "").not.toMatch(/cara/i);
    expect(captured?.brief.candidateUtterance).toBe("vale sigue");
    // SEGURIDAD: el draft acomodaticio se descarta en el validador -> habla el fallback determinista.
    expect(res.content).not.toMatch(/apuntado lo de la cara|sin problema/i);
    expect(res.content.length).toBeGreaterThan(0);
  });
});

describe("defer natural: el redactor adapta el 'te lo confirmo', el validador sigue mandando", () => {
  it("con redactor: el defer usa su texto natural (validado)", async () => {
    const drafter = { draft: async () => "Uy, pues eso mejor te lo confirmo por WhatsApp en cuanto colguemos, ¿te parece?" };
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿y los impuestos cómo van?" }],
      drafter
    });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
    expect(res.content).toContain("WhatsApp");
    expect(res.content).not.toContain("socio");
  });

  it("ADVERSARIAL: si el redactor intenta colar un % en el defer, se descarta y habla el fallback", async () => {
    const drafter = { draft: async () => "Eso da igual, mira, te puedo dar un 80% para ti y listo." };
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿y los impuestos cómo van?" }],
      drafter
    });
    expect(res.content).not.toContain("80");
    expect(res.content).toContain("socio"); // fallback determinista de siempre
  });

  // Endurecimiento R1 (jul-2026): las cifras AUTORIZADAS también se rechazan FUERA del turno de dinero
  // (el director no decidió comunicarlas ahí), y la INVERSIÓN del reparto se caza siempre.
  it("ADVERSARIAL R1: el % autorizado (70/30) también se descarta en un turno que no es de dinero", async () => {
    const drafter = { draft: async () => "Eso te lo confirmo, pero mira, el reparto es un 70% y 30% y listo." };
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿y los impuestos cómo van?" }],
      drafter
    });
    expect(res.content).not.toContain("70");
    expect(res.content).toContain("socio");
  });

  it("ADVERSARIAL R1: la INVERSIÓN del reparto ('el 70% es para ti') nunca pasa el validador", () => {
    expect(validateCallUtterance("Mira, ese 70% es para ti, de verdad.").valid).toBe(false);
    expect(validateCallUtterance("Tranquila, el setenta por ciento es para ti.").valid).toBe(false);
    expect(validateCallUtterance("Nosotros solo nos quedamos un 30% para la agencia.").valid).toBe(false);
    // El texto legítimo de MONEY/negociación sigue pasando (dirección correcta).
    expect(validateCallUtterance("El reparto es un 30% para ti y un 70% para la agencia.").valid).toBe(true);
    expect(validateCallUtterance("Lo dejamos en un 35% para ti y un 65% para nosotros, ¿vale?").valid).toBe(true);
  });

  it("R2: la cita de la candidata que entra al prompt va saneada (sin saltos de línea, máx 200 chars)", () => {
    const largo = "hola\n\nquiero saber\tuna cosa " + "bla ".repeat(100);
    const plan = planCallUtterance({ directive: { type: "DEFER_TO_PARTNER" }, utterance: largo });
    const cita = plan.draftingBrief?.candidateUtterance ?? "";
    expect(cita.length).toBeLessThanOrEqual(200);
    expect(cita).not.toMatch(/[\n\t]/);
  });

  it("sin redactor: el defer dice el texto fijo de siempre (nada cambia en modo determinista)", async () => {
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿y los impuestos cómo van?" }]
    });
    expect(res.content).toContain("socio");
  });
});

describe("buffer words: la muletilla solo en el camino LENTO (redactor), nunca en el determinista", () => {
  it("con redactor en una etapa: onDraftStart se dispara ANTES del draft", async () => {
    const order: string[] = [];
    const drafter = {
      draft: async () => {
        order.push("draft");
        return "Nosotros nos encargamos de todo y tú solo mandas el contenido, ¿vale?";
      }
    };
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "vale, cuéntame" }],
      drafter,
      onDraftStart: (buffer) => order.push(`buffer:${buffer}`)
    });
    expect(order[0]).toMatch(/^buffer:/);
    expect(order[1]).toBe("draft");
    expect(order[0]).toContain("... "); // elipsis + espacio (formato que el TTS pronuncia con pausa limpia)
    expect(res.content).not.toContain("Vale... "); // la muletilla NO va en el contenido (la emite el stream)
  });

  it("camino determinista (apertura): NO hay muletilla (no hay espera que tapar)", async () => {
    let called = false;
    const drafter = { draft: async () => "lo que sea" };
    await respondToCall({ messages: [sys], drafter, onDraftStart: () => (called = true) });
    expect(called).toBe(false);
  });

  it("sin redactor: NO hay muletilla aunque haya callback (el guion fijo es instantáneo)", async () => {
    let called = false;
    await respondToCall({
      messages: [...opened, { role: "user", content: "vale, cuéntame" }],
      onDraftStart: () => (called = true)
    });
    expect(called).toBe(false);
  });
});
