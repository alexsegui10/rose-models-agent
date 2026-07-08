import { describe, it, expect } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { validateCallUtterance } from "@/application/callRedactionValidator";

// Increment 2 (decision de Alex 8-jul): en la LLAMADA, ante RECHAZO EN FIRME de la cara, el bot rechaza
// educado y CIERRA (como el texto), pero solo tras reconducir/tranquilizar al menos una vez. Una simple
// DUDA/verguenza ("me da corte") NO es rechazo firme: se sigue tranquilizando (no cierra). Todo determinista.

const sig = (utterance: string) => classifyCallSignal({ utterance });

describe("clasificador: RECHAZO FIRME de la cara -> face-refusal", () => {
  for (const phrase of [
    "la cara no la enseno ni loca",
    "yo la cara no la quiero ensenar",
    "no quiero mostrar la cara",
    "busco algo mas anonimo",
    "prefiero no dar la cara",
    "me niego a ensenar la cara",
    "quiero trabajar en anonimo"
  ]) {
    it(`"${phrase}" -> face-refusal`, () => {
      expect(sig(phrase)).toBe("face-refusal");
    });
  }
});

describe("clasificador: 'anonimato' NEGADO o PREGUNTADO NO es rechazo (no cierra a candidatas validas)", () => {
  // Riesgo del revisor: /anonim/ incondicional cerraba a quien ACEPTA la cara ("no busco nada anonimo") o
  // PREGUNTA por el proceso ("¿es anonimo?"). Debe seguir SIN ser face-refusal.
  for (const phrase of [
    "no busco nada anonimo la verdad",
    "no me importa no ser anonima",
    "la cara la doy sin problema, no necesito anonimato",
    "esto es como una cuenta anonima?"
  ]) {
    it(`"${phrase}" -> NO face-refusal`, () => {
      expect(sig(phrase)).not.toBe("face-refusal");
    });
  }

  it("pero QUERER anonimato SIGUE siendo face-refusal", () => {
    expect(sig("busco algo mas anonimo")).toBe("face-refusal");
    expect(sig("quiero trabajar en anonimo")).toBe("face-refusal");
  });
});

describe("clasificador: DUDA/verguenza de la cara NO es face-refusal (se sigue tranquilizando)", () => {
  for (const phrase of [
    "tengo que ensenar la cara? es que me da corte",
    "uf la cara me da verguenza",
    "es que soy muy timida para lo de la cara"
  ]) {
    it(`"${phrase}" -> NO face-refusal`, () => {
      expect(sig(phrase)).not.toBe("face-refusal");
    });
  }
});

describe("director: reconduce primero, cierra si insiste en firme", () => {
  function afterOpening() {
    return decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
  }

  it("1er rechazo firme -> RECONDUCT_FACE (tranquiliza, NO cierra) e incrementa el contador", () => {
    const state = afterOpening();
    const d = decideCallDirective({ state, signal: "face-refusal" });
    expect(d.directive.type).toBe("RECONDUCT_FACE");
    expect(d.nextState.closed).toBe(false);
    expect(d.nextState.faceObjectionCount).toBe(1);
  });

  it("2o rechazo firme (tras reconducir) -> CLOSE_FACE_REJECTED (cierra, puerta abierta)", () => {
    let state = afterOpening();
    state = decideCallDirective({ state, signal: "face-refusal" }).nextState; // reconduce
    const d = decideCallDirective({ state, signal: "face-refusal" });
    expect(d.directive.type).toBe("CLOSE_FACE_REJECTED");
    expect(d.nextState.closed).toBe(true);
    expect(d.nextState.closeDirective).toBe("CLOSE_FACE_REJECTED");
  });

  it("cierre por cara es PEGAJOSO: tras cerrar, un 'vale' no reabre el guion (silencio)", () => {
    let state = afterOpening();
    state = decideCallDirective({ state, signal: "face-refusal" }).nextState;
    state = decideCallDirective({ state, signal: "face-refusal" }).nextState; // cerrado
    const follow = decideCallDirective({ state, signal: "follows-along" });
    expect(follow.directive.type).toBe("STAY_SILENT");
  });

  it("tras el cierre por cara, la SEGURIDAD sigue: hostil/pide persona escalan; y una pregunta real se responde", () => {
    let state = afterOpening();
    state = decideCallDirective({ state, signal: "face-refusal" }).nextState;
    state = decideCallDirective({ state, signal: "face-refusal" }).nextState;
    expect(decideCallDirective({ state, signal: "hostile-or-suspicious" }).directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decideCallDirective({ state, signal: "wants-human" }).directive.type).toBe("HANDOFF_TO_ALEX");
    // Una pregunta REAL tras el cierre por cara se responde (Alex: "el bot siempre contesta primero").
    expect(decideCallDirective({ state, signal: "asks-covered" }).directive.type).toBe("ANSWER_FROM_KNOWLEDGE");
  });
});

describe("face-doubt: la DUDA/verguenza tranquiliza (RECONDUCT_FACE) y NUNCA cierra ni cuenta", () => {
  for (const phrase of [
    "es que me da mucha verguenza lo de la cara",
    "uf la cara me da corte",
    "es que soy muy timida para lo de la cara",
    // Miedo de RECONOCIMIENTO/privacidad -> face-doubt (respuesta DETERMINISTA, el LLM no promete "nadie te
    // reconoce"). Cierra el punto de entrada del leak.
    "y si me reconoce alguien de mi zona",
    "tengo miedo de que me vea mi familia",
    "no quiero que me reconozcan en mi ciudad",
    "me da miedo que se enteren en mi pueblo"
  ]) {
    it(`"${phrase}" -> face-doubt`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("face-doubt");
    });
  }

  it("director: face-doubt -> RECONDUCT_FACE sin contar hacia el cierre (no cierra aunque se repita)", () => {
    let state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    for (let i = 0; i < 4; i++) {
      const d = decideCallDirective({ state, signal: "face-doubt" });
      expect(d.directive.type).toBe("RECONDUCT_FACE");
      expect(d.nextState.closed).toBe(false);
      expect(d.nextState.faceObjectionCount).toBe(0);
      state = d.nextState;
    }
  });
});

