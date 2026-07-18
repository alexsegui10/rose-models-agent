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

  // Ventana ancha (18-jul): la ficha muestra la conversacion ENTERA y suma el coste IA real de la traza —
  // con el limite por defecto (50) una conversacion larga perdia turnos y el coste quedaba infravalorado.
  const [messages, transitions] = await Promise.all([repository.listMessages(id, 500), repository.listTransitions(id)]);

  return NextResponse.json({ messages, transitions });
}
