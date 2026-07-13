"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildCandidatePanelRows } from "@/application/candidatePanelRows";
import { classifyDelivery, type SentToCandidate } from "@/application/deliveryNotice";
import { AdsView } from "@/app/components/AdsView";
import { candidatesToCsv, csvFileName } from "@/application/candidatesToCsv";
import { CRM_COLUMNS, crmColumnOf, needsHumanDecision, ringColorVar, stateColorVar, stateLabel } from "@/application/crmView";
import type { Candidate, ConversationMessage, ProfileVisibility, StateTransition } from "@/domain/candidate";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
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

type SimulatorTab = "DASHBOARD" | "CHAT" | "CRM" | "LLAMADAS" | "ANUNCIOS";
type AccentKey = "rose" | "green" | "blue" | "violet" | "gold";
const ACCENT_KEYS: readonly AccentKey[] = ["rose", "green", "blue", "violet", "gold"];

type AdvanceAction =
  | "PROFILE_FIT"
  | "PROFILE_NO_FIT"
  | "CONFIRM_CALL"
  | "PROFILE_OK"
  | "REJECT"
  | "FOLLOW_REQUEST_SENT"
  | "DEVICE_APPROVE"
  | "DEVICE_REJECT";

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

// Etiquetas en espanol del motivo de escalada, para mostrarlo en la tarjeta del CRM y que Alex decida
// sin abrir el chat.
const REVIEW_REASON_LABELS: Record<string, string> = {
  PROFILE_REVIEW: "Revisar perfil",
  PERCENTAGE_NEGOTIATION: "Negocia porcentaje",
  COMMERCIAL_EXCEPTION: "Pide excepción comercial",
  CONTRACT_QUESTION: "Duda de contrato",
  DATA_CONTRADICTION: "Dato contradictorio",
  DEVICE_QUALITY_REVIEW: "Revisa la calidad del móvil",
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

// Qué enseñar en el hueco de la CITA de una tarjeta de llamada (3-jul): con la llamada YA hecha, la
// franja vieja ("el viernes a las 23:00") confunde — se muestra el RESULTADO con su fecha (misma
// precedencia lastCall-sobre-slot que ya usaba el drawer). El reintento programado se anuncia.
function callCardSlotText(item: Candidate): string {
  if (item.currentState === "CALL_IN_PROGRESS") return "en curso ahora";
  if (item.lastCall) {
    const base = item.lastCall.result === "COMPLETED" ? "Completada" : "No contestó";
    const when = item.lastCall.endedAt
      ? new Date(item.lastCall.endedAt).toLocaleString("es-ES", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";
    const retry =
      item.currentState === "CALL_NO_ANSWER" && item.scheduledCallStartMs && item.scheduledCallStartMs > Date.now()
        ? " · reintento programado"
        : "";
    return `${base}${when ? ` · ${when}` : ""}${retry}`;
  }
  return item.scheduledCallSlot || "Sin franja";
}

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
  // Acento conmutable de la maqueta (5 colores). Escribe html[data-accent]; persiste junto al modo.
  const [accent, setAccent] = useState<AccentKey>("rose");
  // Intro splash (pétalos) SOLO en la primera visita (decisión de Alex: no en cada recarga).
  const [showIntro, setShowIntro] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalInput, setModalInput] = useState("");
  // Ficha de candidata (drawer lateral): se abre al hacer clic en una tarjeta del CRM.
  const [drawerCandidate, setDrawerCandidate] = useState<Candidate | null>(null);
  const [drawerMessages, setDrawerMessages] = useState<ConversationMessage[]>([]);
  const [drawerTransitions, setDrawerTransitions] = useState<StateTransition[]>([]);
  const [drawerTab, setDrawerTab] = useState<"conversacion" | "ficha" | "llamada">("conversacion");
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerReply, setDrawerReply] = useState("");
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
  const [testCallPhone, setTestCallPhone] = useState("");
  const [testCallBusy, setTestCallBusy] = useState(false);
  const [testCallResult, setTestCallResult] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [transitions, setTransitions] = useState<StateTransition[]>([]);
  const [instagramUsername, setInstagramUsername] = useState("candidata_demo");
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>("PUBLIC");
  const [message, setMessage] = useState("Hola, me interesa. Tengo 22 anos y soy de Madrid.");
  // Canal activo en la bandeja de Mensajes: Instagram (candidatas normales) o WhatsApp (clave wa:<digitos>).
  const [chatChannel, setChatChannel] = useState<"instagram" | "whatsapp">("instagram");
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
  const [technicalPanelOpen, setTechnicalPanelOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const showDevelopmentPanel = process.env.NODE_ENV !== "production";

  // Tema claro/oscuro + acento: inicializa desde localStorage y aplica los atributos en <html>. Tolerante al
  // formato antiguo (string "dark"/"light") y al nuevo de la maqueta (JSON {mode,accent}).
  useEffect(() => {
    const saved = window.localStorage.getItem("rm-theme");
    let mode: "dark" | "light" = "dark";
    let acc: AccentKey = "rose";
    if (saved === "light" || saved === "dark") {
      mode = saved;
    } else if (saved) {
      try {
        const parsed = JSON.parse(saved) as { mode?: unknown; accent?: unknown };
        if (parsed.mode === "light" || parsed.mode === "dark") mode = parsed.mode;
        if (typeof parsed.accent === "string" && ACCENT_KEYS.includes(parsed.accent as AccentKey)) {
          acc = parsed.accent as AccentKey;
        }
      } catch {
        /* formato desconocido: valores por defecto */
      }
    }
    setTheme(mode);
    setAccent(acc);
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.dataset.mode = mode;
    root.dataset.accent = acc;
  }, []);

  // Intro splash: se muestra UNA vez (primera visita). Auto-oculta a los ~3.4s (2.5s + 0.7s de introOut).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("rm-intro-seen")) return;
    window.localStorage.setItem("rm-intro-seen", "1");
    setShowIntro(true);
    const t = window.setTimeout(() => setShowIntro(false), 3400);
    return () => window.clearTimeout(t);
  }, []);

  // Runtime de la maqueta de Alex: brillo que SIGUE al cursor (dos capas con lag 0.04 y 0.075) + ripple al
  // hacer clic. Solo en punteros finos (ratón/trackpad) para no gastar batería en el iPhone. Best-effort.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return;
    const a = document.getElementById("rm-glow-a");
    const b = document.getElementById("rm-glow-b");
    if (!a || !b) return;
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let ax = mx;
    let ay = my;
    let bx = mx;
    let by = my;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    const tick = () => {
      ax += (mx - ax) * 0.04;
      ay += (my - ay) * 0.04;
      bx += (mx - bx) * 0.075;
      by += (my - by) * 0.075;
      a.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px)`;
      b.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;
      raf = requestAnimationFrame(tick);
    };
    const onClick = (e: MouseEvent) => {
      const root = document.getElementById("rm-root");
      if (!root) return;
      const size = 18;
      const span = document.createElement("span");
      span.style.cssText = `position:fixed;left:${e.clientX - size / 2}px;top:${e.clientY - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle,rgba(var(--accent-rgb),.7),rgba(var(--accent-rgb),0) 70%);pointer-events:none;z-index:9999;animation:rippleFx .6s ease-out forwards`;
      root.appendChild(span);
      window.setTimeout(() => span.remove(), 620);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("click", onClick, true);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    void refreshCandidates();
    void fetch("/api/simulator/status")
      .then((response) => response.json())
      .then((data: SimulatorStatus) => setRuntimeStatus(data));
  }, []);

  // Tiempo real (auto-refresco). SOLO LECTURA: refresca el tablero y, si el drawer esta abierto, su
  // conversacion; nunca decide flujo ni muta estado (invariante 1). Se pausa durante un envio en curso
  // (loading) para no pisarlo, si Alex lo pausa, o si la pestaña no esta visible (ahorra peticiones).
  // Solo activo en el CRM o con la ficha abierta, que es donde importa ver los cambios en vivo.
  useEffect(() => {
    if (!livePolling) return;
    if (
      activeTab !== "CRM" &&
      activeTab !== "DASHBOARD" &&
      activeTab !== "LLAMADAS" &&
      activeTab !== "ANUNCIOS" &&
      !drawerCandidate
    )
      return;
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

  // Mantiene la ficha abierta SINCRONIZADA con los datos frescos del tablero (estado, botones, motivo, %).
  // Sin esto, el auto-refresco actualizaba los mensajes pero NO el estado/botones de la ficha: podias ver
  // datos viejos y pulsar una accion que ya no aplica. Solo lectura; compara updatedAt para no re-renderizar
  // en cada refresco si no cambio nada.
  useEffect(() => {
    if (!drawerCandidate) return;
    const fresh = candidates.find((candidate) => candidate.id === drawerCandidate.id);
    if (fresh && String(fresh.updatedAt) !== String(drawerCandidate.updatedAt)) {
      setDrawerCandidate(fresh);
    }
  }, [candidates, drawerCandidate]);

  // Contador de pendientes en el titulo de la pestana del navegador: "(3) Rose Models Agent" cuando hay
  // candidatas esperando TU decision, para no perderlas aunque el CRM no este en primer plano. Solo presentacion.
  useEffect(() => {
    const waiting = candidates.filter(needsHumanDecision).length;
    document.title = waiting > 0 ? `(${waiting}) Rose Models Agent` : "Rose Models Agent";
  }, [candidates]);

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

  // Quita SOLO las candidatas de demo (por su prefijo de id). Nunca toca las reales.
  // Borra las candidatas de prueba/demo (las que no son de Instagram real). Pide confirmacion.
  function clearTest() {
    const fakeCount = candidates.filter((item) => !/^\d{5,}$/.test(item.instagramUsername)).length;
    openModal({
      title: "¿Limpiar candidatas de prueba?",
      body: `Se borrarán ${fakeCount} candidata(s) de prueba/demo (las que no son de Instagram real). Las candidatas reales NO se tocan.`,
      danger: true,
      confirmLabel: "Limpiar pruebas",
      onConfirm: () => void doClearTest()
    });
  }

  async function doClearTest() {
    try {
      const response = await fetch("/api/simulator/clear-test", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { removed?: number; error?: string };
      if (!response.ok) {
        setCrmNotice(`No se pudieron limpiar las pruebas (${response.status}). ${data.error ?? ""}`.trim());
        return;
      }
      await refreshCandidates();
      setCrmNotice(`Limpiadas ${data.removed ?? 0} candidatas de prueba.`);
    } catch (error) {
      setCrmNotice(`No se pudieron limpiar las pruebas: ${error instanceof Error ? error.message : "error de red"}.`);
    }
  }

  // Dispara la llamada saliente por telefono (SIP/Zadarma, ElevenLabs). Pide confirmacion (accion real con coste).
  function startCall(candidate: Candidate) {
    if (!candidate.phone?.trim()) {
      setCrmNotice(`@${candidate.instagramUsername} no tiene número de teléfono guardado todavía.`);
      return;
    }
    openModal({
      title: "¿Llamar por teléfono?",
      body: `El bot llamará a ${candidate.firstName?.trim() || "la candidata"} por teléfono ahora mismo (suena directamente, sin permiso previo).`,
      confirmLabel: "Llamar",
      onConfirm: () => void doStartCall(candidate)
    });
  }

  async function doStartCall(candidate: Candidate) {
    try {
      const response = await fetch("/api/call/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id })
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setCrmNotice(
          response.status === 503
            ? "Las llamadas aún no están configuradas (faltan las claves de ElevenLabs en Vercel)."
            : `No se pudo iniciar la llamada (${response.status}). ${data.error ?? ""}`.trim()
        );
        return;
      }
      setCrmNotice(
        `📞 Llamando a @${candidate.instagramUsername} ahora. El bot marca su número y conecta; el resultado aparecerá en su ficha al colgar.`
      );
    } catch (error) {
      setCrmNotice(`No se pudo iniciar la llamada: ${error instanceof Error ? error.message : "error de red"}.`);
    }
  }

  // Borra UNA candidata concreta (incluidas las reales de Instagram) y TODO su historial, para repetir la
  // prueba end-to-end desde cero. Irreversible -> pide confirmacion. Tras borrar, deselecciona para no
  // apuntar a un id que ya no existe.
  function deleteCandidate(candidate: Candidate) {
    const label = candidate.firstName?.trim() || `@${candidate.instagramUsername}`;
    openModal({
      title: `¿Borrar a ${label}?`,
      body: "Se borra su conversación, sus estados y TODO su historial. Es irreversible. Úsalo para volver a empezar la prueba desde cero.",
      danger: true,
      confirmLabel: "Borrar definitivamente",
      onConfirm: () => void doDeleteCandidate(candidate)
    });
  }

  async function doDeleteCandidate(candidate: Candidate) {
    const label = candidate.firstName?.trim() || `@${candidate.instagramUsername}`;
    try {
      const response = await fetch(`/api/candidates/${candidate.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
      if (!response.ok) {
        setCrmNotice(`No se pudo borrar la candidata (${response.status}). ${data.error ?? ""}`.trim());
        return;
      }
      // Deseleccionar: si estaba abierta en la ficha o en Mensajes, limpiar para no apuntar a un id muerto.
      if (drawerCandidate?.id === candidate.id) closeDrawer();
      if (selectedCandidate?.id === candidate.id) {
        setSelectedCandidate(null);
        setMessages([]);
        setTransitions([]);
        setLastResult(null);
      }
      await refreshCandidates();
      setCrmNotice(`Borrada ${label} y todo su historial. Puedes empezar de cero.`);
    } catch (error) {
      setCrmNotice(`No se pudo borrar la candidata: ${error instanceof Error ? error.message : "error de red"}.`);
    }
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
    // jul-2026: NO ser optimista — si el servidor falla, no decir "Bot pausado" (era un falso exito que
    // dejaba a Alex creyendo que el bot estaba en pausa cuando seguia respondiendo).
    let response: Response;
    try {
      response = await fetch("/api/simulator/manual-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, manualControlActive: paused })
      });
    } catch (error) {
      setCrmNotice(
        `⚠️ No se pudo ${paused ? "pausar" : "reanudar"} el bot (error de red): ${error instanceof Error ? error.message : "sin conexión"}.`
      );
      return;
    }
    if (!response.ok) {
      setCrmNotice(`⚠️ No se pudo ${paused ? "pausar" : "reanudar"} el bot (${response.status}). Vuelve a intentarlo.`);
      return;
    }
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

  // Export CSV (contingencia: si Meta suspende la cuenta de IG, esta es la copia con telefono+estado). Genera
  // el archivo en el navegador desde la lista ya cargada; el BOM ﻿ hace que Excel abra bien los acentos.
  function exportCandidatesCsv() {
    const csv = candidatesToCsv(candidates);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFileName(new Date().toISOString());
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function applyHumanDecision(candidate: Candidate, decision: "APPROVE" | "REJECT") {
    // Decision humana explicita (invariante 4). Al aprobar, el bot propone la llamada (peticion #5).
    let response: Response;
    try {
      response = await fetch("/api/simulator/human-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, decision })
      });
    } catch (error) {
      setCrmNotice(
        `⚠️ No se pudo aplicar la decisión (error de red): ${error instanceof Error ? error.message : "sin conexión"}.`
      );
      return;
    }
    if (!response.ok) {
      setCrmNotice("No se pudo aplicar la decision.");
      return;
    }
    const data = (await response.json()) as {
      candidate: Candidate;
      proposedMessage: string | null;
      sentToCandidate?: SentToCandidate | null;
      deliveryError?: boolean;
    };
    if (decision === "APPROVE") {
      // No mentir sobre la ENTREGA (jul-2026): "le escribió" solo si el mensaje llegó DE VERDAD a un canal
      // real. sentToCandidate es un objeto { delivered, channel }: un { delivered:false } NO es entrega
      // (bug antiguo: lo contaba por ser truthy). channel "none" = candidata del simulador (sin envío real).
      const verdict = classifyDelivery(data.sentToCandidate, data.deliveryError);
      const msg = data.proposedMessage?.replace(/\n+/g, " ");
      setCrmNotice(
        !msg
          ? `@${candidate.instagramUsername} no estaba en revision: sin cambios.`
          : verdict === "delivered"
            ? `Aprobada @${candidate.instagramUsername}. El bot le escribió: "${msg}"`
            : verdict === "simulator"
              ? `Aprobada @${candidate.instagramUsername} (simulación). El bot respondería: "${msg}"`
              : `Aprobada @${candidate.instagramUsername}. ⚠️ El mensaje NO llegó a Instagram (pendiente): "${msg}"`
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
    setDrawerReply("");
  }

  // Responder a mano DESDE la ficha, como en un chat (no popup). Se envía a Instagram si está conectado
  // y recarga la conversación de la ficha para ver el mensaje al instante.
  async function sendDrawerReply() {
    if (!drawerCandidate || !drawerReply.trim() || loading) return;
    const candidate = drawerCandidate;
    const text = drawerReply.trim();
    setDrawerReply("");
    setLoading(true); // da feedback en el boton y pausa el auto-refresco mientras se envia
    try {
      await doSendManualReply(candidate, text);
      // Al responder a mano, Alex toma el control: el bot se pausa hasta que lo reactive.
      if (!(candidate.manualControlActive || candidate.automationPaused)) {
        await setBotPaused(candidate, true);
      }
      const response = await fetch(`/api/candidates/${candidate.id}/conversation`);
      if (response.ok) {
        const data = (await response.json()) as { messages: ConversationMessage[]; transitions: StateTransition[] };
        setDrawerMessages(data.messages ?? []);
        setDrawerTransitions(data.transitions ?? []);
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
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

  // Responder a la candidata seleccionada DESDE la bandeja (Mensajes), como en Instagram: va a su Instagram
  // y el bot se pausa (Alex toma el control). Recarga la conversacion al instante.
  async function sendChatReply() {
    if (!selectedCandidate || !message.trim() || loading) return;
    const candidate = selectedCandidate;
    const text = message.trim();
    setMessage("");
    setLoading(true); // feedback en el boton + pausa el auto-refresco mientras se envia
    try {
      await doSendManualReply(candidate, text);
      if (!(candidate.manualControlActive || candidate.automationPaused)) {
        await setBotPaused(candidate, true);
      }
      const response = await fetch(`/api/candidates/${candidate.id}/conversation`);
      if (response.ok) {
        const data = (await response.json()) as { messages: ConversationMessage[]; transitions: StateTransition[] };
        setMessages(data.messages ?? []);
        setTransitions(data.transitions ?? []);
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
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
    // Candidata de WhatsApp (clave wa:<digitos>) -> se responde por la Cloud API de WhatsApp; el resto, por
    // Instagram. El bot nunca auto-responde por WhatsApp: esto es Alex escribiendo a mano.
    const isWhatsApp = candidate.instagramUsername.startsWith("wa:");
    const response = await fetch(isWhatsApp ? "/api/whatsapp/send" : "/api/simulator/manual-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, message: text.trim() })
    });
    if (!response.ok) {
      setCrmNotice("No se pudo enviar la respuesta.");
      return;
    }
    if (isWhatsApp) {
      const data = (await response.json()) as { sentToWhatsApp: boolean };
      const num = candidate.phone || candidate.instagramUsername.replace(/^wa:/, "");
      setCrmNotice(
        data.sentToWhatsApp
          ? `Respuesta enviada por WhatsApp a +${num}.`
          : `Respuesta guardada para +${num} (no se pudo enviar: revisa la conexion o la ventana de 24h).`
      );
    } else {
      const data = (await response.json()) as { sentToInstagram: boolean };
      setCrmNotice(
        data.sentToInstagram
          ? `Respuesta enviada a @${candidate.instagramUsername} por Instagram.`
          : `Respuesta guardada para @${candidate.instagramUsername} (Instagram no conectado todavia).`
      );
    }
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
    // "No encaja" descarta a la candidata en la revisión de perfil (irreversible, y el botón está pegado a
    // "Encaja"): pedir confirmación para evitar el clic por error (jul-2026, hallazgo no-encaja-sin-confirmacion).
    if (action === "PROFILE_NO_FIT") {
      openModal({
        title: `¿Descartar a @${candidate.instagramUsername}?`,
        body: "La marcarás como que NO encaja en la revisión de perfil y se descarta. Úsalo solo si de verdad no es válida.",
        danger: true,
        confirmLabel: "No encaja, descartar",
        onConfirm: () => void doAdvanceStage(candidate, "PROFILE_NO_FIT")
      });
      return;
    }
    void doAdvanceStage(candidate, action);
  }

  async function doAdvanceStage(candidate: Candidate, action: AdvanceAction, slot?: string) {
    let response: Response;
    try {
      response = await fetch("/api/simulator/advance-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, action, slot })
      });
    } catch (error) {
      setCrmNotice(`⚠️ No se pudo aplicar la acción (error de red): ${error instanceof Error ? error.message : "sin conexión"}.`);
      return;
    }
    if (!response.ok) {
      setCrmNotice("No se pudo aplicar la accion.");
      return;
    }
    const data = (await response.json()) as {
      candidate: Candidate;
      proposedMessage: string | null;
      sentToCandidate?: SentToCandidate | null;
      deliveryError?: boolean;
      blockedReason?: string | null;
    };
    // La accion no se pudo aplicar por falta de datos (p.ej. confirmar llamada sin telefono/hora): mostrar el
    // motivo real, NO un falso "Llamada confirmada". El estado no cambia.
    if (data.blockedReason) {
      setCrmNotice(`⚠️ ${data.blockedReason}`);
      if (selectedCandidate?.id === candidate.id) setSelectedCandidate(data.candidate);
      if (drawerCandidate?.id === candidate.id) setDrawerCandidate(data.candidate);
      await refreshCandidates();
      return;
    }
    const labels: Record<typeof action, string> = {
      PROFILE_FIT: `Perfil de @${candidate.instagramUsername} verificado: sigue la cualificacion.`,
      PROFILE_NO_FIT: `@${candidate.instagramUsername} descartada en la revision de perfil.`,
      CONFIRM_CALL: `Llamada confirmada para @${candidate.instagramUsername}.`,
      PROFILE_OK: `✓ Perfil de @${candidate.instagramUsername} marcado como revisado y OK.`,
      REJECT: `@${candidate.instagramUsername} rechazada: el bot deja de responderle.`,
      FOLLOW_REQUEST_SENT: `Solicitud enviada a @${candidate.instagramUsername}: el bot deja de pedirla y pasa a revision de perfil.`,
      DEVICE_APPROVE: `📱 Móvil de @${candidate.instagramUsername} aprobado. Si el perfil también está OK, el bot agenda la llamada.`,
      DEVICE_REJECT: `📱 Móvil de @${candidate.instagramUsername} marcado como no válido.`
    };
    // Si el motor no aplico nada (estado incompatible), no mentir con un aviso de exito. PROFILE_OK
    // (marcar el perfil como OK) es idempotente y SIEMPRE cuenta como aplicado (deja constancia + badge),
    // aunque ya estuviera marcado: no debe decir "sin cambios".
    // PROFILE_OK y las decisiones de MOVIL cambian datos (sello/elegibilidad) aunque no muevan el estado:
    // no deben reportar "sin cambios".
    const alwaysCounts = action === "PROFILE_OK" || action === "DEVICE_APPROVE" || action === "DEVICE_REJECT";
    const appliedNothing = !data.proposedMessage && data.candidate.currentState === candidate.currentState && !alwaysCounts;
    if (appliedNothing) {
      setCrmNotice(
        `Sin cambios para @${candidate.instagramUsername}: esa acción no aplica en su estado actual (${stateLabel(candidate.currentState)}).`
      );
    } else if (data.proposedMessage) {
      // No mentir sobre la ENTREGA (jul-2026): "escribió" solo si de verdad llegó a un canal REAL de la
      // candidata. sentToCandidate es un objeto { delivered, channel }: { delivered:false } NO es entrega
      // (bug antiguo: lo contaba por ser truthy); channel "none" es candidata del simulador (sin envío externo).
      const verdict = classifyDelivery(data.sentToCandidate, data.deliveryError);
      const msg = data.proposedMessage.replace(/\n+/g, " ");
      setCrmNotice(
        verdict === "delivered"
          ? `${labels[action]} El bot escribió: "${msg}"`
          : verdict === "simulator"
            ? `${labels[action]} (simulación) El bot respondería: "${msg}"`
            : `${labels[action]} ⚠️ La respuesta NO llegó a enviarse a Instagram (queda pendiente): "${msg}"`
      );
    } else {
      setCrmNotice(labels[action]);
    }
    if (selectedCandidate?.id === candidate.id) {
      setSelectedCandidate(data.candidate);
    }
    if (drawerCandidate?.id === candidate.id) {
      setDrawerCandidate(data.candidate);
    }
    await refreshCandidates();
  }

  // LLAMADA DE PRUEBA: dispara una llamada al numero que Alex teclea (el suyo), sin simular toda la conversacion.
  async function doTestCall() {
    const phone = testCallPhone.trim();
    if (phone.replace(/[^\d]/g, "").length < 8) {
      setTestCallResult("⚠️ Escribe un número de WhatsApp válido con prefijo (ej. +34 6XX XXX XXX).");
      return;
    }
    setTestCallBusy(true);
    setTestCallResult("📞 Lanzando llamada de prueba…");
    try {
      const response = await fetch("/api/call/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (response.ok && data.ok) {
        setTestCallResult("✅ Llamada lanzada: tu teléfono debería sonar en unos segundos.");
      } else {
        setTestCallResult(`❌ No se pudo: ${data.error ?? `error ${response.status}`}`);
      }
    } catch (error) {
      setTestCallResult(`❌ Error de red: ${error instanceof Error ? error.message : "desconocido"}`);
    } finally {
      setTestCallBusy(false);
    }
  }

  return (
    <div className="app-frame" id="rm-root">
      {/* Fondo ambiental de la maqueta (verbatim): dos blobs a la deriva + grano + viñeta. position:fixed,
          pointer-events:none, detrás del contenido. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          width: 640,
          height: 640,
          left: "8%",
          top: "-14%",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(var(--accent-rgb),.16),transparent 66%)",
          filter: "blur(46px)",
          pointerEvents: "none",
          zIndex: 0,
          animation: "bloomDrift 26s ease-in-out infinite"
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          width: 560,
          height: 560,
          right: "2%",
          bottom: "-16%",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(185,139,201,.12),transparent 66%)",
          filter: "blur(50px)",
          pointerEvents: "none",
          zIndex: 0,
          animation: "bloomDrift2 32s ease-in-out infinite"
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          opacity: 0.5,
          backgroundImage: "radial-gradient(rgba(var(--line-rgb),.02) 1px,transparent 1px)",
          backgroundSize: "4px 4px"
        }}
      />
      {/* Brillo que sigue al cursor (dos capas, mix-blend screen). Los mueve el efecto glow/ripple. */}
      <div
        id="rm-glow-a"
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 540,
          height: 540,
          margin: "-270px 0 0 -270px",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 2,
          background: "radial-gradient(circle,rgba(var(--accent-rgb),.24),rgba(var(--accent-rgb),0) 66%)",
          filter: "blur(42px)",
          mixBlendMode: "screen",
          willChange: "transform"
        }}
      />
      <div
        id="rm-glow-b"
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 360,
          height: 360,
          margin: "-180px 0 0 -180px",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 2,
          background: "radial-gradient(circle,rgba(220,182,132,.20),rgba(220,182,132,0) 64%)",
          filter: "blur(34px)",
          mixBlendMode: "screen",
          willChange: "transform"
        }}
      />
      {/* ===== INTRO SPLASH (reproducción FIEL: pétalos + monograma + wordmark). Solo primera visita. ===== */}
      {showIntro ? (
        <div
          onClick={() => setShowIntro(false)}
          style={
            {
              position: "fixed",
              inset: 0,
              zIndex: 100,
              transformOrigin: "center",
              "--text": "#F7F0EF",
              "--text2": "#E4B7C1",
              "--text3": "#8f7f86",
              "--line-rgb": "255,255,255",
              background: "radial-gradient(1000px 720px at 50% 42%,#1d1017,#0b0609 72%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              overflow: "hidden",
              animation: "introOut .7s 2.5s forwards"
            } as React.CSSProperties
          }
        >
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
            {(
              [
                { l: "9%", s: 13, g: "a", d: 3.2, dl: 0.05 },
                { l: "19%", s: 9, g: "gold", d: 3.8, dl: 0.5 },
                { l: "28%", s: 15, g: "violet", d: 2.9, dl: 0.9 },
                { l: "38%", s: 11, g: "a", d: 3.5, dl: 0.2 },
                { l: "47%", s: 8, g: "gold", d: 4.1, dl: 1.2 },
                { l: "56%", s: 14, g: "a", d: 3.1, dl: 0.7 },
                { l: "65%", s: 10, g: "violet", d: 3.7, dl: 0.35 },
                { l: "74%", s: 12, g: "a", d: 3.3, dl: 1 },
                { l: "83%", s: 9, g: "gold", d: 4, dl: 0.15 },
                { l: "91%", s: 13, g: "violet", d: 3, dl: 0.85 }
              ] as const
            ).map((p, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  top: -40,
                  left: p.l,
                  width: p.s,
                  height: p.s,
                  borderRadius: "0 100% 0 100%",
                  background:
                    p.g === "a"
                      ? "linear-gradient(135deg,var(--accent),var(--accent3))"
                      : p.g === "gold"
                        ? "linear-gradient(135deg,#E9C79B,#C99B62)"
                        : "linear-gradient(135deg,#B98BC9,#8A5FA6)",
                  opacity: 0,
                  animation: `petalFall ${p.d}s ${p.dl}s ease-in infinite`
                }}
              />
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              width: 340,
              height: 340,
              borderRadius: "50%",
              background: "radial-gradient(circle,rgba(var(--accent-rgb),.5),transparent 64%)",
              animation: "introBloom 2.2s .15s ease-out forwards"
            }}
          />
          <div
            style={{
              position: "relative",
              width: 110,
              height: 110,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 30,
              animation: "introMono 1.1s cubic-bezier(.2,.9,.3,1) both"
            }}
          >
            <svg width="110" height="110" viewBox="0 0 100 100" style={{ position: "absolute", inset: 0 }}>
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(var(--accent-rgb),.18)" strokeWidth="1" />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray="283"
                style={{
                  animation: "drawRing 1.5s .3s ease-out both",
                  transform: "rotate(-90deg)",
                  transformOrigin: "center",
                  filter: "drop-shadow(0 0 5px rgba(var(--accent-rgb),.6))"
                }}
              />
            </svg>
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: "50%",
                background: "linear-gradient(140deg,var(--accent),var(--accent3))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 12px 44px rgba(200,90,120,.55)"
              }}
            >
              <span style={{ fontFamily: "var(--font-bodoni)", fontWeight: 700, color: "#fff", fontSize: 42, lineHeight: 1 }}>
                R
              </span>
            </div>
          </div>
          <div
            data-m="introword"
            style={
              {
                fontFamily: "var(--font-bodoni)",
                fontWeight: 600,
                fontSize: 40,
                letterSpacing: ".16em",
                background: "linear-gradient(100deg,var(--text) 25%,#E9C79B 45%,var(--accent) 55%,var(--text) 75%)",
                backgroundSize: "200% auto",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
                animation: "introWord 1s .45s both,shimmerText 2.6s .5s linear infinite"
              } as React.CSSProperties
            }
          >
            ROSE&nbsp;MODELS
          </div>
          <div
            style={{
              fontFamily: "var(--font-jost)",
              fontWeight: 300,
              fontSize: 12,
              color: "#C99AA6",
              marginTop: 14,
              textTransform: "uppercase",
              animation: "introSub 1.1s .85s both"
            }}
          >
            Management
          </div>
          <div
            style={{
              width: 130,
              height: 1,
              background: "linear-gradient(90deg,transparent,var(--accent),transparent)",
              marginTop: 26,
              animation: "introLine 1s 1.05s both"
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 36,
              fontFamily: "var(--font-jost)",
              fontSize: 11,
              color: "#6f5f66",
              letterSpacing: ".14em",
              textTransform: "uppercase",
              animation: "introWord 1s 1.7s both"
            }}
          >
            Pulsa para entrar
          </div>
        </div>
      ) : null}

      {/* ===== CABECERA (reproducción FIEL de la maqueta) ===== */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          backdropFilter: "blur(16px)",
          background: "linear-gradient(180deg,rgba(var(--s2),.9),rgba(var(--s2),.55))",
          borderBottom: "1px solid rgba(var(--accent-rgb),.14)"
        }}
      >
        <div
          data-m="navwrap"
          style={{
            maxWidth: 1320,
            margin: "0 auto",
            padding: "0 30px",
            height: 70,
            display: "flex",
            alignItems: "center",
            gap: 30
          }}
        >
          {/* Logo + wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "linear-gradient(140deg,var(--accent),var(--accent3))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 6px 20px rgba(200,90,120,.4)"
              }}
            >
              <span style={{ fontFamily: "var(--font-bodoni)", fontWeight: 700, color: "#fff", fontSize: 19, lineHeight: 1 }}>
                R
              </span>
            </div>
            <div data-m="hidesmall" style={{ lineHeight: 1.05 }}>
              <div
                style={{
                  fontFamily: "var(--font-bodoni)",
                  fontWeight: 600,
                  letterSpacing: ".16em",
                  fontSize: 16,
                  color: "var(--text)"
                }}
              >
                ROSE MODELS
              </div>
              <div
                style={{
                  fontFamily: "var(--font-jost)",
                  fontWeight: 400,
                  fontSize: 9,
                  letterSpacing: ".52em",
                  color: "#C99AA6",
                  marginTop: 3
                }}
              >
                M A N A G E M E N T
              </div>
            </div>
          </div>

          {/* Pestañas */}
          <nav data-m="tabs-top" style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 6 }}>
            {(
              [
                { key: "DASHBOARD", label: "Resumen" },
                { key: "CRM", label: "CRM" },
                { key: "LLAMADAS", label: "Llamadas" },
                { key: "ANUNCIOS", label: "Anuncios" },
                { key: "CHAT", label: "Mensajes" }
              ] as const
            ).map((t) => {
              const active = activeTab === t.key;
              const pending = t.key === "CHAT" ? candidates.filter(needsHumanDecision).length : 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    position: "relative",
                    padding: "10px 16px",
                    borderRadius: 10,
                    fontFamily: "var(--font-jost)",
                    fontWeight: 500,
                    fontSize: 13,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: active ? "var(--text)" : "var(--text3)",
                    transition: ".25s",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                >
                  {t.label}
                  {pending > 0 ? (
                    <span
                      style={{
                        minWidth: 18,
                        height: 18,
                        padding: "0 5px",
                        borderRadius: 9,
                        background: "var(--accent)",
                        color: "var(--accent-contrast)",
                        fontFamily: "var(--font-jost)",
                        fontWeight: 600,
                        fontSize: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      {pending}
                    </span>
                  ) : null}
                  <span
                    style={{
                      position: "absolute",
                      left: 16,
                      right: 16,
                      bottom: 3,
                      height: 1.5,
                      background: "var(--accent)",
                      opacity: active ? 1 : 0,
                      transition: ".25s"
                    }}
                  />
                </button>
              );
            })}
          </nav>

          {/* Derecha: píldora IA + modo/acentos + avatar */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div
              data-m="hidesmall"
              title={`Persistencia: ${runtimeStatus?.persistenceMode ?? "..."} · IA: ${runtimeStatus?.llmMode ?? "..."}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "7px 12px",
                borderRadius: 20,
                border: "1px solid rgba(214,178,124,.28)",
                background: "rgba(214,178,124,.06)"
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#D6B27C",
                  animation: "softPulse 2.4s ease-in-out infinite"
                }}
              />
              <span style={{ fontFamily: "var(--font-jost)", fontSize: 11, color: "var(--text2)", letterSpacing: ".04em" }}>
                IA · {runtimeStatus?.writingModel ?? "…"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 22,
                border: "1px solid rgba(var(--line-rgb),.12)",
                background: "rgba(var(--s2),.5)"
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const next = theme === "dark" ? "light" : "dark";
                  setTheme(next);
                  const root = document.documentElement;
                  root.dataset.theme = next;
                  root.dataset.mode = next;
                  window.localStorage.setItem("rm-theme", JSON.stringify({ mode: next, accent }));
                }}
                title="Cambiar modo"
                style={{
                  width: 26,
                  height: 26,
                  border: "none",
                  cursor: "pointer",
                  borderRadius: "50%",
                  background: "rgba(var(--accent-rgb),.16)",
                  color: "var(--accent)",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: ".2s"
                }}
              >
                {theme === "dark" ? "☀" : "☾"}
              </button>
              <span style={{ width: 1, height: 16, background: "rgba(var(--line-rgb),.14)" }} />
              {(
                [
                  { k: "rose", hex: "#E68CA0" },
                  { k: "green", hex: "#37B26B" },
                  { k: "blue", hex: "#4C8DF0" },
                  { k: "violet", hex: "#A66BE8" },
                  { k: "gold", hex: "#D6A94B" }
                ] as const
              ).map((d) => (
                <button
                  key={d.k}
                  type="button"
                  onClick={() => {
                    setAccent(d.k);
                    document.documentElement.dataset.accent = d.k;
                    window.localStorage.setItem("rm-theme", JSON.stringify({ mode: theme, accent: d.k }));
                  }}
                  title={d.k}
                  style={{
                    width: 17,
                    height: 17,
                    borderRadius: "50%",
                    cursor: "pointer",
                    background: d.hex,
                    border: `2px solid ${accent === d.k ? "var(--text)" : "transparent"}`,
                    boxShadow: "0 0 0 1px rgba(var(--line-rgb),.1)",
                    transition: ".2s"
                  }}
                />
              ))}
            </div>
            <div
              data-m="hidesmall"
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "linear-gradient(140deg,#B98BC9,#8A5FA6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-bodoni)",
                fontWeight: 600,
                color: "#fff",
                fontSize: 15,
                boxShadow: "0 4px 14px rgba(138,95,166,.4)"
              }}
            >
              A
            </div>
          </div>
        </div>
      </header>

      {/* ===== BOTTOM NAV (móvil) — reproducción FIEL. Oculta en desktop, visible en móvil por data-m. ===== */}
      <nav
        data-m="botnav"
        style={{
          display: "none",
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 35,
          height: 64,
          padding: "6px 6px calc(6px + env(safe-area-inset-bottom))",
          background: "linear-gradient(0deg,rgba(var(--s2),.98),rgba(var(--s2),.86))",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(var(--line-rgb),.12)",
          alignItems: "stretch",
          justifyContent: "space-around"
        }}
      >
        {(
          [
            { key: "DASHBOARD", label: "Resumen", icon: "◈", size: 19 },
            { key: "CRM", label: "CRM", icon: "▦", size: 19 },
            { key: "LLAMADAS", label: "Llamadas", icon: "☎", size: 18 },
            { key: "CHAT", label: "Mensajes", icon: "✉", size: 17 }
          ] as const
        ).map((t) => {
          const active = activeTab === t.key;
          const pending = t.key === "CHAT" ? candidates.filter(needsHumanDecision).length : 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: active ? "var(--accent)" : "var(--text3)",
                fontFamily: "var(--font-jost)",
                fontSize: 10,
                letterSpacing: ".03em",
                transition: ".2s",
                position: "relative"
              }}
            >
              <span style={{ fontSize: t.size, lineHeight: 1 }}>{t.icon}</span>
              {t.label}
              {pending > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: -2,
                    right: "calc(50% - 22px)",
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    borderRadius: 8,
                    background: "var(--accent)",
                    color: "var(--accent-contrast)",
                    fontWeight: 600,
                    fontSize: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {pending}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

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
            const llamadasCount = funnel[4].count;
            const cerradasCount = funnel[5].count;
            // "Llamadas hoy": usa la fecha REAL (scheduledCallStartMs) cuando existe; respaldo por texto para
            // citas antiguas sin timestamp. Antes solo miraba el texto "hoy"/"ahora" y se dejaba fuera una
            // cita de hoy escrita de otra forma.
            const todayStartMs = new Date().setHours(0, 0, 0, 0);
            const todayEndMs = todayStartMs + 86_400_000;
            const todayCalls = candidates.filter(
              (item) =>
                item.currentState === "CALL_IN_PROGRESS" ||
                (typeof item.scheduledCallStartMs === "number"
                  ? item.scheduledCallStartMs >= todayStartMs && item.scheduledCallStartMs < todayEndMs
                  : item.scheduledCallSlot
                    ? /hoy|ahora/i.test(item.scheduledCallSlot)
                    : false)
            );
            const pct = (value: number): string => (total > 0 ? `${Math.round((value / total) * 100)}%` : "—");
            const recent = [...candidates].sort((a, b) => epochOf(b.lastMessageAt) - epochOf(a.lastMessageAt)).slice(0, 6);
            const initialOf = (item: Candidate): string =>
              (item.firstName?.trim() || item.instagramUsername || "?").charAt(0).toUpperCase();
            return (
              <div style={{ position: "relative", zIndex: 5, maxWidth: 1320, margin: "0 auto", padding: "34px 30px 80px" }}>
                <div style={{ animation: "scrRise .55s cubic-bezier(.16,1,.3,1) both" }}>
                  {/* HERO */}
                  <div data-m="hero" style={{ display: "grid", gridTemplateColumns: "1fr 372px", gap: 22, marginBottom: 26 }}>
                    <div style={{ animation: "fadeUp .7s both" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
                        <span style={{ width: 28, height: 1, background: "linear-gradient(90deg,var(--accent),transparent)" }} />
                        <span
                          style={{
                            fontFamily: "var(--font-jost)",
                            fontSize: 11,
                            letterSpacing: ".34em",
                            color: "var(--accent)",
                            textTransform: "uppercase"
                          }}
                        >
                          Panel de control
                        </span>
                      </div>
                      <h1
                        style={{
                          fontFamily: "var(--font-bodoni)",
                          fontWeight: 600,
                          fontSize: 52,
                          lineHeight: 1.02,
                          margin: 0,
                          letterSpacing: "-.01em",
                          color: "var(--text)"
                        }}
                      >
                        Buenas, <span style={{ fontStyle: "italic", color: "var(--accent)" }}>Alex</span>
                      </h1>
                      <p
                        style={{
                          color: "var(--text2)",
                          fontSize: 16,
                          lineHeight: 1.5,
                          margin: "14px 0 0",
                          maxWidth: 540,
                          fontWeight: 300
                        }}
                      >
                        Esto es lo que ocurre en tu embudo ahora mismo. Rose trabaja{" "}
                        <span style={{ color: "#D6B27C" }}>día y noche</span> captando y cualificando talento por ti.
                      </p>
                    </div>
                    <div
                      onClick={() => (total === 0 ? void seedDemo() : setActiveTab("CRM"))}
                      style={{
                        animation: "fadeUp .7s .08s both",
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 18,
                        padding: 24,
                        background: "linear-gradient(150deg,rgba(var(--accent-rgb),.14),rgba(185,139,201,.06))",
                        border: "1px solid rgba(var(--accent-rgb),.24)",
                        cursor: "pointer",
                        transition: ".3s"
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          width: "40%",
                          background: "linear-gradient(105deg,transparent,rgba(var(--line-rgb),.1),transparent)",
                          animation: "sheen 6s ease-in-out infinite"
                        }}
                      />
                      <div
                        style={{
                          fontFamily: "var(--font-jost)",
                          fontSize: 10.5,
                          letterSpacing: ".28em",
                          color: "var(--accent)",
                          textTransform: "uppercase"
                        }}
                      >
                        Acción sugerida
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-bodoni)",
                          fontWeight: 600,
                          fontSize: 30,
                          margin: "12px 0 4px",
                          color: "var(--text)"
                        }}
                      >
                        {total === 0
                          ? "Cargar demo"
                          : `${pendingList.length} ${pendingList.length === 1 ? "decisión" : "decisiones"}`}
                      </div>
                      <div style={{ color: "var(--text2)", fontSize: 14, fontWeight: 300 }}>
                        {total === 0 ? "añade candidatas de ejemplo para ver el panel" : "te esperan para aprobar o descartar"}
                      </div>
                      <div
                        style={{
                          marginTop: 18,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 9,
                          fontFamily: "var(--font-jost)",
                          fontWeight: 500,
                          fontSize: 13,
                          letterSpacing: ".06em",
                          color: "var(--accent)"
                        }}
                      >
                        {total === 0 ? "Cargar ahora" : "Revisar ahora"} <span style={{ fontSize: 15 }}>→</span>
                      </div>
                    </div>
                  </div>

                  {/* KPIs */}
                  <div data-m="kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18, marginBottom: 26 }}>
                    {(
                      [
                        {
                          label: "Te esperan",
                          value: pendingList.length,
                          color: "var(--accent)",
                          sub: "decisiones pendientes",
                          delay: 0.05,
                          bar: "var(--accent)",
                          bd: 0.2
                        },
                        {
                          label: "Activas",
                          value: active,
                          color: "#D6B27C",
                          sub: "en el embudo",
                          delay: 0.12,
                          bar: "#D6B27C",
                          bd: 0.28
                        },
                        {
                          label: "Llamadas hoy",
                          value: todayCalls.length,
                          color: "#B98BC9",
                          sub: "agendadas",
                          delay: 0.19,
                          bar: "#B98BC9",
                          bd: 0.36
                        },
                        {
                          label: "Total talento",
                          value: total,
                          color: "var(--text2)",
                          sub: "en base de datos",
                          delay: 0.26,
                          bar: "#A9B4C4",
                          bd: 0.44
                        }
                      ] as const
                    ).map((k) => (
                      <div
                        key={k.label}
                        style={{
                          animation: `popIn .55s ${k.delay}s both`,
                          position: "relative",
                          overflow: "hidden",
                          borderRadius: 16,
                          padding: 22,
                          background: "rgba(var(--s1),.6)",
                          border: "1px solid rgba(var(--line-rgb),.06)",
                          transition: ".3s"
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "var(--font-jost)",
                            fontSize: 10.5,
                            letterSpacing: ".2em",
                            color: "#A99098",
                            textTransform: "uppercase"
                          }}
                        >
                          {k.label}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-bodoni)",
                            fontWeight: 600,
                            fontSize: 52,
                            lineHeight: 1,
                            marginTop: 14,
                            color: k.color
                          }}
                        >
                          {k.value}
                        </div>
                        <div style={{ color: "var(--text3)", fontSize: 12.5, marginTop: 8, fontWeight: 300 }}>{k.sub}</div>
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            bottom: 0,
                            height: 2,
                            width: "100%",
                            background: `linear-gradient(90deg,${k.bar},transparent)`,
                            transformOrigin: "left",
                            animation: `barGrow 1s ${k.bd}s both`
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* EMBUDO */}
                  <div
                    style={{
                      animation: "fadeUp .7s .2s both",
                      borderRadius: 18,
                      padding: 26,
                      background: "rgba(var(--s2),.5)",
                      border: "1px solid rgba(var(--line-rgb),.06)",
                      marginBottom: 26
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22 }}>
                      <div>
                        <div style={{ fontFamily: "var(--font-bodoni)", fontWeight: 600, fontSize: 23, color: "var(--text)" }}>
                          Embudo de talento
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-jost)",
                            fontSize: 12.5,
                            color: "var(--text3)",
                            marginTop: 4,
                            fontWeight: 300
                          }}
                        >
                          {total} candidatas · flujo en tiempo real
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("CRM")}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "var(--font-jost)",
                          fontWeight: 500,
                          fontSize: 13,
                          letterSpacing: ".05em",
                          color: "var(--accent)"
                        }}
                      >
                        Abrir CRM →
                      </button>
                    </div>
                    <div data-m="funnel" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                      {funnel.map((phase) => (
                        <div
                          key={phase.label}
                          onClick={() => setActiveTab(phase.label === "Llamadas" ? "LLAMADAS" : "CRM")}
                          style={{
                            cursor: "pointer",
                            borderRadius: 14,
                            padding: "18px 16px",
                            background: "rgba(var(--s3),.55)",
                            border: "1px solid rgba(var(--line-rgb),.05)",
                            transition: ".3s",
                            position: "relative",
                            overflow: "hidden"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: `var(${phase.colorVar})` }} />
                            <span
                              style={{
                                fontFamily: "var(--font-jost)",
                                fontSize: 10.5,
                                letterSpacing: ".1em",
                                color: "#A99098",
                                textTransform: "uppercase",
                                fontWeight: 400
                              }}
                            >
                              {phase.label}
                            </span>
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-bodoni)",
                              fontWeight: 600,
                              fontSize: 38,
                              lineHeight: 1,
                              color: `var(${phase.colorVar})`
                            }}
                          >
                            {phase.count}
                          </div>
                          <div
                            style={{
                              marginTop: 14,
                              height: 3,
                              borderRadius: 4,
                              background: "rgba(var(--line-rgb),.06)",
                              overflow: "hidden"
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${Math.round((phase.count / funnelMax) * 100)}%`,
                                background: `var(${phase.colorVar})`,
                                borderRadius: 4,
                                transformOrigin: "left",
                                animation: "barGrow 1.1s .3s both"
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SPLIT: llamadas de hoy + actividad */}
                  <div data-m="split" style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 22 }}>
                    <div
                      style={{
                        animation: "fadeUp .7s .28s both",
                        borderRadius: 18,
                        padding: 24,
                        background: "rgba(var(--s2),.5)",
                        border: "1px solid rgba(var(--line-rgb),.06)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ fontFamily: "var(--font-bodoni)", fontWeight: 600, fontSize: 19, color: "var(--text)" }}>
                          Llamadas de hoy
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab("LLAMADAS")}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "var(--font-jost)",
                            fontWeight: 500,
                            fontSize: 12.5,
                            letterSpacing: ".04em",
                            color: "#B98BC9"
                          }}
                        >
                          Ver todas →
                        </button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {todayCalls.length === 0 ? (
                          <div style={{ color: "var(--text3)", fontSize: 13, fontWeight: 300, padding: "8px 2px" }}>
                            Sin llamadas para hoy.
                          </div>
                        ) : (
                          todayCalls.map((item) => (
                            <div
                              key={item.id}
                              onClick={() => void openDrawer(item)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 14,
                                padding: "12px 14px",
                                borderRadius: 12,
                                background: "rgba(var(--s3),.5)",
                                border: "1px solid rgba(var(--line-rgb),.05)",
                                transition: ".25s",
                                cursor: "pointer"
                              }}
                            >
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: "50%",
                                  background: `var(${ringColorVar(item)})`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontFamily: "var(--font-bodoni)",
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: "var(--accent-contrast)"
                                }}
                              >
                                {initialOf(item)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, fontSize: 14.5, color: "var(--text)" }}>
                                  {item.firstName?.trim() || `@${item.instagramUsername}`}
                                </div>
                                <div
                                  style={{ fontFamily: "var(--font-jost)", fontSize: 11, color: "var(--text3)", fontWeight: 300 }}
                                >
                                  {callCardSlotText(item)}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontFamily: "var(--font-jost)",
                                  fontSize: 9.5,
                                  padding: "4px 11px",
                                  borderRadius: 20,
                                  background: `color-mix(in srgb, var(${stateColorVar(item.currentState)}) 14%, transparent)`,
                                  color: `var(${stateColorVar(item.currentState)})`,
                                  letterSpacing: ".08em",
                                  textTransform: "uppercase",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {stateLabel(item.currentState)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        animation: "fadeUp .7s .34s both",
                        borderRadius: 18,
                        padding: 24,
                        background: "rgba(var(--s2),.5)",
                        border: "1px solid rgba(var(--line-rgb),.06)"
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-bodoni)",
                          fontWeight: 600,
                          fontSize: 19,
                          marginBottom: 16,
                          color: "var(--text)"
                        }}
                      >
                        Actividad reciente
                      </div>
                      {recent.length === 0 ? (
                        <div style={{ color: "var(--text3)", fontSize: 13, fontWeight: 300 }}>Sin actividad todavía.</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {recent.map((item, index) => (
                            <div
                              key={item.id}
                              onClick={() => void openDrawer(item)}
                              style={{ display: "flex", gap: 14, padding: "10px 2px", cursor: "pointer" }}
                            >
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                                <span
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: "50%",
                                    background: `var(${stateColorVar(item.currentState)})`,
                                    flexShrink: 0
                                  }}
                                />
                                {index < recent.length - 1 ? (
                                  <span style={{ width: 1, flex: 1, background: "rgba(var(--line-rgb),.08)", marginTop: 5 }} />
                                ) : null}
                              </div>
                              <div style={{ flex: 1, paddingBottom: 8 }}>
                                <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.4, fontWeight: 300 }}>
                                  <strong style={{ fontWeight: 500, color: "var(--text)" }}>
                                    {item.firstName?.trim() || `@${item.instagramUsername}`}
                                  </strong>{" "}
                                  · {stateLabel(item.currentState)}
                                </div>
                                <div
                                  style={{ fontFamily: "var(--font-jost)", fontSize: 10.5, color: "var(--text3)", marginTop: 3 }}
                                >
                                  {relTime(item.lastMessageAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {activeTab === "LLAMADAS"
        ? (() => {
            // Todo derivado de las candidatas (sin histórico): conteos reales, nada inventado.
            const isCallRelated = (item: Candidate): boolean =>
              item.lastCall != null ||
              item.currentState === "CALL_IN_PROGRESS" ||
              item.currentState === "CALL_COMPLETED" ||
              item.currentState === "CALL_NO_ANSWER" ||
              item.currentState === "CALL_SCHEDULED" ||
              Boolean(item.scheduledCallSlot);
            const callList = candidates.filter(isCallRelated).sort((a, b) => {
              const live = (item: Candidate) => (item.currentState === "CALL_IN_PROGRESS" ? 1 : 0);
              return live(b) - live(a);
            });
            const by = (state: Candidate["currentState"]) => callList.filter((item) => item.currentState === state).length;
            const completed = by("CALL_COMPLETED");
            const noans = by("CALL_NO_ANSWER");
            const inprog = by("CALL_IN_PROGRESS");
            const sched = callList.filter(
              (item) => item.currentState === "CALL_SCHEDULED" || (!item.lastCall && Boolean(item.scheduledCallSlot))
            ).length;
            const attempted = completed + noans;
            const durations = callList
              .map((item) => item.lastCall?.durationSec)
              .filter((value): value is number => typeof value === "number");
            const avgDurSec = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
            const shares = callList
              .map((item) => item.lastCall?.negotiatedModelShare)
              .filter((value): value is number => typeof value === "number");
            const avgShare = shares.length ? Math.round(shares.reduce((a, b) => a + b, 0) / shares.length) : null;
            const fmtDur = (seconds?: number | null): string =>
              seconds != null ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—";
            const kpis: { label: string; value: string | number; colorVar: string }[] = [
              { label: "Llamadas hechas", value: attempted, colorVar: "--text" },
              { label: "Completadas", value: completed, colorVar: "--success" },
              { label: "No contestó", value: noans, colorVar: "--danger" },
              { label: "En curso", value: inprog, colorVar: "--purple" },
              { label: "Agendadas", value: sched, colorVar: "--info" },
              { label: "Duración media", value: fmtDur(avgDurSec), colorVar: "--accent" }
            ];
            // Denominador = TOTAL (3-jul): antes se normalizaba contra el máximo de categorías y la
            // dominante (o única) salía clavada al 100% — parecía una barra de progreso rota.
            const outcomeMax = Math.max(1, sched + inprog + completed + noans);
            const outcomes: { label: string; count: number; colorVar: string }[] = [
              { label: "Agendadas", count: sched, colorVar: "--info" },
              { label: "En curso", count: inprog, colorVar: "--purple" },
              { label: "Hechas", count: completed, colorVar: "--success" },
              { label: "No contestó", count: noans, colorVar: "--danger" }
            ];
            const resultText = (item: Candidate): string => {
              if (item.currentState === "CALL_IN_PROGRESS") return "En curso…";
              if (item.lastCall?.summary) return item.lastCall.summary;
              if (item.lastCall?.result === "COMPLETED") return "Completada";
              if (item.lastCall?.result === "NO_ANSWER") return "Sin respuesta";
              return item.scheduledCallSlot ? "Agendada" : "—";
            };
            return (
              <section className="panel">
                <div className="calls2-head">
                  <h2 className="calls2-title">Llamadas</h2>
                  <p className="calls2-subtitle">
                    El bot de voz llama a las candidatas aprobadas, negocia el reparto y te pasa las que lo necesitan.
                  </p>
                </div>

                {/* Llamada de PRUEBA: probar la voz llamando a tu propio numero, sin simular la conversacion. */}
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                    margin: "0 0 1rem",
                    padding: "0.6rem 0.8rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--surface, var(--bg))"
                  }}
                >
                  <span className="muted">📞 Probar la voz llamando a tu número:</span>
                  <input
                    type="tel"
                    placeholder="+34 6XX XXX XXX"
                    value={testCallPhone}
                    onChange={(event) => setTestCallPhone(event.target.value)}
                    style={{
                      padding: "0.4rem 0.6rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      minWidth: "180px"
                    }}
                  />
                  <button
                    className="crm2-btn crm2-btn--teal"
                    type="button"
                    disabled={testCallBusy}
                    onClick={() => void doTestCall()}
                  >
                    {testCallBusy ? "Llamando…" : "Llamar de prueba"}
                  </button>
                  {testCallResult ? (
                    <span style={{ width: "100%", fontSize: "0.9rem", color: "var(--text)" }}>{testCallResult}</span>
                  ) : null}
                </div>

                <div className="calls2-kpis">
                  {kpis.map((kpi) => (
                    <div className="calls2-kpi" key={kpi.label}>
                      <div className="calls2-kpi-label">{kpi.label}</div>
                      <div className="calls2-kpi-value" style={{ color: `var(${kpi.colorVar})` }}>
                        {kpi.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="calls2-stack">
                  <div className="calls2-list">
                    {callList.length === 0 ? (
                      <div className="calls2-empty">
                        <div className="calls2-empty-icon">📞</div>
                        <div className="calls2-empty-text">Aún no hay llamadas. Aprueba candidatas y agéndalas.</div>
                      </div>
                    ) : (
                      callList.map((item) => (
                        <div key={item.id} className="calls2-card" onClick={() => void openDrawer(item)}>
                          <div className="calls2-card-top">
                            <span className="calls2-avatar" style={{ background: `var(${ringColorVar(item)})` }}>
                              {(item.firstName?.trim() || item.instagramUsername || "?").charAt(0).toUpperCase()}
                            </span>
                            <div className="calls2-id">
                              <div className="calls2-name-row">
                                <span className="calls2-name">{item.firstName?.trim() || `@${item.instagramUsername}`}</span>
                                <span className="calls2-username">@{item.instagramUsername}</span>
                              </div>
                              <div className="calls2-slot">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="9" />
                                  <path d="M12 7v5l3 2" />
                                </svg>
                                {callCardSlotText(item)}
                              </div>
                            </div>
                            <div className="calls2-status-wrap">
                              <span className="calls2-status" style={statePillStyle(item.currentState)}>
                                {stateLabel(item.currentState)}
                              </span>
                              {item.currentState === "CALL_IN_PROGRESS" ? (
                                <div className="calls2-live">
                                  <span className="calls2-live-dot" />
                                  en directo
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="calls2-metrics">
                            <div className="calls2-metric calls2-metric--dur">
                              <div className="calls2-metric-label">Duración</div>
                              <div className="calls2-metric-value">{fmtDur(item.lastCall?.durationSec)}</div>
                            </div>
                            <div className="calls2-metric calls2-metric--split">
                              <div className="calls2-metric-label">Reparto</div>
                              <div className="calls2-metric-value">
                                {item.lastCall?.negotiatedModelShare != null ? `${item.lastCall.negotiatedModelShare}%` : "—"}
                              </div>
                            </div>
                            <div className="calls2-metric calls2-metric--result">
                              <div className="calls2-metric-label">Resultado</div>
                              <div className="calls2-metric-value">{resultText(item)}</div>
                            </div>
                          </div>

                          <div className="calls2-actions" onClick={(event) => event.stopPropagation()}>
                            <button className="calls2-btn calls2-btn--ghost" type="button" onClick={() => void openDrawer(item)}>
                              Ver ficha
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="calls2-panel-col">
                    <div className="calls2-panel">
                      <h3 className="calls2-panel-title">Resultados de llamadas</h3>
                      <div className="calls2-outcomes">
                        {outcomes.map((outcome) => (
                          <div className="calls2-outcome" key={outcome.label}>
                            <span className="calls2-outcome-label">{outcome.label}</span>
                            <div className="calls2-bar-track">
                              <div
                                className="calls2-bar-fill"
                                style={{
                                  width: `${Math.round((outcome.count / outcomeMax) * 100)}%`,
                                  background: `var(${outcome.colorVar})`
                                }}
                              />
                            </div>
                            <span className="calls2-outcome-count">{outcome.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="calls2-panel">
                      <div className="calls2-panel-headrow">
                        <h3 className="calls2-panel-title">Duración media</h3>
                        <span className="calls2-avgdur-value">{fmtDur(avgDurSec)}</span>
                      </div>
                      <div className="calls2-spark-caption">
                        {durations.length > 0
                          ? `media de ${durations.length} llamada(s) registrada(s)`
                          : "sin llamadas registradas"}
                      </div>
                    </div>

                    <div className="calls2-panel">
                      <div className="calls2-panel-headrow">
                        <h3 className="calls2-panel-title">Reparto medio negociado</h3>
                        <span className="calls2-avgdur-value">{avgShare != null ? `${avgShare}%` : "—"}</span>
                      </div>
                      <div className="calls2-spark-caption">% medio para la modelo en las llamadas hechas</div>
                    </div>
                  </div>
                </div>
              </section>
            );
          })()
        : null}

      {activeTab === "ANUNCIOS" ? <AdsView candidates={candidates} /> : null}

      {activeTab === "CHAT" ? (
        <section className="panel">
          <header className="chat2-head">
            <h2 className="chat2-title">Mensajes</h2>
            <p className="chat2-subtitle">
              Tus conversaciones reales con las candidatas. Abre una y respóndele aquí mismo:{" "}
              <strong>tu mensaje se envía a su Instagram</strong> y el bot se pausa (tomas el control).
            </p>
          </header>
          <div className="chat2-grid">
            <div className="chat2-panel chat2-left">
              <div className="chat2-left-title">Candidatas</div>
              <div style={{ display: "flex", gap: 4, padding: "4px 8px 8px" }}>
                {(["instagram", "whatsapp"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChatChannel(ch)}
                    style={{
                      flex: 1,
                      padding: "5px 8px",
                      fontSize: 12,
                      borderRadius: 8,
                      cursor: "pointer",
                      border: "1px solid rgba(127,127,127,0.3)",
                      fontWeight: chatChannel === ch ? 700 : 400,
                      background: chatChannel === ch ? "rgba(127,127,127,0.18)" : "transparent",
                      color: "inherit"
                    }}
                  >
                    {ch === "instagram" ? "Instagram" : "WhatsApp"}
                  </button>
                ))}
              </div>
              <div className="chat2-list">
                {(() => {
                  const wantWhatsApp = chatChannel === "whatsapp";
                  const list = candidates.filter((candidate) => candidate.instagramUsername.startsWith("wa:") === wantWhatsApp);
                  if (list.length === 0) {
                    return (
                      <p className="muted" style={{ padding: "6px 8px", fontSize: 12 }}>
                        {wantWhatsApp
                          ? "Aún no hay chats de WhatsApp. Aparecen cuando una candidata escribe al número de la agencia."
                          : "Aún no hay candidatas. Entran solas por Instagram (o carga la demo en Resumen)."}
                      </p>
                    );
                  }
                  return list.map((candidate) => {
                    const candProfile = igProfiles[candidate.instagramUsername];
                    const waNumber = candidate.phone || candidate.instagramUsername.replace(/^wa:/, "");
                    const label = wantWhatsApp
                      ? candidate.firstName?.trim() || `+${waNumber}`
                      : candidate.firstName?.trim() || `@${candProfile?.username ?? candidate.instagramUsername}`;
                    const initial = (
                      candidate.firstName?.trim() ||
                      (wantWhatsApp ? waNumber : candidate.instagramUsername) ||
                      "?"
                    )
                      .charAt(0)
                      .toUpperCase();
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        className="chat2-cand"
                        data-selected={selectedCandidate?.id === candidate.id}
                        onClick={() => void loadChatCandidate(candidate)}
                      >
                        <span className="chat2-cand-avatar" style={{ background: `var(${ringColorVar(candidate)})` }}>
                          {candProfile?.profilePicUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="chat2-cand-avatar-img"
                              src={candProfile.profilePicUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                          {initial}
                        </span>
                        <div className="chat2-cand-body">
                          <div className="chat2-cand-name">{label}</div>
                          <div className="chat2-cand-pill">{stateLabel(candidate.currentState)}</div>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="chat2-panel">
              <div className="chat2-center-head">
                <div className="chat2-center-peer">
                  <span
                    className="chat2-peer-avatar"
                    style={{ background: currentCandidate ? `var(${ringColorVar(currentCandidate)})` : "var(--muted)" }}
                  >
                    {currentCandidate && igProfiles[currentCandidate.instagramUsername]?.profilePicUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="chat2-cand-avatar-img"
                        src={igProfiles[currentCandidate.instagramUsername]?.profilePicUrl ?? ""}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    {(currentCandidate?.firstName?.trim() || currentCandidate?.instagramUsername || "?").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <div className="chat2-peer-name">
                      {currentCandidate
                        ? currentCandidate.firstName?.trim() || `@${currentCandidate.instagramUsername}`
                        : "Elige una candidata"}
                    </div>
                    {currentCandidate ? (
                      <div className="chat2-peer-username">
                        @{igProfiles[currentCandidate.instagramUsername]?.username ?? currentCandidate.instagramUsername}
                      </div>
                    ) : null}
                  </div>
                </div>
                {currentCandidate ? (
                  <span className="chat2-status" style={statePillStyle(currentCandidate.currentState)}>
                    {stateLabel(currentCandidate.currentState)}
                  </span>
                ) : null}
              </div>

              <div className="chat2-stream">
                {!currentCandidate ? (
                  <div className="chat2-empty">Elige una candidata de la izquierda para ver vuestra conversación.</div>
                ) : messages.length === 0 ? (
                  <div className="chat2-empty">Aún no hay mensajes con esta candidata.</div>
                ) : (
                  messages.flatMap((item) => {
                    if (item.role === "system") {
                      return [
                        <div className="chat2-msg" data-role="system" key={item.id}>
                          <span className="chat2-system">⚙ {item.content}</span>
                        </div>
                      ];
                    }
                    const usedFallback = item.role === "agent" && item.metadata?.draftUsedFallback === true;
                    const chunks = item.role === "agent" ? splitIntoMessageBurst(item.content) : [item.content];
                    return chunks.map((chunk, index) => (
                      <div className="chat2-msg" data-role={item.role} key={`${item.id}-${index}`}>
                        <span className="chat2-msg-label" data-role={item.role}>
                          {CHAT_AUTHOR_LABELS[item.role] ?? item.role}
                          {usedFallback && index === 0 ? <span className="chat2-fallback"> · ⚠ sin IA (fallback)</span> : null}
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
                  void sendChatReply();
                }}
              >
                <div className="chat2-composer-row2">
                  <textarea
                    className="chat2-textarea"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={
                      currentCandidate ? "Escribe tu respuesta… (se envía a su Instagram)" : "Elige una candidata para responder"
                    }
                    disabled={!currentCandidate}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendChatReply();
                      }
                    }}
                  />
                  <button className="chat2-btn-send" disabled={loading || !currentCandidate || !message.trim()} type="submit">
                    {loading ? "Enviando…" : "Enviar ➤"}
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
        <div
          style={{
            position: "relative",
            zIndex: 5,
            maxWidth: 1320,
            margin: "0 auto",
            padding: "34px 30px 80px",
            animation: "scrRight .5s cubic-bezier(.16,1,.3,1) both"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginBottom: 24,
              flexWrap: "wrap",
              gap: 16
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
                <span style={{ width: 28, height: 1, background: "linear-gradient(90deg,var(--accent),transparent)" }} />
                <span
                  style={{
                    fontFamily: "var(--font-jost)",
                    fontSize: 11,
                    letterSpacing: ".32em",
                    color: "var(--accent)",
                    textTransform: "uppercase"
                  }}
                >
                  Embudo de captación
                </span>
              </div>
              <h1 style={{ fontFamily: "var(--font-bodoni)", fontWeight: 600, fontSize: 40, margin: 0, color: "var(--text)" }}>
                CRM de talento
              </h1>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={exportCandidatesCsv}
                disabled={candidates.length === 0}
                title="Descarga todas las candidatas en CSV (copia de seguridad)"
                style={{
                  padding: "10px 16px",
                  borderRadius: 22,
                  background: "rgba(var(--s1),.6)",
                  border: "1px solid rgba(var(--line-rgb),.08)",
                  color: "var(--text2)",
                  fontFamily: "var(--font-jost)",
                  fontWeight: 500,
                  fontSize: 12.5,
                  cursor: candidates.length === 0 ? "not-allowed" : "pointer",
                  opacity: candidates.length === 0 ? 0.5 : 1
                }}
              >
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={() => void seedDemo()}
                title="Añade candidatas de ejemplo (no toca las reales)"
                style={{
                  padding: "10px 16px",
                  borderRadius: 22,
                  background: "rgba(var(--s1),.6)",
                  border: "1px solid rgba(var(--line-rgb),.08)",
                  color: "var(--text2)",
                  fontFamily: "var(--font-jost)",
                  fontWeight: 500,
                  fontSize: 12.5,
                  cursor: "pointer"
                }}
              >
                Cargar demo
              </button>
            </div>
          </div>
          {crmNotice ? (
            <p
              style={{
                margin: "0 0 16px",
                padding: "11px 15px",
                borderRadius: 12,
                background: "rgba(var(--accent-rgb),.08)",
                border: "1px solid rgba(var(--accent-rgb),.2)",
                color: "var(--text2)",
                fontFamily: "var(--font-jost)",
                fontSize: 13
              }}
            >
              {crmNotice}
            </p>
          ) : null}
          {candidates.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text3)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
              <p style={{ margin: "0 0 6px", color: "var(--text)", fontFamily: "var(--font-bodoni)", fontSize: 22 }}>
                Aún no hay candidatas.
              </p>
              <p style={{ margin: "0 0 18px", fontSize: 14, fontWeight: 300 }}>
                Las candidatas entran solas por Instagram. Para ver el tablero lleno, carga unas de ejemplo.
              </p>
              <button
                type="button"
                onClick={() => void seedDemo()}
                style={{
                  padding: "12px 22px",
                  borderRadius: 22,
                  background: "rgba(var(--accent-rgb),.12)",
                  border: "1px solid rgba(var(--accent-rgb),.4)",
                  color: "var(--accent)",
                  fontFamily: "var(--font-jost)",
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: "pointer"
                }}
              >
                Cargar candidatas de demo
              </button>
            </div>
          ) : (
            (() => {
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
              const chipStyle = {
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "10px 15px",
                borderRadius: 22,
                background: "rgba(var(--s1),.6)",
                border: "1px solid rgba(var(--line-rgb),.08)",
                fontFamily: "var(--font-jost)",
                fontWeight: 500,
                fontSize: 12.5
              } as React.CSSProperties;
              return (
                <>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        flex: "1 1 240px",
                        minWidth: 200,
                        padding: "10px 15px",
                        borderRadius: 22,
                        background: "rgba(var(--s1),.6)",
                        border: "1px solid rgba(var(--line-rgb),.08)"
                      }}
                    >
                      <span style={{ color: "var(--text3)", display: "flex" }}>
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
                        style={{
                          flex: 1,
                          background: "none",
                          border: "none",
                          outline: "none",
                          color: "var(--text)",
                          fontFamily: "var(--font-jost)",
                          fontSize: 13.5
                        }}
                      />
                    </div>
                    <div style={{ ...chipStyle, borderColor: "rgba(214,178,124,.35)" }}>
                      <span style={{ color: "#D6B27C" }}>⚠️</span>
                      <span style={{ fontFamily: "var(--font-bodoni)", fontWeight: 600, fontSize: 16, color: "#D6B27C" }}>
                        {attentionCount}
                      </span>
                      <span style={{ color: "var(--text3)", fontWeight: 300 }}>te esperan</span>
                    </div>
                    <div style={chipStyle}>
                      <span style={{ color: "var(--accent)" }}>⚡</span>
                      <span style={{ fontFamily: "var(--font-bodoni)", fontWeight: 600, fontSize: 16, color: "var(--text)" }}>
                        {activeCount}
                      </span>
                      <span style={{ color: "var(--text3)", fontWeight: 300 }}>activas</span>
                    </div>
                    <div style={chipStyle}>
                      <span style={{ color: "var(--text3)" }}>👥</span>
                      <span style={{ fontFamily: "var(--font-bodoni)", fontWeight: 600, fontSize: 16, color: "var(--text)" }}>
                        {candidates.length}
                      </span>
                      <span style={{ color: "var(--text3)", fontWeight: 300 }}>total</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLivePolling((value) => !value)}
                      title={livePolling ? "Actualizando en vivo. Clic para pausar." : "Pausado. Clic para reanudar."}
                      style={{
                        ...chipStyle,
                        cursor: "pointer",
                        color: livePolling ? "var(--accent)" : "var(--text3)",
                        borderColor: livePolling ? "rgba(var(--accent-rgb),.35)" : "rgba(var(--line-rgb),.08)"
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: livePolling ? "var(--accent)" : "var(--text3)",
                          animation: livePolling ? "softPulse 2s ease-in-out infinite" : "none"
                        }}
                      />
                      {livePolling ? "En vivo" : "Pausado"}
                    </button>
                    {candidates.some((item) => !/^\d{5,}$/.test(item.instagramUsername)) ? (
                      <button
                        type="button"
                        onClick={() => clearTest()}
                        title="Borra las candidatas de prueba (las reales no se tocan)"
                        style={{ ...chipStyle, cursor: "pointer", color: "var(--text3)" }}
                      >
                        🗑️ Limpiar pruebas
                      </button>
                    ) : null}
                  </div>
                  <div
                    data-m="board5"
                    style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 16, alignItems: "start" }}
                  >
                    {CRM_COLUMNS.map((phase) => {
                      const cards = visible
                        .filter((item) => crmColumnOf(item.currentState) === phase.id)
                        .sort((a, b) => epochOf(b.lastMessageAt) - epochOf(a.lastMessageAt));
                      return (
                        <div key={phase.id} style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 4px 14px" }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: `var(${phase.colorVar})` }} />
                            <span
                              style={{
                                fontFamily: "var(--font-jost)",
                                fontWeight: 500,
                                fontSize: 13,
                                letterSpacing: ".06em",
                                textTransform: "uppercase",
                                color: "var(--text)"
                              }}
                            >
                              {phase.title}
                            </span>
                            <span
                              style={{
                                fontFamily: "var(--font-jost)",
                                fontWeight: 500,
                                fontSize: 11,
                                color: "var(--accent-contrast)",
                                background: `var(${phase.colorVar})`,
                                padding: "2px 9px",
                                borderRadius: 20,
                                marginLeft: "auto"
                              }}
                            >
                              {cards.length}
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 60 }}>
                            {cards.length === 0 ? (
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "18px 8px",
                                  color: "var(--text3)",
                                  fontSize: 12,
                                  fontWeight: 300
                                }}
                              >
                                <div style={{ fontSize: 22, marginBottom: 4 }}>{phase.emptyIcon}</div>
                                {phase.emptyText}
                              </div>
                            ) : (
                              cards.map((candidate) => {
                                const awaitingDecision =
                                  candidate.currentState === "WAITING_HUMAN_REVIEW" ||
                                  candidate.currentState === "HUMAN_INTERVENTION_REQUIRED";
                                const paused = candidate.manualControlActive || candidate.automationPaused || awaitingDecision;
                                const awaitingProfileReview = candidate.currentState === "PROFILE_READY_FOR_REVIEW";
                                const awaitingProfileAccess = candidate.currentState === "WAITING_PROFILE_ACCESS";
                                const awaitingCallConfirm =
                                  candidate.currentState === "COLLECTING_CALL_DETAILS" ||
                                  candidate.currentState === "READY_TO_SCHEDULE";
                                const closed = candidate.currentState === "REJECTED" || candidate.currentState === "CLOSED";
                                const needsDevice = candidate.deviceEligibility === "PENDING_QUALITY_TEST";
                                const isIgsid = /^\d{5,}$/.test(candidate.instagramUsername);
                                const profile = igProfiles[candidate.instagramUsername];
                                const handle = profile?.username ?? (isIgsid ? null : candidate.instagramUsername);
                                const picUrl = profile?.profilePicUrl ?? null;
                                const displayName = candidate.firstName?.trim() || (handle ? `@${handle}` : "Candidata nueva");
                                const initial = (candidate.firstName?.trim() || handle || candidate.instagramUsername || "?")
                                  .charAt(0)
                                  .toUpperCase();
                                const followerCount = typeof profile?.followerCount === "number" ? profile.followerCount : null;
                                const ringVar = ringColorVar(candidate);
                                const pillVar = stateColorVar(candidate.currentState);
                                const tags: string[] = [];
                                if (candidate.age) tags.push(`${candidate.age} años`);
                                if (typeof candidate.hasOnlyFans === "boolean")
                                  tags.push(candidate.hasOnlyFans ? "OF: sí" : "OF: no");
                                if (candidate.deviceModel) tags.push(candidate.deviceModel);
                                if (candidate.country || candidate.city)
                                  tags.push((candidate.country || candidate.city) as string);
                                if (followerCount !== null)
                                  tags.push(
                                    followerCount >= 1000 ? `${(followerCount / 1000).toFixed(1)}k seg` : `${followerCount} seg`
                                  );
                                if (candidate.phone) tags.push("📱");
                                const iconBtn = {
                                  width: 32,
                                  height: 32,
                                  flexShrink: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  border: "1px solid rgba(var(--line-rgb),.08)",
                                  cursor: "pointer",
                                  borderRadius: "50%",
                                  background: "rgba(var(--line-rgb),.03)",
                                  color: "var(--text2)",
                                  transition: ".2s"
                                } as React.CSSProperties;
                                const decBtn = (bg: string, brd: string, col: string) =>
                                  ({
                                    flex: 1,
                                    height: 33,
                                    border: `1px solid ${brd}`,
                                    cursor: "pointer",
                                    borderRadius: 20,
                                    background: bg,
                                    color: col,
                                    fontFamily: "var(--font-jost)",
                                    fontWeight: 600,
                                    fontSize: 11.5,
                                    letterSpacing: ".02em",
                                    transition: ".2s"
                                  }) as React.CSSProperties;
                                return (
                                  <div
                                    key={candidate.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => void openDrawer(candidate)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        void openDrawer(candidate);
                                      }
                                    }}
                                    title="Abrir ficha"
                                    style={{
                                      cursor: "pointer",
                                      position: "relative",
                                      borderRadius: 16,
                                      background: "linear-gradient(162deg,rgba(var(--s1),.92),rgba(var(--s2),.94))",
                                      border: "1px solid rgba(var(--line-rgb),.07)",
                                      transition: ".28s",
                                      animation: "popIn .45s both",
                                      overflow: "hidden"
                                    }}
                                  >
                                    <div style={{ height: 3, background: `var(${pillVar})` }} />
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: 3,
                                        right: 0,
                                        width: 130,
                                        height: 130,
                                        background: `radial-gradient(circle at 85% 5%,color-mix(in srgb, var(${pillVar}) 16%, transparent),transparent 68%)`,
                                        pointerEvents: "none"
                                      }}
                                    />
                                    <div style={{ padding: 15, position: "relative" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        <span style={{ position: "relative", flexShrink: 0 }}>
                                          <span
                                            style={{
                                              width: 46,
                                              height: 46,
                                              borderRadius: "50%",
                                              background: `var(${ringVar})`,
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontFamily: "var(--font-bodoni)",
                                              fontWeight: 600,
                                              fontSize: 16,
                                              color: "var(--accent-contrast)",
                                              boxShadow: `0 0 0 2px var(--bg2),0 0 0 3.5px var(${ringVar})`,
                                              overflow: "hidden"
                                            }}
                                          >
                                            {picUrl ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                src={picUrl}
                                                alt=""
                                                referrerPolicy="no-referrer"
                                                onError={(event) => {
                                                  event.currentTarget.style.display = "none";
                                                }}
                                                style={{
                                                  position: "absolute",
                                                  inset: 0,
                                                  width: "100%",
                                                  height: "100%",
                                                  objectFit: "cover"
                                                }}
                                              />
                                            ) : null}
                                            {initial}
                                          </span>
                                          <span
                                            title={paused ? "Bot pausado" : "Bot activo"}
                                            style={{
                                              position: "absolute",
                                              right: -1,
                                              bottom: -1,
                                              width: 12,
                                              height: 12,
                                              borderRadius: "50%",
                                              border: "2px solid var(--bg2)",
                                              background: paused ? "var(--text3)" : "#8FB99F"
                                            }}
                                          />
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div
                                            style={{
                                              fontFamily: "var(--font-bodoni)",
                                              fontWeight: 600,
                                              fontSize: 16.5,
                                              color: "var(--text)",
                                              lineHeight: 1.12,
                                              whiteSpace: "nowrap",
                                              overflow: "hidden",
                                              textOverflow: "ellipsis"
                                            }}
                                          >
                                            {displayName}
                                          </div>
                                          {handle ? (
                                            <div
                                              style={{
                                                fontFamily: "var(--font-jost)",
                                                fontSize: 11,
                                                color: "var(--text3)",
                                                fontWeight: 300,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                marginTop: 2
                                              }}
                                            >
                                              @{handle}
                                            </div>
                                          ) : null}
                                        </div>
                                        <span
                                          style={{
                                            flexShrink: 0,
                                            fontFamily: "var(--font-jost)",
                                            fontSize: 9.5,
                                            padding: "4px 10px",
                                            borderRadius: 20,
                                            color: `var(${pillVar})`,
                                            background: `color-mix(in srgb, var(${pillVar}) 12%, transparent)`,
                                            border: `1px solid color-mix(in srgb, var(${pillVar}) 33%, transparent)`,
                                            letterSpacing: ".06em",
                                            textTransform: "uppercase",
                                            whiteSpace: "nowrap"
                                          }}
                                        >
                                          {stateLabel(candidate.currentState)}
                                        </span>
                                      </div>
                                      {awaitingDecision && candidate.humanReviewReason ? (
                                        <div
                                          style={{
                                            marginTop: 11,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 7,
                                            padding: "4px 10px",
                                            borderRadius: 20,
                                            background: "rgba(214,178,124,.12)",
                                            border: "1px solid rgba(214,178,124,.3)",
                                            fontFamily: "var(--font-jost)",
                                            fontSize: 10.5,
                                            color: "#D6B27C"
                                          }}
                                        >
                                          ⚠ {REVIEW_REASON_LABELS[candidate.humanReviewReason] ?? candidate.humanReviewReason}
                                        </div>
                                      ) : null}
                                      {profile?.followsBusiness === true || profile?.isPrivate != null ? (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                                          {profile?.followsBusiness === true ? (
                                            <span
                                              title="Te sigue: puedes ver su perfil aunque sea privado"
                                              style={{
                                                fontFamily: "var(--font-jost)",
                                                fontSize: 10.5,
                                                color: "var(--info)",
                                                padding: "3px 10px",
                                                borderRadius: 20,
                                                background: "color-mix(in srgb, var(--info) 12%, transparent)",
                                                border: "1px solid color-mix(in srgb, var(--info) 33%, transparent)"
                                              }}
                                            >
                                              ✓ Te sigue
                                            </span>
                                          ) : null}
                                          {profile?.isPrivate === true ? (
                                            <span
                                              title="Cuenta privada: mándale tú la solicitud de seguimiento"
                                              style={{
                                                fontFamily: "var(--font-jost)",
                                                fontSize: 10.5,
                                                color: "var(--text3)",
                                                padding: "3px 10px",
                                                borderRadius: 20,
                                                background: "rgba(var(--line-rgb),.04)",
                                                border: "1px solid rgba(var(--line-rgb),.05)"
                                              }}
                                            >
                                              🔒 Privada
                                            </span>
                                          ) : profile?.isPrivate === false ? (
                                            <span
                                              title="Cuenta pública: puedes ver su perfil directamente"
                                              style={{
                                                fontFamily: "var(--font-jost)",
                                                fontSize: 10.5,
                                                color: "var(--text3)",
                                                padding: "3px 10px",
                                                borderRadius: 20,
                                                background: "rgba(var(--line-rgb),.04)",
                                                border: "1px solid rgba(var(--line-rgb),.05)"
                                              }}
                                            >
                                              🌐 Pública
                                            </span>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      {tags.length > 0 ? (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 13 }}>
                                          {tags.map((tag, index) => (
                                            <span
                                              key={index}
                                              style={{
                                                fontFamily: "var(--font-jost)",
                                                fontSize: 11,
                                                color: "var(--text2)",
                                                fontWeight: 300,
                                                padding: "3px 10px",
                                                borderRadius: 20,
                                                background: "rgba(var(--line-rgb),.04)",
                                                border: "1px solid rgba(var(--line-rgb),.05)"
                                              }}
                                            >
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                      {paused && !awaitingDecision ? (
                                        <div
                                          style={{
                                            marginTop: 11,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 7,
                                            padding: "5px 11px",
                                            borderRadius: 20,
                                            background: "rgba(214,178,124,.12)",
                                            border: "1px solid rgba(214,178,124,.3)"
                                          }}
                                        >
                                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#D6B27C" }} />
                                          <span style={{ fontFamily: "var(--font-jost)", fontSize: 10.5, color: "#D6B27C" }}>
                                            Bot en pausa
                                          </span>
                                        </div>
                                      ) : null}
                                      <div
                                        onClick={(event) => event.stopPropagation()}
                                        style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}
                                      >
                                        {awaitingProfileAccess ? (
                                          <button
                                            type="button"
                                            title="Ya le enviaste tú la solicitud de seguimiento"
                                            onClick={() => void advanceStage(candidate, "FOLLOW_REQUEST_SENT")}
                                            style={decBtn(
                                              "rgba(var(--accent-rgb),.1)",
                                              "rgba(var(--accent-rgb),.4)",
                                              "var(--accent)"
                                            )}
                                          >
                                            Ya le mandé la solicitud
                                          </button>
                                        ) : null}
                                        {awaitingProfileReview ? (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => void advanceStage(candidate, "PROFILE_FIT")}
                                              style={decBtn("rgba(143,185,159,.12)", "rgba(143,185,159,.4)", "#8FB99F")}
                                            >
                                              ✓ Encaja
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => void advanceStage(candidate, "PROFILE_NO_FIT")}
                                              style={decBtn("rgba(208,106,106,.1)", "rgba(208,106,106,.38)", "#D06A6A")}
                                            >
                                              ✕ No encaja
                                            </button>
                                          </>
                                        ) : null}
                                        {awaitingDecision ? (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => void applyHumanDecision(candidate, "APPROVE")}
                                              style={decBtn("rgba(143,185,159,.12)", "rgba(143,185,159,.4)", "#8FB99F")}
                                            >
                                              ✓ Encaja
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => void advanceStage(candidate, "REJECT")}
                                              style={decBtn("rgba(208,106,106,.1)", "rgba(208,106,106,.38)", "#D06A6A")}
                                            >
                                              ✕ Rechazar
                                            </button>
                                          </>
                                        ) : null}
                                        {needsDevice ? (
                                          <>
                                            <button
                                              type="button"
                                              title="Aprueba la calidad del móvil (doble gate)"
                                              onClick={() => void advanceStage(candidate, "DEVICE_APPROVE")}
                                              style={decBtn("rgba(169,180,196,.12)", "rgba(169,180,196,.38)", "var(--text2)")}
                                            >
                                              ✓ Móvil OK
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => void advanceStage(candidate, "DEVICE_REJECT")}
                                              style={decBtn("rgba(208,106,106,.1)", "rgba(208,106,106,.38)", "#D06A6A")}
                                            >
                                              ✕ Móvil no
                                            </button>
                                          </>
                                        ) : null}
                                        {awaitingCallConfirm ? (
                                          <button
                                            type="button"
                                            onClick={() => void advanceStage(candidate, "CONFIRM_CALL")}
                                            style={decBtn("rgba(185,139,201,.12)", "rgba(185,139,201,.4)", "#B98BC9")}
                                          >
                                            Confirmar llamada
                                          </button>
                                        ) : null}
                                        {!closed && !awaitingProfileReview && !awaitingDecision ? (
                                          <>
                                            {candidate.humanProfileReviewStatus === "POTENTIAL_FIT" ? (
                                              <span
                                                style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  height: 33,
                                                  padding: "0 12px",
                                                  borderRadius: 20,
                                                  background: "rgba(143,185,159,.1)",
                                                  color: "#8FB99F",
                                                  fontFamily: "var(--font-jost)",
                                                  fontWeight: 600,
                                                  fontSize: 11.5
                                                }}
                                              >
                                                ✓ Revisado y OK
                                              </span>
                                            ) : (
                                              <button
                                                type="button"
                                                title="Marca el perfil como revisado y OK"
                                                onClick={() => void advanceStage(candidate, "PROFILE_OK")}
                                                style={decBtn("rgba(143,185,159,.12)", "rgba(143,185,159,.4)", "#8FB99F")}
                                              >
                                                👍 Encaja
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => void advanceStage(candidate, "REJECT")}
                                              style={decBtn("rgba(208,106,106,.1)", "rgba(208,106,106,.38)", "#D06A6A")}
                                            >
                                              ✕ Rechazar
                                            </button>
                                          </>
                                        ) : null}
                                      </div>
                                      <div
                                        onClick={(event) => event.stopPropagation()}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 7,
                                          marginTop: 14,
                                          paddingTop: 13,
                                          borderTop: "1px solid rgba(var(--line-rgb),.06)"
                                        }}
                                      >
                                        <button
                                          type="button"
                                          title="Responder a mano (pausa el bot)"
                                          onClick={() => void sendManualReply(candidate)}
                                          style={iconBtn}
                                        >
                                          ✉
                                        </button>
                                        <button
                                          type="button"
                                          title="Llamar / ver llamadas"
                                          onClick={() => void openDrawer(candidate)}
                                          style={iconBtn}
                                        >
                                          ☎
                                        </button>
                                        {!closed && !awaitingProfileReview && !awaitingDecision ? (
                                          <button
                                            type="button"
                                            title={paused ? "Reanudar bot" : "Pausar bot"}
                                            onClick={() => void setBotPaused(candidate, !paused)}
                                            style={{ ...iconBtn, fontSize: 9.5 }}
                                          >
                                            {paused ? "▶" : "❚❚"}
                                          </button>
                                        ) : null}
                                        <div style={{ flex: 1 }} />
                                        <button
                                          type="button"
                                          title="Eliminar (confirmación en la ficha)"
                                          onClick={() => void openDrawer(candidate)}
                                          style={{ ...iconBtn, color: "var(--text3)" }}
                                        >
                                          <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                          </svg>
                                        </button>
                                      </div>
                                      {formatRelativeTime(candidate.lastMessageAt) ? (
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            marginTop: 12,
                                            color: "var(--text3)",
                                            fontFamily: "var(--font-jost)",
                                            fontSize: 10.5
                                          }}
                                        >
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
                                    </div>
                                  </div>
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
        </div>
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
                  <span className="drawer-state-pill">{stateLabel(drawerCandidate.currentState)}</span>
                  {drawerCandidate.humanProfileReviewStatus === "POTENTIAL_FIT" ? (
                    <span className="drawer-reviewed">✓ Revisado por ti</span>
                  ) : null}
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
                  <p className="drawer-text muted">
                    Llamada con <strong>{drawerCandidate.firstName?.trim() || `@${drawerCandidate.instagramUsername}`}</strong>
                    {drawerCandidate.firstName?.trim() ? ` · @${drawerCandidate.instagramUsername}` : ""}
                  </p>
                  {drawerCandidate.currentState !== "REJECTED" && drawerCandidate.currentState !== "CLOSED" ? (
                    <button
                      type="button"
                      className="btn-xs accent drawer-call-btn"
                      onClick={() => startCall(drawerCandidate)}
                      title="Lanza la llamada por teléfono (ElevenLabs marca a su número y conecta el bot)"
                    >
                      📞 Llamar
                    </button>
                  ) : null}
                  {drawerCandidate.lastCallConversationId ? (
                    <CallRecordingAudio
                      key={drawerCandidate.lastCallConversationId}
                      conversationId={drawerCandidate.lastCallConversationId}
                    />
                  ) : drawerCandidate.lastCall?.result === "COMPLETED" ? (
                    <div className="drawer-block">
                      <span className="drawer-field-label">Grabación de la llamada</span>
                      <p className="drawer-text muted">
                        🎧 La grabación de audio aparece aquí en las llamadas reales (con el guardado de audio activado en
                        ElevenLabs).
                      </p>
                    </div>
                  ) : null}
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
              {/* Porque de la revision (que Alex sepa que mirar sin abrir el chat): especial para el movil. */}
              {(drawerCandidate.currentState === "WAITING_HUMAN_REVIEW" ||
                drawerCandidate.currentState === "HUMAN_INTERVENTION_REQUIRED") &&
              drawerCandidate.humanReviewReason ? (
                <p className="drawer-text">
                  {drawerCandidate.humanReviewReason === "DEVICE_QUALITY_REVIEW"
                    ? `📱 Tiene un ${drawerCandidate.deviceModel ?? "móvil"} — revisa la calidad y aprueba o no.`
                    : `Motivo: ${REVIEW_REASON_LABELS[drawerCandidate.humanReviewReason] ?? drawerCandidate.humanReviewReason}`}
                </p>
              ) : null}
              {/* Aviso explicito del doble gate: con el perfil ya aprobado pero el movil pendiente de calidad,
                  la llamada NO se agenda y la candidata queda "muda" en revision. Sin este aviso parecia que
                  "no pasaba nada" al aprobar el perfil (caso movil generico, Alex 23-jun). */}
              {drawerCandidate.currentState === "WAITING_HUMAN_REVIEW" &&
              drawerCandidate.humanFitDecision === "APPROVED" &&
              drawerCandidate.deviceEligibility === "PENDING_QUALITY_TEST" ? (
                <p className="drawer-text" style={{ color: "#b8860b", fontWeight: 600 }}>
                  ⚠️ Perfil aprobado, pero la llamada NO se agenda hasta que apruebes la calidad del móvil aquí abajo (📱 Móvil
                  OK).
                </p>
              ) : null}
              <div className="drawer-actions">
                {/* Encaja/Rechazar en CUALQUIER fase activa (asi Alex revisa perfiles cuando quiere). */}
                {drawerCandidate.currentState === "PROFILE_READY_FOR_REVIEW" ? (
                  <>
                    <button type="button" className="btn-xs accent" onClick={() => advanceStage(drawerCandidate, "PROFILE_FIT")}>
                      👍 Encaja
                    </button>
                    <button
                      type="button"
                      className="btn-xs danger"
                      onClick={() => advanceStage(drawerCandidate, "PROFILE_NO_FIT")}
                    >
                      Rechazar
                    </button>
                  </>
                ) : drawerCandidate.currentState === "WAITING_HUMAN_REVIEW" ||
                  drawerCandidate.currentState === "HUMAN_INTERVENTION_REQUIRED" ? (
                  <>
                    {/* Decision 1: ¿encaja el perfil? Si ya esta aprobado, normalmente se muestra el sello.
                        EXCEPCION (anti dead-end): si el perfil esta aprobado Y el movil ya esta resuelto (no
                        pendiente ni rechazado) pero la candidata SIGUE en revision (p.ej. iPhone <13 que paso
                        por HIR: "Movil OK" no reanuda desde HIR por invariante 4), el avance a la llamada no se
                        disparo. Se ofrece un boton EXPLICITO para que Alex reanude conscientemente (re-aprobar
                        ES la salida humana designada de HIR; no debilita invariante 4). Sin esto, quedaba
                        congelada con ambas aprobaciones hechas y ningun boton que la rescatara. */}
                    {drawerCandidate.humanFitDecision === "APPROVED" ? (
                      drawerCandidate.deviceEligibility !== "PENDING_QUALITY_TEST" &&
                      drawerCandidate.deviceEligibility !== "NOT_ELIGIBLE" ? (
                        <button
                          type="button"
                          className="btn-xs accent"
                          onClick={() => void applyHumanDecision(drawerCandidate, "APPROVE")}
                        >
                          ▶️ Reanudar (proponer llamada)
                        </button>
                      ) : (
                        <span className="crm2-ok-chip">✓ Perfil aprobado</span>
                      )
                    ) : (
                      <button
                        type="button"
                        className="btn-xs accent"
                        onClick={() => void applyHumanDecision(drawerCandidate, "APPROVE")}
                      >
                        👍 Aprobar perfil
                      </button>
                    )}
                    {/* Decision 2 SEPARADA: ¿el movil vale? Solo si esta pendiente de revision de calidad.
                        El bot no agenda hasta que AMBAS (perfil + movil) esten aprobadas (Alex 22-jun). */}
                    {drawerCandidate.deviceEligibility === "PENDING_QUALITY_TEST" ? (
                      <>
                        <button
                          type="button"
                          className="btn-xs accent"
                          onClick={() => advanceStage(drawerCandidate, "DEVICE_APPROVE")}
                        >
                          📱 Móvil OK
                        </button>
                        <button
                          type="button"
                          className="btn-xs danger"
                          onClick={() => advanceStage(drawerCandidate, "DEVICE_REJECT")}
                        >
                          📱 Móvil no vale
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="btn-xs danger" onClick={() => advanceStage(drawerCandidate, "REJECT")}>
                      Rechazar
                    </button>
                  </>
                ) : drawerCandidate.currentState !== "REJECTED" && drawerCandidate.currentState !== "CLOSED" ? (
                  <>
                    {drawerCandidate.humanProfileReviewStatus === "POTENTIAL_FIT" ? (
                      <span className="crm2-ok-chip">✓ Revisado y OK</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-xs accent"
                        onClick={() => void advanceStage(drawerCandidate, "PROFILE_OK")}
                      >
                        👍 Encaja
                      </button>
                    )}
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
                {/* Borrar la candidata y su historial: disponible en CUALQUIER estado (incluidos REJECTED/
                    CLOSED), que es justo cuando se quiere reciclar la prueba E2E desde cero. */}
                <button
                  type="button"
                  className="btn-xs danger"
                  title="Borra esta candidata y todo su historial para repetir la prueba desde cero"
                  onClick={() => deleteCandidate(drawerCandidate)}
                >
                  🗑️ Borrar / empezar de cero
                </button>
              </div>
              {drawerCandidate.currentState !== "REJECTED" && drawerCandidate.currentState !== "CLOSED" ? (
                <div className="drawer-reply">
                  <textarea
                    className="drawer-reply-input"
                    value={drawerReply}
                    onChange={(event) => setDrawerReply(event.target.value)}
                    placeholder="Escribe una respuesta… (se envía a Instagram cuando esté conectado)"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendDrawerReply();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="drawer-send"
                    disabled={loading || !drawerReply.trim()}
                    onClick={() => void sendDrawerReply()}
                  >
                    {loading ? "Enviando…" : "Enviar ➤"}
                  </button>
                </div>
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

/**
 * Reproductor de la GRABACIÓN de una llamada. Si el audio no está disponible (grabación no guardada en
 * ElevenLabs, id de demostración o error de red) degrada a un aviso claro en vez de un reproductor roto.
 * Se monta con key={conversationId}, así el estado de error se reinicia al cambiar de candidata.
 */
function CallRecordingAudio({ conversationId }: { conversationId: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="drawer-block">
      <span className="drawer-field-label">Grabación de la llamada</span>
      {failed ? (
        <p className="drawer-text muted">
          No se pudo cargar la grabación. Aparece cuando ElevenLabs la guardó (Audio Saving activado) y la llamada terminó.
        </p>
      ) : (
        <audio
          controls
          preload="none"
          className="drawer-audio"
          src={`/api/call/${encodeURIComponent(conversationId)}/audio`}
          onError={() => setFailed(true)}
        >
          Tu navegador no puede reproducir el audio.
        </audio>
      )}
    </div>
  );
}

function formatApiError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "La API no devolvio una respuesta valida. Revisa la consola del servidor.";
}
