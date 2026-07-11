import { describe, it, expect } from "vitest";
import { parseInstagramWebhookEvent } from "@/application/instagramWebhook";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { normalizeCandidate, createCandidate } from "@/domain/candidate";
import { buildCandidatePanelRows } from "@/application/candidatePanelRows";

// ATRIBUCION POR ANUNCIO (11-jul, plan de ads): los DMs que nacen de un anuncio click-to-message llegan
// al webhook con `message.referral` (ad_id, source ADS, ads_context_data.ad_title). Se captura y se guarda
// en la ficha de la candidata (primer anuncio gana) para medir CALIDAD por anuncio en el CRM. Pura
// atribucion: NO cambia nada de la conversacion ni del flujo del bot.

function mk() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

function adPayload(overrides?: { referralOnEvent?: boolean; noReferral?: boolean }) {
  const referral = {
    ref: "",
    source: "ADS",
    type: "OPEN_THREAD",
    ad_id: "120212345678901234",
    ads_context_data: { ad_title: "AD 01 — Casting Rosa", photo_url: "https://example.com/x.jpg" }
  };
  const message: Record<string, unknown> = { mid: "mid_ad_1", text: "Hola, quiero postularme al casting" };
  const event: Record<string, unknown> = { sender: { id: "igsid_777" }, message };
  if (!overrides?.noReferral) {
    if (overrides?.referralOnEvent) event.referral = referral;
    else message.referral = referral;
  }
  return { object: "instagram", entry: [{ id: "1", messaging: [event] }] };
}

describe("parser del webhook: extrae el referral del anuncio", () => {
  it("message.referral (anuncio click-to-message) -> adReferral con ad_id y titulo", () => {
    const [msg] = parseInstagramWebhookEvent(adPayload());
    expect(msg.adReferral?.adId).toBe("120212345678901234");
    expect(msg.adReferral?.adTitle).toBe("AD 01 — Casting Rosa");
    expect(msg.adReferral?.raw).toContain("ADS");
  });

  it("event.referral (link ig.me) tambien se captura", () => {
    const [msg] = parseInstagramWebhookEvent(adPayload({ referralOnEvent: true }));
    expect(msg.adReferral?.adId).toBe("120212345678901234");
  });

  it("sin referral -> adReferral undefined (mensaje organico)", () => {
    const [msg] = parseInstagramWebhookEvent(adPayload({ noReferral: true }));
    expect(msg.adReferral).toBeUndefined();
  });
});

describe("engine.recordAdAttribution: guarda el anuncio de origen en la ficha (primer anuncio gana)", () => {
  it("candidata NUEVA: crea la ficha y fija adId/adTitle", async () => {
    const { engine, repository } = mk();
    await engine.recordAdAttribution({
      instagramUsername: "igsid_777",
      adId: "120212345678901234",
      adTitle: "AD 01 — Casting Rosa",
      referralJson: '{"source":"ADS"}'
    });
    const candidate = await repository.findCandidateByInstagram("igsid_777");
    expect(candidate?.adId).toBe("120212345678901234");
    expect(candidate?.adTitle).toBe("AD 01 — Casting Rosa");
    expect(candidate?.adReferralJson).toContain("ADS");
    // NO toca el flujo: sigue siendo NEW_LEAD sin mensajes.
    expect(candidate?.currentState).toBe("NEW_LEAD");
  });

  it("PRIMER anuncio gana: una atribucion posterior NO sobreescribe", async () => {
    const { engine, repository } = mk();
    await engine.recordAdAttribution({ instagramUsername: "igsid_777", adId: "AD_A", adTitle: "Primero" });
    await engine.recordAdAttribution({ instagramUsername: "igsid_777", adId: "AD_B", adTitle: "Segundo" });
    const candidate = await repository.findCandidateByInstagram("igsid_777");
    expect(candidate?.adId).toBe("AD_A");
    expect(candidate?.adTitle).toBe("Primero");
  });

  it("riesgo revisor: un ig.me (solo ref) NO ocupa el hueco — un anuncio REAL posterior lo completa", async () => {
    const { engine, repository } = mk();
    await engine.recordAdAttribution({ instagramUsername: "igsid_777", referralJson: '{"ref":"bio-link"}' });
    let candidate = await repository.findCandidateByInstagram("igsid_777");
    expect(candidate?.adId).toBeUndefined();
    expect(candidate?.adReferralJson).toContain("bio-link");
    // Llega el anuncio real: completa la ficha (el ref no bloquea la metrica de calidad por anuncio).
    await engine.recordAdAttribution({
      instagramUsername: "igsid_777",
      adId: "AD_REAL",
      adTitle: "AD 05",
      referralJson: '{"source":"ADS"}'
    });
    candidate = await repository.findCandidateByInstagram("igsid_777");
    expect(candidate?.adId).toBe("AD_REAL");
    expect(candidate?.adTitle).toBe("AD 05");
    // Y un ref-only posterior ya no pisa nada:
    await engine.recordAdAttribution({ instagramUsername: "igsid_777", referralJson: '{"ref":"otro"}' });
    candidate = await repository.findCandidateByInstagram("igsid_777");
    expect(candidate?.adId).toBe("AD_REAL");
  });

  it("sin adId ni referralJson -> no-op (no crea candidata fantasma)", async () => {
    const { engine, repository } = mk();
    await engine.recordAdAttribution({ instagramUsername: "igsid_nuevo" });
    expect(await repository.findCandidateByInstagram("igsid_nuevo")).toBeNull();
  });

  it("la atribucion NO pisa datos de una candidata existente (solo anade el anuncio)", async () => {
    const { engine, repository } = mk();
    await repository.saveCandidate(
      normalizeCandidate({ ...createCandidate({ instagramUsername: "igsid_777" }), firstName: "tania", age: 31 })
    );
    await engine.recordAdAttribution({ instagramUsername: "igsid_777", adId: "AD_A" });
    const candidate = await repository.findCandidateByInstagram("igsid_777");
    expect(candidate?.adId).toBe("AD_A");
    expect(candidate?.firstName).toBe("tania");
    expect(candidate?.age).toBe(31);
  });
});

describe("dominio y CRM", () => {
  it("normalizeCandidate conserva los campos de atribucion", () => {
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "x" }),
      adId: "120",
      adTitle: "AD 03",
      adReferralJson: "{}"
    });
    expect(candidate.adId).toBe("120");
    expect(candidate.adTitle).toBe("AD 03");
  });

  it("la ficha del CRM muestra el anuncio de origen (titulo o id; '-' si organica)", () => {
    const withAd = normalizeCandidate({
      ...createCandidate({ instagramUsername: "x" }),
      adId: "120",
      adTitle: "AD 03 — Agencia espanola"
    });
    const rows = buildCandidatePanelRows(withAd);
    expect(rows).toContainEqual(["Anuncio de origen", "AD 03 — Agencia espanola"]);
    const organic = normalizeCandidate({ ...createCandidate({ instagramUsername: "y" }) });
    expect(buildCandidatePanelRows(organic)).toContainEqual(["Anuncio de origen", "-"]);
  });
});
