import { describe, it, expect } from "vitest";
import { candidatesToCsv, csvFileName } from "@/application/candidatesToCsv";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

// EXPORT CSV (Lote 5a / contingencia): si Meta suspende la cuenta de IG, el usuario es la unica clave de
// contacto; este export (telefono + estado + movil) es la copia con la que Alex sigue. Puro; la UI lo descarga.

function mk(overrides: Partial<Candidate> & { instagramUsername: string }): Candidate {
  return normalizeCandidate({ ...createCandidate({ instagramUsername: overrides.instagramUsername }), ...overrides });
}

describe("candidatesToCsv", () => {
  it("lista vacia -> solo la cabecera", () => {
    const csv = candidatesToCsv([]);
    expect(csv).toBe('"Usuario","Nombre","Edad","Ciudad","Telefono","Movil","Estado","Decision","Anuncio","Actualizada"');
  });

  it("una candidata -> cabecera + su fila con los campos clave", () => {
    const csv = candidatesToCsv([
      mk({
        instagramUsername: "12345",
        firstName: "tania",
        age: 34,
        city: "Cordoba",
        phone: "+54 9 351 555",
        deviceModel: "iPhone 13",
        currentState: "APPROVED",
        humanFitDecision: "APPROVED",
        adId: "AD_A",
        adTitle: "AD 01"
      })
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toContain('"12345"');
    expect(row).toContain('"tania"');
    expect(row).toContain('"34"');
    expect(row).toContain('"Cordoba"');
    expect(row).toContain('"+54 9 351 555"');
    expect(row).toContain('"iPhone 13"');
    expect(row).toContain('"APPROVED"');
    expect(row).toContain('"AD 01"');
  });

  it("escapa comas, comillas y saltos de linea sin romper columnas", () => {
    const csv = candidatesToCsv([mk({ instagramUsername: "1", firstName: 'ana "la 40", cordobesa', city: "linea1\nlinea2" })]);
    const [, row] = csv.split("\r\n");
    // La coma y las comillas van dentro de un campo entrecomillado con "" escapadas -> no crean columnas nuevas.
    expect(row).toContain('"ana ""la 40"", cordobesa"');
    expect(row).toContain('"linea1\nlinea2"');
    // La cabecera tiene 10 columnas; el campo con coma no debe anadir columnas al partir por coma FUERA de comillas.
    expect(csv.split("\r\n")[0].split(",").length).toBe(10);
  });

  it("campos ausentes salen como cadena vacia entrecomillada", () => {
    const csv = candidatesToCsv([mk({ instagramUsername: "1" })]);
    const [, row] = csv.split("\r\n");
    // Sin nombre/edad/ciudad/telefono/anuncio -> "" en esas posiciones (no "undefined").
    expect(row).not.toContain("undefined");
    expect(row).toContain('""');
  });

  it("usa el titulo del anuncio, o el id si no hay titulo", () => {
    const soloId = candidatesToCsv([mk({ instagramUsername: "1", adId: "AD_X" })]);
    expect(soloId.split("\r\n")[1]).toContain('"AD_X"');
  });

  it("csvFileName incluye el dia de la fecha ISO", () => {
    expect(csvFileName("2026-07-12T18:30:00.000Z")).toBe("rose-models-candidatas-2026-07-12.csv");
  });
});
