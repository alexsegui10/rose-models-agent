// Calcula la MISMA huella no reversible que loguea el webhook (secretFingerprint en
// src/application/instagramWebhook.ts), para comparar localmente qué App Secret tienes desplegado
// en Vercel SIN filtrarlo en ningún log remoto.
//
// Uso (en la terminal del proyecto):
//   node scripts/secret-fingerprint.mjs <secret-de-meta> [otro-secret ...]
//
// Luego compara la "huella" impresa con el secretFingerprints que sale en los logs [ig-webhook].
//   - Coincide  -> ese ES el secret que tienes en Vercel.
//   - No coincide-> Vercel tiene un valor distinto (mal copiado o no redeployado).
//
// El secret solo vive en tu terminal local; este script no lo guarda ni lo sube a ningún sitio.
import { createHmac } from "node:crypto";

const secrets = process.argv.slice(2);
if (secrets.length === 0) {
  console.error("Uso: node scripts/secret-fingerprint.mjs <app-secret> [otro-app-secret ...]");
  process.exit(1);
}

for (const raw of secrets) {
  const s = raw.trim();
  const fingerprint = createHmac("sha256", "ig-webhook-diag").update(s).digest("hex").slice(0, 12);
  console.log(`huella=${fingerprint}  longitud=${s.length}`);
}
