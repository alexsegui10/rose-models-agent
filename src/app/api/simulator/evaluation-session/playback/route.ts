import { NextResponse } from "next/server";
import { z } from "zod";
import { createEvaluationSession, playImportedConversation } from "@/application/evaluationRunner";
import { getLlmRuntimeConfig } from "@/application/llmConfig";
import { getEvaluationRepository, getImportedConversationRepository } from "@/server/simulatorStore";

const PlaybackRequestSchema = z.object({
  conversationId: z.string().min(1),
  model: z.string().default("gpt-5.4-mini")
});

export async function POST(request: Request) {
  const parsed = PlaybackRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const conversation = await getImportedConversationRepository().get(parsed.data.conversationId);
  if (!conversation) {
    return NextResponse.json(
      {
        error: `No existe ninguna conversacion importada con id "${parsed.data.conversationId}". Importa primero el JSON anonimizado.`
      },
      { status: 404 }
    );
  }

  const config = getLlmRuntimeConfig();
  const playback = await playImportedConversation({
    conversation,
    model: parsed.data.model,
    openaiApiKey: config.llmMode === "OPENAI" ? config.openaiApiKey : undefined
  });
  const session = await getEvaluationRepository().saveSession(
    createEvaluationSession({
      conversationId: conversation.id,
      model: parsed.data.model,
      playbackTurns: playback.turns
    })
  );
  return NextResponse.json({ session });
}
