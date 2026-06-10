# Roadmap — junio 2026

Plan operativo tras la investigación verificada del 10-jun-2026 (7 agentes + 2 revisores
adversariales contra fuentes primarias: docs de OpenAI, Meta, AEPD, EDPB, Drizzle, Retell).
Sustituye el orden de fases de ROSE_MODELS_MASTER_CONTEXT.md donde se indica; el resto de ese
documento sigue vigente como contexto de negocio.

## Hallazgos que cambian el plan

1. **La persistencia pasa a ser la PRIMERA tarea, no una fase posterior.** Todos los datos de
   evaluación (ratings, decisiones A/B, sesiones, conversaciones importadas) viven en Maps en
   memoria y mueren con cada reinicio del dev server. Evaluar 100-200 respuestas antes de
   persistir es trabajo perdido. (Verificado: `simulatorStore.ts`, `evaluationRunner.ts:30-74`.)
2. **El fine-tuning de OpenAI está muerto para nosotros.** Cerrado a organizaciones nuevas desde
   el 7-may-2026; cierre total el 6-ene-2027. Estrategia de estilo: few-shot dinámico con
   ejemplos aprobados + prompt caching. `fineTuningExport.ts` queda como exportador JSONL
   portable (futuro LoRA open-weight), sin más inversión.
3. **La política de follow-ups viola la ventana de 24h de Meta.** "2-3 intentos cada 1-2 días"
   no es automatizable en Instagram. Hay que rediseñar: follow-up automático en hora 20-22,
   opt-in dentro de la primera ventana, resto manual de Alex (HUMAN_AGENT, hasta 7 días).
4. **AI Act Art. 50 (aplica desde el 2-ago-2026):** la divulgación de bot debe ser en la PRIMERA
   interacción, no solo "si preguntan". La entrada ACTIVE actual en `escalation-policy.ts:41-44`
   prescribe exactamente lo que la ley prohíbe; el corpus de estilo y golden tests que creemos
   ahora deben nacer ya conformes. Multas España (AESIA): hasta 35M€/7%.
5. **Bugs reales encontrados en el código** (ver Fase 0): estimador de costes 3x bajo, default
   real gpt-4.1-mini (deslistado), `reviewModel` es config muerta, no existe playback de
   conversaciones importadas (bloqueante de toda la fase de evaluación), falta el test del
   invariante "edad dudosa → no avanzar".
6. **OpenAI ya es encargado de tratamiento HOY** (cada mensaje del simulador va a su API):
   configurar DPA + residencia de datos EU/zero-retention ahora, no en la fase de Instagram.

## Fase 0 — Cimientos (≈1 semana)

Persistencia:
- [ ] PostgreSQL 18 local (instalador EDB como servicio Windows; fallback Docker `postgres:18`).
- [ ] Stopgap opcional día 1: snapshot JSON write-through de los repos in-memory para no perder
      ratings mientras llega Postgres.
- [ ] Completar `schema.ts`: `style_rating` en feedback; tablas `ab_evaluation_cases`,
      `evaluation_sessions`, `imported_conversations`; índices + unique (candidateId,
      externalMessageId); `drizzle-kit generate` + `migrate` (no `push`).
- [ ] `PostgresCandidateRepository` y repos de evaluación tras las interfaces existentes; tests
      de contrato compartidos InMemory/Postgres; selección por env `PERSISTENCE=postgres|memory`.
- [ ] `npm run db:backup` (pg_dump -Fc) con cifrado del volumen (BitLocker mínimo) y prueba de
      restore.

Quick fixes (TDD):
- [ ] `openaiProvider.ts:278-282`: tarifas reales gpt-5.4-mini $0.75/$4.50 por M (cached $0.075);
      añadir gpt-5.4-nano $0.20/$1.25. (El A/B decide empates por coste: con el estimador mal,
      decide mal.)
- [ ] `llmConfig.ts`: defaults a gpt-5.4-mini (gpt-4.1-mini deslistado; 4.1-nano muere
      23-oct-2026). Eliminar o cablear `reviewModel` (hoy config muerta).
