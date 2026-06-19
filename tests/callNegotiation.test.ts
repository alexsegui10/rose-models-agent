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
  it("la oferta inicial es 70 agencia / 30 modelo y no es suelo", () => {
    const offer = initialCallRevenueShareOffer();
    expect(offer.agencyShare).toBe(70);
    expect(offer.modelShare).toBe(30);
    expect(offer.step).toBe(0);
    expect(offer.isFloor).toBe(false);
  });

  it("cada escalon: la AGENCIA cede 70 -> 65 -> 60 (la modelo sube 30 -> 35 -> 40)", () => {
    expect(callRevenueShareOfferForStep(0).agencyShare).toBe(70);
    expect(callRevenueShareOfferForStep(1).agencyShare).toBe(65);
    expect(callRevenueShareOfferForStep(2).agencyShare).toBe(60);
    expect(callRevenueShareOfferForStep(0).modelShare).toBe(30);
    expect(callRevenueShareOfferForStep(1).modelShare).toBe(35);
    expect(callRevenueShareOfferForStep(2).modelShare).toBe(40);
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

  it("NUNCA baja del suelo: la AGENCIA no cede por debajo del 60", () => {
    expect(nextCallRevenueShareStep(2)).toBe(2);
    // Por mucho que se llame repetidamente, jamas pasa del suelo.
    let step: CallRevenueShareStep = 2;
    for (let i = 0; i < 5; i++) {
      step = nextCallRevenueShareStep(step);
    }
    expect(callRevenueShareOfferForStep(step).agencyShare).toBe(CALL_REVENUE_SHARE_FLOOR);
  });

  it("ningun escalon cede la agencia por debajo del suelo autorizado por Alex (60)", () => {
    for (const agencyShare of CALL_REVENUE_SHARE_LADDER) {
      expect(agencyShare).toBeGreaterThanOrEqual(CALL_REVENUE_SHARE_FLOOR);
    }
  });
});
