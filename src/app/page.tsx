"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildCandidatePanelRows } from "@/application/candidatePanelRows";
import { CRM_COLUMNS, crmColumnOf, needsHumanDecision, ringColorVar, stateColorVar, stateLabel } from "@/application/crmView";
import type { ImportedConversation } from "@/application/conversationImport";
import type { Candidate, ConversationMessage, ProfileVisibility, StateTransition } from "@/domain/candidate";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import type {
  ABEvaluationCase,
  ABWinner,
  EvaluationIssue,
  EvaluationSession,
  EvaluationSessionSummary,
  PlaybackTurn
} from "@/domain/evaluation";
import type { ConversationFeedbackStatus, StyleEvaluation } from "@/domain/styleEvaluation";

type SimulatorResponse = {
  candidate: Candidate;
  response: string;
  automationMode: string;
  deliveryStatus: string;
  draft?: DraftSummary;
  understanding: unknown;
  messages: ConversationMessage[];
  transitions: StateTransition[];
  retrievedExamples: RetrievedExample[];
  knowledgeEntries: RetrievedKnowledgeEntry[];
  responsePlan: ResponsePlanSummary;
  factualValidation: FactualValidationSummary;
  styleEvaluation: StyleEvaluation;
  styleContext: StyleContextVersions;
};

type DraftSummary = {
  response: string;
  provider: string;
  modelVersion: string;
  promptVersion: string;
  requestedProvider: string;
  actualProvider: string;
  requestedModel: string;
  actualModel: string;
  usedFallback: boolean;
  fallbackReason?: string | null;
  durationMs: number;
  retryCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  error?: string;
};

type RetrievedExample = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  qualityScore?: number;
  whyItIsGood: string[];
};

type StyleContextVersions = {
  promptVersion: string;
  styleProfileVersion: string;
  rulesVersion: string;
  retrieverVersion: string;
  modelVersion: string;
};

type RetrievedKnowledgeEntry = {
  id: string;
  title: string;
  category: string;
  version: string;
  requiresHumanReview: boolean;
};

type ResponsePlanSummary = {
  objective: string;
  knowledgeEntryIds: string[];
  knowledgeVersions: string[];
  revenueSharePolicyVersion: string | null;
  requiresHumanReview: boolean;
  humanReviewReason: string | null;
  uncoveredQuestion: boolean;
};

type FactualValidationSummary = {
  valid: boolean;
  reasons: string[];
  uncoveredInformation: boolean;
};

type SimulatorStatus = {
  persistenceMode: string;
  llmMode: string;
  writingModel: string;
};

type SimulatorTab = "DASHBOARD" | "EVALUACION" | "CHAT" | "CRM" | "AB" | "LLAMADAS";

type AdvanceAction = "PROFILE_FIT" | "PROFILE_NO_FIT" | "CONFIRM_CALL" | "PROFILE_OK" | "REJECT" | "FOLLOW_REQUEST_SENT";

// Modal reutilizable (sustituye window.prompt/confirm). onConfirm recibe el texto del input (o "").
type ModalState = {
  title: string;
  body?: string;
  hasInput?: boolean;
  inputPlaceholder?: string;
  defaultValue?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value: string) => void;
};

const EVALUATION_ISSUE_OPTIONS: EvaluationIssue[] = [
  "FACTUAL_ERROR",
  "STATE_ERROR",
  "REPETITION",
  "TOO_FORMAL",
  "TOO_LONG",
  "UNNECESSARY_QUESTION",
  "MISSED_REAL_QUESTION"
];

// Etiquetas en espanol del motivo de escalada, para mostrarlo en la tarjeta del CRM y que Alex decida
// sin abrir el chat.
const REVIEW_REASON_LABELS: Record<string, string> = {
  PROFILE_REVIEW: "Revisar perfil",
  PERCENTAGE_NEGOTIATION: "Negocia porcentaje",
  COMMERCIAL_EXCEPTION: "Pide excepción comercial",
  CONTRACT_QUESTION: "Duda de contrato",
  DATA_CONTRADICTION: "Dato contradictorio",
  OTHER: "Revisión humana"
};

// Confirmacion de feedback en espanol (el estado llega como enum en ingles).
const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  APPROVED: "aprobada",
  EDITED: "editada",
  REJECTED: "rechazada"
};

const CHAT_AUTHOR_LABELS: Record<string, string> = {
  candidate: "Candidata",
  agent: "Agente IA",
  alex: "Alex (tú)",
  system: "Sistema"
};

