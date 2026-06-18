import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { seedDemoCandidates } from "@/server/demoSeed";

/**
 * Carga candidatas de DEMO en el almacen (para ver el CRM/Dashboard/Llamadas llenos sin Instagram).
 * Idempotente (ids fijos). Ruta fina. No expone datos sensibles.
 */
export async function POST() {
  const repository = getSimulatorRepository();
  const count = await seedDemoCandidates(repository);
  return NextResponse.json({ seeded: count });
}
