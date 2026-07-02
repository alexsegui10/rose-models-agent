# Mejorar el audio de las llamadas al máximo (sin gastar más dinero)

Investigación 2-jul-2026 sobre los 3 problemas de la llamada real: **se oye mal**, **palabras cortadas**
y **llamadas que se quedan "En curso" para siempre** (y por eso el CRM sale vacío).

## ✅ YA HECHO por Claude vía API (2-jul, tarde) — no tienes que tocarlo

Con la clave en `.env.local` se auditó y corrigió el agente directamente. La auditoría reveló que varios
ajustes que se creían puestos NO lo estaban:

| Ajuste | Antes (real) | Ahora |
|---|---|---|
| Interrupciones (client event `interruption`) | ACTIVAS (causa nº1 de palabras cortadas) | **OFF** |
| End call after silence | **-1 (desactivado)** — por esto las llamadas quedaban "En curso" | **45 s** |
| Max conversation duration | 600 s | **420 s** |
| Turn eagerness | normal | **patient** |
| Stability / Speed / Similarity | 0.5 / 1.0 / 0.8 | **0.7 / 0.95 / 0.75** |
| Custom LLM extra body | **OFF** — por esto el bot no sabía tu nombre | **ON** |
| Webhook post-llamada | **SIN ASIGNAR** (el webhook "Post Rose" existía pero no estaba conectado) — por esto el CRM salía vacío SIEMPRE | **Asignado** (workspace + agente) |
| Voz | "Dani - Hurried" (¡una voz "apresurada"!) | **"Pablo - Deep, Confident and Clear"** (diseñada para llamadas salientes); "Gin" y "Ciro" añadidas a Mis Voces como alternativas para A/B |
| transcribe_on_disabled_interruptions | off | **on** (lo que ella diga mientras habla el bot no se pierde) |

Además se descubrió que la llamada real de hoy (8 min de loro) murió por **"quota limit"**: el bucle
te fundió los créditos de ElevenLabs. **Revisa tus créditos antes de la siguiente prueba.**

Y en el código (desplegado): anti-loro con habla real (el cierre/handoff se repite UNA vez y luego
silencio; las preguntas reales tras el cierre se responden; despedida corta si ella se despide) +
muletillas rotatorias (ya no dice "A ver..." en cada turno).

## Veredicto honesto (resumen)

| Problema | ¿Se arregla sin migrar? | Cómo |
|---|---|---|
| Palabras cortadas | **Muy probablemente SÍ, gratis** | Desactivar interrupciones en ElevenLabs (causa nº1: falsas interrupciones por eco/ruido de línea) |
| Llamadas "En curso" eternas → CRM vacío | **SÍ, hoy mismo** | "End call after silence" (viene DESACTIVADO de fábrica) + tope de duración |
| Se oye mal en general | **Solo en parte** | El techo lo pone la ruta de Zadarma. Tu prueba con Twilio (mismo agente, misma voz, mucho mejor) demuestra que el culpable es el tramo Zadarma, no ElevenLabs. Se ataca con un ticket a Zadarma pidiendo cambio de ruta |

Importante: tu llamada mala fue **de número argentino a un móvil de España** — esa ruta internacional
rara NO predice cómo sonará en producción (Argentina → Argentina). Antes de decidir nada caro, hay que
probar con un móvil argentino real.

---

## PASO 1 — Hoy, en ElevenLabs (10 minutos, gratis)

Todo está en tu agente. Lo que la doc vieja llama pestaña "Advanced" hoy se llama **Configuración**.

1. **Desactivar interrupciones** ⭐ (arregla las palabras cortadas)
   - Agente → **Configuración** → sección **Client events** → quita/desmarca el evento **`interruption`**.
   - Por qué: el eco de la línea hace que el sistema crea que la candidata está hablando y **corta la voz
     del bot a mitad de palabra**. ElevenLabs no tiene mando de sensibilidad: solo on/off. Para un pitch
     saliente, OFF.

2. **End call after silence** ⭐ (arregla las llamadas eternas y el CRM vacío)
   - Agente → **Configuración**, junto a "Turn timeout" → busca **"End call after silence"**.
   - Ponlo a **45 segundos**. Viene desactivado de fábrica (-1): por eso cuando el colgado del móvil no
     llega, la conversación se queda "En curso" para siempre y el webhook del CRM nunca se dispara.
   - Nota: lo que activaste en Herramientas es la *herramienta* "End call" (otra cosa, y nuestro cerebro
     no la usa). El ajuste que nos protege es ESTE timeout.

3. **Max conversation duration** (cinturón extra)
   - Agente → **Configuración** → "Max conversation duration" → **420 segundos** (7 min).
   - Ninguna llamada zombi facturará más de eso.

4. **Turn eagerness = Patient**
   - En los ajustes de turnos (Agente o Configuración) → **Turn eagerness** → **Patient**.
   - El agente entra menos agresivo al turno: menos pisadas cuando hay ruido o ella duda.

5. **Voz: Stability arriba, Speaker boost fuera**
   - Agente → **Voz** → Voice settings:
     - **Stability: 70%** (a 50% la voz mete variaciones que por teléfono suenan a glitch)
     - **Similarity: 75%** (déjalo como está, no subir más)
     - **Speaker boost: OFF** (solo añade latencia; por teléfono no se nota)
     - **Speed: 0.95** (un pelín más lento = más inteligible en teléfono)
   - Modelo: **quédate con Flash v2.5** (Turbo no suena mejor, solo tarda más).

