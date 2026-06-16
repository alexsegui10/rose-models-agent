# Plan — Bot de llamada (agente de voz). Investigación + estrategia (jun-2026)

## DECIDIDO por Alex (16-jun-2026)
- **Canal: la llamada es por WhatsApp** (no telefonía normal). Flujo real: en Instagram se agenda hora
  y la candidata da su teléfono → se la añade a WhatsApp → **el bot la llama por WhatsApp** a la hora
  pactada. (La viabilidad técnica voz-IA-sobre-WhatsApp se está investigando aparte; el guion es el mismo.)
- **Objetivo**: explicar la agencia, generar confianza y **dejar el siguiente paso** (NO cerrar compromiso
  firme en la llamada).
- **Siguiente paso / cierre**: al final, si no le quedan dudas → *"ahora te paso el contrato, léelo con
  calma y cualquier duda sobre él me avisas sin problema"* y se cuelga. El **siguiente paso = enviar el
  contrato** (lo gestiona Alex).
- **Voz**: voz **castellana de librería** de ElevenLabs (NO clonar, de momento).
- **Plataforma**: a confirmar tras la investigación de WhatsApp (Retell era la recomendada para llamada
  normal; con WhatsApp puede cambiar).
- **Duración**: ~5 min; un poco más solo si tiene dudas. Normalmente no preguntan mucho.

## Guion confirmado por Alex (contenido, independiente del canal)
- **Negociación del % EN LA LLAMADA (autorización explícita de Alex, solo canal voz)**: se dice **70/30**.
  Si la candidata se queja **bastante** → se puede bajar a **65/35**; si aún lo ve imposible → **60/40**;
  **de 60 NO se baja**. Nunca proactivo: solo si insiste. El **código controla la escalera** (70→65→60),
  el modelo no negocia libre. *(Encaja con la nota del repo "niveles 65/60 solo para voz, jamás por chat";
  en el DM la negociación sigue escalando a Alex — invariante 3 intacto para chat.)*
- **Continuidad con el DM**: como el % y otras cosas ya se hablaron por Instagram, usar fórmulas tipo
  *"como te dije por Instagram, trabajamos con 70 y 30"* / *"como hablamos por Insta…"* → refuerza que es
  **la misma persona** del chat. Castellano natural y cercano.
- **Pregunta que el bot no sabe**: NO improvisar. Decir *"ese punto se lo comento a mi socio y te digo"*
  (deferir a Alex), para no liarla. Equivale al patrón de deferir del DM.
- **Tono**: español de España natural, muletillas castellanas, cercano (la misma voz que el texto del DM).

## Investigación WhatsApp (16-jun-2026) — VIABLE-CON-PEROS
La WhatsApp Business Calling API es GA desde jul-2025, pero el outbound NO es del todo self-serve y tiene
fricciones reales. **Stack revisado recomendado** (mejor que el inicial):

- **ElevenLabs Agents (WhatsApp nativo) + mi backend como "Custom LLM"**. ElevenLabs gestiona TODA la capa
  de WhatsApp (señalización, audio Opus, permiso de llamada) y la voz/STT; yo expongo un endpoint
  **OpenAI-compatible** (`/v1/chat/completions`) que delega en `conversationEngine`/`openaiProvider`. El
  formato ya lo hablamos. **Invariante 1**: con Custom LLM yo devuelvo el texto → el guion y el estado los
  decide mi código. Vigilar que ElevenLabs no inyecte tool-calling que se salte la máquina de estados.
- Alternativa enterprise: **Twilio WhatsApp Business Calling + ConversationRelay → mi webhook**. SIP nativo
  de Meta a un SBC propio solo si se quiere control total (asumiendo bugs ICE/DTLS).

**Fricciones / bloqueos reales del outbound por WhatsApp:**
1. **WABA verificada + número de WhatsApp Business DEDICADO** (distinto del Instagram y NO puede estar en la
   app normal de WhatsApp).
2. **Permiso de llamada explícito**: NO basta con que dé el número por DM. Flujo: abrir ventana de chat en
   WhatsApp con ella → enviar "call permission request" → ella acepta → llamar **dentro de 72 h**.
3. **Posible umbral de Meta**: messaging limit ≥ 2.000 conversaciones/24h para activar el outbound. Una
   agencia nueva quizá no lo cumpla de entrada → vía BSP/ElevenLabs se suaviza, pero **HAY QUE CONFIRMARLO
   antes de invertir** (riesgo nº1).
