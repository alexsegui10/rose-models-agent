# Playbook: subir el bot al máximo de naturalidad (texto + voz)

_Investigación de 8 frentes + auditoría del bot actual + revisión adversarial (correcciones ya integradas). Pensado el 2026-06-21._

**Encuadre que NO se toca:** el objetivo es sonar **humano, cálido y natural** y persuadir con **honestidad**. Se **mantiene la divulgación** de que es un asistente automatizado (ley de IA UE, Art. 50). Ni un truco es para "ocultar que es IA": los delays, las muletillas, etc. son para **no sonar robótico**, no para engañar. En este público (escéptico al timo), decirlo de cara **sube** la conversión.

Etiquetas: **[INV1]** el código decide flujo/estado/cifras · **[INV3]** el % nunca proactivo · **[DISC]** divulgación de IA.

---

## 1. Resumen ejecutivo — las palancas que más mueven la aguja

1. **El silencio cero delata.** Responder al instante es el "tell" nº1 en texto; un hueco de >1 s lo es en voz. → delays variables en el DM + bajar latencia en la llamada.
2. **Ráfagas cortas, una idea por globo** (ya lo haces) con **pausas reales** entre globos = lo que más humaniza el chat.
3. **Matar el "dialecto IA"** (guion largo "—", "además/sin embargo", regla de tres, hedging): la uniformidad pulida delata más que un error.
4. **Hablar en su registro** (sin marcas muy de España con público LATAM, espejar sus emojis/tono).
5. **Nombrar el miedo a la estafa de frente** ("sé que esto huele a timo, haces bien en dudar") en vez de esquivarlo: desarma al escéptico más rápido que vender.
6. **Divulgar que es IA pronto, envuelto en calidez + Alex detrás:** honestidad = señal anti-estafa = más conversión. **[DISC]**
7. **En voz: dudas/muletillas en lo empático, frase limpia y segura en las cifras.** Titubear al dar el 70/30 resta credibilidad; titubear al consolar, suma.
8. **No perseguir la perfección:** un "beat" antes de responder + micro-imperfecciones evitan la voz "demasiado pulida" (inquietante).

---

## 2. Quick wins (alto impacto, bajo esfuerzo) — empezar por aquí

1. **Divulgación de IA en el primer DM** (cierra un hueco legal). _Ojo: no es "1 línea" — va en el opener (que es una ráfaga) y toca actualizar los golden tests del opener._ **[DISC]**
2. **Ampliar la lista negra de "AI-tells"** en el prompt de texto y en `forbiddenExpressions`: guion largo "—", punto y coma, "Además/Sin embargo/Por lo tanto/En conclusión/Cabe destacar", regla de tres, "no solo X sino también Y", hedging ("puede que/en general/depende de varios factores"), residuos "como IA/aquí tienes". _Verificado: hoy esa lista solo bloquea corporativismo, así que es un hueco real._ **[ALTO × BAJO]**
3. **No cerrar siempre con pregunta**: a veces afirmar y dejar el turno abierto.
4. **Voz: subir `temperature` a ~0,7** (hoy 0,5) SOLO en la ruta de voz (texto plano). ⚠️ **Nunca** subirla en la ruta de texto (usa salida estructurada JSON; más temperatura = más riesgo de fallo → fallback).

---

## 3. Playbook BOT DE TEXTO (DM Instagram)

### 3.1 Timing y ráfagas — **[ALTO × MEDIO]** ⚠️ (ver nota de arquitectura)
- Hoy `conversationBurst.ts` parte la respuesta en globos pero **salen instantáneos**. Hay que añadir **delays variables + "escribiendo…"** entre globos: `delay ≈ 1,2 s + (palabras × 0,28 s)`, tope ~6 s, con variación aleatoria; que dos globos seguidos nunca tarden igual.
- ⚠️ **Bloqueante de arquitectura (lo más importante):** una función serverless de Vercel muere a los ~10 s. 3 globos × 6 s = 18 s → **no cabe**. Esto NO se puede hacer síncrono en el webhook: necesita una **cola/tarea programada** (un worker que envíe los globos con su delay). Es la pieza nº1 de naturalidad de texto, pero es un cambio de arquitectura, no un retoque. **[INV1]** los delays los decide el código.

