"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCandidatePanelRows } from "@/application/candidatePanelRows";
import type { ImportedConversation } from "@/application/conversationImport";
import type { Candidate, ConversationMessage, ProfileVisibility, StateTransition } from "@/domain/candidate";
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
  const [candidates, setCandidates] = useState<Candidate[]>([]);
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
      const response = await fetch("/api/simulator/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: selectedCandidate?.id,
          instagramUsername,
          profileVisibility,
          message
        })
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
          <h1>Rose Models Agent</h1>
          <p className="muted">Chat de prueba para el nucleo conversacional.</p>
        </header>

        <div className="messages">
          {messages.length === 0 ? (
            <p className="muted">Envia un mensaje como candidata para iniciar la conversacion.</p>
          ) : (
            messages.map((item) => (
              <div className={`message ${item.role}`} key={item.id}>
                {item.content}
              </div>
            ))
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
                      {(styleEvaluation.reasons?.length ?? 0) > 0 ? styleEvaluation.reasons.join(" ") : "Sin alertas de estilo."}
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

                <section className="evaluation-box">
                  <h2>Evaluacion A/B</h2>
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
                      <select
                        className="field"
                        value={abWinner}
                        onChange={(event) => setAbWinner(event.target.value as ABWinner)}
                      >
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

                <section className="evaluation-box">
                  <h2>Sesion de evaluacion</h2>
                  <textarea
                    className="textarea import-textarea"
                    value={importJson}
                    onChange={(event) => setImportJson(event.target.value)}
                  />
                  <button className="secondary" type="button" onClick={() => void importConversations()}>
                    Importar conversaciones
                  </button>
                  {importStatus ? <p className="muted">{importStatus}</p> : null}
                  <div className="row">
                    <select
                      className="field"
                      value={evalConversationId}
                      onChange={(event) => setEvalConversationId(event.target.value)}
                    >
                      <option value="">Selecciona conversacion importada</option>
                      {importedConversations.map((conversation) => (
                        <option key={conversation.id} value={conversation.id}>
                          {conversation.id} / {conversation.category}
                        </option>
                      ))}
                    </select>
                    <input className="field" value={evalModel} onChange={(event) => setEvalModel(event.target.value)} />
                  </div>
                  {selectedImportedConversation ? (
                    <p className="muted">
                      {selectedImportedConversation.messages.length} mensajes / {selectedImportedConversation.category}
                    </p>
                  ) : null}
                  <button
                    className="secondary"
                    disabled={evalLoading || !evalConversationId}
                    type="button"
                    onClick={() => void playConversationSession()}
                  >
                    {evalLoading ? "Reproduciendo..." : "Reproducir conversacion"}
                  </button>
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
                              onChange={(event) =>
                                setTurnEdits((current) => ({ ...current, [turn.turnIndex]: event.target.value }))
                              }
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
                              onChange={(event) =>
                                setTurnRatings((current) => ({ ...current, [turn.turnIndex]: event.target.value }))
                              }
                            >
                              <option value="">Puntuacion estilo</option>
                              <option value="1">1 - nunca lo diria</option>
                              <option value="2">2 - poco parecido</option>
                              <option value="3">3 - aceptable</option>
                              <option value="4">4 - bastante parecido</option>
                              <option value="5">5 - exactamente como lo diria</option>
                            </select>
                            <div className="row">
                              <button
                                className="secondary"
                                type="button"
                                onClick={() => void savePlaybackTurnFeedback(turn, "APPROVED")}
                              >
                                Aprobar
                              </button>
                              <button
                                className="secondary"
                                type="button"
                                onClick={() => void savePlaybackTurnFeedback(turn, "EDITED")}
                              >
                                Editar y aprobar
                              </button>
                              <button
                                className="danger"
                                type="button"
                                onClick={() => void savePlaybackTurnFeedback(turn, "REJECTED")}
                              >
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
                </section>
              </>
            ) : null}
          </section>
        ) : null}
      </aside>
    </main>
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
  const fallback = trace.usedFallback ? " / fallback" : "";
  return `${trace.actualProvider} / ${trace.actualModel} / ${trace.durationMs} ms / ${trace.retryCount} reintentos / ${cost}${fallback}`;
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
