import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { escalationNotificationFor, formatOperatorMessage } from "@/infrastructure/integrations/operatorNotifier";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// A (feedback 22-jun): cuando un movil necesita revision manual de calidad (iPhone 11), el aviso de
// WhatsApp y el CRM deben decir el PORQUE. Se fija humanReviewReason = DEVICE_QUALITY_REVIEW.

describe("A: revision de calidad del movil muestra el motivo (iPhone 11)", () => {
  it("guion completo + iPhone 11 -> WAITING_HUMAN_REVIEW con motivo DEVICE_QUALITY_REVIEW", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    // Todo el guion menos el movil: al dar el iPhone 11 (PENDING_QUALITY_TEST) se completa y pasa a revision.
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "dev_review", profileVisibility: "PUBLIC" }),
        firstName: "Carla",
        age: 40,
        isAdultConfirmed: true,
        hasOnlyFans: false,
        currentState: "QUALIFYING"
      })
    );
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "tengo un iphone 11"
    });
    expect(reply.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(reply.candidate.humanReviewReason).toBe("DEVICE_QUALITY_REVIEW");
  });

  it("el aviso de WhatsApp incluye el modelo y dice que revise la calidad", () => {
    const notification = escalationNotificationFor(
      {
        instagramUsername: "17841400000000099",
        currentState: "WAITING_HUMAN_REVIEW",
        humanReviewReason: "DEVICE_QUALITY_REVIEW",
        deviceModel: "iphone 11"
      },
      [{ toState: "WAITING_HUMAN_REVIEW" }]
    );
    expect(notification).not.toBeNull();
    const message = formatOperatorMessage(notification!).toLowerCase();
    expect(message).toContain("iphone 11");
    expect(message).toContain("calidad del movil");
  });
});
