import type { Candidate, CandidatePatch } from "@/domain/candidate";
import type { ExtractedCandidateData } from "./llmProvider";

export interface DataConsistencyResult {
  patch: CandidatePatch;
  contradictions: string[];
  corrections: string[];
}

const correctionPattern = /\b(perdon|perdón|corrijo|en realidad|quise decir|me he equivocado|me equivoque|me equivoqué)\b/i;

// El modelo a veces vuelca marcadores vacios (":", "-", ",", ".") o cadenas en blanco en campos sin
// dato real. Tratarlos como "sin valor" evita falsas contradicciones del tipo "deviceModel changed
// from , to iphone 13" o "country changed from  to :" que disparaban revision humana en cadena.
function isMeaninglessString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.trim().replace(/[\s:;,.\-_/|]+/g, "").length === 0;
}

// Campos derivados/blandos: el modelo los re-infiere a partir del contexto conversacional y cambian
// de forma benigna (p. ej. "tengo OF pero no lo uso" -> hasOnlyFans true/false segun el matiz; el
// modelo mete a veces la descripcion del OF en deviceModel; un movil distinto en otro turno). Un
// cambio aqui es una actualizacion, no una contradiccion dura que escale a revision humana. La EDAD
// es el unico hecho de identidad cuyo cambio sin correccion explicita SI es una contradiccion dura
// (invariante 2: edad dudosa no avanza); los demas campos se actualizan en silencio.
const SOFT_REINFERRED_FIELDS = new Set<keyof CandidatePatch>([
  "country",
  "city",
  "phone",
  "deviceType",
  "deviceModel",
  "deviceEligibility",
  "hasOnlyFans",
  "worksWithAnotherAgency",
  "currentMonthlyRevenue",
  "contentAvailability"
]);