### 3.2 Registro LATAM (sin imitar acento) — **[MEDIO × MEDIO]**
- ⚠️ **Corrección de la crítica:** NO imitar el voseo argentino (tu código ya lo penaliza a propósito en `styleEvaluator.ts` y lo prohíbe el prompt; tu voz es de España). Lo correcto: **tuteo neutro, evitando marcas MUY de España** ("tío/vale/currar/móvil") con público LATAM. Hoy el evaluador NO penaliza esas marcas de España → ahí sí se puede afinar.
- **Emojis:** 0–2 por mensaje, menos al hablar de dinero/contrato/privacidad; no repetir siempre el mismo (parece plantilla).

### 3.3 Imperfecciones humanas — **[MEDIO × BAJO]**
- Tus typos ("trabjar", "encjas") son identidad real → **mantener**, pero variarlos ~1 de cada 10 (a veces bien escrito) para que no parezcan patrón. **No fabricar typos nuevos**: la naturalidad sale de minúsculas al empezar, sin punto final, "jaja", caída de "¿/¡", abreviaturas.

### 3.4 Manejo de objeciones (persuasión ética) — **[ALTO × MEDIO]**
- **Accusation audit (Voss):** di tú primero lo peor que ella piensa. *"sé que esto por Instagram puede oler a timo, y haces bien en desconfiar… por eso te lo explico todo y luego hablas con Alex en persona."*
- **Desactivar red flags de estafa por adelantado:** "aquí no pagas nada, cobramos solo un % cuando tú cobras", "nunca te pedimos la contraseña", "sin prisa, tú decides". **Cero urgencia falsa** ("plazas que vuelan" = firma del estafador).
- **[INV3]** el 70/30 solo si pregunta; cuando lo digas, **limpio y sin titubeo** (la opacidad sobre el reparto también es red flag).

### 3.5 Persona y continuidad — **[MEDIO × BAJO]**
- Reinyectar el ancla de persona + lo que ya sabes de ella **cada turno** (la persona se diluye 20–40 % a los 10–15 turnos). Referencia hacia atrás ("lo que me decías de que ya curras con otra agencia…") y retomar entre sesiones. _Coste: los datos de ella no se cachean; vigilar coste/latencia._

### 3.6 Follow-ups — **YA IMPLEMENTADO ✅**
- Máximo 2 re-enganches + ventana 24h ya está en `outreachPlanner.ts`. Solo mejora pendiente: que el toque sea **contextual** (retomar su última duda concreta, no "¿sigues ahí?").

---

## 4. Playbook BOT DE VOZ (llamada WhatsApp)

### 4.1 Latencia (la variable nº1) — **[ALTO × ALTO]**
- **Streamear** los tokens del LLM al TTS (empezar a hablar con las primeras palabras) en vez de esperar la respuesta entera. Objetivo: hueco entre turnos **<800 ms**; >1 s suena robótico.
- **Medirlo de verdad** en NUESTRO endpoint del Custom LLM (timestamp de recepción y de primer token): ElevenLabs no te lo desglosa. Mirar el **P95**, no la media.
- **Modelo de voz rápido:** forzar el modo más rápido del modelo (verificar qué parámetros acepta el modelo exacto — no asumir); o cambiar el LLM de voz a uno más rápido (Gemini Flash / Haiku) **decidiéndolo con tus golden tests en español**, no con benchmarks en inglés. El TTS rápido (Flash) es **independiente** del LLM. **[INV6]** la traza no miente sobre el modelo real.
- **Frase puente** ("vale, déjame que mire un momento…") para no dejar silencio muerto.

### 4.2 Turn-taking / interrupciones — **[ALTO × MEDIO]** (config ElevenLabs)
- Permitir que **te interrumpa** (barge-in ON = más natural), **OFF solo en la frase de divulgación legal** (debe oírse entera). Relleno en castellano si tarda ("a ver…", "déjame que mire…") en vez del default. Ajustar la detección de voz para acento **LATAM**.
- ⚠️ Los **nombres exactos** de estos ajustes (`turn_eagerness`, `soft_timeout`, etc.) cambian entre versiones de ElevenLabs → **verificarlos en tu panel/config actual**; el consejo de fondo es sólido, los nombres son frágiles.

### 4.3 Muletillas y prosodia — **[MEDIO × BAJO]**
- Disfluencias **SÍ en lo empático** ("o sea…", "a ver cómo te lo explico", "mira, te cuento"), **NO en las afirmaciones de autoridad** (cifras del reparto, privacidad, siguiente paso). Backchanneling de escucha ("ya", "claro") cuando ella cuenta sus miedos.
- **Números hablados** ("setenta - treinta", el móvil por grupos), **más lento** en cifras/privacidad. Para pausas usa **puntuación/elipsis** (verificar si tu versión soporta etiquetas `<break>`).