4. País: España y LATAM soportados. Bloqueados para outbound: EE. UU., Canadá, Nigeria, Vietnam, Turquía/Egipto.

**Coste (WhatsApp):** ~**0,45-1,00 $ por llamada** de 5-7 min (IA ~0,07-0,12/min + transporte WhatsApp
~0,01-0,025/min estimado). Mensual: 100 ≈ 54-87 $ · 500 ≈ 270-435 $. **Más barato que PSTN.** Entrantes
gratis. Meta no publica tarifa pública por minuto (gateada tras BSP) → confirmar rate card.

**Legal (WhatsApp = VoIP, no PSTN):** el **prefijo 400 muy probablemente NO aplica** (es de numeración
E.164/PSTN; una llamada VoIP de WhatsApp no pasa por ahí — matiz: la norma no excluye OTT literalmente, sin
guía CNMC aún). **Sigue aplicando:** declarar que es IA al inicio (EU AI Act Art. 50, desde 2-ago-2026),
aviso de grabación (RGPD), base precontractual (Art. 6.1.b) cubierta porque ella inicia el contacto.

**Plan B si el outbound se complica:** (a) que **ella llame al bot** (user-initiated: gratis, sin permiso ni
umbral) — la cualifica igual; (b) PSTN normal (Twilio Voice): maduro pero ~0,049 $/min + entra en el 400
desde oct-2026; (c) esperar a que madure el self-serve SMB de Meta.

### Texto PROPUESTO de apertura (DRAFT — Alex debe aprobar el wording final)
> "Hola{, nombre}, soy el asistente de Rose Models, hablamos por Instagram. Te aviso de que soy un
> asistente automatizado y de que la llamada se graba para gestionar tu alta. Si en algún momento prefieres
> hablar con una persona, dímelo y te paso con Alex. ¿Te va bien que te cuente cómo trabajamos?"

(Cumple IA + grabación + opción de humano. El texto exacto y la "finalidad" los confirmas tú.)

## Idea clave
Se puede hacer un bot de llamada SALIENTE que suene muy natural en castellano **respetando tu invariante
"el código decide, el modelo solo habla"**. La forma correcta NO es *speech-to-speech* (rompe el control
determinista), sino **arquitectura en CASCADA**: STT → **tu backend Next.js (cerebro) + tu lógica
determinista** → TTS. Cada palabra pasa por una capa de TEXTO que tu código inspecciona, valida (edad, OF,
móvil), enruta a Alex y loggea — es tu `conversationEngine.ts` de hoy, pero por teléfono.

## Stack recomendado para EMPEZAR (Stack 1 — cascada gestionada)
- **Plataforma (fontanería de la llamada)**: **Retell** (recomendado; su "Custom LLM por WebSocket" encaja
  casi 1:1 con tu motor de 16 pasos) o Vapi. Gestiona telefonía, turnos, barge-in, grabación.
- **STT**: Deepgram Flux (soporta español, fin-de-turno integrado, ~0,008 $/min).
- **Cerebro = TU código**: endpoint Next.js como "Custom LLM" reutilizando `conversationEngine`,
  `factualValidator`, `policyRules`, máquina de estados. El LLM de texto que ya usas (gpt-5.4-mini) o
  Claude Haiku 4.5 (rápido para voz).
- **Voz (TTS)**: **ElevenLabs Flash v2.5**, voz **castellana de España** o **clonando la voz de Alex**.
- **Telefonía**: MVP con fijo +34; producción España → número **prefijo 400** vía operador VoIP español.

Alternativas: **Twilio ConversationRelay** (semi-managed, todo en Node, sin microservicio Python; ~0,07
$/min extra). **DIY (Pipecat/LiveKit)** solo a escala >2.000 llamadas/mes (es Python = microservicio
aparte; no compensa antes).

## Voz natural en castellano (lo más crítico)
**ElevenLabs** es la única con voces reales de **España** (no latino) + filtro de acento. Para llamada en
vivo: **Flash v2.5** (~75ms). **Recomendación fuerte: clonar la voz de Alex** (Professional Voice Clone,
~30 min de audio; legal por ser su propia voz) → acento castellano garantizado + coherencia total con el
bot de DM. El código debe meter muletillas castellanas ('a ver', 'o sea', 'vale', 'pues', 'venga'), NO
latinas. Evitar las voces por defecto de Vapi/Retell/OpenAI (tiran a neutro/latino y suenan robóticas).

