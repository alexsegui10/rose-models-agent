# Desplegar el bot a Instagram — paso a paso (definitivo y gratis)

Objetivo: el bot corriendo de verdad, respondiendo DMs de Instagram. Infra gratis (Vercel + Neon),
solo pagas OpenAI por uso (~5–15 céntimos por conversación). Sigue los pasos en orden.

Necesitas: una cuenta de GitHub, el Instagram de Rose Models como **cuenta de empresa** vinculada a
una **página de Facebook**, y ~1 hora. El código ya está listo y preparado para serverless.

---

## PASO 1 — Subir el código a GitHub (para que Vercel lo despliegue)

En la carpeta del proyecto (`c:\Users\Alex\Desktop\proyecto1`):

1. Crea un repo **privado** en https://github.com/new (ej. `rose-models-agent`). No añadas README.
2. En la terminal del proyecto:
   ```
   git remote add origin https://github.com/TU_USUARIO/rose-models-agent.git
   git push -u origin master
   ```
   (Si ya hay un `origin`, usa `git remote set-url origin ...`.)

> Tus secretos NO se suben: `.env.local` está en `.gitignore`. Bien.

---

## PASO 2 — Base de datos gratis (Neon)

1. Entra en https://neon.tech → **Sign up** (gratis) → crea un proyecto (región **EU**, p. ej. Frankfurt).
2. En el dashboard del proyecto, **Connection string**. Copia DOS versiones:
   - **Pooled** (el host lleva `-pooler`): es la que usará la app en Vercel. → la llamaremos `DATABASE_URL`.
   - **Direct** (sin `-pooler`): solo para aplicar las tablas una vez. → `DATABASE_URL_DIRECTA`.

   Ejemplo del aspecto:
   ```
   Pooled:  postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   Direct:  postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

---

## PASO 3 — Crear las tablas en Neon (una sola vez, desde tu PC)

1. En `c:\Users\Alex\Desktop\proyecto1\.env.local`, pon temporalmente la **directa**:
   ```
   DATABASE_URL=postgresql://...ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
2. Ejecuta:
   ```
   npm run db:migrate
   ```
   Esto crea las tablas (candidates, conversation_messages, etc.) en Neon. Debe terminar sin errores.
3. Ya puedes quitar esa línea de `.env.local` (en Vercel usaremos la **pooled**).

> ⚠️ **EN CADA REDEPLOY que incluya cambios de base de datos** (un `.sql` nuevo en `drizzle/`): ANTES de
> redeplegar en Vercel, vuelve a hacer este PASO 3 (`npm run db:migrate` con la cadena **directa**, no la
> pooled). Si subes código que espera una columna/tabla nueva SIN haber migrado Neon, el CRM y el bot se caen
> (5xx). Regla simple: ¿hay un `.sql` nuevo? → migra primero, redeploy después.

---

## PASO 4 — Desplegar en Vercel

1. Entra en https://vercel.com → **Sign up** con GitHub (gratis, plan Hobby).
2. **Add New… → Project** → importa tu repo `rose-models-agent`. Vercel detecta Next.js solo.
3. Antes de **Deploy**, abre **Environment Variables** y añade (Production + Preview):

   | Variable | Valor |
   |---|---|
   | `LLM_MODE` | `OPENAI` |
   | `OPENAI_API_KEY` | tu clave de OpenAI |
   | `OPENAI_UNDERSTANDING_MODEL` | `gpt-5.4-mini` |
   | `OPENAI_WRITING_MODEL` | `gpt-5.4-mini` |
   | `OPENAI_TIMEOUT_MS` | `4000` |
   | `OPENAI_MAX_RETRIES` | `0` |
   | `AUTOMATION_MODE` | `AUTOMATIC` |
   | `PERSISTENCE` | `postgres` |
   | `DATABASE_URL` | la cadena **pooled** de Neon (con `-pooler`) |
   | `INSTAGRAM_VERIFY_TOKEN` | invéntate un string largo (ej. `rosemodels-verify-9f3a...`) |
   | `INSTAGRAM_APP_SECRET` | (lo pones en el PASO 5) |
   | `INSTAGRAM_ACCESS_TOKEN` | (lo pones en el PASO 5) |

   (`OPENAI_TIMEOUT_MS=4000` y `MAX_RETRIES=0` son para caber en el límite de 10s del plan gratis.)
