import { NextResponse } from "next/server";
import { normalizeCandidate } from "@/domain/candidate";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Lista de candidatas para el CRM. SOLO LECTURA (jul-2026): antes re-ESCRIBÍA todas las filas en cada poll
 * de 5s (upsert por candidata) — carga inútil en Neon y, peor, una carrera real: el poll podía pisar con
 * datos viejos una escritura concurrente (webhook de fin de llamada, turno de IG). La normalización se
 * aplica solo en la respuesta; quien persiste normalizado es quien escribe.
 */
export async function GET() {
  const repository = getSimulatorRepository();
  const candidates = await repository.listCandidates();
  return NextResponse.json({ candidates: candidates.map((candidate) => normalizeCandidate(candidate)) });
}
