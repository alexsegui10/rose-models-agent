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

## 5. Política de privacidad — la rediactas tú
- La actualizas tú a mano cuando expliques bien el tratamiento (incluido el proveedor de verificación de
  perfil). Si HikerAPI te ofrece un **DPA** (acuerdo de tratamiento de datos), fírmalo y guárdalo.

---

## Variables de entorno en Vercel (lista completa)
```
# Instagram (ya las tienes)
INSTAGRAM_VERIFY_TOKEN=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_ACCESS_TOKEN=...
# OpenAI (redacción)
OPENAI_API_KEY=...
LLM_MODE=OPENAI
# Timeouts ajustados al cap de ~10s de Vercel Hobby (IMPORTANTE para no perder respuestas)
OPENAI_TIMEOUT_MS=4000
OPENAI_MAX_RETRIES=0
# Persistencia en producción (y NO usar el fallback efímero en Vercel)
PERSISTENCE=postgres
DATABASE_URL=...
ALLOW_EPHEMERAL_FALLBACK=0
# Modo: arranca aprobando tú cada respuesta (cero riesgo); pasa a AUTOMATIC tras los arreglos de AUTOMATIC
AUTOMATION_MODE=HUMAN_APPROVAL
# Avisos WhatsApp
CALLMEBOT_PHONE=+34644742515
CALLMEBOT_APIKEY=4045525
# Privada/pública (Apify)
APIFY_TOKEN=...
```

## Orden recomendado para salir a producción (auditoría 16-jun)
1. **App Review de Meta** (Advanced Access de `instagram_business_manage_messages`) — **TARDA DÍAS, empieza YA**. Sin esto, solo te responden cuentas de prueba que añadas a mano, no el público. Es el cuello de botella real.
2. Crea las **3 credenciales de Instagram** (VERIFY_TOKEN aleatorio, APP_SECRET, ACCESS_TOKEN con el permiso) y ponlas en Vercel.
3. Pon **todas las variables** de arriba en Vercel y haz **redeploy**.
4. **Arranca en `HUMAN_APPROVAL`**: tú apruebas cada respuesta desde el CRM. Así ves tráfico real sin riesgo. Mientras, yo termino los arreglos de robustez para AUTOMATIC (timeouts ✅ ya hechos; faltan idempotencia de envío + lock de concurrencia).
5. Cuando esté todo, pasa a `AUTOMATION_MODE=AUTOMATIC`.
6. Tras el go-live: **rota las claves** (higiene; `.env.local` nunca se subió al repo) y actualiza la **política de privacidad** (OpenAI, Apify, CallMeBot).

## Resumen en una frase
El código es un MVP sólido (686 tests). Para salir: **App Review de Meta** (lo más lento), variables en Vercel, y arranca en **HUMAN_APPROVAL**. Pásame el OK para terminar los arreglos de AUTOMATIC.
