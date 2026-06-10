import { describe, expect, it } from "vitest";
import { buildCandidatePanelRows, formatOnboardingBlockers } from "@/application/candidatePanelRows";
import { normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

describe("candidate normalization", () => {
  it("normalizes an old candidate without onboarding blockers", () => {
    const candidate = normalizeCandidate({
      id: "legacy-candidate",
      instagramUsername: "legacy_user",
      createdAt: new Date("2026-06-09T10:00:00.000Z"),
      updatedAt: new Date("2026-06-09T10:00:00.000Z")
    });

    expect(candidate.onboardingBlockers).toEqual([]);
  });

  it("normalizes old candidates when reading through the in-memory repository", async () => {
    const repository = new InMemoryCandidateRepository();
    const legacyCandidate = {
      id: "repo-legacy",
      instagramUsername: "repo_legacy",
      createdAt: new Date("2026-06-09T10:00:00.000Z"),
      updatedAt: new Date("2026-06-09T10:00:00.000Z")
    } as Candidate;

    await repository.saveCandidate(legacyCandidate);
    const savedCandidate = await repository.findCandidateById("repo-legacy");
    const listedCandidates = await repository.listCandidates();

    expect(savedCandidate?.onboardingBlockers).toEqual([]);
    expect(listedCandidates[0]?.onboardingBlockers).toEqual([]);
  });

  it("formats empty onboarding blockers as a dash", () => {
    expect(formatOnboardingBlockers([])).toBe("-");
  });

  it("formats one or more onboarding blockers", () => {
    expect(formatOnboardingBlockers(["DEVICE_UPGRADE_REQUIRED"])).toBe("DEVICE_UPGRADE_REQUIRED");
    expect(formatOnboardingBlockers(["DEVICE_UPGRADE_REQUIRED", "CONTRACT_REQUIRED"])).toBe("DEVICE_UPGRADE_REQUIRED, CONTRACT_REQUIRED");
  });

  it("renders candidate panel rows without failing when onboarding blockers are missing", () => {
    const legacyCandidate = normalizeCandidate({
      id: "panel-legacy",
      instagramUsername: "panel_legacy",
      createdAt: new Date("2026-06-09T10:00:00.000Z"),
      updatedAt: new Date("2026-06-09T10:00:00.000Z")
    }) as Partial<Candidate>;

    delete legacyCandidate.onboardingBlockers;

    expect(() => buildCandidatePanelRows(legacyCandidate as Candidate)).not.toThrow();
    expect(buildCandidatePanelRows(legacyCandidate as Candidate)).toContainEqual(["Bloqueos onboarding", "-"]);
  });
});
