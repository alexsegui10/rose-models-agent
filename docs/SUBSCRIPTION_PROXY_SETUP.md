# Redacción vía suscripción de ChatGPT (opcional) — guía de montaje

> Objetivo (Alex, 19-jul): que la REDACCIÓN de texto tire de la cuota plana de tu suscripción ChatGPT
> (terra, mismo modelo → misma calidad) y solo pague API cuando la suscripción no esté disponible.
> **El bot NUNCA se cae**: cualquier fallo del proxy → cae a la API automáticamente.

## Cómo funciona (ya está en el código, apagado por defecto)

- La redacción intenta **primero** el proxy del VPS; ante cualquier problema (límite agotado, Cloudflare,
  deslogueo, timeout, respuesta vacía) → **API oficial** al instante. Idéntico resultado.
- El texto del proxy pasa por **los mismos validadores** (factual, estilo, red determinista) que el de la API:
  imposible que baje la calidad o se cuele un bug que no se colaría por la API.
- La **comprensión** (extracción de datos) sigue SIEMPRE en la API (usa esquema JSON que el proxy no garantiza).
- Aviso por **WhatsApp** (CallMeBot, el que ya tienes) cuando el proxy falla.
- **Apagado mientras no exista `OPENAI_SUBSCRIPTION_BASE_URL`** en Vercel. Se enciende/apaga en 1 segundo.

## ⚠️ Antes de empezar (riesgos reales, decisión tuya)

- Usar la suscripción de forma programática es **zona gris del ToS de OpenAI** (aunque el CEO bendijo la vía
  OpenClaw). Riesgo de baneo: **bajo pero real**, más alto desde IP de datacenter (un VPS lo es).
- **Usa una cuenta de ChatGPT AISLADA** (correo distinto al de tu cuenta de API de producción). Así un ban
  solo te cuesta esa suscripción, **nunca** la API a la que caes de reserva.
- Estos proxies **se rompen cada pocas semanas** cuando OpenAI cambia su backend. Cuando pase, el bot tira de
  la API (sin cortes) y hay que actualizar/re-loguear el proxy. Recibirás el aviso por WhatsApp.

## Pasos (los haces tú; yo no puedo montar el VPS ni loguear tu cuenta)

1. **Cuenta aislada**: crea/usa una cuenta de ChatGPT **Plus o Pro** con un correo que NO sea el de tu API.
2. **VPS**: alquila un VPS pequeño (p.ej. Hetzner/DigitalOcean, ~5-10 €/mes; no necesita GPU, el proxy solo
   reenvía). Ubícalo en Europa para menos latencia.
3. **Proxy**: instala un proxy que exponga `/v1/chat/completions` desde la suscripción vía OAuth. Opciones
   probadas (elige uno y sigue su README):
   - `codex-proxy` (github.com/wowyuarm/codex-proxy) — refresca el token solo.
   - `openclaw` con proveedor `openai-codex`.
4. **Login**: haz el login OAuth una vez (abre el navegador, aceptas con la cuenta aislada). El token se
   refresca solo mientras el VPS tenga uso; re-login manual solo si queda >8 días inactivo.
5. **Modelo**: configura el proxy para servir **gpt-5.6-terra** (el mismo que usamos).
6. **Expón el endpoint** con una URL propia (https, detrás de un dominio o la IP del VPS + un token simple).
7. **Vercel → Environment Variables** (Production), añade:
   - `OPENAI_SUBSCRIPTION_BASE_URL` = la URL de tu proxy (p.ej. `https://mi-vps.midominio.com/v1`)
   - `OPENAI_SUBSCRIPTION_API_KEY` = el token que pida tu proxy (si no pide, deja cualquier valor)
   - `OPENAI_SUBSCRIPTION_MODEL` = `gpt-5.6-terra` (opcional; por defecto usa el de redacción)
8. **Redeploy** y avísame: hago una conversación de prueba y confirmo en la traza del CRM que dice
   `openai-subscription` (gratis) cuando va por la suscripción y `openai` cuando cae a la API.

## Para apagarlo

Borra `OPENAI_SUBSCRIPTION_BASE_URL` en Vercel y redeploy. Vuelve al 100% API, comportamiento de siempre.
