import { NegotiationAuthoritySchema, NonPaymentPolicySchema, type NegotiationLog } from "@/domain/businessKnowledge";
import type { CandidateCommercialTier, DeviceEligibility, DeviceType } from "@/domain/candidate";
// Politicas puras movidas a domain (rompen el ciclo application<->content). Se re-exportan aqui para
// no romper a ningun importador existente de @/application/policyRules.
import { communicationPolicy, contentProductionPolicy, followUpAttemptCountRange } from "@/domain/businessPolicy";

export { communicationPolicy, contentProductionPolicy, followUpAttemptCountRange };

export const negotiationAuthority = NegotiationAuthoritySchema.parse({
  STANDARD: { minimumAgencyPercentage: 70 },
  HIGH_POTENTIAL: { minimumAgencyPercentage: 65 },
  EXCEPTIONAL: { minimumAgencyPercentage: 60 }
});

export const nonPaymentPolicy = NonPaymentPolicySchema.parse({
  gracePeriodDays: 7,
  reminderRequired: true,
  suspendAfterGracePeriod: true,
  terminateAfterContinuedNonPayment: true,
  allowDebtCollection: true,
  grantsUnlimitedContentRights: false
});

export function minimumAgencyPercentageForTier(tier: CandidateCommercialTier): number {
  return negotiationAuthority[tier].minimumAgencyPercentage;
}

export function canOfferAgencyPercentage(tier: CandidateCommercialTier, agencyPercentage: number): boolean {
  return agencyPercentage >= minimumAgencyPercentageForTier(tier) && agencyPercentage >= 60;
}

export function firstCounterOfferForTier(tier: CandidateCommercialTier): number {
  if (tier === "STANDARD") return 70;
  return 65;
}

export function canUseSixtyFortyAsFirstCounterOffer(): boolean {
  return false;
}

export function createNegotiationLog(input: NegotiationLog): NegotiationLog {
  return input;
}

// "iphone" con los typos castellanos habituales: ipone (sin h), iphon (sin e), ifone/ifon (ph->f) y la
// transposicion "ipohne"/"ihpone" (la h cae tras la o, o se cruza con la p). El "i" inicial obligatorio y el
// grupo de consonantes evitan falsos positivos con palabras castellanas (impone, propone, pienso, telefono,
// informe...). Sin esto, "Ipohne 13" dejaba deviceEligibility en UNKNOWN y el slot del movil se preguntaba EN
// BUCLE aunque la candidata ya hubiera contestado (bug grave reproducido por Alex 22-jun).
const IPHONE_TYPO = "i(?:ph|hp|p|f)o?h?ne?";
// Typos reales de marca (lanzamiento 3-jul: "Galaxi A31" y "Sansung" no se reconocían y el móvil se
// re-preguntaba en bucle).
const SAMSUNG_TYPO = "sam?sung|samsun\\b|sansung|samsumg";
const GALAXY_TYPO = "galax[iy]e?";
// Marcas de GAMA BAJA (caso real Marianel 5-jul: "Nubia Focus 2 5G" no se reconocía, el bot re-preguntó
// el móvil DOS veces y Alex tuvo que pausar a mano). Estas marcas no cumplen el requisito de cámara:
// pausa directa (NOT_ELIGIBLE), igual que un moto e/g o un galaxy A. Con typo de doble letra habitual.
const BUDGET_BRANDS = "nubia+|tecno|infinix|itel|wiko|blu\\b|umidigi|cubot|doogee|oukitel|ulefone|zte";

// Orden invertido "13 iPhone" (lanzamiento 3-jul: caía al genérico -> falso PENDING con la frase del
// socio, teniendo un 13 APROBADO). Se normaliza a "iphone 13" antes de evaluar. Solo números de modelo
// plausibles (6-17) para no convertir "tengo 2 iphones viejos" en un "iphone 2".
function normalizeInvertedIphone(normalized: string): string {
  return normalized.replace(new RegExp(`\\b([6-9]|1[0-7])\\s*(?:${IPHONE_TYPO})\\b`), (_m, n) => `iphone ${n}`);
}

