import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { sameOriginAllowed } from "@/application/sameOrigin";

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
 * SEGURIDAD (jul-2026): tras quitar el candado global de contraseña, este borrado REAL e IRREVERSIBLE queda
 * tras la guardia "mismo origen" (solo desde la propia web del CRM), para que un desconocido no pueda borrar
 * fichas de candidatas. El CRM pide confirmacion antes de llamar aqui.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginAllowed(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  }
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
    // No filtrar el mensaje crudo de la BD al cliente; se loguea solo en servidor.
    console.error("[candidates/delete] error al borrar", {
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: "No se pudo borrar la candidata." }, { status: 500 });
  }
}