4. **Deploy**. Cuando termine tendrás una URL tipo `https://rose-models-agent.vercel.app`.
   Tu webhook será `https://rose-models-agent.vercel.app/api/instagram/webhook`.

---

## PASO 5 — App de Meta + conectar el webhook

> ⚠️ OJO: las apps NO están en **Meta Business Suite** (`business.facebook.com`, donde gestionas
> posts/anuncios/inbox). Las apps de desarrollador están en **Meta for Developers**, una web DISTINTA:
> **`developers.facebook.com`**. Entra ahí con la misma cuenta; si es tu primera vez te registra como
> desarrollador (gratis). Tu Instagram ya es cuenta profesional vinculada al negocio — eso ya está.

1. https://developers.facebook.com → arriba derecha **My Apps → Create App** → caso de uso
   **Instagram** (o **Other → Business** si no aparece claro).
2. Añade el producto **Instagram** (mensajería de Instagram) / Messenger con Instagram.
3. Vincula tu **cuenta de Instagram de empresa** (y su página de Facebook).
4. **App secret**: en App settings → Basic → copia el *App Secret* → ponlo en Vercel como
   `INSTAGRAM_APP_SECRET` (y vuelve a desplegar, o edítalo y *Redeploy*).
5. **Access token**: genera el token de acceso de Instagram/página con permiso de mensajería → ponlo
   en Vercel como `INSTAGRAM_ACCESS_TOKEN`.
6. **Configurar webhook** (en el producto Instagram → Webhooks / Configuration):
   - Callback URL: `https://rose-models-agent.vercel.app/api/instagram/webhook`
   - Verify token: **el mismo** que pusiste en `INSTAGRAM_VERIFY_TOKEN`.
   - Pulsa **Verify and save** (Meta hará un GET; debe dar OK).
   - Suscríbete al campo **`messages`**.

> Cada vez que cambies una variable en Vercel, haz **Redeploy** para que tome efecto.

---

## PASO 6 — Probar (modo desarrollo, sin esperar a Meta)

En modo desarrollo, solo TÚ y los *test users* podéis escribirle al bot — perfecto para probar:

1. Asegúrate de que tu Instagram personal (u otro) es **tester** de la app (Roles → Testers).
2. Desde ESE Instagram, manda un DM a la cuenta de Rose Models: *"hola, me interesa"*.
3. El bot debería responder en segundos con el opener de Alex. Sigue la conversación y compruébalo.
4. Revisa el panel en `https://rose-models-agent.vercel.app` → pestaña **CRM**: verás la candidata,
   su estado, y podrás pausar / aprobar / **Responder** a las escaladas.

Si algo no responde: en Vercel → tu proyecto → **Logs** (functions) verás los errores (sin secretos).

---

## PASO 7 — Abrirlo al público (cuando te convenza)

Para que CUALQUIER candidata (no solo testers) hable con el bot, Meta exige **App Review** del permiso
`instagram_manage_messages` (verificación del negocio + explicar el uso; tarda días). Lo pides desde el
panel de la app → App Review. Es **la misma app**; solo se amplían los permisos. Hasta entonces, dev
mode con testers te sirve para validar todo.

---

## Cómo opera (recordatorio de tu modo: AUTOMATIC + escalado)

- El bot responde solo la cualificación rutinaria, con tu voz, por WhatsApp al cerrar.
- Se **pausa solo** (no envía nada) en lo delicado: negociación de %, edad dudosa, dudas no cubiertas,
  contrato → queda en el CRM para ti.
- Tú puedes **pausar** a cualquiera y **Responder** a mano desde el CRM (se envía a Instagram).
- Edad < 18 → cerrado automático. Nada de porcentajes proactivos. Nunca promete ocultar la cara.

## Notas / límites conocidos

- **Plan gratis de Vercel**: corta funciones a 10s y técnicamente es "uso personal". Para un negocio en
  serio, a futuro: Vercel Pro (~$20/mes, sube a 60s) o Fly.io (gratis, sin ese límite). Para arrancar,
  Hobby vale; por eso bajamos el timeout de OpenAI a 4s.
- **Aviso de bot (AI Act, ago-2026)**: hoy el bot solo se identifica como asistente si preguntan.
  Decisión legal tuya (pendiente de abogado).
- **Ventana de 24h de Meta**: solo puedes responder dentro de las 24h del último mensaje de la candidata;
  los seguimientos proactivos fuera de eso necesitan plantillas (a futuro).