// Estilo inline de la pill de estado (color por estado, vía var CSS para respetar tema claro/oscuro).
function statePillStyle(state: Candidate["currentState"]): { color: string; background: string; border: string } {
  const colorVar = stateColorVar(state);
  return {
    color: `var(${colorVar})`,
    background: `color-mix(in srgb, var(${colorVar}) 12%, transparent)`,
    border: `1px solid color-mix(in srgb, var(${colorVar}) 33%, transparent)`
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<SimulatorTab>("DASHBOARD");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalInput, setModalInput] = useState("");
  // Ficha de candidata (drawer lateral): se abre al hacer clic en una tarjeta del CRM.
  const [drawerCandidate, setDrawerCandidate] = useState<Candidate | null>(null);
  const [drawerMessages, setDrawerMessages] = useState<ConversationMessage[]>([]);
  const [drawerTransitions, setDrawerTransitions] = useState<StateTransition[]>([]);
  const [drawerTab, setDrawerTab] = useState<"conversacion" | "ficha" | "llamada">("conversacion");
  const [drawerLoading, setDrawerLoading] = useState(false);
  // Auto-refresco ("en vivo"): refresca el tablero/ficha cada pocos segundos. Alex puede pausarlo.
  const [livePolling, setLivePolling] = useState(true);
  const [runtimeStatus, setRuntimeStatus] = useState<SimulatorStatus | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // Perfil de Instagram (foto + @usuario + enlace) resuelto por IGSID via la Graph API, para enriquecer
  // las tarjetas del CRM. Solo para candidatas reales (IGSID numerico); el simulador no tiene IGSID.
  const [igProfiles, setIgProfiles] = useState<
    Record<
      string,
      {
        username: string | null;
        profilePicUrl: string | null;
        profileUrl: string | null;
        followsBusiness: boolean | null;
        followerCount: number | null;
        isVerified: boolean | null;
        isPrivate: boolean | null;
      }
    >
  >({});
  const fetchedProfileIds = useRef<Set<string>>(new Set());
  const [crmNotice, setCrmNotice] = useState<string | null>(null);
  const [crmSearch, setCrmSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [transitions, setTransitions] = useState<StateTransition[]>([]);
  const [instagramUsername, setInstagramUsername] = useState("candidata_demo");
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>("PUBLIC");
  const [message, setMessage] = useState("Hola, me interesa. Tengo 22 anos y soy de Madrid.");
  const [loading, setLoading] = useState(false);
  const [retrievedExamples, setRetrievedExamples] = useState<RetrievedExample[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<RetrievedKnowledgeEntry[]>([]);
  const [responsePlan, setResponsePlan] = useState<ResponsePlanSummary | null>(null);
  const [factualValidation, setFactualValidation] = useState<FactualValidationSummary | null>(null);
  const [styleEvaluation, setStyleEvaluation] = useState<StyleEvaluation | null>(null);
  const [styleContext, setStyleContext] = useState<StyleContextVersions | null>(null);
  const [lastResult, setLastResult] = useState<SimulatorResponse | null>(null);
  const [editedResponse, setEditedResponse] = useState("");
  const [feedbackReason, setFeedbackReason] = useState("");
  const [styleRating, setStyleRating] = useState<string>("");
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [abMessages, setAbMessages] = useState("Hola, me interesa\nQue porcentaje seria?");
  const [abModelA, setAbModelA] = useState("gpt-5.4-nano");
  const [abModelB, setAbModelB] = useState("gpt-5.4-mini");
  const [abBlind, setAbBlind] = useState(true);
  const [abCase, setAbCase] = useState<ABEvaluationCase | null>(null);
  const [abWinner, setAbWinner] = useState<ABWinner>("TIE");
  const [abStyleRating, setAbStyleRating] = useState("");
  const [abNote, setAbNote] = useState("");
  const [abLoading, setAbLoading] = useState(false);
  const [evaluationSession, setEvaluationSession] = useState<EvaluationSession | null>(null);
  const [evalConversationId, setEvalConversationId] = useState("");
  const [evalModel, setEvalModel] = useState("gpt-5.4-mini");
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [turnIssues, setTurnIssues] = useState<Record<number, EvaluationIssue[]>>({});
  const [turnRatings, setTurnRatings] = useState<Record<number, string>>({});
  const [turnEdits, setTurnEdits] = useState<Record<number, string>>({});
  const [importJson, setImportJson] = useState(sampleImportJson);
  const [importedConversations, setImportedConversations] = useState<ImportedConversation[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [technicalPanelOpen, setTechnicalPanelOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const showDevelopmentPanel = process.env.NODE_ENV !== "production";

  // Tema claro/oscuro: inicializa desde localStorage y aplica el atributo en <html>.
  useEffect(() => {
    const saved = window.localStorage.getItem("rm-theme");
    const initial = saved === "light" || saved === "dark" ? saved : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  useEffect(() => {
    void refreshCandidates();
    void fetch("/api/simulator/status")
      .then((response) => response.json())
      .then((data: SimulatorStatus) => setRuntimeStatus(data));
    void fetch("/api/simulator/conversation-import")
      .then((response) => response.json())
      .then((data: { conversations: ImportedConversation[] }) => {
        setImportedConversations(data.conversations);
        if (data.conversations[0]) {
          setEvalConversationId(data.conversations[0].id);
        }
      });
  }, []);

  // Tiempo real (auto-refresco). SOLO LECTURA: refresca el tablero y, si el drawer esta abierto, su
  // conversacion; nunca decide flujo ni muta estado (invariante 1). Se pausa durante un envio en curso
  // (loading) para no pisarlo, si Alex lo pausa, o si la pestaña no esta visible (ahorra peticiones).
  // Solo activo en el CRM o con la ficha abierta, que es donde importa ver los cambios en vivo.
  useEffect(() => {
    if (!livePolling) return;
    if (activeTab !== "CRM" && activeTab !== "DASHBOARD" && activeTab !== "LLAMADAS" && !drawerCandidate) return;
    const interval = setInterval(() => {
      if (loading) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshCandidates();
      if (drawerCandidate) {
        void fetch(`/api/candidates/${drawerCandidate.id}/conversation`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data: { messages: ConversationMessage[]; transitions: StateTransition[] } | null) => {
            if (data) {
              setDrawerMessages(data.messages ?? []);
              setDrawerTransitions(data.transitions ?? []);
            }
          })
          .catch(() => undefined);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [livePolling, activeTab, drawerCandidate, loading]);

  // Resuelve foto/@usuario/enlace de las candidatas reales (IGSID) una sola vez cada una. El ref evita
  // refetch y bucles de dependencia; el fallo es silencioso (la tarjeta cae al avatar de inicial).
  useEffect(() => {
    const pending = candidates.filter(
      (candidate) => /^\d{5,}$/.test(candidate.instagramUsername) && !fetchedProfileIds.current.has(candidate.instagramUsername)
    );
    if (pending.length === 0) return;
    pending.forEach((candidate) => fetchedProfileIds.current.add(candidate.instagramUsername));
    void Promise.all(
      pending.map(async (candidate) => {
        try {
          const response = await fetch(`/api/instagram/profile?id=${encodeURIComponent(candidate.instagramUsername)}`);
          const data = (await response.json()) as {
            ok: boolean;
            username?: string | null;
            profilePicUrl?: string | null;
            profileUrl?: string | null;
            followsBusiness?: boolean | null;
            followerCount?: number | null;
            isVerified?: boolean | null;
            isPrivate?: boolean | null;
          };
          const empty = {
            username: null,
            profilePicUrl: null,
            profileUrl: null,
            followsBusiness: null,
            followerCount: null,
            isVerified: null,
            isPrivate: null
          };
          return [
            candidate.instagramUsername,
            data.ok
              ? {
                  username: data.username ?? null,
                  profilePicUrl: data.profilePicUrl ?? null,
                  profileUrl: data.profileUrl ?? null,
                  followsBusiness: data.followsBusiness ?? null,
                  followerCount: data.followerCount ?? null,
                  isVerified: data.isVerified ?? null,
                  isPrivate: data.isPrivate ?? null
                }
              : { ...empty, isPrivate: data.isPrivate ?? null }
          ] as const;
        } catch {
          return [
            candidate.instagramUsername,
            {
              username: null,
              profilePicUrl: null,
              profileUrl: null,
              followsBusiness: null,
              followerCount: null,
              isVerified: null,
              isPrivate: null
            }
          ] as const;
        }
      })
    ).then((entries) => setIgProfiles((previous) => ({ ...previous, ...Object.fromEntries(entries) })));
  }, [candidates]);

  const currentCandidate = selectedCandidate;
  const extractedRows = useMemo(() => buildCandidatePanelRows(currentCandidate), [currentCandidate]);
  const selectedImportedConversation =
    importedConversations.find((conversation) => conversation.id === evalConversationId) ?? null;

  async function refreshCandidates() {
    const response = await fetch("/api/candidates");
    const data = (await response.json()) as { candidates: Candidate[] };
    setCandidates(data.candidates);
  }

  // Carga candidatas de demo (para ver el tablero/dashboard llenos sin Instagram). Idempotente.
  async function seedDemo() {
    try {
      const response = await fetch("/api/simulator/seed-demo", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { seeded?: number; error?: string };
      if (!response.ok) {
        setCrmNotice(
          response.status === 404
            ? "La función de demo aún no está disponible (espera a que Vercel termine de desplegar y reintenta)."
            : `No se pudieron cargar las candidatas de demo (${response.status}). ${data.error ?? ""}`.trim()
        );
        return;
      }
      await refreshCandidates();
      setCrmNotice(`Cargadas ${data.seeded ?? 0} candidatas de demo.`);
    } catch (error) {
      setCrmNotice(`No se pudieron cargar las candidatas de demo: ${error instanceof Error ? error.message : "error de red"}.`);
    }
  }

  async function importConversations() {
    const response = await fetch("/api/simulator/conversation-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: importJson })
    });
    const data = (await response.json()) as { conversations?: ImportedConversation[]; error?: string };
    if (!response.ok) {
      setImportStatus(data.error ?? "Importacion no valida.");
      return;
    }

    const conversations = data.conversations ?? [];
    setImportedConversations(conversations);
    setEvalConversationId(conversations[0]?.id ?? evalConversationId);
    setImportStatus(`${conversations.length} conversaciones importadas.`);
  }

  async function sendMessage() {
    setLoading(true);
    setSendError(null);

    try {
      // La candidata puede escribir varios mensajes en un turno separandolos con una linea en blanco;
      // se envian como varios y el motor los agrupa (responde una vez). Uno solo = caso normal.
      const parts = message
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const base = { candidateId: selectedCandidate?.id, instagramUsername, profileVisibility };
      const payload = parts.length > 1 ? { ...base, messages: parts } : { ...base, message };
      const response = await fetch("/api/simulator/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await response.json()) as Partial<SimulatorResponse> & { error?: string };

      if (!response.ok || !data.candidate) {
        setSendError(formatApiError(data.error));
        return;
      }

      setSelectedCandidate(data.candidate);
      setInstagramUsername(data.candidate.instagramUsername);
      setMessages(data.messages ?? []);
      setTransitions(data.transitions ?? []);
      setRetrievedExamples(data.retrievedExamples ?? []);
      setKnowledgeEntries(data.knowledgeEntries ?? []);
      setResponsePlan(data.responsePlan ?? null);
      setFactualValidation(data.factualValidation ?? null);
      setStyleEvaluation(data.styleEvaluation ?? null);
      setStyleContext(data.styleContext ?? null);
      setLastResult(data as SimulatorResponse);
      setEditedResponse(data.response ?? "");
      setFeedbackStatus(null);
      setMessage("");
      await refreshCandidates();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "No se pudo enviar el mensaje.");
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(status: ConversationFeedbackStatus) {
    const lastAgentMessage = [...messages].reverse().find((item) => item.role === "agent");
    if (!selectedCandidate || !lastAgentMessage || !styleContext) {
      return;
    }

    await fetch("/api/simulator/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: selectedCandidate.id,
        messageId: lastAgentMessage.id,
        status,
        originalResponse: lastAgentMessage.content,
        editedResponse: status === "EDITED" ? editedResponse : undefined,
        reason: feedbackReason || undefined,
        styleRating: styleRating ? Number(styleRating) : undefined,
        state: selectedCandidate.currentState,
        contextSnapshot: JSON.stringify(lastResult ?? styleContext),
        modelVersion: lastResult?.draft?.modelVersion
      })
    });
    setFeedbackStatus(status);
  }

  async function takeManualControl() {
    if (!selectedCandidate) return;

    const response = await fetch("/api/simulator/manual-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: selectedCandidate.id,
        manualControlActive: true
      })
    });
    const data = (await response.json()) as { candidate: Candidate };
    setSelectedCandidate(data.candidate);
    setFeedbackStatus("TAKEN_OVER");
    await refreshCandidates();
  }

  async function setBotPaused(candidate: Candidate, paused: boolean) {
    // El bot se pausa/reanuda por candidata (peticion de Alex #3). manual-control fija ambos flags.
    await fetch("/api/simulator/manual-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, manualControlActive: paused })
    });
    setCrmNotice(
      paused ? `Bot pausado para @${candidate.instagramUsername}.` : `Bot reanudado para @${candidate.instagramUsername}.`
    );
    const pausedCandidate = { ...candidate, manualControlActive: paused, automationPaused: paused };
    if (selectedCandidate?.id === candidate.id) {
      setSelectedCandidate(pausedCandidate);
    }
    if (drawerCandidate?.id === candidate.id) {
      setDrawerCandidate(pausedCandidate);
    }
    await refreshCandidates();
  }

  async function applyHumanDecision(candidate: Candidate, decision: "APPROVE" | "REJECT") {
    // Decision humana explicita (invariante 4). Al aprobar, el bot propone la llamada (peticion #5).
    const response = await fetch("/api/simulator/human-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, decision })
    });
    if (!response.ok) {
      setCrmNotice("No se pudo aplicar la decision.");
      return;
    }
    const data = (await response.json()) as { candidate: Candidate; proposedMessage: string | null };
    if (decision === "APPROVE") {
      setCrmNotice(
        data.proposedMessage
          ? `Aprobada @${candidate.instagramUsername}. El bot propuso: "${data.proposedMessage.replace(/\n+/g, " ")}"`
          : `@${candidate.instagramUsername} no estaba en revision: sin cambios.`
      );
    } else {
      setCrmNotice(`@${candidate.instagramUsername} marcada como rechazada.`);
    }
    if (selectedCandidate?.id === candidate.id) {
      setSelectedCandidate(data.candidate);
    }
    if (drawerCandidate?.id === candidate.id) {
      setDrawerCandidate(data.candidate);
    }
    await refreshCandidates();
  }

  function openModal(next: ModalState) {
    setModalInput(next.defaultValue ?? "");
    setModal(next);
  }

  async function openDrawer(candidate: Candidate) {
    setDrawerCandidate(candidate);
    setDrawerTab("conversacion");
    setDrawerMessages([]);
    setDrawerTransitions([]);
    setDrawerLoading(true);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/conversation`);
      if (response.ok) {
        const data = (await response.json()) as {
          messages: ConversationMessage[];
          transitions: StateTransition[];
        };
        setDrawerMessages(data.messages ?? []);
        setDrawerTransitions(data.transitions ?? []);
      }
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerCandidate(null);
  }

  // Selecciona una candidata en el chat y carga su conversacion real (mensajes + transiciones).
  async function loadChatCandidate(candidate: Candidate) {
    setSelectedCandidate(candidate);
    setInstagramUsername(candidate.instagramUsername);
    setProfileVisibility(candidate.declaredProfileVisibility);
    setMessage("");
    setFeedbackStatus(null);
    setLastResult(null);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/conversation`);
      if (response.ok) {
        const data = (await response.json()) as { messages: ConversationMessage[]; transitions: StateTransition[] };
        setMessages(data.messages ?? []);
        setTransitions(data.transitions ?? []);
      }
    } catch {
      /* silencioso: si falla, se queda la conversacion actual */
    }
  }

  function sendManualReply(candidate: Candidate) {
    // Responder a mano a una candidata (escalada o pausada). Abre un modal; al confirmar se persiste como
    // mensaje de Alex y se envia a Instagram si la integracion esta activa.
    openModal({
      title: `Responder a @${candidate.instagramUsername}`,
      body: "Se envía a Instagram si la integración está activa.",
      hasInput: true,
      inputPlaceholder: "Escribe tu respuesta…",
      confirmLabel: "Enviar",
      onConfirm: (text) => {
        if (text.trim()) void doSendManualReply(candidate, text.trim());
      }
    });
  }

  async function doSendManualReply(candidate: Candidate, text: string) {
    const response = await fetch("/api/simulator/manual-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, message: text.trim() })
    });
    if (!response.ok) {
      setCrmNotice("No se pudo enviar la respuesta.");
      return;
    }
    const data = (await response.json()) as { sentToInstagram: boolean };
    setCrmNotice(
      data.sentToInstagram
        ? `Respuesta enviada a @${candidate.instagramUsername} por Instagram.`
        : `Respuesta guardada para @${candidate.instagramUsername} (Instagram no conectado todavia).`
    );
    await refreshCandidates();
  }

  function advanceStage(candidate: Candidate, action: AdvanceAction) {
    // CONFIRM_CALL pide la hora y REJECT pide confirmacion (mediante modal); el resto se aplica directo.
    if (action === "CONFIRM_CALL") {
      openModal({
        title: "Confirmar llamada",
        body: `Confirmar la llamada con @${candidate.instagramUsername}. La hora es opcional.`,
        hasInput: true,
        inputPlaceholder: "Hora acordada, p. ej. el lunes a las 18h",
        confirmLabel: "Confirmar llamada",
        onConfirm: (slot) => void doAdvanceStage(candidate, "CONFIRM_CALL", slot.trim() || undefined)
      });
      return;
    }
    if (action === "REJECT") {
      // Rechazar silencia el bot (deja de responder, sin gastar OpenAI): confirmar para evitar clics por error.
      openModal({
        title: `¿Rechazar a @${candidate.instagramUsername}?`,
        body: "El bot dejará de responderle.",
        danger: true,
        confirmLabel: "Rechazar",
        onConfirm: () => void doAdvanceStage(candidate, "REJECT")
      });
      return;
    }
    void doAdvanceStage(candidate, action);
  }

  async function doAdvanceStage(candidate: Candidate, action: AdvanceAction, slot?: string) {
    const response = await fetch("/api/simulator/advance-stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, action, slot })
    });
    if (!response.ok) {
      setCrmNotice("No se pudo aplicar la accion.");
      return;
    }
    const data = (await response.json()) as { candidate: Candidate; proposedMessage: string | null };
    const labels: Record<typeof action, string> = {
      PROFILE_FIT: `Perfil de @${candidate.instagramUsername} verificado: sigue la cualificacion.`,
      PROFILE_NO_FIT: `@${candidate.instagramUsername} descartada en la revision de perfil.`,
      CONFIRM_CALL: `Llamada confirmada para @${candidate.instagramUsername}.`,
      PROFILE_OK: `Perfil de @${candidate.instagramUsername} marcado como OK.`,
      REJECT: `@${candidate.instagramUsername} rechazada: el bot deja de responderle.`,
      FOLLOW_REQUEST_SENT: `Solicitud enviada a @${candidate.instagramUsername}: el bot deja de pedirla y pasa a revision de perfil.`
    };
    // Si el motor no aplico nada (estado incompatible), no mentir con un aviso de exito. PROFILE_OK puede
    // no cambiar de estado pero si marcar el perfil como OK: eso tambien cuenta como aplicado.
    const profileFlagChanged = data.candidate.humanProfileReviewStatus !== candidate.humanProfileReviewStatus;
    const appliedNothing =
      !data.proposedMessage &&
      data.candidate.currentState === candidate.currentState &&
      !(action === "PROFILE_OK" && profileFlagChanged);
    if (appliedNothing) {
      setCrmNotice(`Sin cambios para @${candidate.instagramUsername}: la accion no aplica en su estado actual.`);
    } else {
      setCrmNotice(
        data.proposedMessage
          ? `${labels[action]} El bot escribio: "${data.proposedMessage.replace(/\n+/g, " ")}"`
          : labels[action]
      );
    }
    if (selectedCandidate?.id === candidate.id) {
      setSelectedCandidate(data.candidate);
    }
    if (drawerCandidate?.id === candidate.id) {
      setDrawerCandidate(data.candidate);
    }
    await refreshCandidates();
  }

  async function runABComparison() {
    const messagesForRun = abMessages
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (messagesForRun.length === 0) return;

    setAbLoading(true);
    const response = await fetch("/api/simulator/ab-evaluation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messagesForRun,
        profileVisibility,
        modelA: abModelA,
        modelB: abModelB,
        blind: abBlind
      })
    });
    const data = (await response.json()) as { case: ABEvaluationCase };
    setAbCase(data.case);
    setAbWinner("TIE");
    setAbStyleRating("");
    setAbNote("");
    setAbLoading(false);
  }

  async function saveABDecision() {
    if (!abCase) return;

    const response = await fetch("/api/simulator/ab-evaluation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: abCase.id,
        winner: abWinner,
        styleRating: abStyleRating ? Number(abStyleRating) : undefined,
        note: abNote || undefined
      })
    });
    const data = (await response.json()) as { case: ABEvaluationCase };
    setAbCase(data.case);
  }

  async function playConversationSession() {
    if (!evalConversationId) {
      setEvalError("Selecciona una conversacion importada primero.");
      return;
    }

    setEvalLoading(true);
    setEvalError(null);
    try {
      const response = await fetch("/api/simulator/evaluation-session/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: evalConversationId,
          model: evalModel
        })
      });
      const data = (await response.json()) as { session?: EvaluationSession; error?: unknown };
      if (!response.ok || !data.session) {
        setEvalError(formatApiError(data.error));
        return;
      }

      const suggestedIssues: Record<number, EvaluationIssue[]> = {};
      const generatedEdits: Record<number, string> = {};
      for (const turn of data.session.playbackTurns ?? []) {
        suggestedIssues[turn.turnIndex] = turn.suggestedIssues;
        generatedEdits[turn.turnIndex] = turn.generatedResponse;
      }
      setTurnIssues(suggestedIssues);
      setTurnEdits(generatedEdits);
      setTurnRatings({});
      setEvaluationSession(data.session);
    } catch (error) {
      setEvalError(error instanceof Error ? error.message : "No se pudo reproducir la conversacion.");
    } finally {
      setEvalLoading(false);
    }
  }

  async function savePlaybackTurnFeedback(turn: PlaybackTurn, status: ConversationFeedbackStatus) {
    if (!evaluationSession || !turn.generatedResponse) return;

    const rating = turnRatings[turn.turnIndex];
    const response = await fetch("/api/simulator/evaluation-session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: evaluationSession.id,
        turnIndex: turn.turnIndex,
        status,
        originalResponse: turn.generatedResponse,
        editedResponse: status === "EDITED" ? (turnEdits[turn.turnIndex] ?? turn.generatedResponse) : undefined,
        styleRating: rating ? Number(rating) : undefined,
        issues: turnIssues[turn.turnIndex] ?? []
      })
    });
    const data = (await response.json()) as { session?: EvaluationSession; error?: unknown };
    if (!response.ok || !data.session) {
      setEvalError(formatApiError(data.error));
      return;
    }
    setEvalError(null);
    setEvaluationSession(data.session);
  }

  function toggleTurnIssue(turnIndex: number, issue: EvaluationIssue, checked: boolean) {
    setTurnIssues((current) => {
      const currentIssues = current[turnIndex] ?? [];
      return {
        ...current,
        [turnIndex]: checked ? [...currentIssues, issue] : currentIssues.filter((item) => item !== issue)
      };
    });
  }

  return (
    <div className="app-frame">
      <header className="top-bar">
        <div>
          <h1>Rose Models Agent</h1>
          <p className="muted">Simulador local sin Instagram real.</p>
        </div>
        <nav className="tab-bar">
          <button
            className={activeTab === "DASHBOARD" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("DASHBOARD")}
          >
            Resumen
          </button>
          <button
            className={activeTab === "CRM" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("CRM")}
          >
            CRM
          </button>
          <button
            className={activeTab === "LLAMADAS" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("LLAMADAS")}
          >
            Llamadas
          </button>
          <button
            className={activeTab === "CHAT" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("CHAT")}
          >
            Chat de prueba
          </button>
          <button
            className={activeTab === "EVALUACION" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("EVALUACION")}
          >
            Evaluacion
          </button>
          <button
            className={activeTab === "AB" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("AB")}
          >
            A/B de modelos
          </button>
        </nav>
        <button
          type="button"
          className="theme-toggle"
          aria-label="Cambiar tema claro u oscuro"
          title={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            setTheme(next);
            document.documentElement.dataset.theme = next;
            window.localStorage.setItem("rm-theme", next);
          }}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <p className="status-bar">
          Persistencia: {runtimeStatus?.persistenceMode ?? "..."} · IA: {runtimeStatus?.llmMode ?? "..."} (
          {runtimeStatus?.writingModel ?? "..."})
        </p>
      </header>

      {activeTab === "DASHBOARD"
        ? (() => {
            // Todo se DERIVA de las candidatas actuales (sin histórico): conteos reales, nada inventado.
            const epochOf = (value?: Date | string): number => {
              if (!value) return 0;
              const time = new Date(value).getTime();
              return Number.isNaN(time) ? 0 : time;
            };
            const relTime = (value?: Date | string): string => {
              const time = epochOf(value);
              if (!time) return "";
              const minutes = Math.round((Date.now() - time) / 60000);
              if (minutes < 1) return "justo ahora";
              if (minutes < 60) return `hace ${minutes} min`;
              const hours = Math.round(minutes / 60);
              if (hours < 24) return `hace ${hours} h`;
              return `hace ${Math.round(hours / 24)} d`;
            };
            const countStates = (states: Candidate["currentState"][]): number =>
              candidates.filter((item) => states.includes(item.currentState)).length;
            const total = candidates.length;
            const active = candidates.filter(
              (item) =>
                !item.manualControlActive &&
                !item.automationPaused &&
                item.currentState !== "REJECTED" &&
                item.currentState !== "CLOSED"
            ).length;
            const pendingList = candidates.filter((item) => needsHumanDecision(item));
            // Embudo de 6 fases (la "decisión" se separa visualmente del resto de cualificación).
            const funnel = (
              [
                { label: "Nuevas", colorVar: "--faint", states: ["NEW_LEAD", "WAITING_PROFILE_ACCESS"] },
                { label: "Cualificando", colorVar: "--accent", states: ["QUALIFYING"] },
                {
                  label: "Tu decisión",
                  colorVar: "--warn",
                  states: ["PROFILE_READY_FOR_REVIEW", "WAITING_HUMAN_REVIEW", "HUMAN_INTERVENTION_REQUIRED"]
                },
                {
                  label: "Agenda",
                  colorVar: "--info",
                  states: ["APPROVED", "COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "CALL_SCHEDULED"]
                },
                { label: "Llamadas", colorVar: "--purple", states: ["CALL_IN_PROGRESS", "CALL_COMPLETED", "CALL_NO_ANSWER"] },
                { label: "Cerradas", colorVar: "--faint", states: ["REJECTED", "CLOSED"] }
              ] as { label: string; colorVar: string; states: Candidate["currentState"][] }[]
            ).map((phase) => ({ ...phase, count: countStates(phase.states) }));
            const funnelMax = Math.max(1, ...funnel.map((phase) => phase.count));
            const agendaCount = funnel[3].count;
            const llamadasCount = funnel[4].count;
            const cerradasCount = funnel[5].count;
            const todayCalls = candidates.filter(
              (item) =>
                item.currentState === "CALL_IN_PROGRESS" ||
                (item.scheduledCallSlot ? /hoy|ahora/i.test(item.scheduledCallSlot) : false)
            );
            const pct = (value: number): string => (total > 0 ? `${Math.round((value / total) * 100)}%` : "—");
            const recent = [...candidates].sort((a, b) => epochOf(b.lastMessageAt) - epochOf(a.lastMessageAt)).slice(0, 6);
            const initialOf = (item: Candidate): string =>
              (item.firstName?.trim() || item.instagramUsername || "?").charAt(0).toUpperCase();
            return (
              <section className="panel">
                <div className="dash2-head">
                  <div>
                    <h2 className="dash2-greeting">Buenas, Alex 👋</h2>
                    <p className="dash2-subtitle">Esto es lo que pasa en tu embudo ahora mismo.</p>
                  </div>
                  {total === 0 ? (
                    <button className="dash2-waiting-btn" type="button" onClick={() => void seedDemo()}>
                      Cargar candidatas de demo
                    </button>
                  ) : (
                    <button className="dash2-waiting-btn" type="button" onClick={() => setActiveTab("CRM")}>
                      ⚠️ {pendingList.length} {pendingList.length === 1 ? "espera" : "esperan"} tu decisión
                    </button>
                  )}
                </div>

                <div className="dash2-kpi-row">
                  {(
                    [
                      { label: "Te esperan", value: pendingList.length, colorVar: "--warn", icon: "⚠️" },
                      { label: "Activas", value: active, colorVar: "--accent", icon: "⚡" },
                      { label: "Llamadas hoy", value: todayCalls.length, colorVar: "--purple", icon: "📞" },
                      { label: "Total candidatas", value: total, colorVar: "--info", icon: "👥" }
                    ] as { label: string; value: number; colorVar: string; icon: string }[]
                  ).map((kpi) => (
                    <div className="dash2-kpi" key={kpi.label}>
                      <div
                        className="dash2-kpi-glow"
                        style={{
                          background: `radial-gradient(120px 80px at 90% 0, color-mix(in srgb, var(${kpi.colorVar}) 16%, transparent), transparent)`
                        }}
                      />
                      <div className="dash2-kpi-top">
                        <span className="dash2-kpi-label">{kpi.label}</span>
                        <span
                          className="dash2-kpi-icon"
                          style={{
                            background: `color-mix(in srgb, var(${kpi.colorVar}) 16%, transparent)`,
                            color: `var(${kpi.colorVar})`
                          }}
                        >
                          {kpi.icon}
                        </span>
                      </div>
                      <div className="dash2-kpi-valrow">
                        <span className="dash2-kpi-value" style={{ color: `var(${kpi.colorVar})` }}>
                          {kpi.value}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="dash2-stack">
                  <div className="dash2-card">
                    <div className="dash2-card-head">
                      <h3 className="dash2-card-title">Embudo de candidatas</h3>
                      <span className="dash2-card-meta">{total} en total</span>
                    </div>
                    <div className="dash2-funnel-list">
                      {funnel.map((phase) => (
                        <div
                          key={phase.label}
                          className="dash2-funnel-row"
                          onClick={() => setActiveTab(phase.label === "Llamadas" ? "LLAMADAS" : "CRM")}
                        >
                          <span className="dash2-funnel-label">{phase.label}</span>
                          <div className="dash2-funnel-track">
                            <div
                              className="dash2-funnel-bar"
                              style={{
                                width: `${Math.round((phase.count / funnelMax) * 100)}%`,
                                background: `linear-gradient(90deg, var(${phase.colorVar}), color-mix(in srgb, var(${phase.colorVar}) 60%, transparent))`,
                                boxShadow: `0 0 16px color-mix(in srgb, var(${phase.colorVar}) 33%, transparent)`
                              }}
                            />
                          </div>
                          <span className="dash2-funnel-count">{phase.count}</span>
                        </div>
                      ))}
                    </div>
                    <div className="dash2-conv">
                      <div className="dash2-conv-cell">
                        <div className="dash2-conv-label">Activas</div>
                        <div className="dash2-conv-value">{pct(active)}</div>
                      </div>
                      <div className="dash2-conv-cell">
                        <div className="dash2-conv-label">En llamadas</div>
                        <div className="dash2-conv-value">{pct(llamadasCount)}</div>
                      </div>
                      <div className="dash2-conv-cell">
                        <div className="dash2-conv-label">Cerradas</div>
                        <div className="dash2-conv-value">{pct(cerradasCount)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="dash2-right">
                    <div className="dash2-card dash2-card--pad18">
                      <div className="dash2-card-head">
                        <h3 className="dash2-card-title">Llamadas de hoy</h3>
                        <button className="dash2-link-btn" type="button" onClick={() => setActiveTab("LLAMADAS")}>
                          Ver todas →
                        </button>
                      </div>
                      <div className="dash2-calls-list">
                        {todayCalls.length === 0 ? (
                          <div className="dash2-empty">Sin llamadas para hoy.</div>
                        ) : (
                          todayCalls.map((item) => (
                            <div key={item.id} className="dash2-call" onClick={() => void openDrawer(item)}>
                              <span className="dash2-avatar" style={{ background: `var(${ringColorVar(item)})` }}>
                                {initialOf(item)}
                              </span>
                              <div className="dash2-call-body">
                                <div className="dash2-call-name">{item.firstName?.trim() || `@${item.instagramUsername}`}</div>
                                <div className="dash2-call-slot">{item.scheduledCallSlot || "en curso"}</div>
                              </div>
                              <span
                                style={{
                                  flex: "none",
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: "3px 9px",
                                  borderRadius: 999,
                                  whiteSpace: "nowrap",
                                  color: `var(${stateColorVar(item.currentState)})`,
                                  background: `color-mix(in srgb, var(${stateColorVar(item.currentState)}) 12%, transparent)`,
                                  border: `1px solid color-mix(in srgb, var(${stateColorVar(item.currentState)}) 33%, transparent)`
                                }}
                              >
                                {stateLabel(item.currentState)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="dash2-card dash2-card--pad18">
                      <h3 className="dash2-activity-title">Actividad reciente</h3>
                      {recent.length === 0 ? (
                        <div className="dash2-empty">Sin actividad todavía.</div>
                      ) : (
                        <div className="dash2-activity-list">
                          {recent.map((item, index) => (
                            <div
                              key={item.id}
                              className="dash2-act-row"
                              onClick={() => void openDrawer(item)}
                              style={{ cursor: "pointer" }}
                            >
                              <div className="dash2-act-rail">
                                <span
                                  className="dash2-act-dot"
                                  style={{
                                    background: `var(${stateColorVar(item.currentState)})`,
                                    boxShadow: `0 0 8px color-mix(in srgb, var(${stateColorVar(item.currentState)}) 60%, transparent)`
                                  }}
                                />
                                {index < recent.length - 1 ? <span className="dash2-act-line" /> : null}
                              </div>
                              <div className="dash2-act-body">
                                <div className="dash2-act-text">
                                  <strong>{item.firstName?.trim() || `@${item.instagramUsername}`}</strong> ·{" "}
                                  {stateLabel(item.currentState)}
                                </div>
                                <div className="dash2-act-time">{relTime(item.lastMessageAt)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {pendingList.length > 0 ? (
                  <div className="dash2-pending-card">
                    <div className="dash2-pending-head">
                      <span className="dash2-pending-badge">⚠️</span>
                      <h3 className="dash2-card-title">Pendientes de tu decisión</h3>
                    </div>
                    <div className="dash2-pending-grid">
                      {pendingList.map((item) => (
                        <div key={item.id} className="dash2-pending-item" onClick={() => void openDrawer(item)}>
                          <span className="dash2-pending-avatar" style={{ background: `var(${ringColorVar(item)})` }}>
                            {initialOf(item)}
                          </span>
                          <div className="dash2-pending-body">
                            <div className="dash2-pending-name">{item.firstName?.trim() || `@${item.instagramUsername}`}</div>
                            <div className="dash2-pending-reason">
                              {item.humanReviewReason
                                ? (REVIEW_REASON_LABELS[item.humanReviewReason] ?? item.humanReviewReason)
                                : stateLabel(item.currentState)}
                            </div>
                          </div>
                          <span className="dash2-pending-arrow">→</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })()
        : null}

      {activeTab === "LLAMADAS"
        ? (() => {
            // Todo derivado de las candidatas: las hechas (lastCall), las agendadas/en curso, y metricas.
            const done = candidates.filter((item) => item.lastCall);
            const completed = done.filter((item) => item.lastCall?.result === "COMPLETED").length;
            const noAnswer = done.filter((item) => item.lastCall?.result === "NO_ANSWER").length;
            const shares = done
              .map((item) => item.lastCall?.negotiatedModelShare)
              .filter((share): share is number => typeof share === "number");
            const avgShare = shares.length ? Math.round(shares.reduce((a, b) => a + b, 0) / shares.length) : null;
            const upcoming = candidates.filter(
              (item) => !item.lastCall && (item.currentState === "CALL_SCHEDULED" || Boolean(item.scheduledCallSlot))
            );
            const formatDuration = (seconds?: number): string =>
              seconds != null ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : "—";
            return (
              <section className="panel dashboard">
                <div>
                  <h2>Llamadas</h2>
                  <p className="muted">
                    El bot de voz llama, explica la agencia, negocia el reparto y te pasa las que lo necesitan.
                  </p>
                </div>
                <div className="dash-kpis">
                  <div className="dash-kpi">
                    <span className="dash-kpi-label">Llamadas hechas</span>
                    <b>{done.length}</b>
                  </div>
                  <div className="dash-kpi">
                    <span className="dash-kpi-label">Completadas</span>
                    <b>{completed}</b>
                  </div>
                  <div className="dash-kpi">
                    <span className="dash-kpi-label">No contestaron</span>
                    <b>{noAnswer}</b>
                  </div>
                  <div className="dash-kpi">
                    <span className="dash-kpi-label">Reparto medio</span>
                    <b>{avgShare != null ? `${avgShare}%` : "—"}</b>
                  </div>
                </div>
                <div className="dash-stack">
                  <div className="dash-card">
                    <h3>Llamadas recientes</h3>
                    {done.length === 0 ? (
                      <p className="muted">Aún no se ha registrado ninguna llamada.</p>
                    ) : (
                      done.map((item) => (
                        <button key={item.id} type="button" className="dash-list-row" onClick={() => void openDrawer(item)}>
                          <span className="dash-list-name">{item.firstName?.trim() || `@${item.instagramUsername}`}</span>
                          <span className="call-row-meta">
                            <span className="call-row-info">
                              {formatDuration(item.lastCall?.durationSec)}
                              {item.lastCall?.negotiatedModelShare != null ? ` · ${item.lastCall.negotiatedModelShare}%` : ""}
                            </span>
                            <span
                              className={
                                item.lastCall?.result === "COMPLETED" ? "dash-list-state call-ok" : "dash-list-state call-no"
                              }
                            >
                              {item.lastCall?.result === "COMPLETED" ? "Completada" : "No contestó"}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="dash-card">
                    <h3>Agendadas / por llamar</h3>
                    {upcoming.length === 0 ? (
                      <p className="muted">Nada agendado. Aprueba candidatas y agéndalas desde el CRM.</p>
                    ) : (
                      upcoming.map((item) => (
                        <button key={item.id} type="button" className="dash-list-row" onClick={() => void openDrawer(item)}>
                          <span className="dash-list-name">{item.firstName?.trim() || `@${item.instagramUsername}`}</span>
                          <span className="dash-list-state">{item.scheduledCallSlot || stateLabel(item.currentState)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </section>
            );
          })()
        : null}

      {activeTab === "EVALUACION" ? (
        <section className="panel eval-panel">
          <h2>Evaluacion de conversaciones importadas</h2>
          <p className="muted">Selecciona una conversacion, reproducela con el modelo elegido y evalua cada turno generado.</p>

          {importedConversations.length === 0 ? (
            <p className="muted">
              No hay conversaciones importadas todavia. Ejecuta npm run import:replay o usa el bloque Importar mas conversaciones
              (JSON) de abajo.
            </p>
          ) : (
            <div className="conversation-card-list">
              {importedConversations.map((conversation) => (
                <button
                  className={conversation.id === evalConversationId ? "conversation-card selected" : "conversation-card"}
                  key={conversation.id}
                  type="button"
                  onClick={() => setEvalConversationId(conversation.id)}
                >
                  <strong>{conversation.id}</strong>
                  <span className="muted">{conversation.category}</span>
                  <span className="muted">{conversation.messages.length} mensajes</span>
                </button>
              ))}
            </div>
          )}

          <div className="row">
            <input
              className="field"
              value={evalModel}
              onChange={(event) => setEvalModel(event.target.value)}
              placeholder="Modelo de redaccion"
            />
            <button
              className="primary"
              disabled={evalLoading || !evalConversationId}
              type="button"
              onClick={() => void playConversationSession()}
            >
              {evalLoading ? "Reproduciendo..." : "Reproducir conversacion"}
            </button>
          </div>
          {selectedImportedConversation ? (
            <p className="muted">
              Seleccionada: {selectedImportedConversation.id} / {selectedImportedConversation.category} /{" "}
              {selectedImportedConversation.messages.length} mensajes
            </p>
          ) : null}
          {evalError ? <p className="error-text">{evalError}</p> : null}

          {evaluationSession ? (
            <div className="feedback-box">
              <p className="muted">
                Sesion {evaluationSession.id} / {evaluationSession.model}
              </p>
              {(evaluationSession.playbackTurns ?? []).map((turn) => {
                const savedFeedback = evaluationSession.turnFeedback.find((item) => item.turnIndex === turn.turnIndex);
                return (
                  <div className="ab-result" key={turn.turnIndex}>
                    <div className="ab-run">
                      <span>Turno {turn.turnIndex + 1} / Candidata</span>
                      <p>{turn.candidateMessage}</p>
                    </div>
                    <div className="ab-run">
                      <span>Respuesta generada / Estado: {turn.resultingState}</span>
                      <p>{turn.generatedResponse || "Sin respuesta generada (automatizacion bloqueada)."}</p>
                      <small>{formatTrace(turn.providerTrace)}</small>
                    </div>
                    <div className="ab-run">
                      <span>Respuesta original</span>
                      <p>{turn.originalResponse ?? "Sin respuesta original registrada."}</p>
                    </div>
                    <textarea
                      className="textarea"
                      value={turnEdits[turn.turnIndex] ?? turn.generatedResponse}
                      onChange={(event) => setTurnEdits((current) => ({ ...current, [turn.turnIndex]: event.target.value }))}
                      placeholder="Respuesta editada por Alex"
                    />
                    <div className="issue-grid">
                      {EVALUATION_ISSUE_OPTIONS.map((issue) => (
                        <label className="checkbox-row" key={issue}>
                          <input
                            checked={(turnIssues[turn.turnIndex] ?? []).includes(issue)}
                            type="checkbox"
                            onChange={(event) => toggleTurnIssue(turn.turnIndex, issue, event.target.checked)}
                          />
                          {issue}
                        </label>
                      ))}
                    </div>
                    <select
                      className="field"
                      value={turnRatings[turn.turnIndex] ?? ""}
                      onChange={(event) => setTurnRatings((current) => ({ ...current, [turn.turnIndex]: event.target.value }))}
                    >
                      <option value="">Puntuacion estilo</option>
                      <option value="1">1 - nunca lo diria</option>
                      <option value="2">2 - poco parecido</option>
                      <option value="3">3 - aceptable</option>
                      <option value="4">4 - bastante parecido</option>
                      <option value="5">5 - exactamente como lo diria</option>
                    </select>
                    <div className="row">
                      <button className="secondary" type="button" onClick={() => void savePlaybackTurnFeedback(turn, "APPROVED")}>
                        Aprobar
                      </button>
                      <button className="secondary" type="button" onClick={() => void savePlaybackTurnFeedback(turn, "EDITED")}>
                        Editar y aprobar
                      </button>
                      <button className="danger" type="button" onClick={() => void savePlaybackTurnFeedback(turn, "REJECTED")}>
                        Rechazar
                      </button>
                    </div>
                    {savedFeedback ? <p className="muted">Feedback guardado: {savedFeedback.status}</p> : null}
                  </div>
                );
              })}
              {(evaluationSession.playbackTurns ?? []).length === 0 ? (
                <p className="muted">Esta sesion no tiene turnos reproducidos.</p>
              ) : null}
              {evaluationSession.summary ? (
                <div className="ab-run">
                  <span>Resumen de la sesion</span>
                  <p>{formatSessionSummary(evaluationSession.summary)}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <details className="import-details">
            <summary>Importar mas conversaciones (JSON)</summary>
            <div className="feedback-box">
              <textarea
                className="textarea import-textarea"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
              />
              <button className="secondary" type="button" onClick={() => void importConversations()}>
                Importar conversaciones
              </button>
              {importStatus ? <p className="muted">{importStatus}</p> : null}
            </div>
          </details>
        </section>
      ) : null}

      {activeTab === "CHAT" ? (
        <section className="panel">
          <header className="chat2-head">
            <h2 className="chat2-title">Chat de prueba 🧪</h2>
            <p className="chat2-subtitle">
              Es una <strong>prueba local</strong>: aquí escribes TÚ haciéndote pasar por una candidata para ver cómo responde el
              bot. <strong>No se envía nada a Instagram.</strong> Las conversaciones reales llegan solas al CRM, y desde la ficha
              de cada candidata puedes responder a mano (eso sí va a Instagram cuando esté conectado).
            </p>
          </header>
          <div className="chat2-grid">
            <div className="chat2-panel chat2-left">
              <div className="chat2-left-title">Candidatas</div>
              <div className="chat2-list">
                {candidates.length === 0 ? (
                  <p className="muted" style={{ padding: "6px 8px", fontSize: 12 }}>
                    Sin candidatas. Crea una con el botón de abajo o carga la demo en Resumen.
                  </p>
                ) : (
                  candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="chat2-cand"
                      data-selected={selectedCandidate?.id === candidate.id}
                      onClick={() => void loadChatCandidate(candidate)}
                    >
                      <span className="chat2-cand-avatar" style={{ background: `var(${ringColorVar(candidate)})` }}>
                        {(candidate.firstName?.trim() || candidate.instagramUsername || "?").charAt(0).toUpperCase()}
                      </span>
                      <div className="chat2-cand-body">
                        <div className="chat2-cand-name">@{candidate.instagramUsername}</div>
                        <div className="chat2-cand-pill">{stateLabel(candidate.currentState)}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="chat2-panel">
              <div className="chat2-center-head">
                <div className="chat2-center-peer">
                  <span
                    className="chat2-peer-avatar"
                    style={{ background: currentCandidate ? `var(${ringColorVar(currentCandidate)})` : "var(--muted)" }}
                  >
                    {(currentCandidate?.firstName?.trim() || instagramUsername || "?").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <div className="chat2-peer-name">{currentCandidate?.firstName?.trim() || `@${instagramUsername}`}</div>
                    <div className="chat2-peer-username">@{currentCandidate?.instagramUsername ?? instagramUsername}</div>
                  </div>
                </div>
                {currentCandidate ? (
                  <span className="chat2-status" style={statePillStyle(currentCandidate.currentState)}>
                    {stateLabel(currentCandidate.currentState)}
                  </span>
                ) : null}
              </div>

              <div className="chat2-stream">
                {messages.length === 0 ? (
                  <div className="chat2-empty">Envía un mensaje como candidata para iniciar la conversación.</div>
                ) : (
                  messages.flatMap((item) => {
                    if (item.role === "system") {
                      return [
                        <div className="chat2-msg" data-role="system" key={item.id}>
                          <span className="chat2-system">⚙ {item.content}</span>
                        </div>
                      ];
                    }
                    const chunks = item.role === "agent" ? splitIntoMessageBurst(item.content) : [item.content];
                    return chunks.map((chunk, index) => (
                      <div className="chat2-msg" data-role={item.role} key={`${item.id}-${index}`}>
                        <span className="chat2-msg-label" data-role={item.role}>
                          {CHAT_AUTHOR_LABELS[item.role] ?? item.role}
                        </span>
                        <div className="chat2-bubble" data-role={item.role}>
                          {chunk}
                        </div>
                      </div>
                    ));
                  })
                )}
              </div>

              <form
                className="chat2-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
              >
                <div className="chat2-composer-row1">
                  <input
                    className="chat2-input-username"
                    value={instagramUsername}
                    onChange={(event) => setInstagramUsername(event.target.value)}
                    placeholder="instagram_username"
                  />
                  <select
                    className="chat2-select-vis"
                    value={profileVisibility}
                    onChange={(event) => setProfileVisibility(event.target.value as ProfileVisibility)}
                  >
                    <option value="PUBLIC">Público</option>
                    <option value="PRIVATE">Privado</option>
                    <option value="UNKNOWN">Desconocido</option>
                  </select>
                  <button
                    className="chat2-btn-new"
                    type="button"
                    title="Empieza una conversación desde cero (candidata nueva) para ver el saludo inicial"
                    onClick={() => {
                      setInstagramUsername(`candidata_${Math.floor(Math.random() * 100000)}`);
                      setSelectedCandidate(null);
                      setMessages([]);
                      setTransitions([]);
                      setLastResult(null);
                      setFeedbackStatus(null);
                      setProfileVisibility("PUBLIC");
                      setMessage("Hola, me interesa");
                    }}
                  >
                    + Candidata nueva
                  </button>
                </div>
                <div className="chat2-composer-row2">
                  <textarea
                    className="chat2-textarea"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Escribe como candidata…"
                  />
                  <button className="chat2-btn-send" disabled={loading || !message.trim()} type="submit">
                    {loading ? "Enviando…" : "Enviar"}
                  </button>
                </div>
                {sendError ? <div className="chat2-error">{sendError}</div> : null}
              </form>
            </div>

            <div className="chat2-panel">
              <div className="chat2-review-head">
                <span className="chat2-review-title">Revisión de Alex</span>
                {currentCandidate ? (
                  <span className="chat2-status" style={statePillStyle(currentCandidate.currentState)}>
                    {stateLabel(currentCandidate.currentState)}
                  </span>
                ) : null}
              </div>
              <div className="chat2-review-body">
                <div>
                  <div className="chat2-section-label">Datos extraídos</div>
                  <div className="chat2-extracted">
                    {extractedRows.map(([label, value]) => (
                      <div className="chat2-extracted-row" key={label}>
                        <span className="chat2-extracted-key">{label}</span>
                        <span className="chat2-extracted-val">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {transitions.length > 0 ? (
                  <div>
                    <div className="chat2-section-label">Transiciones de estado</div>
                    <div className="chat2-transitions">
                      {transitions.map((transition) => (
                        <div className="chat2-transition" key={transition.id}>
                          <span className="chat2-transition-trigger">{transition.trigger}</span>
                          <span className="chat2-transition-arrow">
                            {" · "}
                            {transition.fromState}
                            {" → "}
                          </span>
                          <span className="chat2-transition-to">{transition.toState}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="chat2-section-label">Traza LLM</div>
                  {lastResult?.draft ? (
                    <div className="chat2-trace">
                      <div className="chat2-trace-head">
                        <span className="chat2-trace-title">🔌 Proveedor</span>
                        <span className="chat2-badge" data-kind={lastResult.draft.usedFallback ? "fallback" : "real"}>
                          {lastResult.draft.usedFallback ? "⚠ Fallback" : "✓ Real"}
                        </span>
                      </div>
                      <div className="chat2-trace-lines">
                        <div className="chat2-trace-row">
                          <span className="chat2-trace-key">proveedor</span>
                          <span>{lastResult.draft.actualProvider}</span>
                        </div>
                        <div className="chat2-trace-row">
                          <span className="chat2-trace-key">modelo</span>
                          <span>{lastResult.draft.actualModel}</span>
                        </div>
                        <div className="chat2-trace-row">
                          <span className="chat2-trace-key">duración</span>
                          <span>{lastResult.draft.durationMs} ms</span>
                        </div>
                        {lastResult.draft.inputTokens != null ? (
                          <div className="chat2-trace-row">
                            <span className="chat2-trace-key">tokens</span>
                            <span>
                              {lastResult.draft.inputTokens} in / {lastResult.draft.outputTokens ?? 0} out
                            </span>
                          </div>
                        ) : null}
                        {lastResult.draft.estimatedCostUsd != null ? (
                          <div className="chat2-trace-row">
                            <span className="chat2-trace-key">coste</span>
                            <span>${lastResult.draft.estimatedCostUsd.toFixed(6)}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="chat2-trace">
                      <div className="chat2-empty" style={{ padding: "10px 0", margin: 0 }}>
                        Aún no hay respuesta generada.
                      </div>
                    </div>
                  )}
                </div>

                {showDevelopmentPanel ? (
                  <section className="dev-panel">
                    <button className="secondary" type="button" onClick={() => setTechnicalPanelOpen((current) => !current)}>
                      {technicalPanelOpen ? "Ocultar detalles tecnicos" : "Mostrar detalles tecnicos"}
                    </button>
                    {technicalPanelOpen ? (
                      <>
                        {styleEvaluation ? (
                          <div className="data-row">
                            <span>Evaluacion de estilo</span>
                            <strong>{Math.round(styleEvaluation.score * 100)}%</strong>
                            <p className={(styleEvaluation.reasons?.length ?? 0) > 0 ? "alert-warn" : "muted"}>
                              {(styleEvaluation.reasons?.length ?? 0) > 0
                                ? styleEvaluation.reasons.join(" ")
                                : "Sin alertas de estilo."}
                            </p>
                          </div>
                        ) : null}

                        {factualValidation ? (
                          <div className="data-row">
                            <span>Validacion factual</span>
                            <strong className={factualValidation.valid ? undefined : "alert-danger"}>
                              {factualValidation.valid ? "Correcta" : "Revisar"}
                            </strong>
                            <p className={factualValidation.valid ? "muted" : "alert-danger"}>
                              {(factualValidation.reasons?.length ?? 0) > 0
                                ? factualValidation.reasons.join(" ")
                                : "Sin alertas factuales."}
                            </p>
                          </div>
                        ) : null}

                        {responsePlan ? (
                          <div className="data-row">
                            <span>Plan de respuesta</span>
                            <strong>{responsePlan.objective}</strong>
                            <p className="muted">{responsePlan.humanReviewReason ?? "Sin revision humana requerida."}</p>
                            <pre className="debug-json">{JSON.stringify(responsePlan, null, 2)}</pre>
                          </div>
                        ) : null}

                        {lastResult ? (
                          <div className="data-row">
                            <span>Automatizacion</span>
                            <strong>
                              {lastResult.automationMode} / {lastResult.deliveryStatus}
                            </strong>
                            {lastResult.draft ? (
                              <DraftTrace draft={lastResult.draft} />
                            ) : (
                              <p className="muted">Sin trazas de proveedor para esta respuesta.</p>
                            )}
                          </div>
                        ) : null}

                        {styleContext ? (
                          <div className="data-row">
                            <span>Versiones</span>
                            <strong>{styleContext.styleProfileVersion}</strong>
                            <p className="muted">{styleContext.retrieverVersion}</p>
                          </div>
                        ) : null}

                        {lastResult ? (
                          <div className="data-row">
                            <span>Datos extraidos</span>
                            <strong>Comprension</strong>
                            <pre className="debug-json">{JSON.stringify(lastResult.understanding, null, 2)}</pre>
                          </div>
                        ) : null}

                        <div className="data-grid">
                          {knowledgeEntries.map((entry) => (
                            <div className="data-row" key={entry.id}>
                              <span>{entry.category}</span>
                              <strong>{entry.title}</strong>
                              <p className="muted">{entry.version}</p>
                            </div>
                          ))}

                          {retrievedExamples.map((example) => (
                            <div className="data-row" key={example.id}>
                              <span>{example.category}</span>
                              <strong>{example.title}</strong>
                              <p className="muted">{example.tags?.join(", ") || "-"}</p>
                            </div>
                          ))}
                        </div>

                        {selectedCandidate && messages.some((item) => item.role === "agent") ? (
                          <div className="feedback-box">
                            <textarea
                              className="textarea"
                              value={editedResponse}
                              onChange={(event) => setEditedResponse(event.target.value)}
                              placeholder="Respuesta editada por Alex"
                            />
                            <input
                              className="field"
                              value={feedbackReason}
                              onChange={(event) => setFeedbackReason(event.target.value)}
                              placeholder="¿Por qué editas o rechazas esta respuesta? (opcional)"
                            />
                            <select
                              className="field"
                              value={styleRating}
                              onChange={(event) => setStyleRating(event.target.value)}
                            >
                              <option value="">Puntuacion estilo</option>
                              <option value="1">1 - nunca lo diria</option>
                              <option value="2">2 - poco parecido</option>
                              <option value="3">3 - aceptable</option>
                              <option value="4">4 - bastante parecido</option>
                              <option value="5">5 - exactamente como lo diria</option>
                            </select>
                            <div className="row">
                              <button className="secondary" type="button" onClick={() => void sendFeedback("APPROVED")}>
                                Aprobar
                              </button>
                              <button className="secondary" type="button" onClick={() => void sendFeedback("EDITED")}>
                                Editar y aprobar
                              </button>
                              <button className="danger" type="button" onClick={() => void sendFeedback("REJECTED")}>
                                Rechazar
                              </button>
                              <button className="danger" type="button" onClick={() => void takeManualControl()}>
                                Tomar control
                              </button>
                            </div>
                            {feedbackStatus ? (
                              <p className="feedback-saved">
                                ✓ Guardado: {FEEDBACK_STATUS_LABELS[feedbackStatus] ?? feedbackStatus}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "CRM" ? (
        <section className="panel">
          <div className="crm2-head">
            <h2>CRM de candidatas</h2>
            <p>
              Cada columna es una fase del embudo. Las que esperan tu decisión llevan el anillo{" "}
              <strong style={{ color: "var(--warn)" }}>ámbar</strong> ⚠️ en el avatar.
            </p>
          </div>
          {crmNotice ? <p className="status-bar">{crmNotice}</p> : null}
          {candidates.length === 0 ? (
            <div className="crm2-seed">
              <div className="crm2-seed-icon">🗂️</div>
              <p>Aún no hay candidatas.</p>
              <p className="muted">Carga unas de ejemplo para ver cómo queda el tablero, o empieza en el chat de prueba.</p>
              <div className="crm2-seed-actions">
                <button className="crm2-btn crm2-btn--teal" type="button" onClick={() => void seedDemo()}>
                  Cargar candidatas de demo
                </button>
                <button className="crm2-btn crm2-btn--ghost" type="button" onClick={() => setActiveTab("CHAT")}>
                  Ir al chat de prueba
                </button>
              </div>
            </div>
          ) : (
            (() => {
              // Columnas, etiquetas y agrupacion por estado viven en crmView.ts (capa de presentacion
              // pura y exhaustiva sobre los 15 estados: ninguna candidata desaparece del tablero).
              const epochOf = (value?: Date | string): number => {
                if (!value) return 0;
                const time = new Date(value).getTime();
                return Number.isNaN(time) ? 0 : time;
              };
              const formatRelativeTime = (value?: Date | string): string | null => {
                const time = epochOf(value);
                if (!time) return null;
                const minutes = Math.round((Date.now() - time) / 60000);
                if (minutes < 1) return "justo ahora";
                if (minutes < 60) return `hace ${minutes} min`;
                const hours = Math.round(minutes / 60);
                if (hours < 24) return `hace ${hours} h`;
                const days = Math.round(hours / 24);
                if (days < 30) return `hace ${days} d`;
                return new Date(time).toLocaleDateString("es-ES");
              };
              const query = crmSearch.trim().toLowerCase();
              const visible = query
                ? candidates.filter(
                    (item) =>
                      item.instagramUsername.toLowerCase().includes(query) ||
                      (item.firstName ? item.firstName.toLowerCase().includes(query) : false)
                  )
                : candidates;
              const attentionStates: Candidate["currentState"][] = [
                "PROFILE_READY_FOR_REVIEW",
                "WAITING_HUMAN_REVIEW",
                "HUMAN_INTERVENTION_REQUIRED"
              ];
              const attentionCount = candidates.filter((item) => attentionStates.includes(item.currentState)).length;
              const activeCount = candidates.filter(
                (item) =>
                  !item.manualControlActive &&
                  !item.automationPaused &&
                  item.currentState !== "REJECTED" &&
                  item.currentState !== "CLOSED"
              ).length;
              return (
                <>
                  <div className="crm2-toolbar">
                    <div className="crm2-search">
                      <span className="crm2-search-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="11" cy="11" r="7" />
                          <path d="m21 21-4.3-4.3" />
                        </svg>
                      </span>
                      <input
                        type="search"
                        placeholder="Buscar por nombre o @usuario…"
                        value={crmSearch}
                        onChange={(event) => setCrmSearch(event.target.value)}
                      />
                    </div>
                    <div className="crm2-kpis">
                      <div className="crm2-kpi" style={{ border: "1px solid color-mix(in srgb, var(--warn) 40%, var(--line))" }}>
                        <span
                          className="crm2-kpi-icon"
                          style={{ background: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)" }}
                        >
                          ⚠️
                        </span>
                        <div>
                          <div className="crm2-kpi-value" style={{ color: "var(--warn)" }}>
                            {attentionCount}
                          </div>
                          <div className="crm2-kpi-label">te esperan</div>
                        </div>
                      </div>
                      <div className="crm2-kpi">
                        <span
                          className="crm2-kpi-icon"
                          style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}
                        >
                          ⚡
                        </span>
                        <div>
                          <div className="crm2-kpi-value">{activeCount}</div>
                          <div className="crm2-kpi-label">activas</div>
                        </div>
                      </div>
                      <div className="crm2-kpi">
                        <span className="crm2-kpi-icon" style={{ background: "var(--panel-2)", color: "var(--muted)" }}>
                          👥
                        </span>
                        <div>
                          <div className="crm2-kpi-value">{candidates.length}</div>
                          <div className="crm2-kpi-label">total</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={livePolling ? "live-pill on" : "live-pill"}
                        onClick={() => setLivePolling((value) => !value)}
                        title={
                          livePolling
                            ? "Actualizando el tablero en vivo. Clic para pausar."
                            : "Auto-refresco pausado. Clic para reanudar."
                        }
                      >
                        <span className="live-dot" />
                        {livePolling ? "En vivo" : "Pausado"}
                      </button>
                    </div>
                  </div>
                  {candidates.length === 0 ? (
                    <div className="crm-empty-global">
                      <p>Aún no hay candidatas. Prueba el núcleo conversacional en el chat de prueba.</p>
                      <button className="btn-xs accent" type="button" onClick={() => setActiveTab("CHAT")}>
                        Ir al chat de prueba
                      </button>
                    </div>
                  ) : null}
                  <div className="crm2-board">
                    {CRM_COLUMNS.map((phase) => {
                      const cards = visible
                        .filter((item) => crmColumnOf(item.currentState) === phase.id)
                        .sort((a, b) => epochOf(b.lastMessageAt) - epochOf(a.lastMessageAt));
                      return (
                        <div key={phase.id} className="crm2-col">
                          <div className="crm2-col-head">
                            <span className="crm2-col-bar" style={{ background: `var(${phase.colorVar})` }} />
                            <span className="crm2-col-title">{phase.title}</span>
                            <span className="crm2-col-count">{cards.length}</span>
                          </div>
                          <div className="crm2-col-body" style={{ borderLeftColor: `var(${phase.colorVar})` }}>
                            {cards.length === 0 ? (
                              <div className="crm2-empty">
                                <div className="crm2-empty-icon">{phase.emptyIcon}</div>
                                <div className="crm2-empty-text">{phase.emptyText}</div>
                              </div>
                            ) : (
                              cards.map((candidate) => {
                                const paused = candidate.manualControlActive || candidate.automationPaused;
                                const awaitingDecision =
                                  candidate.currentState === "WAITING_HUMAN_REVIEW" ||
                                  candidate.currentState === "HUMAN_INTERVENTION_REQUIRED";
                                const awaitingProfileReview = candidate.currentState === "PROFILE_READY_FOR_REVIEW";
                                const awaitingProfileAccess = candidate.currentState === "WAITING_PROFILE_ACCESS";
                                const awaitingCallConfirm =
                                  candidate.currentState === "COLLECTING_CALL_DETAILS" ||
                                  candidate.currentState === "READY_TO_SCHEDULE";
                                const closed = candidate.currentState === "REJECTED" || candidate.currentState === "CLOSED";
                                const isIgsid = /^\d{5,}$/.test(candidate.instagramUsername);
                                const profile = igProfiles[candidate.instagramUsername];
                                // @usuario real si se resolvio; si no, el usuario del simulador; para un IGSID sin resolver, nada.
                                const handle = profile?.username ?? (isIgsid ? null : candidate.instagramUsername);
                                const profileUrl = profile?.profileUrl ?? null;
                                const picUrl = profile?.profilePicUrl ?? null;
                                const hasName = Boolean(candidate.firstName?.trim());
                                const displayName = candidate.firstName?.trim() || (handle ? `@${handle}` : "Candidata nueva");
                                const initial = (candidate.firstName?.trim() || handle || candidate.instagramUsername || "?")
                                  .charAt(0)
                                  .toUpperCase();
                                // Si te sigue, puedes ver su perfil aunque sea privado (sustituto oficial de is_private).
                                const followsBusiness = profile?.followsBusiness === true;
                                const followerCount = typeof profile?.followerCount === "number" ? profile.followerCount : null;
                                const ringVar = ringColorVar(candidate);
                                const pillVar = stateColorVar(candidate.currentState);
                                const tags: string[] = [];
                                if (candidate.age) tags.push(`${candidate.age} años`);
                                if (typeof candidate.hasOnlyFans === "boolean")
                                  tags.push(candidate.hasOnlyFans ? "OF: si" : "OF: no");
                                if (candidate.deviceModel) tags.push(candidate.deviceModel);
                                if (candidate.country || candidate.city)
                                  tags.push((candidate.country || candidate.city) as string);
                                if (followerCount !== null)
                                  tags.push(
                                    followerCount >= 1000 ? `${(followerCount / 1000).toFixed(1)}k seg` : `${followerCount} seg`
                                  );
                                if (candidate.phone) tags.push("📱");
                                return (
                                  <article
                                    key={candidate.id}
                                    className="crm2-card"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => void openDrawer(candidate)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        void openDrawer(candidate);
                                      }
                                    }}
                                  >
                                    <div className="crm2-card-top">
                                      <span className="crm2-avatar-wrap">
                                        <span
                                          className="crm2-avatar"
                                          style={{
                                            background: `var(${ringVar})`,
                                            boxShadow: `0 0 0 2px var(--panel), 0 0 0 4px var(${ringVar})`
                                          }}
                                        >
                                          {picUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              className="crm2-avatar-img"
                                              src={picUrl}
                                              alt=""
                                              referrerPolicy="no-referrer"
                                              onError={(event) => {
                                                event.currentTarget.style.display = "none";
                                              }}
                                            />
                                          ) : null}
                                          {initial}
                                        </span>
                                        <span
                                          className="crm2-bot-dot"
                                          title={paused ? "Bot pausado" : "Bot activo"}
                                          style={{ background: paused ? "var(--faint)" : "var(--success)" }}
                                        />
                                      </span>
                                      <div className="crm2-id">
                                        <div className="crm2-name-row">
                                          <span className="crm2-name">{displayName}</span>
                                        </div>
                                        {hasName && handle ? (
                                          profileUrl ? (
                                            <a
                                              className="crm2-username"
                                              href={profileUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(event) => event.stopPropagation()}
                                            >
                                              @{handle} ↗
                                            </a>
                                          ) : (
                                            <span className="crm2-username">@{handle}</span>
                                          )
                                        ) : null}
                                      </div>
                                      <span
                                        className="crm2-pill"
                                        style={{
                                          color: `var(${pillVar})`,
                                          background: `color-mix(in srgb, var(${pillVar}) 12%, transparent)`,
                                          border: `1px solid color-mix(in srgb, var(${pillVar}) 33%, transparent)`
                                        }}
                                      >
                                        {stateLabel(candidate.currentState)}
                                      </span>
                                    </div>
                                    {(awaitingDecision && candidate.humanReviewReason) ||
                                    followsBusiness ||
                                    profile?.isPrivate !== undefined ? (
                                      <div className="crm2-badges">
                                        {awaitingDecision && candidate.humanReviewReason ? (
                                          <span
                                            className="crm2-badge"
                                            style={{
                                              color: "var(--warn)",
                                              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
                                              border: "1px solid color-mix(in srgb, var(--warn) 33%, transparent)"
                                            }}
                                          >
                                            ⚠ {REVIEW_REASON_LABELS[candidate.humanReviewReason] ?? candidate.humanReviewReason}
                                          </span>
                                        ) : null}
                                        {followsBusiness ? (
                                          <span
                                            className="crm2-badge"
                                            title="Te sigue: puedes ver su perfil aunque sea privado"
                                            style={{
                                              color: "var(--info)",
                                              background: "color-mix(in srgb, var(--info) 12%, transparent)",
                                              border: "1px solid color-mix(in srgb, var(--info) 33%, transparent)"
                                            }}
                                          >
                                            ✓ Te sigue
                                          </span>
                                        ) : null}
                                        {profile?.isPrivate === true ? (
                                          <span
                                            className="crm2-badge"
                                            title="Cuenta privada: mándale tú la solicitud para ver su perfil"
                                            style={{
                                              color: "var(--muted)",
                                              background: "var(--panel-2)",
                                              border: "1px solid var(--line)"
                                            }}
                                          >
                                            🔒 Privada
                                          </span>
                                        ) : profile?.isPrivate === false ? (
                                          <span
                                            className="crm2-badge"
                                            title="Cuenta pública: puedes ver su perfil directamente"
                                            style={{
                                              color: "var(--muted)",
                                              background: "var(--panel-2)",
                                              border: "1px solid var(--line)"
                                            }}
                                          >
                                            🌐 Pública
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {tags.length > 0 ? (
                                      <div className="crm2-metas">
                                        {tags.map((tag, index) => (
                                          <span key={index} className="crm2-meta">
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                    <div className="crm2-actions" onClick={(event) => event.stopPropagation()}>
                                      {awaitingProfileAccess ? (
                                        <button
                                          className="crm2-btn crm2-btn--teal"
                                          type="button"
                                          title="La cuenta es privada y ya le has enviado tú la solicitud de seguimiento"
                                          onClick={() => void advanceStage(candidate, "FOLLOW_REQUEST_SENT")}
                                        >
                                          Ya le mandé la solicitud
                                        </button>
                                      ) : null}
                                      {awaitingProfileReview ? (
                                        <>
                                          <button
                                            className="crm2-btn crm2-btn--teal"
                                            type="button"
                                            onClick={() => void advanceStage(candidate, "PROFILE_FIT")}
                                          >
                                            Encaja
                                          </button>
                                          <button
                                            className="crm2-btn crm2-btn--danger"
                                            type="button"
                                            onClick={() => void advanceStage(candidate, "PROFILE_NO_FIT")}
                                          >
                                            No encaja
                                          </button>
                                        </>
                                      ) : null}
                                      {awaitingDecision ? (
                                        <>
                                          <button
                                            className="crm2-btn crm2-btn--teal"
                                            type="button"
                                            onClick={() => void applyHumanDecision(candidate, "APPROVE")}
                                          >
                                            Aprobar
                                          </button>
                                          <button
                                            className="crm2-btn crm2-btn--danger"
                                            type="button"
                                            onClick={() => void advanceStage(candidate, "REJECT")}
                                          >
                                            Rechazar
                                          </button>
                                        </>
                                      ) : null}
                                      {awaitingCallConfirm ? (
                                        <button
                                          className="crm2-btn crm2-btn--teal"
                                          type="button"
                                          onClick={() => void advanceStage(candidate, "CONFIRM_CALL")}
                                        >
                                          Confirmar llamada
                                        </button>
                                      ) : null}
                                      <button
                                        className="crm2-btn crm2-btn--ghost"
                                        type="button"
                                        onClick={() => void sendManualReply(candidate)}
                                      >
                                        Responder
                                      </button>
                                      {!closed ? (
                                        <button
                                          className="crm2-btn crm2-btn--ghost"
                                          type="button"
                                          onClick={() => void setBotPaused(candidate, !paused)}
                                        >
                                          {paused ? "Reanudar" : "Pausar"}
                                        </button>
                                      ) : null}
                                      {!closed && !awaitingProfileReview && !awaitingDecision ? (
                                        <button
                                          className="crm2-btn crm2-btn--danger"
                                          type="button"
                                          onClick={() => void advanceStage(candidate, "REJECT")}
                                        >
                                          Rechazar
                                        </button>
                                      ) : null}
                                    </div>
                                    {formatRelativeTime(candidate.lastMessageAt) ? (
                                      <div className="crm2-footer">
                                        <svg
                                          width="11"
                                          height="11"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        >
                                          <circle cx="12" cy="12" r="9" />
                                          <path d="M12 7v5l3 2" />
                                        </svg>
                                        Último mensaje {formatRelativeTime(candidate.lastMessageAt)}
                                      </div>
                                    ) : null}
                                  </article>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()
          )}
        </section>
      ) : null}

      {activeTab === "AB" ? (
        <section className="panel eval-panel">
          <h2>Evaluacion A/B</h2>
          <p className="muted">Compara dos modelos con los mismos mensajes y guarda la decision de Alex.</p>
          <textarea className="textarea" value={abMessages} onChange={(event) => setAbMessages(event.target.value)} />
          <div className="row">
            <input className="field" value={abModelA} onChange={(event) => setAbModelA(event.target.value)} />
            <input className="field" value={abModelB} onChange={(event) => setAbModelB(event.target.value)} />
          </div>
          <label className="checkbox-row">
            <input checked={abBlind} type="checkbox" onChange={(event) => setAbBlind(event.target.checked)} />
            Ocultar modelos al evaluar
          </label>
          <button className="secondary" disabled={abLoading} type="button" onClick={() => void runABComparison()}>
            {abLoading ? "Ejecutando..." : "Ejecutar A/B"}
          </button>

          {abCase ? (
            <div className="ab-result">
              <div className="ab-run">
                <span>Respuesta A{abCase.blind ? "" : ` / ${abCase.runA.model}`}</span>
                <p>{abCase.runA.response}</p>
                <small>{formatTrace(abCase.runA.providerTrace)}</small>
              </div>
              <div className="ab-run">
                <span>Respuesta B{abCase.blind ? "" : ` / ${abCase.runB.model}`}</span>
                <p>{abCase.runB.response}</p>
                <small>{formatTrace(abCase.runB.providerTrace)}</small>
              </div>
              <select className="field" value={abWinner} onChange={(event) => setAbWinner(event.target.value as ABWinner)}>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="TIE">EMPATE</option>
                <option value="NONE">NINGUNA</option>
              </select>
              <select className="field" value={abStyleRating} onChange={(event) => setAbStyleRating(event.target.value)}>
                <option value="">Puntuacion estilo</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
              <input
                className="field"
                value={abNote}
                onChange={(event) => setAbNote(event.target.value)}
                placeholder="Nota de Alex"
              />
              <button className="secondary" type="button" onClick={() => void saveABDecision()}>
                Guardar decision
              </button>
              {abCase.winner ? <p className="muted">Decision guardada: {abCase.winner}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {drawerCandidate ? (
        <div className="drawer-scrim" role="presentation" onClick={closeDrawer}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Ficha de candidata"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="drawer-header">
              <div className="drawer-id">
                <span className="drawer-avatar">
                  {(drawerCandidate.firstName?.trim() || drawerCandidate.instagramUsername || "?").charAt(0).toUpperCase()}
                </span>
                <div>
                  <h3 className="drawer-name">{drawerCandidate.firstName?.trim() || `@${drawerCandidate.instagramUsername}`}</h3>
                  <span className="drawer-state-pill">{drawerCandidate.currentState}</span>
                </div>
              </div>
              <button type="button" className="drawer-close" aria-label="Cerrar ficha" onClick={closeDrawer}>
                ✕
              </button>
            </header>

            <nav className="drawer-tabs">
              <button
                type="button"
                className={drawerTab === "conversacion" ? "drawer-tab active" : "drawer-tab"}
                onClick={() => setDrawerTab("conversacion")}
              >
                Conversación
              </button>
              <button
                type="button"
                className={drawerTab === "ficha" ? "drawer-tab active" : "drawer-tab"}
                onClick={() => setDrawerTab("ficha")}
              >
                Ficha
              </button>
              <button
                type="button"
                className={drawerTab === "llamada" ? "drawer-tab active" : "drawer-tab"}
                onClick={() => setDrawerTab("llamada")}
              >
                Llamada
              </button>
            </nav>

            <div className="drawer-body">
              {drawerTab === "conversacion" ? (
                drawerLoading ? (
                  <p className="muted">Cargando conversación…</p>
                ) : drawerMessages.length === 0 ? (
                  <p className="muted">Sin mensajes todavía.</p>
                ) : (
                  <div className="drawer-conversation">
                    {drawerMessages.map((item) => (
                      <div className={`message ${item.role}`} key={item.id}>
                        {item.content}
                      </div>
                    ))}
                  </div>
                )
              ) : null}

              {drawerTab === "ficha" ? (
                <div className="drawer-ficha">
                  <div className="drawer-fields">
                    {buildCandidatePanelRows(drawerCandidate).map(([label, value]) => (
                      <div className="drawer-field" key={label}>
                        <span className="drawer-field-label">{label}</span>
                        <span className="drawer-field-value">{value}</span>
                      </div>
                    ))}
                  </div>
                  {drawerCandidate.objections && drawerCandidate.objections.length > 0 ? (
                    <div className="drawer-block">
                      <span className="drawer-field-label">Objeciones</span>
                      <div className="drawer-chips">
                        {drawerCandidate.objections.map((objection, index) => (
                          <span className="drawer-chip danger" key={index}>
                            {objection}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {drawerCandidate.conversationSummary ? (
                    <div className="drawer-block">
                      <span className="drawer-field-label">📝 Resumen</span>
                      <p className="drawer-text">{drawerCandidate.conversationSummary}</p>
                    </div>
                  ) : null}
                  {drawerCandidate.notes && drawerCandidate.notes.length > 0 ? (
                    <div className="drawer-block">
                      <span className="drawer-field-label">Notas</span>
                      {drawerCandidate.notes.map((note, index) => (
                        <p className="drawer-text" key={index}>
                          {note}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {drawerTab === "llamada" ? (
                <div className="drawer-call">
                  {drawerCandidate.lastCall ? (
                    <>
                      <div className="call-stats">
                        <div className="call-stat">
                          <span className="drawer-field-label">Resultado</span>
                          <span className={drawerCandidate.lastCall.result === "COMPLETED" ? "call-result ok" : "call-result no"}>
                            {drawerCandidate.lastCall.result === "COMPLETED" ? "Completada" : "No contestó"}
                          </span>
                        </div>
                        <div className="call-stat">
                          <span className="drawer-field-label">Duración</span>
                          <strong>
                            {drawerCandidate.lastCall.durationSec != null
                              ? `${Math.floor(drawerCandidate.lastCall.durationSec / 60)}m ${
                                  drawerCandidate.lastCall.durationSec % 60
                                }s`
                              : "—"}
                          </strong>
                        </div>
                        <div className="call-stat">
                          <span className="drawer-field-label">Reparto acordado</span>
                          <strong>
                            {drawerCandidate.lastCall.negotiatedModelShare != null
                              ? `${drawerCandidate.lastCall.negotiatedModelShare}% / ${
                                  100 - drawerCandidate.lastCall.negotiatedModelShare
                                }%`
                              : "—"}
                          </strong>
                        </div>
                      </div>
                      {drawerCandidate.lastCall.summary ? (
                        <div className="drawer-block">
                          <span className="drawer-field-label">Resumen de la llamada</span>
                          <p className="drawer-text">{drawerCandidate.lastCall.summary}</p>
                        </div>
                      ) : null}
                      {drawerCandidate.lastCall.transcript.length > 0 ? (
                        <div className="drawer-block">
                          <span className="drawer-field-label">Transcripción</span>
                          <div className="drawer-conversation">
                            {drawerCandidate.lastCall.transcript.map((turn, index) => (
                              <div className={`message ${turn.role}`} key={index}>
                                {turn.content}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {drawerCandidate.lastCall.endedAt ? (
                        <p className="drawer-text muted">
                          Terminó: {new Date(drawerCandidate.lastCall.endedAt).toLocaleString("es-ES")}
                        </p>
                      ) : null}
                    </>
                  ) : drawerCandidate.scheduledCallSlot ? (
                    <p className="drawer-text">
                      📞 Llamada agendada: <strong>{drawerCandidate.scheduledCallSlot}</strong>
                    </p>
                  ) : (
                    <p className="muted">Aún no hay llamada. Aprueba a la candidata y agéndala desde el CRM.</p>
                  )}
                </div>
              ) : null}
            </div>

            <footer className="drawer-footer">
              {/* Acciones segun estado, identicas a las tarjetas del CRM (mismos handlers deterministas). */}
              {drawerCandidate.currentState === "PROFILE_READY_FOR_REVIEW" ? (
                <>
                  <button type="button" className="btn-xs accent" onClick={() => advanceStage(drawerCandidate, "PROFILE_FIT")}>
                    Encaja
                  </button>
                  <button type="button" className="btn-xs danger" onClick={() => advanceStage(drawerCandidate, "PROFILE_NO_FIT")}>
                    No encaja
                  </button>
                </>
              ) : null}
              {drawerCandidate.currentState === "WAITING_HUMAN_REVIEW" ||
              drawerCandidate.currentState === "HUMAN_INTERVENTION_REQUIRED" ? (
                <>
                  <button
                    type="button"
                    className="btn-xs accent"
                    onClick={() => void applyHumanDecision(drawerCandidate, "APPROVE")}
                  >
                    Aprobar
                  </button>
                  <button type="button" className="btn-xs danger" onClick={() => advanceStage(drawerCandidate, "REJECT")}>
                    Rechazar
                  </button>
                </>
              ) : null}
              {drawerCandidate.currentState === "COLLECTING_CALL_DETAILS" ||
              drawerCandidate.currentState === "READY_TO_SCHEDULE" ? (
                <button type="button" className="btn-xs accent" onClick={() => advanceStage(drawerCandidate, "CONFIRM_CALL")}>
                  Confirmar llamada
                </button>
              ) : null}
              <button type="button" className="btn-xs" onClick={() => sendManualReply(drawerCandidate)}>
                Responder a mano
              </button>
              {drawerCandidate.currentState !== "REJECTED" && drawerCandidate.currentState !== "CLOSED" ? (
                <button
                  type="button"
                  className="btn-xs"
                  onClick={() =>
                    setBotPaused(drawerCandidate, !(drawerCandidate.manualControlActive || drawerCandidate.automationPaused))
                  }
                >
                  {drawerCandidate.manualControlActive || drawerCandidate.automationPaused ? "Reactivar bot" : "Pausar bot"}
                </button>
              ) : null}
            </footer>
          </aside>
        </div>
      ) : null}

      {modal ? (
        <div className="modal-scrim" role="presentation" onClick={() => setModal(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>{modal.title}</h3>
            {modal.body ? <p className="muted">{modal.body}</p> : null}
            {modal.hasInput ? (
              <input
                className="modal-input"
                autoFocus
                value={modalInput}
                placeholder={modal.inputPlaceholder}
                onChange={(event) => setModalInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = modalInput;
                    setModal(null);
                    modal.onConfirm(value);
                  }
                }}
              />
            ) : null}
            <div className="modal-actions">
              <button type="button" className="modal-btn ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={modal.danger ? "modal-btn danger" : "modal-btn primary"}
                onClick={() => {
                  const value = modalInput;
                  setModal(null);
                  modal.onConfirm(value);
                }}
              >
                {modal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DraftTrace({ draft }: { draft: DraftSummary }) {
  return (
    <>
      <p className="muted">
        {draft.provider} / {draft.modelVersion} / {draft.promptVersion}
      </p>
      <div className="trace-grid">
        <span>Proveedor solicitado</span>
        <strong>{draft.requestedProvider}</strong>
        <span>Proveedor real</span>
        <strong>{draft.actualProvider}</strong>
        <span>Modelo solicitado</span>
        <strong>{draft.requestedModel}</strong>
        <span>Modelo real</span>
        <strong>{draft.actualModel}</strong>
        <span>Fallback</span>
        <strong>{draft.usedFallback ? "Si" : "No"}</strong>
        <span>Motivo fallback</span>
        <strong>{draft.fallbackReason ?? draft.error ?? "-"}</strong>
        <span>Duracion</span>
        <strong>{draft.durationMs} ms</strong>
        <span>Reintentos</span>
        <strong>{draft.retryCount}</strong>
        <span>Tokens</span>
        <strong>
          {draft.inputTokens ?? "-"} in / {draft.outputTokens ?? "-"} out
        </strong>
        <span>Coste estimado</span>
        <strong>{draft.estimatedCostUsd === null ? "-" : `$${draft.estimatedCostUsd.toFixed(6)}`}</strong>
      </div>
    </>
  );
}

function formatApiError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "La API no devolvio una respuesta valida. Revisa la consola del servidor.";
}

function formatTrace(trace: ABEvaluationCase["runA"]["providerTrace"]): string {
  const cost = trace.estimatedCostUsd === null ? "-" : `$${trace.estimatedCostUsd.toFixed(6)}`;
  const fallback = trace.usedFallback ? ` / fallback${formatFallbackStages(trace.fallbackReason)}` : "";
  return `${trace.actualProvider} / ${trace.actualModel} / ${trace.durationMs} ms / ${trace.retryCount} reintentos / ${cost}${fallback}`;
}

function formatFallbackStages(fallbackReason: string | null | undefined): string {
  if (!fallbackReason) return "";
  const stages: string[] = [];
  if (fallbackReason.includes("comprension:")) stages.push("comprension");
  if (fallbackReason.includes("redaccion:")) stages.push("redaccion");
  return stages.length > 0 ? ` ${stages.join(" + ")}` : "";
}

function formatSessionSummary(summary: EvaluationSessionSummary): string {
  const style = summary.averageStyleRating === null ? "-" : summary.averageStyleRating.toFixed(1);
  return `Aprobadas ${Math.round(summary.approvedWithoutChangesPct)}% · Editadas ${Math.round(summary.editedPct)}% · Rechazadas ${Math.round(summary.rejectedPct)}% · Estilo medio ${style}/5 · Errores factuales ${summary.factualErrors} · Coste $${summary.estimatedCostUsd.toFixed(4)}`;
}

const sampleImportJson = JSON.stringify(
  {
    version: "1",
    conversations: [
      {
        id: "eval-demo-1",
        status: "CORRECTED",
        source: "ANONYMIZED_JSON",
        purpose: "EVALUATION",
        category: "qualification",
        initialState: "NEW_LEAD",
        stateBefore: "QUALIFYING",
        tags: ["demo", "quality"],
        messages: [
          {
            role: "candidate",
            content: "Hola, quiero saber como funciona",
            originalAlexResponse: "Hola, te cuento.",
            correctedResponse: "Hola, cuentame un poco de ti y vemos si encaja.",
            approved: true
          }
        ],
        originalAlexResponses: ["Hola, te cuento."],
        correctedResponses: ["Hola, cuentame un poco de ti y vemos si encaja."],
        approved: true,
        notes: "Conversacion de ejemplo anonimizada para evaluar calidad.",
        outcome: "evaluation_only",
        endedInCall: false,
        candidateApproved: false,
        anonymizedPersonalData: { instagram: "ANON_HANDLE" }
      }
    ]
  },
  null,
  2
);
