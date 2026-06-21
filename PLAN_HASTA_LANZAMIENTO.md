# Plan hasta el lanzamiento — Rose Models

_Pensado el 2026-06-20. Es el mapa completo, de principio a fin: dónde estamos, qué falta, qué decides tú y cómo será tu día a día cuando esté en marcha._

---

## 1. La visión en una frase

Una candidata escribe por Instagram → **el bot la cualifica solo** → cuando está lista, **tú decides "Encaja"** → el bot **agenda la llamada** → a la hora, **el bot de voz la llama por WhatsApp** y le explica todo → tú ves el resultado y decides la incorporación.

### El flujo completo, paso a paso

1. **Anuncio en Instagram** → la candidata manda un DM.
2. **Bot de Instagram** (ya funciona): saluda, pregunta el **nombre**, la **edad**, el **móvil**, si tiene **OnlyFans** y (solo si tiene) si trabaja con **otra agencia**. Responde dudas (cuánto se gana, si cuesta algo, edad, servicios, privacidad…). **Nunca** da el porcentaje de forma proactiva. **Nunca** propone la llamada por su cuenta.
3. Cuando termina el guion esencial → estado **"esperando tu revisión"** → el bot dice _"lo hablo con mi socio y te digo"_ y **a ti te llega un aviso**.
4. **Tú miras el perfil** en el CRM y das **"Encaja"** (o lo descartas).
5. Si encaja → el bot **pide día y hora** (ella te dice hora **Argentina**), lo **convierte a hora España**, **no agenda dos llamadas a la vez** (huecos de 30 min) → estado **"llamada agendada"** → **pausa el bot de Instagram** para esa candidata.
6. A la hora → **llamada de voz por WhatsApp** (ElevenLabs + nuestro cerebro): apertura legal, el pitch, responde dudas, negocia el reparto **70 → 65 → 60** (solo en la voz), y cierra con el contrato o te lo pasa a ti. Si **no contesta**, reintenta hasta **3 veces**.
7. Si tras 3 intentos no contesta → **mensaje de Instagram** para re-agendar.
8. Si **abandona a mitad** de la conversación → **1-2 mensajes** de recuperación (no más).
9. Al acabar la llamada → nos llega el **resultado** → lo ves en el CRM y decides la incorporación.

---

## 2. ✅ Lo que YA está hecho

- **Bot de Instagram** funcionando en Vercel (OpenAI + red de seguridad determinista).
- **Núcleo conversacional** con **959 tests en verde**.
- **Conocimiento del negocio** amplio. _Hoy he rellenado 3 huecos que confirmaste_: cuánto se gana (honesto, sin cifras), no cuesta nada, y la edad objetivo (≈30-50). _(Listo en el código, sin commitear todavía.)_
- **Sistema de agendado**: conversión Argentina→España, sin solapar, pausa de Instagram, y **espera tu "Encaja"** antes de proponer nada. (Código + tests.)
- **Bot de voz**: director de la llamada, negociación del reparto, validador de voz y redactor con IA con red de seguridad. (Código + tests.)
- **Conexión con ElevenLabs**: WhatsApp conectado, número **+34 611 02 22 54**, agente vinculado. _(Hecho hoy.)_
- **El "cerebro" de la llamada** (lo que ElevenLabs llamará) y el **aviso de fin de llamada**: construidos y verificados hoy.
- **Re-enganche** (no contesta / abandono): lógica + tarea programada. (Código + tests.)
- **Plantilla `permiso_llamada`**: creada y **en revisión en Meta**. _(Hecho hoy.)_

---

## 3. ⏳ Lo que falta para lanzar (en orden)

### 🟢 Cosas que haces TÚ (clics, sin programar)

| # | Paso | Dónde | Estado |
|---|------|-------|--------|
| A | Esperar que Meta apruebe la plantilla `permiso_llamada` | Meta / WhatsApp Manager | ⏳ en revisión |
| B | Poner 2 llaves en Vercel: `CALL_LLM_API_KEY` y `CALL_WEBHOOK_SECRET` | Vercel → Settings → Environment Variables | ⬜ pendiente |
| C | Conectar el agente a nuestro cerebro + voz castellana | ElevenLabs → agente | ⬜ pendiente |
| D | Añadir método de pago (tarjeta) — antes de la 1ª llamada real | WhatsApp Manager | ⬜ pendiente |
| E | Probar una llamada a tu propio número | ElevenLabs (botón "Saliente") | ⬜ pendiente |

