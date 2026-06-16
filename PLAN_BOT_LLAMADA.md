# Plan — Bot de llamada (agente de voz). Investigación + estrategia (jun-2026)

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