describe("SEGURIDAD DURA de la cara: el validador de voz veta prometer anonimato/difuminar (bloqueante revisor)", () => {
  for (const phrase of [
    "Tranquila, podemos difuminarte la cara si quieres. Seguimos?",
    "Mira, puedes trabajar en anonimato perfectamente, sin mostrar la cara.",
    "No hace falta que muestres la cara, la tapamos y ya.",
    "Si te da corte, te difuminamos la cara y nadie te reconoce.",
    "Podemos hacer que no salga tu cara en el contenido.",
    // 2ª ronda del revisor: anonimato en adjetivo, "cubrir", pronombre intercalado, incógnito, permisivo.
    "que no se te reconozca la cara",
    "trabajarias de forma anonima",
    "seria todo anonimo, no te preocupes",
    "te cubrimos la cara y listo",
    "no se te vera la cara",
    "no se vea tu cara",
    "seria en plan incognito",
    "no muestres la cara si no quieres",
    "no ensenas la cara, tranquila",
    "no tienes que mostrar la cara si no quieres",
    "puedes salir de espaldas y ya",
    "grabas solo el cuerpo, sin problema",
    "con media cara vale",
    // 3ª ronda del revisor: sinonimo "rostro", identidad, objetos, reconocer sin "cara", cara parcial, filtro.
    "te difuminamos el rostro",
    "te tapamos el rostro y listo",
    "puedes ocultar el rostro",
    "no se ve tu rostro",
    "te pixelamos y ya",
    "podemos ocultar tu identidad",
    "tu identidad se mantiene oculta",
    "nadie sabra quien eres",
    "te ponemos una mascara y listo",
    "puedes llevar antifaz",
    "puedes ir con mascarilla",
    "sales con gafas de sol y gorra, nadie te reconoce",
    "asi nadie te reconoce",
    "asi no se te reconoce",
    "te grabamos de espalda",
    "solo grabamos de cuello para abajo",
    "puedes no salir de cara",
    "no tienes por que salir de cara",
    "te ponemos un filtro que te cambia la cara",
    "medio rostro y listo",
    "puedes salir sin que se vea quien eres",
    // 4ª ronda del revisor: clitico intercalado, "das", perifrasis, "quien eres" en plural/variantes, velo,
    // emoji/sticker, "apenas se ve".
    "te lo difuminamos todo y ya",
    "si quieres te lo pixelo un poco",
    "no das la cara si no quieres",
    "no hace falta que des la cara",
    "asi no se te llega a ver la cara",
    "nadie va a saber que eres tu",
    "no van a saber quien eres",
    "no se enteran de quien eres",
    "puedes usar un velo",
    "te ponemos un emoji en la cara",
    "apenas se te ve la cara",
    "solo se te ve el cuerpo",
    // 5ª ronda del revisor: familia de RECONOCIMIENTO con morfologia (enclitico, auxiliar, plural, VOSEO
    // argentino, "tu identidad").
    "nadie va a reconocerte",
    "no te van a reconocer",
    "nadie te va a reconocer",
    "no te reconocen",
    "nadie podra reconocerte",
    "nadie va a saber que sos vos",
    "nadie sabe que eres vos",
    "nadie va a saber tu identidad",
    "nadie sabe tu identidad",
    "se disimula tu identidad",
    "tu identidad no se revela",
    // 6ª ronda del revisor: SUBJUNTIVO reconozca(n) (la forma mas natural tras "para que no"), imposible/no
    // hay forma, y "no te ve nadie".
    "para que no te reconozcan",
    "nadie te reconozca",
    "asi no te reconozca nadie",
    "que no te reconozcan",
    "es imposible que te reconozcan",
    "no hay forma de que te reconozcan",
    "nadie conocido te va a ver",
    "no te ve nadie de tu entorno"
  ]) {
    it(`"${phrase}" -> INVALIDO (cae al fallback determinista)`, () => {
      expect(validateCallUtterance(phrase).valid).toBe(false);
    });
  }

  it("reafirmaciones legitimas (obligacion de la cara/rostro) siguen validas", () => {
    for (const phrase of [
      "A muchas al principio les da corte, pero la cara es imprescindible. ¿Seguimos?",
      "No, tienes que mostrar la cara, es nuestra manera de trabajar.",
      "Necesitamos que muestres la cara, es lo que da confianza.",
      "La cara se lleva con naturalidad y estamos contigo.",
      "El rostro es justo lo que da confianza al cliente, por eso es imprescindible.",
      "Tienes que dar la cara, sales de cara y con toda naturalidad.",
      "Construimos tu identidad de marca en Instagram poco a poco.",
      "De espaldas no, siempre de frente y de cara, que es lo que da confianza."
    ]) {
      expect(validateCallUtterance(phrase).valid, phrase).toBe(true);
    }
  });

  it("una reafirmacion legitima de la cara SIGUE siendo valida (no falso positivo)", () => {
    expect(
      validateCallUtterance(
        "A muchas al principio les da corte, pero la cara es imprescindible porque da confianza al cliente. ¿Seguimos?"
      ).valid
    ).toBe(true);
  });
});
