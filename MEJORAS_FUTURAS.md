# 🗺️ MEJORAS FUTURAS — rose-models-agent

_Roadmap tras la auditoría + investigación nocturna (1→2 jul 2026). Nada de esto bloquea el lanzamiento (ver LANZAMIENTO.md). Ordenado para que decidas tú qué construimos después. Cada punto lleva **impacto**, **esfuerzo** (S/M/L) y si **toca invariantes** (→ requiere tests adversariales + revisor)._

Regla de oro que confirmó la investigación: **Instagram prohíbe el DM automático en frío**; tu modelo actual (responder al instante + reenganche limitado) es el correcto. Cualquier idea de "más volumen automático de openers" = riesgo de baneo, NO mejora.

---

## 🔧 PARTE A — Endurecimiento pendiente (fiabilidad; sale del propio sistema)

### A0 — Necesita TU decisión (no lo toqué a propósito)
- **Teléfono dado pronto congela el funnel** (`responsePlanner.ts`): si una candidata suelta su WhatsApp en QUALIFYING (habitual en AR), el bot deja de cualificar y responde en bucle "lo hablo con mi socio", pero nunca llega a revisión → lead muerto en silencio. **El fix choca con una decisión tuya previa** (BUG-A: no reabrir el guion con el teléfono capturado), por eso lo dejo para que decidas: o acotamos ese gate al estado post-aprobación, o escalamos a revisión cuando hay teléfono+adulta sin guion completo. **Impacto ALTO, esfuerzo M, toca flujo (tests adversariales).**

### A1 — Watchdog de llamadas "en curso" (RIESGO 3 del revisor)
Si el webhook de fin de ElevenLabs no llega, la ficha queda "En curso…" para siempre. Hoy se recupera a mano (botón Llamar / Rechazar funcionan). **Mejora:** un cron que barra `CALL_IN_PROGRESS` de más de X min y las devuelva a un estado accionable + aviso. **Impacto medio, esfuerzo S-M, neutro.**

### A2 — Auto-refresh del token de Instagram
`INSTAGRAM_ACCESS_TOKEN` caduca (~60 días); cuando muere, el bot enmudece **sin error visible** (el webhook sigue dando 200 a Meta). **Mejora:** refresco automático del long-lived token + aviso a los 7 días de caducar. **Impacto ALTO (evita un apagón silencioso), esfuerzo M, neutro.**

### A3 — Concurrencia extrema sobre la MISMA candidata (P1-4)
Bajo carga muy alta y simultánea (webhook de fin + turno de IG a la vez), el upsert de fila completa puede pisar una escritura. Mitigado en parte (versión atómica), pero no 100%. **Mejora:** update por campos / lock optimista en Postgres. **Impacto medio (raro a tu volumen), esfuerzo M-L, cuidado (tests).**

### A4 — Avisos del CRM visibles fuera de la pestaña CRM (P1 de la auditoría)
Los avisos (éxito y error) solo se pintan en la pestaña "CRM" y el drawer los tapa. **Mejora:** un toast global visible en Mensajes/ficha. **Impacto medio (Alex se pierde fallos), esfuerzo S, neutro. No pude verlo visualmente → lo dejo para hacerlo contigo.**

### A5 — Pestaña "Mensajes" en vivo
No se refresca sola: si Alex responde a mano, no ve las réplicas nuevas hasta recargar. **Mejora:** polling como el drawer. **Impacto medio, esfuerzo S, neutro.**

### A6 — Detalles menores (P3): "mañana a las 6" se agenda a las 06:00 AM (avisar/confirmar franja); handoff solo se honra si el status es COMPLETED (si es "failed" el reintento re-llama a quien pidió persona); frescura HMAC también en el formato hex-pelado. **Impacto bajo, esfuerzo S.**

---

## 🚀 PARTE B — Crecimiento y CRM (sube conversión / ahorra tu tiempo)

> Contexto del sector: **la velocidad de 1ª respuesta es la palanca #1** (responder en <5 min multiplica x21 la cualificación). Tu bot ya responde al instante — el riesgo es que las esperas de revisión maten esa ventaja. De ahí las 3 primeras ideas.

