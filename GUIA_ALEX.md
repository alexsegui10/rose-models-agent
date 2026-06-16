# Guía rápida — qué tengo que hacer (Alex)

Todo el código está hecho y probado. Esto es lo único que queda **de tu parte** para dejarlo 100% en
producción. Las claves van SIEMPRE en `.env.local` (local) y en **Vercel → Settings → Environment
Variables** (producción); nunca en el código.

## 1. Avisos por WhatsApp (CallMeBot) — casi hecho
- En local ya está configurado y **probado** (te llegó el WhatsApp de prueba).
- **En Vercel** añade y haz *redeploy*:
  - `CALLMEBOT_PHONE=+34644742515`
  - `CALLMEBOT_APIKEY=4045525`
- Con esto, cuando el bot escale a ti (desconfianza, agresión, negociación, contrato…) o haya un error,
  te llega un WhatsApp con el motivo y el enlace a la cuenta de la candidata.

## 2. Privada / Pública en el CRM (HikerAPI) — falta tu key
1. Regístrate en **hikerapi.com** (100 consultas gratis, sin mínimo, ~0,60 $ por cada 1.000).
2. Copia tu **access key**.
3. Añádela en `.env.local` y en Vercel:
   - `HIKERAPI_KEY=tu_access_key`
4. **Avísame con la key** y hago la prueba real de punta a punta (confirmo que el badge sale bien).
- Mientras no la pongas, el CRM funciona igual pero sin el badge privada/pública (no rompe nada).

## 3. La solicitud de seguimiento → la mandas tú (manual)
- Instagram **no** deja seguir/mandar solicitudes por código (automatizarlo banearía tu cuenta).
- En el CRM, cuando una candidata salga **🔒 Privada**, tienes su **enlace** al lado: la abres y le das a
  **Seguir** (2 segundos). Cuando te acepte, su perfil ya es visible.

## 4. Instagram (foto, enlace, "te sigue") — ya funciona
- Funciona con tu token actual. Solo asegúrate de que la app de Meta tiene los permisos
  `instagram_business_basic` + `instagram_business_manage_messages` (los mismos que ya usas para los DMs).

## 5. Política de privacidad — hecho
- Ya añadí la línea sobre el proveedor de verificación de perfil. Si HikerAPI te ofrece un **DPA**
  (acuerdo de tratamiento de datos), fírmalo y guárdalo.

---

## Variables de entorno en Vercel (lista completa)
```
# Instagram (ya las tienes)
INSTAGRAM_VERIFY_TOKEN=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_ACCESS_TOKEN=...
# OpenAI (si usas OpenAI para redactar)
OPENAI_API_KEY=...
# Persistencia en producción
PERSISTENCE=postgres
DATABASE_URL=...
# Avisos WhatsApp
CALLMEBOT_PHONE=+34644742515
CALLMEBOT_APIKEY=4045525
# Privada/pública (cuando tengas la key)
HIKERAPI_KEY=...
```

## Resumen en una frase
Pon `CALLMEBOT_*` y `HIKERAPI_KEY` en Vercel, pásame la HikerAPI key para probarla, y manda tú la
solicitud de seguimiento a las que salgan privadas. El resto ya está hecho.