- [ ] Adaptador: `reasoning effort: "none"` explícito (TTFT 0.67s vs 4.7s; timeout 12s no tolera
      medium), `verbosity: "low"` en redacción. Probar compatibilidad con structured outputs.
- [ ] Prompt caching: bloque estático (instrucciones+estilo+ejemplos) primero y >1024 tokens.
- [ ] Test del invariante 2 que falta: "edad dudosa → no avanzar a revisión humana".
- [ ] Cobertura explícita 8/8 reglas de seguridad de ARCHITECTURE.md.

Tooling de evaluación (el bloqueante):
- [ ] Endpoint + UI de playback: reproducir conversación importada turno a turno por el motor y
      recoger feedback por turno (hoy las sesiones no tocan el motor).
- [ ] UI legible del summary de sesión (hoy JSON crudo) + export CSV/JSON.
- [ ] Pre-poblar issues (FACTUAL_ERROR/STATE_ERROR) con los validadores; Alex confirma.
- [ ] Unificar los dos schemas de feedback (chat en vivo vs sesión).

## Fase 1 — Calidad conversacional (2-4 semanas, el corazón)

Protocolo (metodología 2026 verificada):
- [ ] Rúbrica anclada: descriptores 1-5 escritos con ejemplo real cada uno + 6-8 rasgos binarios
      de la voz de Alex (tuteo es-ES, longitud, sin emojis, léxico propio "vale/te explico/lo
      comento con mi socio", cero corporate-speak, cero IA-ismos, marcadores peninsulares — los
      modelos derivan a español neutro/LatAm).
- [ ] 20 conversaciones cubriendo los 12 estados, sobremuestreando caminos de riesgo (edad
      ambigua, <18, porcentaje, negociación, salidas de HUMAN_INTERVENTION_REQUIRED); ≥1/3 de
      respuestas evaluadas de turno 6+ (la fidelidad de persona decae en turnos tardíos).
- [ ] Cada fallo factual o rating ≤2 → mismo día: fix + golden test.
- [ ] A/B honesto: gpt-5.4-mini vs gpt-5.4-nano (¿basta el barato para comprensión?), pares
      emparejados, ciego, test binomial. Con 100-200 pares solo se detectan ganadores ≥60-65%;
      empate estadístico → decidir por coste/latencia/fallbacks. Validar harness con un A/A.
- [ ] Adaptador Anthropic (`anthropicProvider.ts`) tras las interfaces existentes, con el mismo
      fallback determinista y trazas honestas, para A/B a ciegas GPT vs Claude (decisión de Alex,
      10-jun-2026). Candidatos: claude-haiku-4-5 ($1/$5 por M) y claude-sonnet-4-6 ($3/$15 por M).
      El proveedor del bot se decide con datos del A/B, no por preferencia.
- [ ] Opcional (spike 1 día): promptfoo local como gate de regresión en CI (es el path oficial
      tras la muerte de OpenAI Evals el 30-nov-2026). Si fricciona con el pipeline multi-turno,
      descartarlo sin pena.
- [ ] (Después, con etiquetas de Alex) juez LLM calibrado: ≥90% TPR/TNR o kappa ≥0.6 en held-out
      vs Alex; el juez nunca aprueba envíos — Alex sigue siendo la única puerta.

Criterios de salida de la fase:
1. ≥20 conversaciones, ≥120 respuestas evaluadas, 12/12 estados cubiertos.
2. Cero errores factuales en la última pasada completa (un error → fix + golden test + reset).
3. Estilo: media ≥4.0/5 **y** ≥80% de respuestas ≥4 **y** ninguna ≤2.
4. Todo modo de fallo descubierto tiene golden test; suite verde.
5. Importación de conversaciones reales: tratarlas como PSEUDONIMIZADAS (no anónimas, EDPB
   01/2025) — siguen siendo datos personales; ver Fase L.

## Fase L — Cumplimiento legal (en paralelo; decisiones de Alex + abogado)

