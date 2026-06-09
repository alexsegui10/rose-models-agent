"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candidate, ConversationMessage, ProfileVisibility, StateTransition } from "@/domain/candidate";
import type { ConversationFeedbackStatus, StyleEvaluation } from "@/domain/styleEvaluation";

type SimulatorResponse = {
  candidate: Candidate;
  response: string;
  automationMode: string;
  deliveryStatus: string;
  draft: DraftSummary;
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
  usedFallback: boolean;
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
  const showDevelopmentPanel = process.env.NODE_ENV !== "production";

  useEffect(() => {
    void refreshCandidates();
  }, []);

  const currentCandidate = selectedCandidate;
  const extractedRows = useMemo(() => {
    if (!currentCandidate) return [];

    return [
      ["Estado", currentCandidate.currentState],
      ["Usuario", currentCandidate.instagramUsername],
      ["Edad", currentCandidate.age?.toString() ?? "-"],
      ["Ciudad", currentCandidate.city ?? "-"],
      ["Pais", currentCandidate.country ?? "-"],
      ["Telefono", currentCandidate.phone ?? "-"],
      ["Dispositivo", currentCandidate.phoneDeviceType],
      ["iPhone requerido", currentCandidate.hasRequiredIPhone === null ? "-" : booleanValue(currentCandidate.hasRequiredIPhone)],
      ["Visibilidad declarada", currentCandidate.declaredProfileVisibility],
      ["Acceso aceptado declarado", booleanValue(currentCandidate.candidateDeclaredProfileAccessAccepted)],
      ["Acceso verificado", booleanValue(currentCandidate.humanVerifiedProfileAccess)],
      ["Perfil revisado humano", booleanValue(currentCandidate.humanProfileReviewed)],
      ["Decision humana", currentCandidate.humanFitDecision],
      ["OnlyFans", booleanValue(currentCandidate.hasOnlyFans)],
      ["Otra agencia", booleanValue(currentCandidate.worksWithAnotherAgency)],
      ["Revision humana", currentCandidate.humanReviewStatus]
    ];
  }, [currentCandidate]);

  async function refreshCandidates() {
    const response = await fetch("/api/candidates");
    const data = (await response.json()) as { candidates: Candidate[] };
    setCandidates(data.candidates);
  }

  async function sendMessage() {
    setLoading(true);
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
    const data = (await response.json()) as SimulatorResponse;
    setSelectedCandidate(data.candidate);
    setInstagramUsername(data.candidate.instagramUsername);
    setMessages(data.messages);
    setTransitions(data.transitions);
    setRetrievedExamples(data.retrievedExamples);
    setKnowledgeEntries(data.knowledgeEntries);
    setResponsePlan(data.responsePlan);
    setFactualValidation(data.factualValidation);
    setStyleEvaluation(data.styleEvaluation);
    setStyleContext(data.styleContext);
    setLastResult(data);
    setEditedResponse(data.response);
    setFeedbackStatus(null);
    setMessage("");
    await refreshCandidates();
    setLoading(false);
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
        modelVersion: lastResult?.draft.modelVersion
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
            <select className="field" value={profileVisibility} onChange={(event) => setProfileVisibility(event.target.value as ProfileVisibility)}>
              <option value="PUBLIC">Publico</option>
              <option value="PRIVATE">Privado</option>
              <option value="UNKNOWN">Desconocido</option>
              <option value="UNAVAILABLE">No disponible</option>
            </select>
          </div>
          <textarea className="textarea" value={message} onChange={(event) => setMessage(event.target.value)} />
          <button className="primary" disabled={loading || !message.trim()} type="submit">
            {loading ? "Enviando..." : "Enviar mensaje"}
          </button>
        </form>
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
            <h2>Modo desarrollo</h2>
            {styleEvaluation ? (
              <div className="data-row">
                <span>Evaluacion de estilo</span>
                <strong>{Math.round(styleEvaluation.score * 100)}%</strong>
                <p className="muted">{styleEvaluation.reasons.length > 0 ? styleEvaluation.reasons.join(" ") : "Sin alertas de estilo."}</p>
              </div>
            ) : null}

            {factualValidation ? (
              <div className="data-row">
                <span>Validacion factual</span>
                <strong>{factualValidation.valid ? "Correcta" : "Revisar"}</strong>
                <p className="muted">{factualValidation.reasons.length > 0 ? factualValidation.reasons.join(" ") : "Sin alertas factuales."}</p>
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
                <p className="muted">
                  {lastResult.draft.provider} · {lastResult.draft.modelVersion} · {lastResult.draft.promptVersion}
                </p>
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
                  <p className="muted">{example.tags.join(", ")}</p>
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
                <input className="field" value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value)} placeholder="Motivo opcional" />
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
          </section>
        ) : null}
      </aside>
    </main>
  );
}

function booleanValue(value: boolean | undefined): string {
  if (value === undefined) {
    return "-";
  }

  return value ? "Si" : "No";
}
