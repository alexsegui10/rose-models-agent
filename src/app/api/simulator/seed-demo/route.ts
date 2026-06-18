import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { clearDemoCandidates, seedDemoCandidates } from "@/server/demoSeed";

/**
 * Carga candidatas de DEMO en el almacen (para ver el CRM/Dashboard/Llamadas llenos sin Instagram).
 * Idempotente (ids fijos). Ruta fina. No expone datos sensibles.
 */
export async function POST() {
  try {
    const repository = getSimulatorRepository();
    const count = await seedDemoCandidates(repository);
    return NextResponse.json({ seeded: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al sembrar la demo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Borra las candidatas de demo (solo las de demo, por su prefijo de id; nunca toca reales). */
export async function DELETE() {
  try {
    const repository = getSimulatorRepository();
    const removed = await clearDemoCandidates(repository);
    return NextResponse.json({ removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al quitar la demo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