// "iphone pro 15" / "iphone pro max 15" (el modificador VA ANTES del numero): se reordena a "iphone 15 pro"
// para que el gate lo trate como el modelo real. Sin esto, la palabra "pro" suelta caia en el generico de
// gama alta -> PENDING ("lo valoro con mi socio") teniendo un iPhone 15 Pro que es APROBADO directo (caso
// real Janna 5-jul: "iPhone pro 15"). Solo reordena cuando hay numero detras; "iphone pro" a secas no se toca.
function normalizeIphoneModifierOrder(normalized: string): string {
  return normalized.replace(
    new RegExp(`\\b(?:${IPHONE_TYPO})\\s?(pro\\s?max|pro|plus|max)\\s?(\\d{1,2})(?!\\d)`, "g"),
    (_m, modifier: string, num: string) => `iphone ${num} ${modifier}`
  );
}

// Normalizacion completa del texto de dispositivo antes de evaluarlo (orden invertido + modificador antes
// del numero). Una sola funcion para que las tres consultas (elegibilidad, tipo, modelo) no diverjan.
function normalizeDeviceText(description: string): string {
  return normalizeIphoneModifierOrder(normalizeInvertedIphone(normalize(description)));
}

export function deviceEligibilityForDescription(description: string): DeviceEligibility {
  const normalized = normalizeDeviceText(description);

  if (
    new RegExp(
      `\\b(comprare|compraré|cambiare|cambiaré|me comprare|me compraré|me cambio)\\b.*\\b(?:${IPHONE_TYPO}|galaxy\\s?s2[3-9]|s23|s24|s25)\\b`
    ).test(normalized)
  )
    return "PENDING_UPGRADE";
  if (/\b(viejo|malo|mala calidad|roto|gama baja|android barato|redmi antiguo)\b/.test(normalized)) return "NOT_ELIGIBLE";
  // Gate real de Alex: Motorola E32 rechazado ("con ese movil no podemos trabajar"). Las familias
  // moto e/g son gama de entrada; un motorola sin modelo pasa a prueba de calidad.
  if (/\b(?:motorola|moto)\s?[eg]\s?\d{1,2}(?!\d)/.test(normalized)) return "NOT_ELIGIBLE";
  // Marcas de gama baja (Nubia, Tecno, Infinix...): pausa directa, decision de Alex 6-jul (caso Marianel).
  if (new RegExp(`\\b(?:${BUDGET_BRANDS})\\b`).test(normalized)) return "NOT_ELIGIBLE";
  // (?!\d) en vez de \b: "iphone 13pro max" pega el sufijo al numero y \b no corta entre "13" y "pro".
  if (new RegExp(`\\b${IPHONE_TYPO}\\s?(1[3-9]|[2-9]\\d)(?!\\d)`).test(normalized)) return "APPROVED";
  // Decision de Alex (2-jul, prueba E2E de lanzamiento): el iPhone 12 es el MINIMO ACEPTADO -> APROBADO
  // directo (nada de "lo valoro con mi socio"). El DUDOSO ("iPhone X o por ahi": X/10, XS, XR y el 11
  // normal) -> prueba de calidad (frase del socio y el bot SIGUE; se revisa al final). iPhone 9 o anterior
  // es CLARAMENTE malo -> NOT_ELIGIBLE (la conversacion se pausa ahi directo).
  if (new RegExp(`\\b${IPHONE_TYPO}\\s?1[12]\\s?(pro\\s?max|pro)\\b`).test(normalized)) return "APPROVED";
  if (new RegExp(`\\b${IPHONE_TYPO}\\s?12(?!\\d)`).test(normalized)) return "APPROVED";
  if (new RegExp(`\\b${IPHONE_TYPO}\\s?(?:11|10)(?!\\d)`).test(normalized)) return "PENDING_QUALITY_TEST";
  if (new RegExp(`\\b${IPHONE_TYPO}\\s?(?:xs|xr|x)(?!\\w)`).test(normalized)) return "PENDING_QUALITY_TEST";
  if (new RegExp(`\\b${IPHONE_TYPO}\\s?[1-9](?!\\d)`).test(normalized)) return "NOT_ELIGIBLE";
  if (new RegExp(`\\b(?:${GALAXY_TYPO}|${SAMSUNG_TYPO})\\s?s2[3-9]\\b`).test(normalized)) return "APPROVED";
  // Samsung de gama baja/entrada (Galaxy A/J, p.ej. "samsung a15") = CLARAMENTE malo -> NOT_ELIGIBLE (pausa).
  // El resto de Samsung/Galaxy sin modelo claro cae al fallback de abajo como dudoso (PENDING).
  if (new RegExp(`\\b(?:${GALAXY_TYPO}|${SAMSUNG_TYPO})\\s?[aj]\\s?\\d`).test(normalized)) return "NOT_ELIGIBLE";
  if (/\b(pro|max|ultra|gama alta|high end|xiaomi 14|xiaomi 15|pixel 8|pixel 9)\b/.test(normalized))
    return "PENDING_QUALITY_TEST";
  if (
    new RegExp(
      `\\b(?:${IPHONE_TYPO}|${SAMSUNG_TYPO}|${GALAXY_TYPO}|android|xiaomi|redmi|huawei|honor|oppo|realme|pixel|motorola|moto)\\b`
    ).test(normalized)
  )
    return "PENDING_QUALITY_TEST";

  return "UNKNOWN";
}

