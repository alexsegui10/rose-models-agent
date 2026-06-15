import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstagramConfig } from "@/application/instagramConfig";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Respuesta MANUAL de Alex a una candidata (cuando el bot escaló o él pausó la conversación). Persiste
 * el mensaje como autoría ALEX y lo envía a Instagram (no-op si la integración no está configurada o si
 * la candidata no es de Instagram). No toca el estado: para tomar el control total, Alex pausa el bot
 * aparte. El control de flujo sigue siendo del código; esto solo manda un texto que Alex escribe.
 */
const ManualReplySchema = z.object({
  candidateId: z.string(),
  message: z.string().min(1)
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = ManualReplySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const repository = getSimulatorRepository();
  const candidate = await repository.findCandidateById(parsed.data.candidateId);
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  await repository.addMessage({
    id: crypto.randomUUID(),
    candidateId: candidate.id,
    role: "alex",
    author: "ALEX",
    content: parsed.data.message,
    createdAt: new Date(),
    metadata: { manual: true }
  });

  const config = getInstagramConfig();
  let sentToInstagram = false;
  if (config.isConfigured) {
    const provider = new GraphApiInstagramMessagingProvider(config);
    // La clave de la conversación es el IGSID (lo guardamos en instagramUsername para las de Instagram).
    sentToInstagram = await provider.sendTextMessage(candidate.instagramUsername, parsed.data.message);
  }

  const messages = await repository.listMessages(candidate.id);
  return NextResponse.json({ ok: true, sentToInstagram, messages });
}
