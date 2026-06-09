import { NextResponse } from "next/server";
import { z } from "zod";
import { getImportedConversationRepository } from "@/server/simulatorStore";

const ImportConversationSchema = z.object({
  json: z.string().min(1)
});

export async function GET() {
  return NextResponse.json({ conversations: await getImportedConversationRepository().list() });
}

export async function POST(request: Request) {
  const parsed = ImportConversationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const conversations = await getImportedConversationRepository().importJson(parsed.data.json);
    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid conversation import." }, { status: 400 });
  }
}
