# Conectar el bot a Instagram (guía de Alex)

El código de la integración ya está listo: recibe los DMs por un webhook, los pasa por el motor y
responde con la voz de Alex (respetando el modo de automatización y la pausa del CRM). Lo que falta
es **configuración tuya en Meta + un sitio donde alojar la app**. Esta guía es ese checklist.

## Lo que ya está hecho (código)

- `GET/POST /api/instagram/webhook` — verifica el handshake de Meta, comprueba la firma de cada
  evento, parsea los mensajes entrantes, los pasa al motor y responde en ráfaga (varios DMs si toca).
- Verificación de firma HMAC y parseo robusto (ignora ecos, reacciones, adjuntos). Con tests.
- `GraphApiInstagramMessagingProvider` — envía los DMs por la Graph API.
- Idempotencia: si Meta reintenta un evento, el `mid` evita procesarlo dos veces.
- Seguridad: sin firma válida no se procesa nada; los secretos solo se leen de `.env.local`.

## Lo que tienes que hacer tú (una vez)

1. **Cuenta y app de Meta**
   - Tu Instagram debe ser **cuenta de empresa/creador** y estar vinculada a una **página de Facebook**.
   - Crea una app en [developers.facebook.com](https://developers.facebook.com) → producto
     **Instagram** / **Messenger** (mensajería de Instagram).

2. **Permisos** (requieren *App Review* de Meta, puede tardar días):
   - `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`.
   - Mientras tanto, en modo desarrollo puedes probar con tu propia cuenta sin review.

3. **Hosting** — el webhook necesita una **URL pública HTTPS**. Opciones:
   - Producción: desplegar en Vercel/Railway/Render (Next.js) → la URL será
     `https://TU-DOMINIO/api/instagram/webhook`.
   - Pruebas locales: `ngrok http 3000` → usa la URL de ngrok + `/api/instagram/webhook`.

4. **Configura el webhook en Meta** (panel de la app → Webhooks → Instagram):
   - Callback URL: `https://TU-DOMINIO/api/instagram/webhook`
   - Verify token: el mismo string que pongas en `INSTAGRAM_VERIFY_TOKEN`.
   - Suscríbete al campo **messages**.

5. **Pon los secretos en `.env.local`** (NUNCA en git):
   ```
   INSTAGRAM_VERIFY_TOKEN=<el string que elijas>
   INSTAGRAM_APP_SECRET=<App secret de tu app de Meta>
   INSTAGRAM_ACCESS_TOKEN=<token de acceso de Instagram/Page>
   # Si usas login de Facebook en vez de Instagram:
   # INSTAGRAM_GRAPH_BASE_URL=https://graph.facebook.com
   LLM_MODE=OPENAI
   PERSISTENCE=postgres        # para no perder candidatas al reiniciar
   ```

6. **Elige el modo de automatización** (`AUTOMATION_MODE` en `.env.local`):
   - `HUMAN_APPROVAL` (recomendado para empezar): el bot redacta pero **no envía solo**; tú apruebas
     cada respuesta desde el CRM. Empezar así y vigilar.
   - `AUTOMATIC`: el bot responde solo (respeta la pausa por candidata del CRM).

## Cómo se comporta

- DM entrante → el motor cualifica con la voz de Alex. Si `AUTOMATIC` y la candidata no está pausada,
  responde solo; si `HUMAN_APPROVAL` o está pausada, queda pendiente para que decidas en el CRM.
- Estados, % y aprobaciones los decide siempre el código (la IA solo entiende y redacta).
- Edad <18 → cerrado automático. Negociación / dudas → a tu revisión.

## Pendientes / decisiones

- **Aviso de bot (AI Act, ago-2026):** hoy el bot solo se identifica como asistente si preguntan.
  Decisión legal tuya (pendiente de abogado en el ROADMAP).
- **Enviar tras aprobar (modo HUMAN_APPROVAL):** el botón "Aprobar" del CRM marca el estado; queda
  por cablear que ese "Aprobar" dispare también el envío del DM aprobado por Instagram.
- **Ventana de 24h de Meta:** fuera de la ventana de 24h solo se pueden enviar mensajes con plantilla;
  los follow-ups proactivos hay que rediseñarlos para respetarla.
