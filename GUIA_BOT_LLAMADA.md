# Guía — Bot de llamada (voz): qué tienes que hacer (Alex)

Todo el **cerebro** del bot de llamada ya está programado y probado (783 tests verdes). Falta solo lo que
depende de tus cuentas. Esta guía es para mañana: abres las cuentas, pegas un par de claves, y lo
probamos. Las claves van SIEMPRE en `.env.local` (local) y en **Vercel → Settings → Environment
Variables** (producción); nunca en el código.

> Orden corto: **1) ElevenLabs** → **2) confirmar el umbral** → **3) variables en Vercel** → **4) crear el
> agente y apuntarlo a mi endpoint** → **5) probar en el panel de ElevenLabs** → **6) WhatsApp** (después).

---

## 1. Abre cuenta en ElevenLabs
1. Entra en **elevenlabs.io** y crea cuenta.
2. Coge un plan que incluya **Agents + WhatsApp + llamadas salientes** y **añade método de pago** (el
   outbound lo exige).
3. En **Voice Library**, filtra por **Spanish (Spain)** y elige una **voz masculina** que te pegue. Guarda
   su **Voice ID**.
4. En tu perfil, copia tu **API key** de ElevenLabs.

## 2. ⚠️ CONFIRMA esto con ElevenLabs ANTES de gastar (riesgo nº1)
Pregúntales (chat de soporte o ventas):
> "Quiero hacer **llamadas salientes por WhatsApp** con una WABA nueva. ¿Hace falta tener ~2.000
> conversaciones/24h para activar el outbound, o vosotros como BSP lo cubrís? ¿Qué requisitos pide Meta?"

Si te dicen que **sí se puede** sin ese volumen → seguimos con WhatsApp. Si **no** → tenemos plan B (que
ella llame al bot, o llamada normal). **No abras el número de WhatsApp Business hasta tener esta
respuesta.**

## 3. Pon las variables en Vercel (y en `.env.local`)
Genera dos secretos aleatorios largos (por ejemplo en una terminal: `openssl rand -hex 32`, uno para cada
uno) y añádelos:
```
# Secreto que protege el endpoint del cerebro (lo pondrás también en ElevenLabs)
CALL_LLM_API_KEY=<secreto-1-aleatorio>
# Secreto del webhook de fin de llamada
CALL_WEBHOOK_SECRET=<secreto-2-aleatorio>
# La llamada se graba (1) o no (0)
CALL_RECORDED=1
# (Para más adelante, cuando montemos el disparador de la llamada)
ELEVENLABS_API_KEY=<tu-api-key-de-elevenlabs>
ELEVENLABS_AGENT_ID=<lo-tendrás-en-el-paso-4>
```
Haz **redeploy** en Vercel para que tomen efecto.

## 4. Crea el agente en ElevenLabs y apúntalo a mi endpoint
En el panel de ElevenLabs → **Agents** → crea uno:
- **Voz**: la voz castellana que elegiste (Voice ID del paso 1).
- **Idioma**: Español.
- **LLM**: elige **"Custom LLM"** y pon:
  - **Server URL**: `https://TU-APP.vercel.app/api/call/llm`  *(tu dominio de Vercel + `/api/call/llm`)*
  - **API key**: el mismo `CALL_LLM_API_KEY` del paso 3.
  - Modelo: cualquiera (lo ignora; el cerebro decide).
- **Mensaje del sistema / first message**: déjalo casi vacío. El bot abre solo con la **locución legal**
  (declara que es IA + grabación) y lleva el guion él mismo. No hace falta que escribas el guion ahí.
- Copia el **Agent ID** y ponlo en `ELEVENLABS_AGENT_ID` (Vercel) cuando montemos el disparador.

## 5. Pruébalo (¡aquí ya lo oyes!)
En el panel de ElevenLabs, usa el **modo de prueba** del agente (texto o voz). El bot debería:
1. Abrir con la **locución legal** ("soy un asistente automatizado… se graba… si prefieres una persona…").
2. Si dices "vale", ir explicando por etapas: cómo trabaja la agencia → tu parte → contenido y cara →
   dinero (70/30, "como te dije por Instagram") → límites → y cerrar con **"te paso el contrato"**.
3. Si te quejas del reparto, bajar a 65 y luego a 60 (y de ahí ya te pasa conmigo).
4. Si preguntas algo concreto, decir **"se lo comento a mi socio y te digo"** (de momento defiere, por
   seguridad; luego le activamos responder del conocimiento).
5. Si pides hablar con una persona, pasar a handoff.

**Escucha alguna prueba y dime qué te chirría** del guion/voz; lo afinamos.

## 6. WhatsApp (después de confirmar el umbral)
- Crea/verifica **Meta Business** y una **WABA con un número NUEVO** dedicado (no tu WhatsApp personal ni
  el de Instagram; ese número no puede estar en la app normal de WhatsApp).
- Conecta esa WABA a ElevenLabs (ellos te guían).
- Flujo de la llamada: le abres chat en WhatsApp → le mandas la **solicitud de permiso de llamada** → ella
  acepta → el bot la llama **dentro de 72 h**.

## 7. La parte legal (tuya)
- Aprueba el **texto de apertura** (está en `PLAN_BOT_LLAMADA.md`; dime si lo cambias).
- Actualiza tu **política de privacidad** mencionando la llamada con IA + grabación + ElevenLabs/OpenAI.

---

## Lo que me mandas a mí para terminar
Cuando tengas el paso 4 hecho y hayas probado:
1. Tu **dominio de Vercel** (para confirmar la URL del endpoint).
2. El **Agent ID** y confirmación de que el método de pago + WhatsApp están activos.
3. La respuesta de ElevenLabs sobre el **umbral** del paso 2.

Con eso monto el **disparador de la llamada** (que al agendar dispare la llamada saliente con el nombre de
la candidata) y conecto el **webhook de fin de llamada** (`/api/call/end`) en el panel de ElevenLabs.

## Resumen en una frase
El cerebro está hecho y probado. Mañana: **ElevenLabs + confirmar umbral + 2 secretos en Vercel + apuntar
el agente a `/api/call/llm`** → y ya oyes al bot hablar. WhatsApp y el disparador, después.
