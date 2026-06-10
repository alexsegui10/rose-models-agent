import { NextResponse } from "next/server";
import { normalizeCandidate } from "@/domain/candidate";
import { getSimulatorRepository } from "@/server/simulatorStore";

export async function GET() {
  const repository = getSimulatorRepository();
  const candidates = await repository.listCandidates();
  const normalizedCandidates = await Promise.all(candidates.map((candidate) => repository.saveCandidate(normalizeCandidate(candidate))));

  return NextResponse.json({ candidates: normalizedCandidates });
}
