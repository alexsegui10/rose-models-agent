import { describe, expect, it } from "vitest";
import { seedDemoCandidates } from "@/server/demoSeed";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

describe("seedDemoCandidates", () => {
  it("siembra las candidatas de demo sin lanzar y son recuperables", async () => {
    const repository = new InMemoryCandidateRepository();
    const count = await seedDemoCandidates(repository);
    expect(count).toBeGreaterThan(0);

    const candidates = await repository.listCandidates();
    expect(candidates.length).toBe(count);

    // La llamada completada de demo guarda lastCall con % negociado.
    const claudia = await repository.findCandidateById("demo-12");
    expect(claudia?.lastCall?.negotiatedModelShare).toBe(65);

    // Idempotente: re-sembrar no duplica.
    await seedDemoCandidates(repository);
    const again = await repository.listCandidates();
    expect(again.length).toBe(count);
  });
});
