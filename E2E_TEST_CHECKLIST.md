# Checklist de pruebas E2E (de Instagram al contrato) — para Alex

_Objetivo: validar el funnel entero con pruebas controladas (tú) y luego pocas candidatas reales, anotando lo que chirría para pulirlo. NO quemar muchos leads con un bug que se ve en las 3 primeras._

## Antes de empezar (preparación)
- [ ] **Debounce APAGADO** para estas pruebas: en Vercel `INBOUND_DEBOUNCE=off` (respuestas al instante = más fácil ver qué pasa).
- [ ] Llaves en Vercel puestas: OpenAI, Instagram, ElevenLabs (`ELEVENLABS_API_KEY` para oír/llamar), `SITE_PASSWORD`.
- [ ] Migración aplicada (ya está) y último deploy en **"Ready"**.
- [ ] Ten a mano: una **cuenta de Instagram de prueba** (no la tuya de la agencia) y **tu móvil** para la llamada de WhatsApp.

---

## PRUEBA 1 — Texto completo, TÚ (sin gastar candidatas reales)
Desde tu **cuenta de Instagram de prueba**, escribe al perfil de la agencia como si fueras una candidata.

Mira en cada paso:
- [ ] **Opener correcto** (saluda como Alex; si tu cuenta de prueba es privada, pide aceptar la solicitud; si es pública, "hemos visto tu perfil").
- [ ] **Pregunta el NOMBRE primero**, luego edad, luego móvil, luego OF, y solo si tienes OF, agencias.
- [ ] **No repite preguntas** ni te llama por el nombre en cada mensaje (debe sonar natural, no robot).
- [ ] Si le preguntas dudas (**cuánto se gana / cuesta algo / qué edad / cómo trabajáis / privacidad**) → responde bien, sin soltar el % a lo loco, sin prometer ingresos.
- [ ] Al terminar el guion → dice **"lo hablo con mi socio y te digo"** (NO propone la llamada solo).
- [ ] **Tú das "Encaja"** en el CRM → entonces el bot **pide día y hora** y **agenda** (si dices hora de Argentina, ¿la convierte a España?).
- [ ] Pide tu **número de WhatsApp** solo al final.

✍️ **Anota**: cualquier mensaje que suene raro/robótico, que repita, que no entienda, o que diga algo mal.

---

## PRUEBA 2 — La llamada de voz, TÚ (a tu propio número)
Una vez agendada (o desde el botón **"Saliente"** de ElevenLabs / el botón "Llamar" del CRM), que te llame a **tu móvil**.

Mira:
- [ ] **Suena natural** (la voz, el ritmo) o robótico.
- [ ] Sigue el **guion** (cómo trabaja la agencia → tu parte → contenido → dinero → límites → cierre) **sin soltar un párrafo enorme y callarse**.
- [ ] Al hablar del **dinero**: dice **30% para ti / 70% para la agencia** (NO "el 70 es para ti").
- [ ] Si te quejas del reparto → lo defiende y baja 65 → 60 (no más).
- [ ] Si preguntas algo que no sabe → **"lo confirmo con mi socio"** (no se inventa nada).
- [ ] Cierra con **"te paso el contrato, léelo con calma"**.

✍️ **Anota**: frases que suenen mal, que diga algo incorrecto, o cortes raros.

---

## PRUEBA 3 — El contrato (manual por ahora)
- [ ] Tras la llamada, **envías tú el contrato** por WhatsApp y ves que la conversación queda bien en el CRM.

---

## PRUEBA 4 — Pocas candidatas REALES (3-5, no el anuncio a tope)
Cuando lo de arriba funcione, deja entrar **unas pocas** candidatas reales del anuncio.
- [ ] Observa cada conversación de principio a fin.
- [ ] **Anota** cada cosa que chirríe (frase rara, duda mal resuelta, momento robótico, algo que la hizo abandonar).
- [ ] Me pasas las notas → yo lo arreglo → repetimos con otras pocas.
- [ ] Cuando 2-3 tandas salgan limpias → **escalas** (más candidatas) y, si quieres, **activas el debounce** (`INBOUND_DEBOUNCE=on`).

---

## Plantilla para anotar (cópiala por cada cosa)
```
- Dónde: (DM / llamada / paso X)
- Qué pasó: (lo que dijo el bot o la candidata)
- Qué debería pasar:
- Gravedad: rompe / suena mal / menor
```

## 🔄 Reiniciar una prueba desde cero
Para repetir el E2E con la misma cuenta: abre la **ficha** de la candidata y pulsa **🗑️ Borrar / empezar de cero** (pide confirmación). Borra su conversación, estados y TODO su historial. Cuando esa cuenta vuelva a escribir, arranca con el **opener** como si fuera nueva. Disponible en cualquier estado (incluso rechazada/cerrada). ⚠️ En producción es **irreversible** (borra de la base de datos real) — solo para tus candidatas de prueba.

## Recordatorios
- Si algo va mal y quieres parar el bot en una conversación → **pausa** esa candidata en el CRM (tomas el control).
- El **debounce** (esperar a que termine de escribir) lo activas **después**, cuando el funnel base esté fino.
- La **divulgación de IA** la gestionas tú (recuerda: es obligatoria por ley antes de llamadas reales).