### 4.4 Guion conversacional ético — **[ALTO × MEDIO]**
- Estructura: saludo+divulgación → por qué llamo → su situación → qué hacéis → dudas → siguiente paso. Validación emocional ("es normal que dudes, hay mucho fake por ahí"). Imperfección que humaniza ("no te voy a prometer que te haces rica, eso te lo promete un estafador"). Cierre suave: el **contrato como protección de ELLA** ("así tienes por escrito el % y que no pagas nada"), sin prisa.

---

## 5. Divulgación elegante (cumple la ley sin matar la conversación) — **[DISC]**

La clave no es retrasarla (ilegal), sino **envolverla en calidez + propósito + Alex real + control**.

**Texto (primer mensaje):**
> "¡Hola! Soy el asistente de Alex, de Rose Models 🌹 (sí, automatizado, pero leo todo y Alex lo revisa). Gracias por escribir, cuéntame, ¿cómo te llamas?"

**Voz (primeros segundos):**
> "¡Hola [nombre]! Soy el asistente de Alex, de Rose Models — sí, automatizado, pero te llamo de su parte para contarte cómo trabajamos, ¿te va bien? La llamada se graba por calidad, y si en algún momento prefieres hablar con Alex directamente, me lo dices y te lo paso."

**Si pregunta "¿eres una persona o un robot?":**
> "Buena pregunta, soy un asistente automático, pero todo lo que te cuento es real y Alex está detrás de cada paso. Si quieres hablar con él, te lo paso sin problema."

❌ **No vale:** "Hola, soy Sara de Rose Models" (nombre humano falso = incumple + destruye confianza). Ni el rollo legal frío ("Reglamento UE 2024/1689…") = efecto contestador, cuelgan.

---

## 6. Temas legales a cerrar (de la crítica)
- **Grabación de la llamada (RGPD):** si se graba, hace falta **consentimiento + política de retención** (más serio que el Art. 50). Tratarlo bien, sobre todo con público escéptico.
- **Divulgación primer turno:** decirlo claro y distinguible, en el idioma de la conversación, sin hacerse pasar por humano + con salida humana real (hablar con Alex).

---

## 7. Plan por fases

**Fase 0 — Quick wins (esta semana):** divulgación de IA en el primer DM **[DISC]** · lista negra de AI-tells · no cerrar siempre con pregunta · `temperature` 0,7 solo en voz.

**Fase 1 — Naturalidad estructural (lo que más se nota):**
- **Texto:** la **cola/worker para enviar los globos con delays + "escribiendo…"** (es la grieta nº1, pero es cambio de arquitectura por el techo de 10 s de Vercel).
- **Voz:** instrumentar y bajar la **latencia** (streaming token→TTS, medir P95, elegir modelo de voz por golden tests) + config de ElevenLabs (barge-in, relleno en castellano, VAD LATAM).

**Fase 2 — Persuasión fina:** accusation audit + desactivar red flags en los ejemplos (texto y voz) · disfluencias contextuales + prosodia en voz · registro LATAM (tuteo neutro) · reinyección de persona · follow-up contextual.

**Fase 3 — Medición:** medir 2 cosas accionables (hueco de turno en tu endpoint; % de chats que llegan a agendar). _Nota: con poco volumen, el A/B estadístico no aplica; usar juicio cualitativo sobre 10–20 conversaciones + los golden tests en tu español._

---

## 8. Notas técnicas a verificar antes de implementar (de la crítica)
- `reasoning_effort`/`verbosity`: **no** prometerlos en la ruta de texto sin verificar que el modelo exacto los acepta; el quick win real de texto es **prompt caching** + limitar tokens.
- `temperature`: subir **solo en voz** (0,7), nunca con la salida estructurada de texto.
- Nombres de `conversation_config` de ElevenLabs y soporte de `<break>`: **verificar en tu versión** (cambian entre releases).
- Los delays + ráfagas necesitan **cola/worker** (no caben en una invocación serverless de 10 s) → es lo primero a resolver en Fase 1 de texto.

Todo respeta los invariantes: el **código** decide flujo, estado, cifras, delays, cuándo se divulga y los follow-ups; el **LLM** solo redacta la forma; el **%** nunca es proactivo; la **divulgación** se mantiene y se loguea; la **traza** no miente sobre el modelo real.
