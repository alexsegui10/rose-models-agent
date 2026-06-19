export interface InstagramMessagingProvider {
  sendMessage(input: { instagramUsername: string; message: string }): Promise<void>;
  /**
   * Envía un texto al IGSID indicado. `options.humanAgentTag` (OPCIONAL) etiqueta el mensaje como
   * HUMAN_AGENT para poder escribir fuera de la ventana estándar de 24h (re-enganche). Sin él, envío
   * estándar (RESPONSE), como hacen las llamadas existentes del webhook.
   */
  sendTextMessage(recipientId: string, text: string, options?: { humanAgentTag?: boolean }): Promise<boolean>;
}

export interface InternalNotificationProvider {
  notifyHumanReview(input: { candidateId: string; reason: string }): Promise<void>;
}

export interface CalendarProvider {
  createCallSlot(input: { candidateId: string; startsAt: Date; phone: string }): Promise<{ eventId: string }>;
}

export interface VoiceAgentProvider {
  startCall(input: { candidateId: string; phone: string }): Promise<{ callId: string }>;
}

export interface ContractProvider {
  prepareContract(input: { candidateId: string }): Promise<{ contractId: string }>;
}

export interface WhatsAppProvider {
  sendMessage(input: { phone: string; message: string }): Promise<void>;
}
