import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import type { ProfilePrivacyProvider } from "@/application/profilePrivacyProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { followRequestNotificationFor, formatOperatorMessage } from "@/infrastructure/integrations/operatorNotifier";

function engineWith(provider: ProfilePrivacyProvider | undefined) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    profilePrivacyProvider: provider
  });
  return { engine, repository };
}

function privacyProvider(value: boolean | null, onCall?: () => void): ProfilePrivacyProvider {
  return {
    async detectIsPrivate() {
      onCall?.();
      return value;
    }
  };
}

describe("deteccion de privada/publica en el opener", () => {
  it("PRIVADA detectada -> pide aceptar la solicitud y entra en WAITING_PROFILE_ACCESS", async () => {
    const { engine } = engineWith(privacyProvider(true));
    const result = await engine.handleIncomingMessage({ instagramUsername: "17841400000000001", message: "holaaaa" });
    expect(result.response.toLowerCase()).toContain("solicitud de seguimiento");
    expect(result.response.toLowerCase()).not.toContain("hemos visto tu perfil");
    expect(result.candidate.currentState).toBe("WAITING_PROFILE_ACCESS");
  });

  it("PUBLICA detectada -> dice que ha visto el perfil y pide el nombre", async () => {
    const { engine } = engineWith(privacyProvider(false));
    const result = await engine.handleIncomingMessage({ instagramUsername: "17841400000000002", message: "holaaaa" });
    expect(result.response.toLowerCase()).toContain("hemos visto tu perfil");
    expect(result.response.toLowerCase()).toContain("como te llamas");
    expect(result.candidate.currentState).not.toBe("WAITING_PROFILE_ACCESS");
  });

  it("DESCONOCIDA (null) -> opener NEUTRO: pide el nombre sin afirmar nada ni pedir solicitud", async () => {
    const { engine } = engineWith(privacyProvider(null));
    const result = await engine.handleIncomingMessage({ instagramUsername: "17841400000000003", message: "holaaaa" });
    expect(result.response.toLowerCase()).toContain("como te llamas");
    expect(result.response.toLowerCase()).not.toContain("hemos visto tu perfil");
    expect(result.response.toLowerCase()).not.toContain("solicitud de seguimiento");
  });

  it("si el detector falla, red de seguridad -> opener neutro (no rompe el turno)", async () => {
    const provider: ProfilePrivacyProvider = {
      async detectIsPrivate() {
        throw new Error("apify caido");
      }
    };
    const { engine } = engineWith(provider);
    const result = await engine.handleIncomingMessage({ instagramUsername: "17841400000000004", message: "holaaaa" });
    expect(result.response.toLowerCase()).toContain("como te llamas");
    expect(result.response.toLowerCase()).not.toContain("solicitud de seguimiento");
  });

  it("si el llamador ya da la visibilidad, NO se consulta al detector", async () => {
    const onCall = vi.fn();
    const { engine } = engineWith(privacyProvider(true, onCall));
    const result = await engine.handleIncomingMessage({
      instagramUsername: "17841400000000005",
      profileVisibility: "PUBLIC",
      message: "holaaaa"
    });
    expect(onCall).not.toHaveBeenCalled();
    expect(result.response.toLowerCase()).toContain("hemos visto tu perfil");
  });
});

describe("aviso para enviar la solicitud de seguimiento", () => {
  it("avisa cuando la candidata ENTRA en WAITING_PROFILE_ACCESS", () => {
    const notification = followRequestNotificationFor({ instagramUsername: "17841400000000006" }, [
      { toState: "WAITING_PROFILE_ACCESS" }
    ]);
    expect(notification).not.toBeNull();
    expect(notification?.kind).toBe("follow-request");
    expect(formatOperatorMessage(notification!).toLowerCase()).toContain("solicitud de seguimiento");
  });

  it("no avisa si no entra en WAITING_PROFILE_ACCESS", () => {
    expect(followRequestNotificationFor({ instagramUsername: "x" }, [{ toState: "QUALIFYING" }])).toBeNull();
    expect(followRequestNotificationFor({ instagramUsername: "x" }, [])).toBeNull();
  });
});
