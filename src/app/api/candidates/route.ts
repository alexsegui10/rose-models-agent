import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";

export async function GET() {
  const repository = getSimulatorRepository();
  const candidates = await repository.listCandidates();

  return NextResponse.json({ candidates });
}