- [ ] **Divulgación de bot en primer mensaje** (AI Act Art. 50, aplica 2-ago-2026): DECISIÓN DE
      ALEX (10-jun-2026): mantener por ahora la política actual ("solo si preguntan").
      PENDIENTE: revisar con abogado antes del lanzamiento en Instagram — desde el 2-ago-2026 la
      divulgación en primera interacción es obligatoria y el corpus de estilo/golden tests
      creado en la Fase 1 habría que retocarlo entonces.
- [ ] OpenAI: DPA + residencia EU / zero data retention en la organización (ya somos responsables
      de tratamiento hoy).
- [ ] DPIA (EIPD): probablemente obligatoria (criterios AEPD: perfilado + sujetos vulnerables +
      tecnología novedosa). Posible dato Art. 9 (vida sexual) → base legal = consentimiento
      explícito; lo confirma el abogado.
- [ ] Aviso de privacidad Art. 13 por capas en el flujo de DM; registro de actividades Art. 30.
- [ ] Calendario de retención/borrado (las conversaciones de menores auto-CLOSED se borran en
      plazo corto; no quedan en el corpus de evaluación).
- [ ] Procedimiento de borrado (DSAR) que alcance Postgres, importaciones, prompts/ejemplos,
      exports JSONL y backups.
- [ ] Runbook de brechas (AEPD 72h, rotación de claves OpenAI/Meta, evidencias) — 1 página.
- [ ] Verificación de identidad/edad con documento en el onboarding (antes de cualquier
      contenido), con minimización y retención propia.

## Fase 2 — Persistencia cloud + Instagram (tras criterios de salida)

- [ ] Rediseño de follow-ups compatible con ventana 24h (tocar máquina de estados: p. ej.
      estado/flag WINDOW_EXPIRED; el motor jamás envía fuera de ventana). Diseñarlo al final de
      la Fase 1.
- [ ] Instagram API with Instagram Login (Graph v25+), app Business propia, Standard Access (sin
      App Review para cuenta propia), modo Live, webhooks; solicitar con antelación verificación
      de negocio + feature Human Agent (esa sí lleva revisión).
- [ ] Hosting del webhook público (Vercel Pro $20/mes o VPS €5-15/mes — el Hobby de Vercel
      prohíbe uso comercial) + endpoint de Data Deletion Callback de Meta.
- [ ] Captura del ad referral (campaña → candidata) desde el día uno.
- [ ] Migrar el MISMO schema a Supabase/Neon cambiando DATABASE_URL (la portabilidad es lo que
      compramos quedándonos en dialecto pg; SQLite habría sido un rewrite).
- [ ] Sin middleware (ManyChat no aporta siendo cuenta propia y añade un encargado GDPR).
- [ ] Lenguaje de captación no explícito en anuncios y DMs (riesgo discrecional de enforcement
      de Meta en el sector; documentar en BUSINESS_KNOWLEDGE.md).

## Fase 3 — Voz (Retell) — después

- Llamadas a teléfono normal (Twilio/Telnyx con número español), NO WhatsApp (Retell no integra
  WhatsApp calling hoy; re-verificar trimestralmente). Piloto es-ES con 2-3 combos TTS/ASR.
  Coste realista $0.10-0.25/min. Saludo con divulgación IA + aviso de grabación.

## Costes orientativos

- Fase de calidad: <$10 de API en total (gpt-5.4-mini + caching). ~$0.002-0.011/mensaje
  (2 llamadas LLM por turno: comprensión + redacción).
- Fase live: OpenAI ~$20-110/mes (a ~500 candidatas/mes), hosting ~$20/mes, Postgres gestionado
  ~$25/mes. El coste dominante será el ad spend de Instagram (a medir en la primera campaña).

## Pendientes de decisión de Alex

1. Redacción exacta de la divulgación de bot del primer mensaje (Fase L).
2. Validar tarifas de OpenAI en su dashboard de facturación antes de fijar el estimador.
3. Abogado para DPIA/Art. 9/retención (la parte que no puede resolver el código).
4. Rotar la clave de OpenAI expuesta (pendiente desde el 10-jun).
