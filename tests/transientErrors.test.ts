import { describe, it, expect } from "vitest";
import { isRetriableTransientError, isDatabaseUnavailableError } from "@/application/transientErrors";

// DEDUP del clasificador de errores de infraestructura (Lote 5c). Estos tests FIJAN el comportamiento exacto
// que tenian las dos copias (webhook isLikelyTransientError / store isConnectionError) ANTES de extraerlas, y
// dejan clara la divergencia INTENCIONADA: credenciales -> BD no disponible SI, reintentable NO.

describe("isRetriableTransientError (webhook: ¿reintenta Meta?)", () => {
  it("codigos compartidos de red/conexion -> true", () => {
    for (const code of ["ECONNRESET", "ETIMEDOUT", "CONNECTION_CLOSED", "57P03"]) {
      expect(isRetriableTransientError({ code })).toBe(true);
    }
  });

  it("connection exceptions de postgres (08006/08001/08004) -> true", () => {
    expect(isRetriableTransientError({ code: "08006" })).toBe(true);
    expect(isRetriableTransientError({ code: "08001" })).toBe(true);
    expect(isRetriableTransientError({ code: "08004" })).toBe(true);
  });

  it("credenciales/config (28000/28P01/3D000) -> FALSE (reintentar no lo arregla)", () => {
    expect(isRetriableTransientError({ code: "28000" })).toBe(false);
    expect(isRetriableTransientError({ code: "28P01" })).toBe(false);
    expect(isRetriableTransientError({ code: "3D000" })).toBe(false);
  });

  it("por MENSAJE (fetch failed / timeout / socket...) -> true", () => {
    expect(isRetriableTransientError({ message: "fetch failed" })).toBe(true);
    expect(isRetriableTransientError({ message: "Connection terminated unexpectedly" })).toBe(true);
    expect(isRetriableTransientError({ message: "too many connections" })).toBe(true);
  });

  it("error de datos/logica -> false", () => {
    expect(isRetriableTransientError({ code: "23505", message: "unique violation" })).toBe(false);
    expect(isRetriableTransientError(new Error("algo raro de negocio"))).toBe(false);
    expect(isRetriableTransientError(null)).toBe(false);
    expect(isRetriableTransientError("texto")).toBe(false);
  });

  it("recorre cause anidado y AggregateError", () => {
    expect(isRetriableTransientError({ message: "x", cause: { code: "ECONNRESET" } })).toBe(true);
    expect(isRetriableTransientError(new AggregateError([{ code: "ETIMEDOUT" }]))).toBe(true);
  });
});

describe("isDatabaseUnavailableError (store: ¿caigo a memoria?)", () => {
  it("codigos compartidos de red/conexion -> true", () => {
    for (const code of ["ECONNREFUSED", "EPIPE", "CONNECTION_ENDED", "57P03"]) {
      expect(isDatabaseUnavailableError({ code })).toBe(true);
    }
  });

  it("credenciales/config (28000/28P01/3D000) -> true (config rota -> memoria)", () => {
    expect(isDatabaseUnavailableError({ code: "28000" })).toBe(true);
    expect(isDatabaseUnavailableError({ code: "28P01" })).toBe(true);
    expect(isDatabaseUnavailableError({ code: "3D000" })).toBe(true);
  });

  it("NO va por mensaje (mas conservador para no caer a memoria por un error de datos)", () => {
    expect(isDatabaseUnavailableError({ message: "fetch failed" })).toBe(false);
    expect(isDatabaseUnavailableError({ message: "connection terminated" })).toBe(false);
  });

  it("connection exceptions 08xxx NO estan en este set (divergencia real que se preserva)", () => {
    expect(isDatabaseUnavailableError({ code: "08006" })).toBe(false);
  });

  it("error de datos -> false; recorre cause y AggregateError", () => {
    expect(isDatabaseUnavailableError({ code: "23505" })).toBe(false);
    expect(isDatabaseUnavailableError({ cause: { code: "ECONNREFUSED" } })).toBe(true);
    expect(isDatabaseUnavailableError(new AggregateError([{ code: "28P01" }]))).toBe(true);
  });
});
