import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { deviceEligibilityForDescription, deviceModelForDescription } from "@/application/policyRules";

describe("dataExtractor volunteered first name", () => {
  it("extracts the name from 'Soy Laura'", () => {
    const result = extractDeterministicUnderstanding("Soy Laura, tengo 34 anos");
    expect(result.extractedData.firstName).toBe("Laura");
    expect(result.extractedData.age).toBe(34);
  });

  it("extracts the name from 'me llamo'", () => {
    const result = extractDeterministicUnderstanding("Hola, me llamo carla");
    expect(result.extractedData.firstName).toBe("Carla");
  });

  it("does not mistake locations or roles for names", () => {
    expect(extractDeterministicUnderstanding("Soy de Madrid").extractedData.firstName).toBeUndefined();
    expect(extractDeterministicUnderstanding("Soy modelo desde 2020").extractedData.firstName).toBeUndefined();
    expect(extractDeterministicUnderstanding("Soy argentina").extractedData.firstName).toBeUndefined();
  });
});

describe("dataExtractor device eligibility is gated on actually mentioning a device", () => {
  it("classifies a genuinely bad phone as NOT_ELIGIBLE when the device is named", () => {
    expect(extractDeterministicUnderstanding("tengo un samsung viejo").extractedData.deviceEligibility).toBe("NOT_ELIGIBLE");
    expect(extractDeterministicUnderstanding("tengo un redmi antiguo").extractedData.deviceEligibility).toBe("NOT_ELIGIBLE");
    expect(extractDeterministicUnderstanding("mi movil esta roto").extractedData.deviceEligibility).toBe("NOT_ELIGIBLE");
  });

  it("does NOT flag eligibility from 'malo'/'viejo' when no device is mentioned (sobre la persona)", () => {
    expect(
      extractDeterministicUnderstanding("perdona estoy un poco malo y viejo, tengo 38").extractedData.deviceEligibility
    ).toBeUndefined();
    expect(
      extractDeterministicUnderstanding("hoy me siento vieja y de mala leche").extractedData.deviceEligibility
    ).toBeUndefined();
  });

  it("still classifies a good phone as before", () => {
    expect(extractDeterministicUnderstanding("tengo un iphone 14").extractedData.deviceEligibility).toBe("APPROVED");
    expect(extractDeterministicUnderstanding("ipone 13").extractedData.deviceEligibility).toBe("APPROVED");
  });
});

describe("dataExtractor OnlyFans negation", () => {
  it("keeps hasOnlyFans true for plain mentions", () => {
    expect(extractDeterministicUnderstanding("Tengo of verificado").extractedData.hasOnlyFans).toBe(true);
  });

  it("reads 'nunca tuve of' as false instead of true", () => {
    expect(extractDeterministicUnderstanding("No, nunca tuve of").extractedData.hasOnlyFans).toBe(false);
    expect(extractDeterministicUnderstanding("Nunca he tenido onlyfans").extractedData.hasOnlyFans).toBe(false);
    expect(extractDeterministicUnderstanding("No tengo of").extractedData.hasOnlyFans).toBe(false);
  });
});

describe("dataExtractor device models with attached suffixes (regression iter-1: re-pregunta del movil)", () => {
  it("recognizes 'iPhone 13pro Max' as an approved device", () => {
    const result = extractDeterministicUnderstanding("Tengo un iPhone 13pro Max");
    expect(result.extractedData.deviceType).toBe("IPHONE");
    expect(result.extractedData.deviceEligibility).toBe("APPROVED");
    expect(result.extractedData.deviceModel).toContain("iphone 13");
  });

  it("recognizes 'iPhone 14 pro' and keeps iPhone 11 as pending quality test", () => {
    expect(deviceEligibilityForDescription("Tengo iPhone 14 pro")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("Tengo iPhone 11")).toBe("PENDING_QUALITY_TEST");
    expect(deviceModelForDescription("tengo un iphone 14 pro")).toBe("iphone 14 pro");
  });
});

describe("dataExtractor short local phone numbers with explicit phone context", () => {
  it("captures a 7-digit number when the message mentions the phone", () => {
    const result = extractDeterministicUnderstanding("Mi numero es 5550147");
    expect(result.extractedData.phone).toBe("5550147");
    expect(result.intent).toBe("PROVIDES_PHONE");
  });

  it("does not capture short digit runs without phone context", () => {
    const result = extractDeterministicUnderstanding("Tengo 1500000 seguidores entre cuentas");
    expect(result.extractedData.phone).toBeUndefined();
    expect(result.extractedData.age).toBeUndefined();
  });
});
