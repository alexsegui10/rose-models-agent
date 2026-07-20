/**
 * Guard COMPARTIDO (texto + voz): detecta una promesa de OCULTAR la cara o trabajar en anonimato, sea cual
 * sea la formulacion del modelo ("para que no salga tu cara", "sin mostrar la cara", "te difuminamos la
 * cara", "anonimato"). La cara es un requisito DURO e innegociable: ninguna salida del LLM puede prometer
 * lo contrario. Vive aqui para que la ruta de TEXTO (factualValidator) y la de VOZ (callRedactionValidator)
 * usen EXACTAMENTE la misma deteccion y no diverjan (regla CLAUDE.md).
 */

/** true si el texto promete ocultar/difuminar/tapar la cara o trabajar en anonimato. */
export function promisesFaceConcealment(response: string): boolean {
  const normalized = response
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  // "cara"/"rostro" (+ coloquiales "carita"/"careto") son intercambiables: el resto del codigo trata "rostro"
  // como cara y un modelo los alterna para no repetir; el guard DEBE cubrir todos en cada rama (huecos del
  // revisor y barrido 20-jul: "careto"/"carita" se colaban). "morro"/"jeta" se dejan fuera (ambiguos).
  const FACE = "(?:cara|carita|careto|rostro)";

  // A. ANONIMATO / INCOGNITO / ocultar la IDENTIDAD / que no se sepa/vea quien eres (anonimato de facto sin la
  //    palabra "cara"). Se veta aunque vaya negado ("no es posible el anonimato" cae al fallback SEGURO).
  if (/\banonim\w*/.test(normalized)) return true;
  if (/\bincognit\w*/.test(normalized)) return true;
  if (
    /\b(?:oculta\w*|tapa\w*|proteg\w*|reserva\w*|escond\w*|disimul\w*|en secreto|a salvo)\b[^.!?]{0,20}\bidentidad\b/.test(
      normalized
    )
  )
    return true;
  if (
    /\bidentidad\b[^.!?]{0,20}\b(?:oculta\w*|tapad\w*|proteg\w*|reservad\w*|disimul\w*|a salvo|en secreto|anonim\w*|no se (?:revela|sabe|conoce|nota))\b/.test(
      normalized
    )
  )
    return true;
  // "nadie/no ... sabe/va a saber/se entera/ve/reconoce ... quien eres / que eres tu/vos / tu identidad"
  // (perifrasis, plural y voseo argentino incluidos): anonimato de facto.
  if (
    /\b(?:nadie|que no|para que no|sin que|asi no|no)\b[^.!?]{0,25}\b(?:sep\w*|sab\w*|conoc\w*|conozc\w*|se enter\w*|descubr\w*|vea\w*|ve\b|ven\b|not\w*|distingu\w*|reconoc\w*|reconozc\w*|identifi\w*)\b[^.!?]{0,18}\b(?:quien eres|quien sos|que eres tu|que sos vos|que eres vos|tu identidad|tu nombre)\b/.test(
      normalized
    )
  )
    return true;
  if (
    /\b(?:quien eres|tu identidad)\b[^.!?]{0,15}\b(?:oculto|oculta|en secreto|a salvo|anonim\w*|no se sepa|no se revela)\b/.test(
      normalized
    )
  )
    return true;

  // B. VERBO DE OCULTAMIENTO (difuminar/pixelar/tapar/recortar/oscurecer/borrar/ocultar/cubrir/esconder/
  //    disimular) junto a cara/rostro, en cualquier orden. Ademas: pixelar/difuminar CON pronombre y clitico
  //    opcional ("te lo pixelamos", "te difuminamos") son ocultamiento de imagen aunque no digan "cara".
  // desenfoc(ar)/blur (barrido 20-jul): sinonimos realistas de difuminar la imagen que faltaban.
  const CONCEAL = "difumin|desenfoc|blur|pixel|tap|recort|oscurec|borr|ocult|cubr|escond|disimul";
  if (new RegExp(`\\b(?:${CONCEAL})\\w*\\b[^.!?]{0,30}\\b${FACE}\\b`).test(normalized)) return true;
  if (new RegExp(`\\b${FACE}\\b[^.!?]{0,30}\\b(?:${CONCEAL})\\w*`).test(normalized)) return true;
  if (/\b(?:te|le|os|nos)\s+(?:l[oa]s?\s+)?(?:pixel|difumin)\w*/.test(normalized)) return true;
  // Filtro / emoji / sticker que CAMBIA o TAPA la cara/rostro (ocultamiento de identidad de facto).
  if (
    new RegExp(
      `\\bfiltro\\b[^.!?]{0,25}\\b(?:cambi|modific|transform|deform|altera|tap|ocult)\\w*[^.!?]{0,15}\\b${FACE}\\b`
    ).test(normalized)
  )
    return true;
  if (new RegExp(`\\b(?:emoji|emoticono|sticker|stiker|pegatina)\\b[^.!?]{0,20}\\b${FACE}\\b`).test(normalized)) return true;
  if (new RegExp(`\\b${FACE}\\b[^.!?]{0,20}\\b(?:emoji|emoticono|sticker|stiker|pegatina)\\b`).test(normalized)) return true;
  // Avatar (digital) que sustituye la cara: ocultamiento de identidad de facto (barrido 20-jul). Solo con
  // "cara" cerca para no cazar usos ajenos; el caso claro es "un avatar en vez de tu cara".
  if (new RegExp(`\\bavatar\\b[^.!?]{0,20}\\b${FACE}\\b`).test(normalized)) return true;
  if (new RegExp(`\\b${FACE}\\b[^.!?]{0,20}\\bavatar\\b`).test(normalized)) return true;

  // C. cara/rostro NO se ve / nota / reconoce / distingue (pronombre + perifrasis opcionales: "no se te
  //    llega a ver la cara", "no se te va a ver"); no sale / aparece.
  // disting\\w* (no distingu\\w*): cubre el SUBJUNTIVO "distinga" ("que no se distinga tu cara"), no solo el
  // indicativo "distingue" (hueco 20-jul). apreci/percib: "no se te aprecia/percibe la cara" (sinonimos de ver).
  const HIDDEN_VERB = "ve\\w*|nota\\w*|reconoc\\w*|reconozc\\w*|disting\\w*|identifi\\w*|apreci\\w*|percib\\w*";
  const PERIPHRASIS =
    "(?:llega\\s+a\\s+|va\\s+a\\s+|vas\\s+a\\s+|puede[ns]?\\s+|pueda[ns]?\\s+|alcanza\\s+a\\s+|logra\\s+a?\\s*)?";
  if (
    new RegExp(
      `\\b(?:no|apenas|casi\\s+no|ni)\\s+se\\s+(?:te\\s+|le\\s+|me\\s+)?${PERIPHRASIS}(?:${HIDDEN_VERB})\\b[^.!?]{0,20}\\b${FACE}\\b`
    ).test(normalized)
  )
    return true;
  if (
    new RegExp(
      `\\b${FACE}\\b[^.!?]{0,20}\\b(?:no|apenas|casi\\s+no|ni)\\s+se\\s+(?:te\\s+|le\\s+|me\\s+)?${PERIPHRASIS}(?:${HIDDEN_VERB})\\b`
    ).test(normalized)
  )
    return true;
  if (
    new RegExp(
      `\\bno\\s+(?:te\\s+|le\\s+|se\\s+te\\s+|se\\s+le\\s+)?${PERIPHRASIS}(?:saldra|sale|salga|aparece|aparecera|apareceria|salir)\\b[^.!?]{0,20}\\b${FACE}\\b`
    ).test(normalized)
  )
    return true;
  if (
    new RegExp(`\\b${FACE}\\b[^.!?]{0,20}\\bno\\s+(?:te\\s+|le\\s+)?(?:saldra|sale|salga|aparece|aparecera)\\b`).test(normalized)
  )
    return true;
  // "solo se te ve el cuerpo" (promete que solo el cuerpo, no la cara). Articulo opcional (20-jul: "solo cuerpo").
  if (/\bsolo\s+se\s+(?:te\s+|le\s+)?ve\w*\s+(?:el\s+|tu\s+)?cuerpo\b/.test(normalized)) return true;

  // D. Que NADIE / NO te RECONOZCA (anonimato de facto). El bot NUNCA promete no-reconocimiento legitimo. Se
  //    admite pronombre PROCLITICO ("no TE reconocen") o ENCLITICO ("nadie va a reconocerTE"), con auxiliar
  //    intercalado ("va a / puede / podra reconocer") y plural, cerrando la morfologia que cazo el revisor.
  const AUX = "(?:va[ns]?\\s+a\\s+|vas\\s+a\\s+|puede[ns]?\\s+|pueda[ns]?\\s+|podr\\w+\\s+|logra\\s+a?\\s*)?";
  // Negadores de reconocimiento (incluye "imposible/no hay forma que ... te reconozcan").
  const NO_RECOG = "(?:nadie|no|que\\s+no|para\\s+que\\s+no|asi\\s+no|imposible|no\\s+hay\\s+(?:forma|manera|modo))";
  // recono[cz]\\w* cubre el INDICATIVO (reconoce/reconocen) y el SUBJUNTIVO (reconozca/reconozcan), la forma
  // MAS natural tras "para que no / asi no" (hueco que cazo el revisor). ver\\w*/vea\\w* cubre "nadie te ve".
  const RECOG_VERB = "recono[cz]\\w*|identif\\w*";
  // Proclitico: "(nadie|no|imposible que) ... te (va a) reconozca(n)/reconoce(n)/identifica / (no) te ve(n)".
  if (new RegExp(`\\b${NO_RECOG}\\b[^.!?]{0,20}\\bte\\s+${AUX}(?:${RECOG_VERB}|ve\\b|ven\\b|vea\\w*|ver\\w*)`).test(normalized))
    return true;
  // Enclitico: "(nadie|no|para que no|imposible) ... (va a) reconocerte/identificarte/verte".
  if (
    new RegExp(`\\b${NO_RECOG}\\b[^.!?]{0,20}\\b${AUX}(?:reconocer|reconozcan?|identificar|ver)(?:te|os|la)\\b`).test(normalized)
  )
    return true;

  // E. OBJETOS que tapan la cara: mascara/mascarilla/antifaz/pasamontañas/velo siempre; gafas+gorra ya los
  //    caza D ("nadie te reconoce") o B ("tapar la cara").
  if (/\b(?:mascara|mascarilla|antifaz|pasamontanas|verdugo|capucha)\b/.test(normalized)) return true;
  if (/\b(?:un|el|con|lleva\w*|usa\w*|ponte|pon)\s+(?:un\s+)?velo\b/.test(normalized)) return true;

  // F. SIN mostrar/dar/salir de cara; negar la OBLIGACION de mostrar/salir de cara; imperativo permisivo.
  if (
    new RegExp(`\\bsin\\s+(?:mostrar|ensenar|muestr\\w*|ensen\\w*|dar|que\\s+se\\s+vea)\\b[^.!?]{0,15}\\b${FACE}\\b`).test(
      normalized
    )
  )
    return true;
  if (/\bsin\s+(?:dar|mostrar|ensenar)\s+la\s+cara\b/.test(normalized)) return true;
  if (
    new RegExp(
      `\\bsin\\s+que\\s+(?:aparezca|aparezcan|salga|salgan|se\\s+vea|se\\s+vean|se\\s+te\\s+vea|se\\s+note)\\b[^.!?]{0,40}\\b${FACE}\\b`
    ).test(normalized)
  )
    return true;
  if (
    new RegExp(
      `\\bno\\s+(?:hace\\s+falta|necesitas|necesita|tienes\\s+que|tenes\\s+que|es\\s+necesario|es\\s+obligatorio|hay\\s+que|por\\s+que)\\s+(?:que\\s+)?(?:mostrar|ensenar|muestr\\w*|ensen\\w*|dar|des|das|da|salir\\s+de|dar\\s+la)\\b[^.!?]{0,15}\\b${FACE}\\b`
    ).test(normalized)
  )
    return true;
  if (/\b(?:no\s+tienes\s+por\s+que|no\s+hace\s+falta|no\s+hay\s+que|puedes\s+no)\s+salir\s+de\s+cara\b/.test(normalized))
    return true;
  if (/\bno\s+salir\s+de\s+cara\b/.test(normalized)) return true;
  // Imperativo permisivo "no (me) muestres/das/das la cara" (2ª persona: muestres/muestras/ensenes/ensenas/
  // des/das/da). NO caza "no, tienes que MOSTRAR" (infinitivo con coma, reafirmacion), ya gestionado arriba.
  if (
    new RegExp(`\\bno\\s+(?:me\\s+|nos\\s+)?(?:muestres|muestras|ensenes|ensenas|des|das|da)\\b[^.!?]{0,15}\\b${FACE}\\b`).test(
      normalized
    )
  )
    return true;

  // G. CARA PARCIAL que evita mostrarla (de espalda(s), media cara/medio rostro, solo el cuerpo, de(l) cuello
  //    para abajo). NO se incluye "de perfil"/"de lado" (ambiguos). "de espaldas NO" (reafirmacion) se excluye.
  if (
    /\bde\s+espaldas?\b(?!\s+no\b)|\bmedi[ao]\s+(?:cara|carita|careto|rostro)\b|\bsolo\s+(?:el\s+|tu\s+)?cuerpo\b|\bde(?:l)?\s+cuello\s+(?:para|hacia)\s+abajo\b/.test(
      normalized
    )
  )
    return true;

  // H. CONCEDER trabajar sin la cara (draft acomodaticio del LLM: "apuntado lo de la cara, sin problema",
  //    "sin cara, sin problema", "sin la cara no hay problema", "respeto que no quieras mostrar la cara").
  //    Barrido 20-jul: el redactor, al recibir el rechazo de la cara como contexto, tendia a ACEPTARLO. Se
  //    exige un marcador DURO e INEQUIVOCO de CONCESION (sin problema / no pasa nada / apuntado / dalo por
  //    hecho) que la INSISTENCIA legitima ("la cara es imprescindible / sin ella no funciona / es la base")
  //    NUNCA lleva. NO se usa "de acuerdo"/"vale" (revisor 20-jul): son tambien conectores de una insistencia
  //    ("de acuerdo, PERO la cara es imprescindible") -> falsos positivos sobre reafirmaciones legitimas.
  const NOFACE_REF = `(?:sin\\s+(?:la\\s+|tu\\s+)?${FACE}|lo\\s+de\\s+(?:la\\s+|tu\\s+)?${FACE})`;
  const CONCESSION =
    "sin\\s+problema|no\\s+hay\\s+(?:problema|drama|lio|pega)|no\\s+pasa\\s+nada|sin\\s+drama|apuntad\\w*|anotad\\w*|dalo\\s+por\\s+hecho";
  if (new RegExp(`\\b${NOFACE_REF}\\b[^.!?]{0,25}\\b(?:${CONCESSION})`).test(normalized)) return true;
  if (new RegExp(`\\b(?:${CONCESSION})\\b[^.!?]{0,25}\\b${NOFACE_REF}\\b`).test(normalized)) return true;
  // "respeto/entiendo que NO QUIERAS mostrar/ensenar/dar la cara" = aceptar el rechazo (concesion explicita).
  if (new RegExp(`\\brespet\\w*\\b[^.!?]{0,20}\\bno\\s+quier\\w*\\b[^.!?]{0,20}\\b${FACE}\\b`).test(normalized)) return true;

  return false;
}
