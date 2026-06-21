import { describe, expect, it } from "vitest";
import { getQStashConfig } from "@/application/qstashConfig";

describe("getQStashConfig", () => {
  it("isConfigured solo con token + ambas signing keys; debounce DESACTIVADO por defecto", () => {
    expect(getQStashConfig({} as NodeJS.ProcessEnv).isConfigured).toBe(false);
    const config = getQStashConfig({
      QSTASH_TOKEN: "t",
      QSTASH_CURRENT_SIGNING_KEY: "cur",
      QSTASH_NEXT_SIGNING_KEY: "next"
    } as unknown as NodeJS.ProcessEnv);
    expect(config.isConfigured).toBe(true);
    expect(config.debounceEnabled).toBe(false); // off salvo INBOUND_DEBOUNCE=on
    expect(config.debounceMs).toBe(55000);
  });

  it("debounceEnabled solo con INBOUND_DEBOUNCE=on; INBOUND_DEBOUNCE_MS ajustable", () => {
    const config = getQStashConfig({
      QSTASH_TOKEN: "t",
      QSTASH_CURRENT_SIGNING_KEY: "cur",
      QSTASH_NEXT_SIGNING_KEY: "next",
      INBOUND_DEBOUNCE: "on",
      INBOUND_DEBOUNCE_MS: "40000"
    } as unknown as NodeJS.ProcessEnv);
    expect(config.debounceEnabled).toBe(true);
    expect(config.debounceMs).toBe(40000);
  });
});
