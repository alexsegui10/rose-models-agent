import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * DELETE /api/candidates/[id] — borra UNA candidata concreta (incluidas las reales de Instagram) y, en
 * cascada, TODO su historial: mensajes, transiciones y decisiones de negociacion. Sirve para reiniciar
 * las pruebas end-to-end desde cero (tras borrar, un mensaje nuevo de esa cuenta crea una candidata limpia
 * con el opener fresco). Ruta fina: solo llama al repositorio, sin logica de negocio.
 *
 * IDEMPOTENTE a proposito: si la candidata ya no existe se devuelve 200 igualmente (deleteCandidate es
 * no-op en ambos backends), para que un doble click o una carrera con el refresco del CRM no muestre un
 * falso error en una pantalla destructiva.
 *
 * Proteccion: el Basic Auth del middleware cubre esta ruta (no esta en MACHINE_PATHS). En produccion
 * (Postgres/Neon) el borrado es REAL e IRREVERSIBLE; el CRM pide confirmacion antes de llamar aqui.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Id de candidata invalido." }, { status: 400 });
  }
  try {
    const repository = getSimulatorRepository();
    const existing = await repository.findCandidateById(id);
    await repository.deleteCandidate(id);
    return NextResponse.json({ deleted: true, instagramUsername: existing?.instagramUsername ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al borrar la candidata.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
