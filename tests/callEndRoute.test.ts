import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/call/end/route";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

const SECRET = "test-webhook-secret";

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/call/end", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body)
  });
}

async function seedScheduled() {
  const repository = getSimulatorRepository();
  return repository.saveCandidate(
    normalizeCandidate({ ...createCandidate({ instagramUsername: `end_${Math.random()}` }), currentState: "CALL_SCHEDULED" })
  );
}

afterEach(() => {
  delete process.env.CALL_WEBHOOK_SECRET;
});

describe("webhook de fin de llamada", () => {
  it("sin CALL_WEBHOOK_SECRET -> 503", async () => {
    delete process.env.CALL_WEBHOOK_SECRET;
    const res = await POST(req({ candidateId: "x", status: "completed" }));
    expect(res.status).toBe(503);
  });

  it("token incorrecto -> 401", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const res = await POST(req({ candidateId: "x", status: "completed" }, "Bearer mal"));
    expect(res.status).toBe(401);
  });

  it("status 'completed' -> CALL_COMPLETED", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await POST(req({ candidateId: seeded.id, status: "completed", summary: "ok" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("COMPLETED");
    expect(json.candidate.currentState).toBe("CALL_COMPLETED");
  });

  it("status 'no-answer' -> CALL_NO_ANSWER", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await POST(req({ candidateId: seeded.id, status: "no-answer" }, `Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
    expect(json.candidate.currentState).toBe("CALL_NO_ANSWER");
  });

  it("candidata inexistente -> 404", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const res = await POST(req({ candidateId: "no-existe", status: "completed" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(404);
  });
});
