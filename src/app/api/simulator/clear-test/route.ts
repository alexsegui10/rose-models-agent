import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { clearNonRealCandidates } from "@/server/demoSeed";

/**
 * Borra las candidatas de PRUEBA (las que no son de Instagram real: pruebas del chat + demo), dejando
 * solo las que entraron por el webhook (IGSID numerico). Ruta fina. No toca candidatas reales.
 */
export async function POST() {
  try {
    const repository = getSimulatorRepository();
    const removed = await clearNonRealCandidates(repository);
    return NextResponse.json({ removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al limpiar las pruebas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
