/**
 * Detección de privacidad de la cuenta de Instagram para el OPENER: dado el IGSID de la candidata,
 * dice si su cuenta es privada (true), pública (false) o no se pudo saber a tiempo (null). El motor lo
 * usa SOLO en el primer mensaje para elegir el opener correcto (privada → pedir aceptar la solicitud;
 * pública/null → opener PÚBLICO por defecto, "hemos visto tu perfil"). La implementación real (infra) lleva
 * su propio límite de tiempo y red de seguridad; aquí solo está el contrato (la capa application no toca I/O).
 */
export interface ProfilePrivacyProvider {
  detectIsPrivate(igsid: string): Promise<boolean | null>;
}

/** Detector inerte (simulador/tests/sin configurar): siempre "desconocido" → opener PÚBLICO por defecto. */
export class NoopProfilePrivacyProvider implements ProfilePrivacyProvider {
  async detectIsPrivate(): Promise<boolean | null> {
    return null;
  }
}
