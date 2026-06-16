import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/call/llm/route";

const KEY = "test-call-key";

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/call/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.CALL_LLM_API_KEY;
});

describe("endpoint Custom LLM de la llamada", () => {
  it("sin CALL_LLM_API_KEY configurada -> 503", async () => {
    delete process.env.CALL_LLM_API_KEY;
    const res = await POST(req({ messages: [] }));
    expect(res.status).toBe(503);
  });

  it("token incorrecto -> 401", async () => {
    process.env.CALL_LLM_API_KEY = KEY;
    const res = await POST(req({ messages: [] }, "Bearer mal"));
    expect(res.status).toBe(401);
  });

  it("token correcto, sin turnos -> apertura legal (JSON estilo OpenAI)", async () => {
    process.env.CALL_LLM_API_KEY = KEY;
    const res = await POST(req({ messages: [{ role: "system", content: "x" }] }, `Bearer ${KEY}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content.toLowerCase()).toContain("automatizado");
  });

  it("stream=true -> SSE en formato OpenAI con el texto y [DONE]", async () => {
    process.env.CALL_LLM_API_KEY = KEY;
    const res = await POST(req({ messages: [{ role: "system", content: "x" }], stream: true }, `Bearer ${KEY}`));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text.toLowerCase()).toContain("automatizado");
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("[DONE]");
  });

  it("json inválido -> 400", async () => {
    process.env.CALL_LLM_API_KEY = KEY;
    const bad = new Request("http://localhost/api/call/llm", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: "{no-json"
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
