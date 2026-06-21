import { NextResponse } from "next/server";
import { z } from "zod";
import { getWhatsAppConfig } from "@/application/whatsappConfig";
import { GraphApiWhatsAppMessagingProvider } from "@/infrastructure/integrations/whatsappMessagingProvider";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Respuesta MANUAL de Alex a una candidata por WhatsApp (desde la bandeja del CRM). Persiste el mensaje
 * con autoria ALEX y lo envia por la Cloud API al numero de la candidata. El bot NUNCA auto-responde por
 * WhatsApp: esto es Alex escribiendo a mano. Ruta fina (regla ui-api).
 *
 * Ventana de 24h: fuera de las 24h del ultimo mensaje de la candidata, Meta exige una plantilla aprobada
 * (de pago); el envio de texto libre puede ser rechazado por la API -> devolvemos sentToWhatsApp=false
 * (sin romper). El mensaje queda guardado igualmente para que Alex tenga el historial.
 */
const SendSchema = z.object({
  candidateId: z.string(),
  message: z.string().min(1)
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = SendSchema.safeParse(await request.json());
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
    // role "agent" + author "ALEX": misma convencion que la respuesta manual de Instagram (trazabilidad).
    role: "agent",
    author: "ALEX",
    content: parsed.data.message,
    createdAt: new Date(),
    metadata: { manual: true, channel: "whatsapp" }
  });

  const config = getWhatsAppConfig();
  let sentToWhatsApp = false;
  // Numero destino: el phone de la candidata o, si no, los digitos de la clave wa:<digitos>.
  const toPhone = candidate.phone?.replace(/\D/g, "") || candidate.instagramUsername.replace(/^wa:/, "");
  if (config.isConfigured && toPhone) {
    const provider = new GraphApiWhatsAppMessagingProvider(config);
    sentToWhatsApp = await provider.sendTextMessage(toPhone, parsed.data.message);
  }

  const messages = await repository.listMessages(candidate.id);
  return NextResponse.json({ ok: true, sentToWhatsApp, messages });
}