6. **La voz en sí ("Rodrigo Angular")**
   - El teléfono corta todo lo agudo (por encima de ~3.4 kHz): una voz con mucho "aire"/susurro llega
     sucia. Si tras los ajustes sigue sonando mal, prueba otra voz masculina medio-grave con articulación
     fuerte y sin susurro — es el mayor salto de calidad gratis que queda.

No toques: formatos de audio TTS del agente (el SIP los negocia por su cuenta, los ignora), codecs
(ya es G.711 forzado, no hay nada mejor posible con Zadarma) ni Media Encryption (déjalo Disabled,
como manda la guía de Zadarma).

---

## PASO 2 — Diagnóstico de 5 minutos (antes de reclamar a nadie)

Abre en ElevenLabs la conversación de la llamada real de hoy (Agents → Call history):

- **Escucha la grabación de ElevenLabs y compárala con lo que oíste en el móvil:**
  - Si en la grabación las frases están COMPLETAS pero en el móvil se cortaban → el problema es la
    **ruta de Zadarma** (pérdida de paquetes) → ticket a Zadarma (Paso 3).
  - Si la grabación YA tiene las palabras cortadas → eran **interrupciones falsas** → el Paso 1.1 lo arregla.
- **Mira la transcripción:** si en los momentos de corte aparecen turnos de "usuario" con trozos de lo
  que decía el PROPIO bot o basura ininteligible → confirmado: eco/interrupción falsa.

**Eco-test 4444 (opcional, muy revelador):** lanza una llamada saliente del agente al número interno
**4444** de Zadarma (repite lo que oye). Si ya se oye mal ahí, el problema está entre ElevenLabs y
Zadarma; si se oye perfecto, el problema es la ruta hacia el móvil de destino.

---

## PASO 3 — Ticket a Zadarma (la palanca real del "se oye mal")

En el panel de Zadarma **no hay tornillos de audio** (ni codecs, ni jitter, ni timers): las palancas son
tickets. Zadarma SÍ cambia rutas por destino cuando la queja va documentada. Abre ticket en
my.zadarma.com → Soporte → Tickets (o support@zadarma.com) con 2-3 llamadas concretas
(fecha, hora con zona horaria, número origen y destino — las sacas de Mi PBX → Estadísticas PBX).

Texto sugerido (copia y pega, rellena los datos):

> Asunto: Mala calidad de audio y problemas de señalización en llamadas salientes SIP
>
> Hola. Uso el trunk SIP con ElevenLabs (sip.rtc.elevenlabs.io) y tengo tres problemas:
>
> 1. AUDIO ENTRECORTADO: en las llamadas salientes se pierden sílabas y la voz llega degradada.
>    Ejemplos: [fecha/hora/destino de 2-3 llamadas]. Pido cambio de carrier/ruta para el prefijo 549
>    (Argentina móvil) y 34 (España), y que reviséis internamente el jitter buffer de la PBX y que no
>    haya supresión de silencio/VAD activa en el trunk hacia el carrier de destino.
>
> 2. CALLERID REESCRITO: tengo configurado mi número argentino como CallerID pero en destino aparece
>    oculto o un número de Reino Unido. Pido ruta con CLI garantizado ("Premium routes with guaranteed
>    CallerID transfer" según vuestra web) para esos prefijos.
>
> 3. COLGADO QUE NO LLEGA: cuando el destinatario cuelga, el BYE no llega a ElevenLabs y la sesión
>    queda abierta. Pido que verifiquéis que el BYE se envía al Contact devuelto en el 200 OK de
>    sip.rtc.elevenlabs.io, reabriendo la conexión TCP si ha muerto (requisito documentado por ElevenLabs).

Además, revisa en **Mi PBX → Llamadas salientes** que exista una regla por destino (549 y 34) con tu
número argentino como "Displayed Caller ID", y en la extensión que usa ElevenLabs que el CallerID sea
el número argentino.

---

## PASO 4 — Repetir la prueba y decidir

1. Aplica el Paso 1, haz otra llamada de prueba.
2. Si las palabras ya no se cortan y la llamada se cierra sola → quedan solo los matices de "se oye mal".
3. **Piloto argentino**: antes de decidir migrar nada, 2-3 llamadas a móviles argentinos reales (+549…).
   La ruta AR→AR de producción es OTRA distinta a la que probaste (AR→España).
4. Si tras el cambio de ruta de Zadarma + piloto AR sigue sonando mal → la migración racional NO es
   volver a Twilio (no vende números argentinos sin domicilio en Argentina) sino otro proveedor con
   numeración AR que conecte al mismo trunk de ElevenLabs (p. ej. **DIDWW** — tiene guía oficial de
   ElevenLabs — o Telnyx). El agente, el cerebro y el CRM no se tocan: solo se cambia el trunk.

## Experimentos opcionales (solo si lo anterior no basta)

- **TLS en el trunk**: ElevenLabs → Phone numbers → tu trunk → Transport **TLS puerto 5061** (en vez de
  TCP 5060). La conexión suele sobrevivir mejor y ayuda al BYE. Si Zadarma no lo acepta, volver a TCP.
- **Trunk directo sin PBX** (solo diagnóstico): importar el número otra vez con Address `sip.zadarma.com`
  y el login SIP principal (Configuración → SIP), sin la capa PBX. Si mejora claramente, parte del
  problema es el procesado de la PBX. Ojo: en esas llamadas se pierden la grabación y los webhooks de
  la PBX.
- **Muletillas que no interrumpen**: si algún día quieres reactivar interrupciones, existe (por API)
  `interruption_ignore_terms` para que "sí", "vale", "ajá", "claro" no roben el turno.