export function deviceTypeForDescription(description: string): DeviceType {
  const normalized = normalizeDeviceText(description);
  if (new RegExp(`\\b(?:${IPHONE_TYPO}|i phone|ios)\\b`).test(normalized)) return "IPHONE";
  if (new RegExp(`\\b(?:${SAMSUNG_TYPO}|${GALAXY_TYPO})\\b`).test(normalized)) return "SAMSUNG";
  if (
    new RegExp(
      `\\b(?:android|xiaomi|redmi|huawei|oppo|realme|pixel|motorola|moto|movil|telefono|celular|${BUDGET_BRANDS})\\b`
    ).test(normalized)
  )
    return "OTHER";
  return "UNKNOWN";
}

export function deviceModelForDescription(description: string): string | null {
  // Mismas familias que clasifica el gate (lanzamiento 3-jul: 'Moto g 85' y 'Galaxy A31' quedaban con
  // eligibility PERO sin modelo en la ficha, y Alex tenía que releer el chat para saber qué valoraba).
  const normalized = normalizeDeviceText(description);
  const match = normalized.match(
    new RegExp(
      `\\b(${IPHONE_TYPO}\\s?\\d{1,2}(?:\\s?(?:pro\\s?max|pro|max|plus|mini))?|(?:${GALAXY_TYPO}|${SAMSUNG_TYPO})\\s?[sajm]\\s?\\d{1,3}(?:\\s?(?:ultra|plus))?|(?:motorola|moto)\\s?[eg]\\s?\\d{1,3}|redmi\\s?(?:note\\s?)?\\d{1,2}|pixel\\s?\\d{1,2}\\s?pro|pixel\\s?\\d{1,2}|xiaomi\\s?(?:poco\\s?)?[a-z]?\\d{1,2})\\b`
    )
  );
  if (match) return match[1].replace(/\s+/g, " ").trim();
  // Red de seguridad: si hay una MARCA reconocible pero el patrón fino no capturó el modelo, se guarda
  // desde la marca (hasta ~24 chars) para que Alex SIEMPRE vea en la ficha qué móvil está valorando.
  const brandAnchored = normalized.match(
    new RegExp(
      `\\b(?:${IPHONE_TYPO}|${SAMSUNG_TYPO}|${GALAXY_TYPO}|xiaomi|redmi|huawei|honor|oppo|realme|pixel|motorola|moto|${BUDGET_BRANDS})\\b[a-z0-9 +]{0,20}`
    )
  );
  return brandAnchored ? brandAnchored[0].replace(/\s+/g, " ").trim() : null;
}

export function shouldAskCurrentRevenue(hasOnlyFans: boolean | undefined): boolean {
  return hasOnlyFans === true;
}

export function shouldAskFollowerCount(): boolean {
  return false;
}

export function shouldEscalateForCommunicationDelay(delayCount: number): boolean {
  return delayCount > 1;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