### 🔵 Datos que ya tienes que guardar (para el paso B/C)

- Plantilla: **`permiso_llamada`** · idioma **`es`**
- **ID del número de teléfono** de WhatsApp (el que copiaste con "Copy phone number ID")
- **Agent ID** de ElevenLabs y tu **API key** de ElevenLabs (para el botón del CRM, más adelante)

### 🟠 Cosas de código (las hago yo cuando toque)

- **Disparador automático de la llamada a la hora agendada** — lo prometí "en paralelo"; **aún no está**. Depende de la decisión nº1 de abajo (cómo se dispara). _Para empezar a probar NO hace falta: se puede lanzar a mano._
- (Opcional) Endurecer la contraseña de la web para que sea "a prueba de fallos".
- (Opcional) Lote de arreglos menores de la revisión exhaustiva.

---

## 4. 💸 Costes (recordatorio)

- **ElevenLabs**: ~22 $/mes, y solo cuando lo uses.
- **Meta (WhatsApp)**: pago por uso, **~menos de 1 € por llamada** de 5 min (permiso + minutos). **Sin cuota fija.** La tarjeta no se cobra hasta que haya llamadas reales.
- **OpenAI**: céntimos por conversación.
- **Vercel**: gratis (plan Hobby). _Solo costaría si quieres llamadas automáticas al minuto exacto (ver decisión nº1)._
- **SIM**: prepago, sin cuota mensual.

---

## 5. ⚠️ Decisiones que tienes que tomar

1. **¿Cómo se dispara la llamada a la hora exacta?** Vercel gratis solo permite tareas **una vez al día**, no "a las 18:03 en punto". Opciones:
   - **(Recomendado para empezar) Botón manual**: cuando llegue la hora, le das tú al botón de llamar. Cero coste, control total mientras pruebas.
   - **Cron externo gratis** (ej. cron-job.org) que cada pocos minutos revise y lance las llamadas que tocan. Gratis, requiere un pequeño montaje.
   - **Vercel Pro** (~20 $/mes) para tareas más frecuentes. Más caro, evitable.
2. **Apertura legal de la llamada** (`CALL_DISCLOSURE`): está **en "on" por defecto** (correcto y legal). Solo hay que asegurarse de **no dejarla en "off"** en Vercel cuando hagamos pruebas → volver a "on" antes de llamadas reales.
3. **Contraseña de la web**: hoy protege el CRM, pero conviene endurecerla (que si falla, **bloquee** en vez de abrir). Decisión tuya, te lo recomiendo.

---

## 6. 🗓️ Tu día a día cuando esté en marcha

1. Te llegan leads del anuncio → **el bot cualifica solo**, tú no haces nada.
2. Cuando una candidata está lista → **te llega un aviso**.
3. Miras su perfil en el CRM y das **"Encaja"** (o la descartas). _Esta es tu decisión clave._
4. El bot **agenda la llamada** con ella.
5. A la hora → (botón o automático) **se lanza la llamada de voz**.
6. Ves el **resultado** de la llamada y decides la **incorporación**.

Tu trabajo se reduce a **dos decisiones humanas**: "¿encaja este perfil?" y "¿la incorporo tras la llamada?". Todo lo demás lo lleva el sistema.

---

## 7. 👉 El siguiente paso concreto cuando vuelvas

Estábamos en la **Parte A**: comprobar en **Vercel → Settings → Environment Variables** si ya existen `CALL_LLM_API_KEY` y `CALL_WEBHOOK_SECRET`.
- Si **no** están → las creamos (2 contraseñas largas) y las metemos.
- Luego **Parte B**: conectar el agente de ElevenLabs a nuestro cerebro (con esa llave) + ponerle **voz castellana**.

Mientras, Meta va aprobando la plantilla. Cuando esté todo → **prueba de llamada a tu propio número** y a producción. 🌹