| # | Mejora | Qué resuelve | Impacto | Esfuerzo | Coste |
|---|---|---|---|---|---|
| **B1** ⭐ | **Cola "Te esperan" con reloj** (ordenar decisiones por antigüedad, verde/ámbar/rojo) | ves cuánto lleva esperando cada candidata → no se enfrían | **ALTO** | **S** | gratis |
| **B2** ⭐ | **Panel "Hoy"** (tareas derivadas de estados: aprobadas sin agendar, llamadas hechas sin siguiente paso, citas de hoy) | con un operador, lo que no está en una lista se pierde | **ALTO** | S-M | gratis |
| **B3** ⭐ | **Booking con Cal.com** (link de calendario en vez de parsear "el lunes a las 18h") | menos no-shows, zonas horarias AR bien, menos reagendados | **ALTO** | M | gratis (self-host) |
| **B4** | **Analítica de embudo real** (tasa etapa→etapa y dónde se caen, no la foto actual) | te dice DÓNDE arreglar; usa las transiciones que ya guardas | **ALTO** | M | gratis |
| **B5** | **Contrato con firma (DocuSeal)** pre-rellenado desde el CRM | cierra el último escalón (hoy 100% manual por WhatsApp) | **ALTO** | M-L | gratis (self-host) |
| **B6** | **Cola de leads fríos** (materializar la señal `markCold` en un filtro para reactivar a mano) | recupera un % que hoy desaparece en silencio | medio | S | gratis |
| **B7** | **Segmentación por señales operativas** (orden sugerido: dispositivo OK + interés alto arriba) | priorizas tu tiempo. ⚠️ SOLO señales operativas, **nunca** físicas (eso es tuyo) | medio | S | gratis |
| **B8** | **A/B de openers con medición** (etiquetar variante → medir respuesta) | hoy A/B-testeas sin leer el resultado. Rinde en meses, no días | medio | S+M | gratis |
| **B9** | **Plantillas de respuesta rápida** en control manual (botones que pre-rellenan texto del conocimiento) | ahorra tiempo al escribir a mano | bajo-medio | S | gratis |
| **B10** | **KPIs con tendencia** ("+3 vs semana pasada", win-rate del embudo, tiempo de ciclo) | te orienta; depende de B4 | bajo-medio | M | gratis |

**Secuencia recomendada:** B1 + B2 (ya, impacto inmediato en tu tiempo) → B3 (quita fricción en la llamada) → B4 (mide) → B5 (cierra) → el resto acumulativo.

---

## 🎙️ PARTE C — Bots de voz y texto (más eficaces y humanos)

_Casi todo es capa de presentación/observabilidad/enrutado — no toca el control de flujo. Marco las que rozan el límite._

**Ganancias rápidas (empezar aquí):**
- **C1 — Fillers pregrabados en la voz** ("dale, mirá…", "un segundito") que el CÓDIGO dispara si la respuesta tarda: mata el silencio que delata al bot. **Alto / S / neutro.** *(Ya tienes "buffer words"; esto es la versión con audio pregrabado.)*
- **C2 — Escalado a humano por señales** (piden persona / 2 fallos seguidos / enfado sostenido / negociación → a Alex). **Alto / S-M / refuerza invariante 4.**
- **C3 — Resumen/contexto al redactor** (pasar un resumen de lo hablado, no repreguntar). **Medio / S / neutro.** *(Ya lo montamos en parte esta madrugada con `callFactExtractor` en la voz; falta pulir en texto.)*

**Alto valor, esfuerzo medio:**
- **C4 — Streaming real STT→LLM→TTS** (que `/api/call/llm` emita tokens en streaming, no la respuesta entera): la mayor mejora de latencia percibida. **Alto / M / neutro.**
- **C5 — Resumen post-llamada estructurado** (un LLM barato en batch tras cada llamada → JSON: resultado, objeciones, sentimiento, ¿se dijo el disclosure?, próxima acción) guardado en la ficha. Convierte el 100% de llamadas en datos. **Alto / M / neutro** *(el resumen es sugerencia; NO reescribe el estado real)*.
- **C6 — Banco de objeciones formalizado** (top-5 cubren ~74%) en `src/content/` con golden tests. **Alto / M / ⚠️ toca invariante 3 en la objeción del %: tests adversariales obligatorios.**
- **C7 — Barge-in como política por estado** (disclosure NO interrumpible; captura de datos = paciente; charla = adaptativo). **Medio-alto / M / refuerza el disclosure.**
- **C8 — Endpointing semántico + AMD asíncrono** (menos interrupciones, mejor detección de buzón). **Medio-alto / M**, depende de lo que exponga ElevenLabs/Zadarma.

**Medio plazo (necesita datos de C5):**
- **C9 — Coaching del guion con datos reales** (qué línea pierde candidatas). **Alto a medio plazo / M.**
- **C10 — Re-enganche multi-toque por código** (respetando límites de IG). **Medio-alto / M.**

---

## 🚫 Lo que NO recomiendo (para no perder tiempo/dinero)
- **Automatizar openers en frío a escala** → baneo de Instagram garantizado.
- **CRM/sales-engagement enterprise** (HubSpot de pago, Outreach.io, Salesloft) → caros, para equipos, duplican lo que ya tienes.
- **Suites de "conversation intelligence" de pago** (Aircall, NiCE, Hamming…) → úsalas como inspiración de qué medir, no las compres; C5 casero cubre el 90%.
- **Entrenar modelos propios de turn-detection / sentimiento en tiempo real** → sobreingeniería para un operador solo; usa lo que traiga ElevenLabs.
- **SMS de pago para recordatorios** ahora → recuerda por el propio bot (IG/voz) gratis hasta que el volumen lo justifique.

---

*Fuentes clave: speed-to-lead (Kixie/Verse), reclutamiento OF (Nimbusreach), límites de Meta/IG (ofm-tools, CreatorFlow), embudo (Teamgate/Blueprint), Cal.com, DocuSeal, latencia y turn-taking de voz (Hamming/Coval/LiveKit), AMD (Vida), escalado (eesel/Decagon). Detalle completo en el informe de la auditoría.*
