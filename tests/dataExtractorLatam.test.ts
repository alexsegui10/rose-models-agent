import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";

describe("dataExtractor LATAM phone extraction", () => {
  describe("Argentinian numbers", () => {
    it("extracts +54 with the mobile 9 prefix and dashes", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es +54 9 11 2345-6789");
      expect(result.extractedData.phone).toBe("5491123456789");
    });

    it("extracts +54 9 with a three-digit area code and spaces", () => {
      const result = extractDeterministicUnderstanding("Mi numero es +54 9 351 123 4567");
      expect(result.extractedData.phone).toBe("5493511234567");
    });

    it("extracts +54 without the mobile 9 prefix", () => {
      const result = extractDeterministicUnderstanding("Te paso mi telefono +54 11 2345-6789");
      expect(result.extractedData.phone).toBe("541123456789");
    });

    it("extracts 54 numbers without the plus sign", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es 54 9 11 2345 6789");
      expect(result.extractedData.phone).toBe("5491123456789");
    });

    it("extracts a bare Buenos Aires local number", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es 11 2345 6789");
      expect(result.extractedData.phone).toBe("1123456789");
    });
  });

  describe("Colombian numbers", () => {
    it("extracts +57 mobiles with spaces", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es +57 300 123 4567");
      expect(result.extractedData.phone).toBe("573001234567");
    });

    it("extracts a bare ten-digit mobile starting with 3", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es 3001234567");
      expect(result.extractedData.phone).toBe("3001234567");
    });

    it("extracts a grouped ten-digit mobile starting with 3", () => {
      const result = extractDeterministicUnderstanding("Llamame al 300 123 4567");
      expect(result.extractedData.phone).toBe("3001234567");
    });
  });

  describe("Spanish numbers keep working", () => {
    it("extracts the classic spaced Spanish mobile", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es 612 345 678, podemos hablar cuando quieras");
      expect(result.extractedData.phone).toBe("612345678");
    });

    it("extracts a Spanish mobile with +34 prefix preserving the country code", () => {
      const result = extractDeterministicUnderstanding("Mi telefono es +34 612 345 678");
      expect(result.extractedData.phone).toBe("34612345678");
    });

    it("extracts a contiguous Spanish mobile", () => {
      const result = extractDeterministicUnderstanding("Llamame al 612345678");
      expect(result.extractedData.phone).toBe("612345678");
    });
  });

  it("classifies a LATAM phone message as PROVIDES_PHONE, not REQUESTS_CALL", () => {
    const result = extractDeterministicUnderstanding("Mi telefono es +54 9 11 2345-6789");
    expect(result.intent).toBe("PROVIDES_PHONE");
  });

  it("does not invent a phone from short revenue figures", () => {
    const result = extractDeterministicUnderstanding("Ahora mismo facturo 1200 al mes");
    expect(result.extractedData.phone).toBeUndefined();
    expect(result.extractedData.currentMonthlyRevenue).toBe(1200);
  });

  describe("phone digits never leak into the age (regression: adult closed as minor)", () => {
    it("does not read 'tengo 11 2345 6789' as age 11", () => {
      const result = extractDeterministicUnderstanding("tengo 11 2345 6789");
      expect(result.extractedData.phone).toBe("1123456789");
      expect(result.extractedData.age).toBeUndefined();
    });

    it("does not read the classic AR mobile prefix as age 15", () => {
      const result = extractDeterministicUnderstanding("tengo 15 2345 6789");
      expect(result.extractedData.phone).toBe("1523456789");
      expect(result.extractedData.age).toBeUndefined();
    });

    it("still extracts the real age when both age and phone are present", () => {
      const result = extractDeterministicUnderstanding("Tengo 24 años y mi telefono es 11 2345 6789");
      expect(result.extractedData.age).toBe(24);
      expect(result.extractedData.phone).toBe("1123456789");
    });
  });
});

describe("dataExtractor LATAM cities and countries", () => {
  it.each([
    ["soy de medellin", "Medellín", "Colombia"],
    ["vivo en bogota", "Bogotá", "Colombia"],
    ["soy de cali", "Cali", "Colombia"],
    ["soy de barranquilla", "Barranquilla", "Colombia"],
    ["soy de buenos aires", "Buenos Aires", "Argentina"],
    ["vivo en mendoza", "Mendoza", "Argentina"],
    ["soy de la plata", "La Plata", "Argentina"],
    ["vivo en mar del plata", "Mar del Plata", "Argentina"],
    ["soy de rosario", "Rosario", "Argentina"],
    ["soy de montevideo", "Montevideo", "Uruguay"]
  ])("extracts city and country from '%s'", (message, city, country) => {
    const result = extractDeterministicUnderstanding(message);
    expect(result.extractedData.city).toBe(city);
    expect(result.extractedData.country).toBe(country);
  });

  it("keeps Spanish cities mapped to España", () => {
    const result = extractDeterministicUnderstanding("Soy de Madrid");
    expect(result.extractedData.city).toBe("Madrid");
    expect(result.extractedData.country).toBe("España");
  });

  it("keeps mapping cordoba to Argentina as before", () => {
    const result = extractDeterministicUnderstanding("Vivo en cordoba");
    expect(result.extractedData.city).toBe("Cordoba");
    expect(result.extractedData.country).toBe("Argentina");
  });

  it("maps a bare country mention without inventing a city", () => {
    const result = extractDeterministicUnderstanding("Soy de Colombia");
    expect(result.extractedData.country).toBe("Colombia");
    expect(result.extractedData.city).toBeUndefined();
  });

  it("does not mistake 'calidad' for the city Cali", () => {
    const result = extractDeterministicUnderstanding("La calidad de mis fotos es buena");
    expect(result.extractedData.city).toBeUndefined();
    expect(result.extractedData.country).toBeUndefined();
  });
});
