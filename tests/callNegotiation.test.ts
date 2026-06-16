import { describe, expect, it } from "vitest";
import {
  CALL_REVENUE_SHARE_FLOOR,
  CALL_REVENUE_SHARE_LADDER,
  callRevenueShareOfferForStep,
  initialCallRevenueShareOffer,
  nextCallRevenueShareStep,
  type CallRevenueShareStep
} from "@/application/callNegotiation";

describe("escalera de negociacion del reparto en la llamada (voz)", () => {
  it("la oferta inicial es 70/30 para la modelo y no es suelo", () => {
    const offer = initialCallRevenueShareOffer();
    expect(offer.modelShare).toBe(70);
    expect(offer.agencyShare).toBe(30);
    expect(offer.step).toBe(0);
    expect(offer.isFloor).toBe(false);
  });

  it("cada escalon ofrece 70 -> 65 -> 60 a la modelo", () => {
    expect(callRevenueShareOfferForStep(0).modelShare).toBe(70);
    expect(callRevenueShareOfferForStep(1).modelShare).toBe(65);
    expect(callRevenueShareOfferForStep(2).modelShare).toBe(60);
    // La agencia se queda el complementario.
    expect(callRevenueShareOfferForStep(1).agencyShare).toBe(35);
    expect(callRevenueShareOfferForStep(2).agencyShare).toBe(40);
  });

  it("el ultimo escalon (60) se marca como suelo: oferta final", () => {
    expect(callRevenueShareOfferForStep(0).isFloor).toBe(false);
    expect(callRevenueShareOfferForStep(1).isFloor).toBe(false);
    expect(callRevenueShareOfferForStep(2).isFloor).toBe(true);
  });

  it("avanzar de escalon cuando insiste: 0 -> 1 -> 2", () => {
    expect(nextCallRevenueShareStep(0)).toBe(1);
    expect(nextCallRevenueShareStep(1)).toBe(2);
  });

  it("NUNCA baja del suelo: desde el ultimo escalon se queda en 60", () => {
    expect(nextCallRevenueShareStep(2)).toBe(2);
    // Por mucho que se llame repetidamente, jamas pasa del suelo.
    let step: CallRevenueShareStep = 2;
    for (let i = 0; i < 5; i++) {
      step = nextCallRevenueShareStep(step);
    }
    expect(callRevenueShareOfferForStep(step).modelShare).toBe(CALL_REVENUE_SHARE_FLOOR);
  });

  it("ningun escalon ofrece menos del suelo autorizado por Alex (60)", () => {
    for (const modelShare of CALL_REVENUE_SHARE_LADDER) {
      expect(modelShare).toBeGreaterThanOrEqual(CALL_REVENUE_SHARE_FLOOR);
    }
  });
});
