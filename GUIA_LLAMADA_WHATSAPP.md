# Guía paso a paso — Activar las llamadas por WhatsApp (bot de voz)

Objetivo: que el bot pueda **llamar por WhatsApp** a las candidatas. Hazlo **por fases, en orden**. Al
terminar cada fase, dile a Claude "hecho fase X" o manda captura si te atascas.

> Recuerda el coste: ElevenLabs ~0,10 $/min + Meta ~0,02–0,05 $/min (solo si contesta). ~0,60–0,75 $/llamada de 5 min.

---

## FASE 0 — Lo que necesitas tener a mano (antes de empezar)
- [ ] Una cuenta de **Facebook/Meta** (la tuya vale).
- [ ] Un **número de teléfono DEDICADO** para WhatsApp Business Platform. MUY IMPORTANTE: **no puede ser un número que ya estés usando en la app normal de WhatsApp**. Opciones: una **SIM nueva/de prueba**, un número virtual, o uno que no tengas en WhatsApp. Tiene que poder **recibir un SMS o llamada** para verificarse.
- [ ] Una **tarjeta** (Meta cobra las llamadas).
- [ ] Tener a mano tu **API key de ElevenLabs** y el **Agent ID** (ya los tienes).

---

## FASE 1 — Cuenta de Meta Business
1. Entra en **https://business.facebook.com**.
2. Si no tienes cuenta de empresa: **Crear cuenta** → nombre "Rose Models", tu nombre y email.
3. Verifica el email si te lo pide.
✅ Resultado: tienes un "Business Manager" de Meta.

---

## FASE 2 — Conectar WhatsApp en ElevenLabs
1. En **ElevenLabs** → entra en tu **agente** (el de la llamada).
2. Busca la sección de **canales** (Channels) o **WhatsApp** / **Integraciones**.
3. Pulsa **"Connect WhatsApp"** (o "Importar cuenta de WhatsApp"). Se abre el asistente de Meta.
4. En el asistente: elige tu **Meta Business** (el de la Fase 1), crea la **cuenta de WhatsApp Business (WABA)** y **registra el número dedicado** (Fase 0).
5. Te llegará un **código** por SMS/llamada a ese número → introdúcelo.
✅ Resultado: WhatsApp queda conectado a tu agente. **Apunta el `phone_number_id`** que te muestre ElevenLabs (lo necesitamos luego).

> Si no encuentras el botón de WhatsApp en ElevenLabs, manda captura de la pantalla del agente y te digo dónde está.

---

## FASE 3 — Plantilla de "permiso de llamada" (WhatsApp Manager)
Meta exige que la candidata **dé permiso** antes de que el bot la llame. Eso se hace con una plantilla.
1. En **business.facebook.com** → busca **WhatsApp Manager** → **Plantillas de mensajes**.
2. **Crear plantilla** → tipo/categoría **solicitud de permiso de llamada** (call permission request). Si no aparece esa opción exacta, dime y lo vemos.
3. Ponle **nombre** (ej. `permiso_llamada`) e **idioma Español**.
4. Texto sugerido del cuerpo: *"Hola {{1}}, soy del equipo de Rose Models 🌹. ¿Te llamo ahora por WhatsApp para explicarte cómo trabajamos y resolver tus dudas?"*
5. **Enviar a revisión** → Meta la aprueba (suele tardar de minutos a unas horas).
✅ Resultado: tienes el **nombre** de la plantilla aprobada (ej. `permiso_llamada`) en idioma `es`.

---

## FASE 4 — Método de pago (Meta)
1. En **WhatsApp Manager** / **Configuración de la cuenta** → **Facturación / método de pago**.
2. Añade tu **tarjeta**.
✅ Resultado: ya puedes hacer llamadas salientes (sin esto, Meta las bloquea).

---

## FASE 5 — Claves en Vercel
En **Vercel** → tu proyecto → **Settings → Environment Variables**, añade/confirma:
```
ELEVENLABS_API_KEY                      = (tu API key de ElevenLabs)
ELEVENLABS_AGENT_ID                     = (tu Agent ID)
ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID     = (el phone_number_id de la Fase 2)
ELEVENLABS_CALL_PERMISSION_TEMPLATE     = permiso_llamada   (nombre de la plantilla, Fase 3)
ELEVENLABS_CALL_PERMISSION_TEMPLATE_LANG = es
CALL_LLM_API_KEY                        = (inventa un token largo aleatorio)
CALL_WEBHOOK_SECRET                     = (inventa OTRO token largo aleatorio, distinto)
```
Luego **Deployments → ⋯ → Redeploy** para que cojan las variables.
✅ Resultado: la web ya sabe llamar.

---

## FASE 6 — Configurar el agente de ElevenLabs (la parte técnica, te ayudo)
En tu **agente** de ElevenLabs:
1. **Custom LLM** (LLM personalizado): URL = `https://rose-models-agent.vercel.app/api/call/llm`
   - Cabecera de autorización: `Authorization: Bearer <CALL_LLM_API_KEY>` (el mismo token de la Fase 5).
   - En el "extra body" / cuerpo extra, reenvía las **variables dinámicas** como `elevenlabs_extra_body` (esto pásamelo y lo afinamos juntos).
2. **Webhook de fin de llamada** (post-call webhook): `https://rose-models-agent.vercel.app/api/call/end`
   - Con la cabecera `Authorization: Bearer <CALL_WEBHOOK_SECRET>`.
3. **Voz**: elige una **voz castellana** de la librería.
✅ Resultado: el agente usa NUESTRO cerebro y nos avisa al terminar (duración, %, transcripción).

> Esta fase es la más técnica: cuando llegues, mándame captura de la config del Custom LLM y la repasamos campo a campo.

---

## FASE 7 — Prueba (¡el momento de la verdad!)
1. En la web → **CRM** o **Mensajes** → coge una candidata (o crea una de prueba) y pon en su ficha **TU propio número de WhatsApp** en el campo teléfono.
2. Abre su **ficha → pestaña Llamada → "📞 Llamar por WhatsApp"**.
3. Te llega a TU WhatsApp la **solicitud de permiso** → **acéptala**.
4. El bot **te llama**. Habla con él como si fueras la candidata.
✅ Si te llama y conversa → **¡funciona!** Ahí ya solo queda afinar el guion escuchando llamadas reales.

---

### Orden resumido
FASE 0 (tener número+Meta+tarjeta) → 1 (Meta Business) → 2 (conectar WhatsApp en ElevenLabs) → 3 (plantilla permiso) → 4 (pago) → 5 (claves Vercel) → 6 (config agente) → 7 (prueba).

Hazlas **de una en una** y ve diciéndome. La 2, la 3 y la 6 son las que más lío pueden dar — ahí manda captura sin problema.
