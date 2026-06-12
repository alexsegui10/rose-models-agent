import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { createCandidate, type Candidate } from "@/domain/candidate";

const GEO_QUESTION = "No quiero que me vean en Argentina, se puede bloquear mi pais en Instagram y OnlyFans?";

function hirCandidate(): Candidate {
  return {
    ...createCandidate({ instagramUsername: "lead_hir_gate", profileVisibility: "PUBLIC" }),
    currentState: "HUMAN_INTERVENTION_REQUIRED"
  };
}

function geoEntry(): KnowledgeEntry {
  const entry = businessKnowledgeEntries.find((candidate) => candidate.id === "geo-privacy-three-layers");
  if (!entry) throw new Error("geo-privacy-three-layers entry missing");
  return entry;
}

describe("LocalBusinessKnowledgeRetriever state gating in HUMAN_INTERVENTION_REQUIRED", () => {
  it("does not bypass allowedStates for entries scoped to other states", async () => {
    const scopedElsewhere: KnowledgeEntry = {
      ...geoEntry(),
      id: "geo-synthetic-scoped",
      allowedStates: ["CALL_SCHEDULED"]
    };
    const retriever = new LocalBusinessKnowledgeRetriever([scopedElsewhere]);

    const entries = await retriever.retrieve({
      candidate: hirCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: GEO_QUESTION
    });

    expect(entries).toHaveLength(0);
  });

  it("still serves entries that explicitly allow HUMAN_INTERVENTION_REQUIRED", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();

    const entries = await retriever.retrieve({
      candidate: hirCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: GEO_QUESTION
    });

    expect(entries.map((entry) => entry.id)).toContain("geo-privacy-three-layers");
  });

  it("serves entries with an empty allowedStates list in any state, including HIR", async () => {
    const unrestricted: KnowledgeEntry = {
      ...geoEntry(),
      id: "geo-synthetic-unrestricted",
      allowedStates: []
    };
    const retriever = new LocalBusinessKnowledgeRetriever([unrestricted]);

    const entries = await retriever.retrieve({
      candidate: hirCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: GEO_QUESTION
    });

    expect(entries.map((entry) => entry.id)).toContain("geo-synthetic-unrestricted");
  });
});
