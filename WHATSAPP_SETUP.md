# Bandeja de WhatsApp en el CRM — guía de configuración (para Alex)

_Objetivo: ver y responder en la web los chats del número de la agencia (el mismo +34 que usa ElevenLabs para las llamadas), con fotos y documentos. El código ya está listo y **a la espera de estos datos** — sin ellos no hace nada (no rompe nada)._

> ⚠️ **Antes de nada, un paso de comprobación.** Como ese número lo usa ElevenLabs para las llamadas, hay que asegurarse de que **nuestra web puede recibir los mensajes SIN romper las llamadas**. Hazme caso con el orden: primero el **Paso 0**.

---

## Paso 0 — Comprobar quién recibe los mensajes hoy (¡el importante!)

1. Entra en **developers.facebook.com** → tu app de Meta (la que se creó con ElevenLabs) → **WhatsApp → Configuración**.
2. Mira la sección **Webhook**: ¿hay una URL de **callback** puesta? ¿De quién es (ElevenLabs)?
3. **Mándame una captura de esa pantalla.** Con eso te digo exactamente cómo enganchar nuestra web:
   - Lo más probable y limpio: configurar un **"override de webhook" por número** que mande los mensajes de ESE número a **nuestra web**, sin tocar lo de las llamadas de ElevenLabs.
   - Si viéramos que no se puede compartir, hay un plan B — pero no nos adelantamos: **primero la captura.**

👉 **No sigas a los pasos siguientes hasta que veamos esa captura juntos.** Es el seguro para no romper las llamadas.

---

## Paso 1 — Token permanente (para enviar y recibir)

En **business.facebook.com → Configuración del negocio**:
1. **Usuarios → Usuarios del sistema** → crea uno (rol **Administrador**), por ejemplo "Rose Models API".
2. Asígnale **la App** y la **cuenta de WhatsApp (WABA)**.
3. **Generar token** → marca los permisos **`whatsapp_business_messaging`** y **`whatsapp_business_management`** → genera. **Este token NO caduca.**
4. Guárdalo en sitio seguro (me lo pasas para `.env.local`; **nunca al chat ni a git**).

## Paso 2 — Datos del número
- **Phone number ID**: lo tienes del panel de Meta (o en ElevenLabs → WhatsApp → ··· → **Copy phone number ID**). Es el mismo que ya usamos para las llamadas.

## Paso 3 — Webhook hacia nuestra web
En la app de Meta → **WhatsApp → Configuración → Webhook** (esto lo afinamos según el Paso 0):
- **URL de callback**: `https://rose-models-agent.vercel.app/api/whatsapp/webhook`
- **Verify token**: una palabra secreta que **tú inventas** (la misma que pondrás en `WHATSAPP_VERIFY_TOKEN`).
- **Suscribir** el campo **`messages`**.

## Paso 4 — Variables en Vercel (Settings → Environment Variables)
Pon estas (valores reales solo aquí, nunca en el código):

| Variable | Qué es |
|---|---|
| `WHATSAPP_VERIFY_TOKEN` | la palabra secreta que inventaste para el webhook |
| `WHATSAPP_APP_SECRET` | el **App Secret** de tu app de Meta |
| `WHATSAPP_ACCESS_TOKEN` | el **token permanente** del Paso 1 |
| `WHATSAPP_PHONE_NUMBER_ID` | el **phone number ID** del Paso 2 |
| `WHATSAPP_GRAPH_VERSION` | opcional, deja `v21.0` |

Cuando estén, **Redeploy**. A partir de ahí la integración se "enciende" sola.

---

## ⚠️ Lo que debes saber del WhatsApp (regla de Meta, no nuestra)
- **Dentro de 24h** desde que la candidata te escribe → puedes responderle **texto y fotos libremente** (gratis).
- **Fuera de 24h** → para iniciar conversación hace falta una **plantilla aprobada** (de pago). Justo **tras la llamada** (que abre conversación) sueles estar dentro de las 24h → puedes mandarle el contrato y responder sin problema.

## Estado del código (lo que ya está hecho y a la espera)
- ✅ Lectura del webhook de WhatsApp (parser de mensajes y fotos/documentos) — testeado.
- ✅ Envío de texto por la Cloud API — testeado.
- ✅ Configuración por variables (desactivado si faltan, igual que Instagram).
- ⏳ Pendiente (lo hago cuando confirmemos el Paso 0): la ruta del webhook, ver los chats en la web (estilo Instagram), enviar fotos/documentos y el aviso de la ventana de 24h.

👉 **Tu único paso ahora: la captura del Paso 0** (Webhook de la app de Meta). Con eso seguimos seguros. 🌹
