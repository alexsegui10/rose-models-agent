import { NextResponse } from "next/server";
import { getLlmRuntimeConfig } from "@/application/llmConfig";
import { getPersistenceMode } from "@/server/simulatorStore";

/**
 * Estado runtime REAL del simulador (invariante 6: nunca mentir sobre el modo activo).
 * Solo expone modos y nombres de modelo; jamas claves API ni DATABASE_URL.
 */
export async function GET() {
  const llmConfig = getLlmRuntimeConfig();
  return NextResponse.json({
    persistenceMode: getPersistenceMode(),
    llmMode: llmConfig.llmMode,
    writingModel: llmConfig.writingModel
  });
}