export function buildConsistentCandidatePatch(input: {
  candidate: Candidate;
  extractedData: ExtractedCandidateData;
  inboundMessage: string;
}): DataConsistencyResult {
  const patch: CandidatePatch = {};
  const contradictions: string[] = [];
  const corrections: string[] = [];
  const allowsCorrection = correctionPattern.test(input.inboundMessage);

  applyValue("age", input.candidate.age, input.extractedData.age, patch, contradictions, corrections, allowsCorrection);
  if (patch.age !== undefined) patch.isAdultConfirmed = patch.age >= 18;
  applyValue(
    "country",
    input.candidate.country,
    input.extractedData.country,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  applyValue("city", input.candidate.city, input.extractedData.city, patch, contradictions, corrections, allowsCorrection);
  applyValue("phone", input.candidate.phone, input.extractedData.phone, patch, contradictions, corrections, allowsCorrection);
  applyValue(
    "deviceType",
    input.candidate.deviceType,
    input.extractedData.deviceType,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  applyValue(
    "deviceModel",
    input.candidate.deviceModel,
    input.extractedData.deviceModel,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  applyDeviceEligibility(
    input.candidate.deviceEligibility,
    input.extractedData.deviceEligibility,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  if (input.extractedData.profileVisibility) {
    patch.declaredProfileVisibility = input.extractedData.profileVisibility;
  }
  applyValue(
    "hasOnlyFans",
    input.candidate.hasOnlyFans,
    input.extractedData.hasOnlyFans,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  applyValue(
    "worksWithAnotherAgency",
    input.candidate.worksWithAnotherAgency,
    input.extractedData.worksWithAnotherAgency,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  applyValue(
    "currentMonthlyRevenue",
    input.candidate.currentMonthlyRevenue,
    input.extractedData.currentMonthlyRevenue,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );
  applyContentAvailability(
    input.candidate.contentAvailability,
    input.extractedData.contentAvailability,
    patch,
    contradictions,
    corrections,
    allowsCorrection
  );

  if (input.extractedData.firstName && !input.candidate.firstName) patch.firstName = input.extractedData.firstName;
  if (input.extractedData.experienceDescription && !input.candidate.experienceDescription)
    patch.experienceDescription = input.extractedData.experienceDescription;
  if (input.extractedData.goals && !input.candidate.goals) patch.goals = input.extractedData.goals;
  if (input.extractedData.objections?.length)
    patch.objections = [...input.candidate.objections, ...input.extractedData.objections];

  return { patch, contradictions, corrections };
}

function applyValue<K extends keyof CandidatePatch>(
  key: K,
  currentValue: CandidatePatch[K],
  nextValue: CandidatePatch[K] | undefined,
  patch: CandidatePatch,
  contradictions: string[],
  corrections: string[],
  allowsCorrection: boolean
): void {
  if (nextValue === undefined) return;
  // Marcador vacio del modelo (":", "-", cadena en blanco): no es un dato, se ignora sin tocar nada.
  if (isMeaninglessString(nextValue)) return;
  // Re-inferencia que DEGRADA un dato conocido a "UNKNOWN" (el modelo "olvido" el movil en un turno
  // posterior): es perdida de informacion, nunca un conflicto. Se conserva el valor almacenado.
  if (nextValue === "UNKNOWN" && currentValue !== undefined && currentValue !== null && currentValue !== "UNKNOWN") return;

  // Un valor almacenado vacio o basura cuenta como "sin dato": rellenar con el nuevo, sin contradiccion.
  const storedIsMissing =
    currentValue === undefined || currentValue === null || currentValue === "UNKNOWN" || isMeaninglessString(currentValue);
  if (storedIsMissing || currentValue === nextValue) {
    patch[key] = nextValue;
    return;
  }

  if (allowsCorrection) {
    patch[key] = nextValue;
    corrections.push(`${String(key)} corrected from ${String(currentValue)} to ${String(nextValue)}`);
    return;
  }

  // Campos blandos re-inferidos (pais, ciudad, telefono, dispositivo, OF si/no, agencias, ingresos,
  // disponibilidad): el modelo los re-emite/re-infiere cada turno, asi que un cambio es una
  // actualizacion silenciosa (queda como nota CORRECTION para Alex), NUNCA una contradiccion dura
  // que escale a revision humana. `age` es el UNICO campo que sigue siendo contradiccion dura
  // (invariante 2): un cambio de edad sin correccion explicita cae al push de abajo y escala.
  if (SOFT_REINFERRED_FIELDS.has(key)) {
    patch[key] = nextValue;
    corrections.push(`${String(key)} updated from ${String(currentValue)} to ${String(nextValue)}`);
    return;
  }

  contradictions.push(`${String(key)} changed from ${String(currentValue)} to ${String(nextValue)}`);
}

function applyContentAvailability(
  currentValue: string | undefined,
  nextValue: string | undefined,
  patch: CandidatePatch,
  contradictions: string[],
  corrections: string[],
  allowsCorrection: boolean
): void {
  if (typeof nextValue !== "string" || nextValue.trim().length === 0) return;
  applyValue("contentAvailability", currentValue, nextValue, patch, contradictions, corrections, allowsCorrection);
}

function applyDeviceEligibility(
  currentValue: Candidate["deviceEligibility"],
  nextValue: CandidatePatch["deviceEligibility"] | undefined,
  patch: CandidatePatch,
  contradictions: string[],
  corrections: string[],
  allowsCorrection: boolean
): void {
  if (nextValue === undefined) return;
  const expectedResolution =
    (currentValue === "PENDING_UPGRADE" || currentValue === "PENDING_QUALITY_TEST" || currentValue === "UNKNOWN") &&
    (nextValue === "APPROVED" || nextValue === "PENDING_QUALITY_TEST");

  if (expectedResolution) {
    patch.deviceEligibility = nextValue;
    if (currentValue !== nextValue && currentValue !== "UNKNOWN") {
      corrections.push(`deviceEligibility corrected from ${currentValue} to ${nextValue}`);
    }
    return;
  }

  applyValue("deviceEligibility", currentValue, nextValue, patch, contradictions, corrections, allowsCorrection);
}
