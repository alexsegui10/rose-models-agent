// Import SOLO de tipo (se borra en compilación): el tipo ImportedConversation vive junto a su
// schema Zod en application/conversationImport.ts, igual que hace db/schema.ts. No crea ciclo en
// runtime porque ambos lados usan `import type`.
import type { ImportedConversation } from "@/application/conversationImport";
import type { NegotiationDecision } from "@/domain/businessKnowledge";
import type { Candidate, ConversationMessage, StateTransition } from "@/domain/candidate";
import type { ABEvaluationCase, ABWinner, EvaluationSession } from "@/domain/evaluation";
import type { AlexStyleRating, ApprovedResponse, ConversationFeedback } from "@/domain/styleEvaluation";

export interface CandidateRepository {
  findCandidateById(id: string): Promise<Candidate | null>;
  findCandidateByInstagram(instagramUsername: string): Promise<Candidate | null>;
  listCandidates(): Promise<Candidate[]>;
  /**
   * Instantes de inicio (ms UTC) de las llamadas YA agendadas (candidatas en CALL_SCHEDULED con
   * `scheduledCallStartMs` fijado). Lo usa el agendado determinista para no solapar dos llamadas.
   */
  listBookedCallStarts(): Promise<number[]>;
  /**
   * Candidatas candidatas a RE-ENGANCHE proactivo: inactivas (lastMessageAt <= idleSinceMs ms UTC),
   * NO en estados terminales/cerrados al re-enganche (CLOSED/REJECTED/CALL_SCHEDULED/CALL_COMPLETED) y
   * NO con control manual o automatizacion pausada. CALL_NO_ANSWER SI entra (para el reagendado tras 3
   * llamadas sin respuesta). El cron las filtra despues con `planOutreach`.
   */
  listCandidatesForOutreach(idleSinceMs: number): Promise<Candidate[]>;
  saveCandidate(candidate: Candidate): Promise<Candidate>;
  /**
   * Incrementa ATOMICAMENTE generationCancellationVersion y devuelve el nuevo valor. Atomico = dos turnos
   * concurrentes (webhook + reintento de Meta / flush) obtienen versiones DISTINTAS, no la misma; asi el
   * send-gate (canAutomationSend) deja pasar solo al turno mas nuevo y cancela el obsoleto, sin doble envio
   * (P1-4). NO es un read-modify-write (eso se pisa en concurrencia): postgres usa UPDATE ... +1 RETURNING;
   * in-memory lo hace sincrono (sin await entre leer y escribir). Lanza si la candidata no existe.
   */
  bumpGenerationVersion(id: string): Promise<number>;
  deleteCandidate(id: string): Promise<void>;
  listMessages(candidateId: string, limit?: number): Promise<ConversationMessage[]>;
  findMessageByExternalId(candidateId: string, externalMessageId: string): Promise<ConversationMessage | null>;
  addMessage(message: ConversationMessage): Promise<void>;
  listTransitions(candidateId: string): Promise<StateTransition[]>;
  addTransition(transition: StateTransition): Promise<void>;
  findApprovedNegotiationDecision(candidateId: string): Promise<NegotiationDecision | null>;
  saveNegotiationDecision(decision: NegotiationDecision): Promise<NegotiationDecision>;
}

export interface ConversationFeedbackRepository {
  saveFeedback(feedback: ConversationFeedback): Promise<ConversationFeedback>;
  listFeedback(candidateId?: string): Promise<ConversationFeedback[]>;
  saveApprovedResponse(response: ApprovedResponse): Promise<ApprovedResponse>;
  listApprovedResponses(): Promise<ApprovedResponse[]>;
}

export interface RecordABDecisionInput {
  id: string;
  winner: ABWinner;
  styleRating?: AlexStyleRating;
  note?: string;
}

export interface EvaluationRepository {
  saveABCase(abCase: ABEvaluationCase): Promise<ABEvaluationCase>;
  listABCases(): Promise<ABEvaluationCase[]>;
  /** Lanza `Error("AB evaluation not found.")` si el caso no existe. */
  recordABDecision(input: RecordABDecisionInput): Promise<ABEvaluationCase>;
  saveSession(session: EvaluationSession): Promise<EvaluationSession>;
  getSession(id: string): Promise<EvaluationSession | null>;
  listSessions(): Promise<EvaluationSession[]>;
}

export interface ImportedConversationRepository {
  /** Valida el JSON (schema + detección de PII) y persiste las conversaciones; upsert por id. */
  importJson(json: string): Promise<ImportedConversation[]>;
  list(): Promise<ImportedConversation[]>;
  get(id: string): Promise<ImportedConversation | null>;
}
