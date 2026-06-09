export interface InstagramMessagingProvider {
  sendMessage(input: { instagramUsername: string; message: string }): Promise<void>;
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

