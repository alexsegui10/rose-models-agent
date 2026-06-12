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