## Coste real (todo incluido, móvil España)
- **~0,15-0,18 $/min** (el "desde 0,05" de los anuncios es falso, es 3-4x). La **telefonía a móvil ES
  (~0,049 $/min) domina** el coste variable.
- Por llamada de ~7 min: **~1,05-1,26 $**. Al mes: **100 llamadas ≈ 105-126 $ · 500 ≈ 525-630 $ · 2.000 ≈
  2.100-2.520 $**. Bajar telefonía a Telnyx recorta ~0,03-0,04 $/min.

## Legal UE/España (importante, con fechas)
1. **Declarar que es una IA al inicio** (EU AI Act, obligatorio desde 2-ago-2026): primeros segundos, como
   "asistente automatizado de Rose Models". La voz natural no exime.
2. **Avisar de la grabación** (RGPD): base legal documentada (interés legítimo o consentimiento) + informar.
3. **Consentimiento de llamada**: YA cubierto (ella dio el número y agendó por DM) — pero **documenta** ese
   opt-in y llama a la hora pactada.
4. **Prefijo 400** (obligatorio 17-oct-2026): las llamadas comerciales en España deben salir de un número
   **400 de un operador español** (NO Twilio/Telnyx); los móviles ya están prohibidos para comercial.
5. RGPD: política de privacidad, **firmar DPA** con cada proveedor (voz-IA, OpenAI, telefonía), transferencia
   internacional (SCCs/DPF), minimizar, plazo de conservación (p.ej. 90 días-12 meses).
6. **Solución**: una **locución de apertura determinista** (paso 0, controlado por código como tu opener de
   DM) que junta IA + grabación + finalidad + opción de hablar con persona, y se loggea como prueba.

## Cómo integra con el sistema actual (reusa el cerebro)
- **Disparo**: al agendar (`CALL_SCHEDULED` con slot + phone, campos que ya existen), un **scheduler**
  (cron/cola tipo Inngest/QStash, fuera de Vercel serverless) llama a la API saliente de la plataforma
  inyectando el contexto de la `Candidate` (nombre/edad/OF/país) → el bot arranca **sabiendo con quién habla**.
- **Cerebro = tu código** vía Custom LLM (WebSocket): STT→texto→tu pipeline decide y redacta→TTS. El modelo
  nunca cambia estado, solo pide **acciones (tools)** que tu código aprueba/deniega.
- **Handoff a Alex** (invariante 4): negociación/sospecha de menor/pide humano → transferencia en vivo o
  "te escribe Alex".
- **Cierre**: webhook de fin de llamada (reusa tu patrón webhook+HMAC) escribe transcripción/resumen/estado
  en la `Candidate`. Probablemente nuevo estado post-`CALL_SCHEDULED` (CALL_COMPLETED/CALL_NO_ANSWER).

## Plan por fases
- **Fase 0 (días)**: decisiones (abajo) + locución de apertura + (si clonas) grabar 30 min de audio +
  pedir presupuesto del número 400 a operadores españoles (plazo largo).
- **Fase 1 — MVP (1-2 sem)**: Retell + tu backend como Custom LLM + Deepgram + ElevenLabs, con **fijo +34**
  de prueba. El bot llama, se identifica como IA, habla en castellano natural, mantiene el guion
  determinista, hace handoff. Validar latencia (600-900ms) y **escuchar grabaciones reales**.
- **Fase 2 — Producción (2-4 sem)**: número 400 vía operador español + SIP; cerrar legal (DPAs, política,
  logging); scheduler que dispara la saliente; webhook de cierre.
- **Fase 3 — Escala (>2.000/mes)**: migrar a DIY (Pipecat/LiveKit) + Telnyx para recortar margen.

## Decisiones que Alex debe tomar
1. **Objetivo de la llamada**: ¿solo explicar/generar confianza/avanzar, o también cerrar compromiso
   concreto (fecha de inicio)?
2. **Clonar tu voz** (sí/no).
3. **Plataforma**: Retell (recomendado) vs Vapi.
4. **Volumen/presupuesto** esperado (define si ~0,15-0,18 $/min es asumible y si conviene Telnyx).
5. **Número 400**: aceptar la dependencia de un operador español (empezar a pedir presupuesto ya).
6. **Locución de apertura** (texto IA+grabación+finalidad, tu registro).
7. **Reintentos** si no contesta (cuántos, en qué horas) y **base legal + conservación** de la grabación.
8. Firmar **DPAs** con los proveedores.
