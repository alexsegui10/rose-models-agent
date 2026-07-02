# 🚀 LANZAMIENTO — checklist del día 1 (Rose Models)

_Generado en la auditoría nocturna del 1→2 jul 2026. Todo el código de esta lista YA está desplegado (commits d38bd31 · 838b13a · 663feb5 · 4261945 · e2bb9bc). 1332 tests en verde._

El embudo completo: **candidata escribe por Instagram → el bot cualifica → tú pulsas "Encaja" → el bot pide hora+teléfono y agenda → el auto-marcador llama sola a esa hora → el bot de voz habla → el resultado aparece en la ficha → tú envías el contrato por WhatsApp a mano.**

---

## ✅ PARTE 1 — Variables en Vercel (10 min, lo más importante)

`Vercel → tu proyecto → Settings → Environment Variables`. Tras cambiar cualquiera, **Redeploy**.

### Imprescindibles para el BOT DE TEXTO (si falta una, el bot enmudece o pierde DMs EN SILENCIO)
| Variable | Valor | Si falta… |
|---|---|---|
| `LLM_MODE` | `OPENAI` | el bot responde en modo determinista (más plano) |
| `OPENAI_API_KEY` | tu clave | cae a determinista |
| `AUTOMATION_MODE` | **`AUTOMATIC`** ⭐ | con `HUMAN_APPROVAL` el bot **NO envía solo** (tendrías que aprobar cada mensaje). Ver decisión abajo |
| `PERSISTENCE` | `postgres` | — |
| `DATABASE_URL` | tu Neon | **el arranque falla ruidoso** (ya no pierde datos en silencio; añadido esta noche) |
| `SITE_PASSWORD` | una frase larga | el CRM devuelve 503 (fail-closed) |
| `INSTAGRAM_VERIFY_TOKEN` / `INSTAGRAM_APP_SECRET` / `INSTAGRAM_ACCESS_TOKEN` | los de tu app de Meta | no entran/salen DMs |

### Imprescindibles para el BOT DE VOZ
| Variable | Valor | Nota |
|---|---|---|
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` / `ELEVENLABS_AGENT_PHONE_NUMBER_ID` | los de ElevenLabs | sin ellas, el botón Llamar da 503 |
| `CALL_LLM_API_KEY` | token largo | **debe ser IDÉNTICO** al del Custom LLM en ElevenLabs |
| `CALL_WEBHOOK_SECRET` | = signing secret del webhook de ElevenLabs | para que se guarde grabación/resumen |
| `CALL_DISCLOSURE` | `on` | que suene el saludo "Hola, soy Alex…" |
| `CALL_RECORDED` | `0` | que NO diga "te aviso que grabo" |
| `CALL_LLM_REDACTION` | (déjala **vacía** o sin poner) | la redacción natural va **ON por defecto** con clave; solo `off` la apaga |

### Auto-marcador y avisos
| Variable | Valor | Nota |
|---|---|---|
| `CRON_SECRET` | token largo | sin él, el auto-marcador y el re-enganche no corren |
| `QSTASH_TOKEN` (+ `QSTASH_URL`, signing keys) | los de Upstash | sin él, la llamada **no sale sola** (ahora te AVISA por WhatsApp si falla) |
| `CALLMEBOT_PHONE` / `CALLMEBOT_APIKEY` | los tuyos | los avisos a tu WhatsApp (escaladas, llamada que no salió, menor en llamada…) |
| `APIFY_TOKEN` | opcional | detección de cuenta privada/pública (si falta, opener neutro) |

> **`OPENAI_TIMEOUT_MS` / `OPENAI_MAX_RETRIES`:** ya no hace falta ponerlas — el código ahora usa `4000`/`0` por defecto (cabían mal en el techo de 10s de Vercel; arreglado esta noche).

### ⭐ Decisión del día 1 — `AUTOMATION_MODE`
- **`AUTOMATIC` (recomendado):** el bot responde **solo** durante la cualificación. Lo sensible (negociación del %, contradicciones, cualquier cosa que exija revisión, candidata en revisión humana) se **BLOQUEA automáticamente y te llega a ti** — no se envía a ciegas. El "Encaja" antes de la llamada y las decisiones de revisión **siguen siendo tuyas** (eso es código, no depende de este modo). Es lo que necesitas para que el embudo funcione solo.
- `HUMAN_APPROVAL`: el bot redacta pero **no envía nada** hasta que tú apruebas cada mensaje. Más seguro, pero no es "que funcione solo".
- **Aviso honesto:** bajo carga MUY alta y simultánea sobre la MISMA candidata queda un resquicio de concurrencia (P1-4) que no está 100% cerrado; para el volumen de lanzamiento no debería darse. Está en MEJORAS_FUTURAS.md.

---

## ✅ PARTE 2 — Panel de ElevenLabs (HECHA POR API el 2-jul — solo verificaciones)

Claude auditó y configuró el agente por API el 2-jul (detalle en `AUDIO_LLAMADAS.md`): Custom LLM ya
apuntaba bien; se corrigieron interrupciones (OFF), end-call-por-silencio (45 s), duración máxima (420 s),
turn eagerness (patient), voz (**Pablo - Deep, Confident and Clear**, stability 0.7 / speed 0.95 /
similarity 0.75, Flash v2.5), `custom_llm_extra_body` (ON — ya llega tu nombre al cerebro) y se **asignó
el webhook post-llamada** "Post Rose" (estaba creado pero sin conectar: por eso el CRM salía vacío).

Te quedan solo 2 verificaciones manuales:
1. **Créditos de ElevenLabs**: la llamada del 2-jul murió por "quota limit" (el bucle fundió créditos).
   Mira el contador y recarga/espera al reset antes de la siguiente prueba.
2. **`CALL_WEBHOOK_SECRET` en Vercel = signing secret del webhook "Post Rose"** (ElevenLabs →
   Settings → Webhooks). Si tras una llamada el CRM sigue vacío, este secreto es el primer sospechoso:
   regenera el secret en ElevenLabs, cópialo a Vercel y Redeploy.

## ✅ PARTE 3 — Meta / Instagram (una vez)
- Webhook de Instagram apuntando a `https://TU-WEB/api/instagram/webhook`, campo **messages** suscrito, token vigente.
- ⚠️ `INSTAGRAM_ACCESS_TOKEN` **caduca (~60 días)**. Apúntate renovarlo; cuando muera, el bot enmudece sin error visible (está en MEJORAS_FUTURAS como pendiente de auto-refresh).

