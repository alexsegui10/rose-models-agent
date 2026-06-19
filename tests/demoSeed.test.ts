import { describe, expect, it } from "vitest";
import { clearDemoCandidates, clearNonRealCandidates, DEMO_ID_PREFIX, seedDemoCandidates } from "@/server/demoSeed";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

describe("seedDemoCandidates", () => {
  it("siembra las candidatas de demo sin lanzar y son recuperables", async () => {
    const repository = new InMemoryCandidateRepository();
    const count = await seedDemoCandidates(repository);
    expect(count).toBeGreaterThan(0);

    const candidates = await repository.listCandidates();
    expect(candidates.length).toBe(count);

    // Los ids de demo son UUIDs validos con prefijo reconocible (compatibles con Postgres uuid).
    expect(candidates.every((candidate) => candidate.id.startsWith(DEMO_ID_PREFIX))).toBe(true);

    // La llamada completada de demo (demo-12) guarda lastCall con % negociado, recuperable por id.
    const claudia = await repository.findCandidateById(`${DEMO_ID_PREFIX}000000000012`);
    expect(claudia?.lastCall?.negotiatedModelShare).toBe(65);

    // Idempotente: re-sembrar no duplica.
    await seedDemoCandidates(repository);
    const again = await repository.listCandidates();
    expect(again.length).toBe(count);
  });

  it("clearDemoCandidates borra solo las de demo y deja intactas las reales", async () => {
    const repository = new InMemoryCandidateRepository();
    await seedDemoCandidates(repository);
    // Una candidata "real" (id que NO es de demo) no debe verse afectada.
    const { createCandidate } = await import("@/domain/candidate");
    const real = createCandidate({ instagramUsername: "1789456123" });
    await repository.saveCandidate(real);

    const removed = await clearDemoCandidates(repository);
    expect(removed).toBeGreaterThan(0);

    const remaining = await repository.listCandidates();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(real.id);
  });

  it("clearNonRealCandidates borra pruebas + demo y deja solo las de IGSID real", async () => {
    const repository = new InMemoryCandidateRepository();
    await seedDemoCandidates(repository); // demo (usuarios con nombre, no IGSID)
    const { createCandidate } = await import("@/domain/candidate");
    const real = createCandidate({ instagramUsername: "17841447161456284" }); // IGSID real
    await repository.saveCandidate(real);
    const test = createCandidate({ instagramUsername: "candidata_12345" }); // prueba del chat
    await repository.saveCandidate(test);

    const removed = await clearNonRealCandidates(repository);
    expect(removed).toBeGreaterThan(0);

    const remaining = await repository.listCandidates();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(real.id);
  });
});
