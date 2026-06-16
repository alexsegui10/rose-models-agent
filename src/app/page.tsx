"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCandidatePanelRows } from "@/application/candidatePanelRows";
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

type SimulatorTab = "EVALUACION" | "CHAT" | "CRM" | "AB";

const EVALUATION_ISSUE_OPTIONS: EvaluationIssue[] = [
  "FACTUAL_ERROR",
  "STATE_ERROR",
  "REPETITION",
  "TOO_FORMAL",
  "TOO_LONG",
  "UNNECESSARY_QUESTION",
  "MISSED_REAL_QUESTION"
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<SimulatorTab>("EVALUACION");
  const [runtimeStatus, setRuntimeStatus] = useState<SimulatorStatus | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
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

  const currentCandidate = selectedCandidate;
  const extractedRows = useMemo(() => buildCandidatePanelRows(currentCandidate), [currentCandidate]);
  const selectedImportedConversation =
    importedConversations.find((conversation) => conversation.id === evalConversationId) ?? null;

  async function refreshCandidates() {
    const response = await fetch("/api/candidates");
    const data = (await response.json()) as { candidates: Candidate[] };
    setCandidates(data.candidates);
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
    if (selectedCandidate?.id === candidate.id) {
      setSelectedCandidate({ ...candidate, manualControlActive: paused, automationPaused: paused });
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
    await refreshCandidates();
  }

  async function sendManualReply(candidate: Candidate) {
    // Responder a mano a una candidata (escalada o pausada). Se persiste como mensaje de Alex y se
    // envia a Instagram si la integracion esta activa. Para ver el contexto completo, pestaña Chat.
    const text = window.prompt(`Responder a @${candidate.instagramUsername} (se envia a Instagram):`);
    if (text === null || !text.trim()) return;
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

  async function advanceStage(
    candidate: Candidate,
    action: "PROFILE_FIT" | "PROFILE_NO_FIT" | "CONFIRM_CALL" | "PROFILE_OK" | "REJECT"
  ) {
    // Acciones del CRM: verificar/OK de perfil (en cualquier momento), confirmar llamada, rechazar.
    let slot: string | undefined;
    if (action === "CONFIRM_CALL") {
      const entered = window.prompt("Hora acordada para la llamada (opcional, p. ej. 'el lunes a las 18h'):");
      // Cancelar/Escape (null) ABORTA: no se confirma la llamada por error. Vacio = confirmar sin hora.
      if (entered === null) return;
      slot = entered.trim() || undefined;
    }
    if (action === "REJECT") {
      // Rechazar silencia el bot (deja de responder, sin gastar OpenAI): confirmar para evitar clics por error.
      if (!window.confirm(`Rechazar a @${candidate.instagramUsername}? El bot dejara de responderle.`)) return;
    }
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
      REJECT: `@${candidate.instagramUsername} rechazada: el bot deja de responderle.`
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
            className={activeTab === "EVALUACION" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("EVALUACION")}
          >
            Evaluacion
          </button>
          <button
            className={activeTab === "CHAT" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("CHAT")}
          >
            Chat de prueba
          </button>
          <button
            className={activeTab === "CRM" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("CRM")}
          >
            CRM
          </button>
          <button
            className={activeTab === "AB" ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab("AB")}
          >
            A/B de modelos
          </button>
        </nav>
        <p className="status-bar">
          Persistencia: {runtimeStatus?.persistenceMode ?? "..."} · IA: {runtimeStatus?.llmMode ?? "..."} (
          {runtimeStatus?.writingModel ?? "..."})
        </p>
      </header>

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
        <main className="app-shell">
          <aside className="panel">
            <h2>Candidatas</h2>
            <p className="muted">Simulador local sin Instagram real.</p>
            <div className="candidate-list">
              {candidates.map((candidate) => (
                <button
                  className="candidate-button"
                  key={candidate.id}
                  onClick={() => {
                    setSelectedCandidate(candidate);
                    setInstagramUsername(candidate.instagramUsername);
                    setProfileVisibility(candidate.declaredProfileVisibility);
                  }}
                >
                  <strong>@{candidate.instagramUsername}</strong>
                  <span className="muted">{candidate.currentState}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="main-panel">
            <header className="header">
              <h2>Chat de prueba</h2>
              <p className="muted">Chat de prueba para el nucleo conversacional.</p>
            </header>

            <div className="messages">
              {messages.length === 0 ? (
                <p className="muted">Envia un mensaje como candidata para iniciar la conversacion.</p>
              ) : (
                messages.flatMap((item) =>
                  item.role === "agent"
                    ? splitIntoMessageBurst(item.content).map((chunk, index) => (
                        <div className={`message ${item.role}`} key={`${item.id}-${index}`}>
                          {chunk}
                        </div>
                      ))
                    : [
                        <div className={`message ${item.role}`} key={item.id}>
                          {item.content}
                        </div>
                      ]
                )
              )}
            </div>

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <div className="row">
                <input
                  className="field"
                  value={instagramUsername}
                  onChange={(event) => setInstagramUsername(event.target.value)}
                  placeholder="instagram_username"
                />
                <select
                  className="field"
                  value={profileVisibility}
                  onChange={(event) => setProfileVisibility(event.target.value as ProfileVisibility)}
                >
                  <option value="PUBLIC">Publico</option>
                  <option value="PRIVATE">Privado</option>
                  <option value="UNKNOWN">Desconocido</option>
                </select>
                <button
                  className="secondary"
                  type="button"
                  title="Empieza una conversacion desde cero (candidata nueva) para ver el saludo inicial"
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
                  Candidata nueva
                </button>
              </div>
              <textarea className="textarea" value={message} onChange={(event) => setMessage(event.target.value)} />
              <button className="primary" disabled={loading || !message.trim()} type="submit">
                {loading ? "Enviando..." : "Enviar mensaje"}
              </button>
            </form>
            {sendError ? <p className="error-text">{sendError}</p> : null}
          </section>

          <aside className="panel">
            <h2>Revision de Alex</h2>
            <p className="muted">Datos extraidos y cambios de estado.</p>
            {currentCandidate ? <span className="state-pill">{currentCandidate.currentState}</span> : null}
            <div className="data-grid">
              {extractedRows.map(([label, value]) => (
                <div className="data-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="data-grid">
              {transitions.map((transition) => (
                <div className="data-row" key={transition.id}>
                  <span>{transition.trigger}</span>
                  <strong>
                    {transition.fromState} -&gt; {transition.toState}
                  </strong>
                </div>
              ))}
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
                        <p className="muted">
                          {(styleEvaluation.reasons?.length ?? 0) > 0
                            ? styleEvaluation.reasons.join(" ")
                            : "Sin alertas de estilo."}
                        </p>
                      </div>
                    ) : null}

                    {factualValidation ? (
                      <div className="data-row">
                        <span>Validacion factual</span>
                        <strong>{factualValidation.valid ? "Correcta" : "Revisar"}</strong>
                        <p className="muted">
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
                          placeholder="Motivo opcional"
                        />
                        <select className="field" value={styleRating} onChange={(event) => setStyleRating(event.target.value)}>
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
                        {feedbackStatus ? <p className="muted">Feedback guardado: {feedbackStatus}</p> : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}
          </aside>
        </main>
      ) : null}

      {activeTab === "CRM" ? (
        <section className="panel">
          <h2>CRM de candidatas</h2>
          <p className="muted">
            Cada columna es una fase del embudo. Las que necesitan tu decision estan en <strong>⚠ Tu decision</strong>.
          </p>
          {crmNotice ? <p className="status-bar">{crmNotice}</p> : null}
          {candidates.length === 0 ? (
            <p className="muted">Aun no hay candidatas. Inicia una conversacion en el chat de prueba.</p>
          ) : (
            (() => {
              const PHASES: { key: string; title: string; tone: string; states: Candidate["currentState"][] }[] = [
                { key: "nuevas", title: "Nuevas", tone: "new", states: ["NEW_LEAD", "WAITING_PROFILE_ACCESS"] },
                { key: "cualificando", title: "Cualificando", tone: "qualify", states: ["QUALIFYING"] },
                {
                  key: "decision",
                  title: "⚠ Tu decision",
                  tone: "attention",
                  states: ["PROFILE_READY_FOR_REVIEW", "WAITING_HUMAN_REVIEW", "HUMAN_INTERVENTION_REQUIRED"]
                },
                {
                  key: "agenda",
                  title: "Agenda",
                  tone: "schedule",
                  states: ["APPROVED", "COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "CALL_SCHEDULED"]
                },
                { key: "cerradas", title: "Cerradas", tone: "closed", states: ["REJECTED", "CLOSED"] }
              ];
              const STATE_LABELS: Partial<Record<Candidate["currentState"], string>> = {
                NEW_LEAD: "Nueva",
                WAITING_PROFILE_ACCESS: "Esperando solicitud",
                PROFILE_READY_FOR_REVIEW: "Revisar perfil",
                QUALIFYING: "Cualificando",
                WAITING_HUMAN_REVIEW: "Tu decision",
                HUMAN_INTERVENTION_REQUIRED: "Intervencion",
                APPROVED: "Aprobada",
                COLLECTING_CALL_DETAILS: "Agendando",
                READY_TO_SCHEDULE: "Lista para llamada",
                CALL_SCHEDULED: "Llamada agendada",
                REJECTED: "Rechazada",
                CLOSED: "Cerrada"
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
                  <div className="crm-toolbar">
                    <input
                      className="field crm-search"
                      type="search"
                      placeholder="Buscar por nombre o @usuario…"
                      value={crmSearch}
                      onChange={(event) => setCrmSearch(event.target.value)}
                    />
                    <div className="crm-summary">
                      <span className="crm-kpi attention">
                        <b>{attentionCount}</b> te esperan
                      </span>
                      <span className="crm-kpi">
                        <b>{activeCount}</b> activas
                      </span>
                      <span className="crm-kpi">
                        <b>{candidates.length}</b> total
                      </span>
                    </div>
                  </div>
                  <div className="crm-board">
                    {PHASES.map((phase) => {
                      const cards = visible.filter((item) => phase.states.includes(item.currentState));
                      return (
                        <div key={phase.key} className={`crm-column tone-${phase.tone}`}>
                          <div className="crm-column-head">
                            <span className="crm-column-title">{phase.title}</span>
                            <span className="crm-count">{cards.length}</span>
                          </div>
                          {cards.length === 0 ? (
                            <p className="crm-empty-col">—</p>
                          ) : (
                            cards.map((candidate) => {
                              const paused = candidate.manualControlActive || candidate.automationPaused;
                              const awaitingDecision =
                                candidate.currentState === "WAITING_HUMAN_REVIEW" ||
                                candidate.currentState === "HUMAN_INTERVENTION_REQUIRED";
                              const awaitingProfileReview = candidate.currentState === "PROFILE_READY_FOR_REVIEW";
                              const awaitingCallConfirm =
                                candidate.currentState === "COLLECTING_CALL_DETAILS" ||
                                candidate.currentState === "READY_TO_SCHEDULE";
                              const closed = candidate.currentState === "REJECTED" || candidate.currentState === "CLOSED";
                              const displayName = candidate.firstName?.trim() || `@${candidate.instagramUsername}`;
                              const initial = (candidate.firstName?.trim() || candidate.instagramUsername || "?")
                                .charAt(0)
                                .toUpperCase();
                              const tags: string[] = [];
                              if (candidate.age) tags.push(`${candidate.age} años`);
                              if (typeof candidate.hasOnlyFans === "boolean")
                                tags.push(candidate.hasOnlyFans ? "OF: si" : "OF: no");
                              if (candidate.deviceModel) tags.push(candidate.deviceModel);
                              if (candidate.country || candidate.city) tags.push((candidate.country || candidate.city) as string);
                              if (candidate.phone) tags.push("📱");
                              return (
                                <article key={candidate.id} className={`crm-card tone-${phase.tone}`}>
                                  <div className="crm-card-top">
                                    <span className="crm-avatar">{initial}</span>
                                    <span className="crm-card-id">
                                      <span className="crm-card-name">{displayName}</span>
                                      {candidate.firstName?.trim() ? (
                                        <span className="crm-card-handle">@{candidate.instagramUsername}</span>
                                      ) : null}
                                    </span>
                                    <span className="crm-bot" title={paused ? "Bot pausado" : "Bot activo"}>
                                      <span className={paused ? "crm-bot-dot paused" : "crm-bot-dot"} />
                                      {paused ? "Pausado" : "Activo"}
                                    </span>
                                  </div>
                                  <span className={`crm-state tone-${phase.tone}`}>
                                    {STATE_LABELS[candidate.currentState] ?? candidate.currentState}
                                  </span>
                                  {tags.length > 0 ? (
                                    <div className="crm-meta">
                                      {tags.map((tag, index) => (
                                        <span key={index} className="crm-tag">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                  <div className="crm-card-actions">
                                    {awaitingProfileReview ? (
                                      <>
                                        <button
                                          className="btn-xs accent"
                                          type="button"
                                          onClick={() => void advanceStage(candidate, "PROFILE_FIT")}
                                        >
                                          Encaja
                                        </button>
                                        <button
                                          className="btn-xs danger"
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
                                          className="btn-xs accent"
                                          type="button"
                                          onClick={() => void applyHumanDecision(candidate, "APPROVE")}
                                        >
                                          Aprobar
                                        </button>
                                        <button
                                          className="btn-xs danger"
                                          type="button"
                                          onClick={() => void advanceStage(candidate, "REJECT")}
                                        >
                                          Rechazar
                                        </button>
                                      </>
                                    ) : null}
                                    {awaitingCallConfirm ? (
                                      <button
                                        className="btn-xs accent"
                                        type="button"
                                        onClick={() => void advanceStage(candidate, "CONFIRM_CALL")}
                                      >
                                        Confirmar llamada
                                      </button>
                                    ) : null}
                                    <button className="btn-xs" type="button" onClick={() => void sendManualReply(candidate)}>
                                      Responder
                                    </button>
                                    {!closed ? (
                                      <button
                                        className="btn-xs"
                                        type="button"
                                        onClick={() => void setBotPaused(candidate, !paused)}
                                      >
                                        {paused ? "Reanudar" : "Pausar"}
                                      </button>
                                    ) : null}
                                    {!closed && !awaitingProfileReview && !awaitingDecision ? (
                                      <>
                                        <button
                                          className="btn-xs"
                                          type="button"
                                          onClick={() => void advanceStage(candidate, "PROFILE_OK")}
                                        >
                                          OK perfil
                                        </button>
                                        <button
                                          className="btn-xs danger"
                                          type="button"
                                          onClick={() => void advanceStage(candidate, "REJECT")}
                                        >
                                          Rechazar
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </article>
                              );
                            })
                          )}
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