---

## ✅ PARTE 4 — Prueba E2E antes de abrir el grifo (15 min)
1. **Texto:** escríbete por Instagram como si fueras una candidata → comprueba que el bot cualifica y que en el CRM ves la conversación en vivo.
2. **Encaja:** pulsa "Encaja" en tu ficha de prueba → el bot pide hora+teléfono.
3. **Agenda:** dale hora y (tu) teléfono → debe quedar en "Llamada agendada".
4. **Llamada:** o esperas a la hora (auto-marcador) o pulsas 📞 Llamar → el bot te llama y habla.
5. **Cierre:** al colgar, en la pestaña "Llamada" de la ficha deben aparecer resumen + transcripción + grabación.
6. Envía tú el contrato por WhatsApp.

**Prueba también los bordes** (deben comportarse bien, arreglados esta noche): decir "tengo 17" (cierra), "no me interesa" ya agendada (te llega a ti, no te llama), "¿qué edad hay que tener?" (responde, no "lo consulto con mi socio").

---

## 🔒 Lo que quedó blindado esta noche (resumen)
- La llamada **no sale dos veces** a la misma persona; si el auto-marcador falla, **te avisa** (no se pierde en silencio).
- Una **menor** detectada en la llamada → cerrada (no "enviar contrato"); un **handoff** en la llamada → revisión tuya.
- Un **rechazo por escrito con la llamada agendada** desarma la llamada y te lo pasa a ti.
- El CRM **ya no miente**: si un mensaje no se envía, lo dice; los fallos de red se avisan.
- Config a prueba de errores de despliegue (timeouts, cron desbloqueado, fail-loud de la base).

## ⚠️ Lo que NO toqué (decisiones/riesgos que dejo en tu mano)
Están en **MEJORAS_FUTURAS.md** con detalle. Resumen: la concurrencia extrema (P1-4), el auto-refresh del token de Instagram, y algún borde de naturalidad del guion. Nada de esto bloquea el lanzamiento con volumen normal.
