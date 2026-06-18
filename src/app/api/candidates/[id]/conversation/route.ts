import { NextResponse } from "next/server";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Conversacion (mensajes + transiciones) de una candidata, para la ficha-drawer del CRM.
 * Ruta fina: solo lee del repositorio. No expone datos sensibles (claves, prompts internos).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getSimulatorRepository();
  const candidate = await repository.findCandidateById(id);
  if (!candidate) {
    return NextResponse.json({ error: "Candidata no encontrada." }, { status: 404 });
  }

  const [messages, transitions] = await Promise.all([repository.listMessages(id), repository.listTransitions(id)]);

  return NextResponse.json({ messages, transitions });
}
