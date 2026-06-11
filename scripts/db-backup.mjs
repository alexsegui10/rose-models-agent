#!/usr/bin/env node
/**
 * db-backup.mjs — backup con `pg_dump -Fc` (formato custom, restaurable con pg_restore) a un
 * fichero con timestamp bajo backups/ (gitignorado).
 *
 * Uso: npm run db:backup
 *
 * Lee DATABASE_URL del entorno o de .env.local (gitignorado). La contraseña se pasa a pg_dump por
 * la variable de entorno PGPASSWORD del proceso hijo, nunca por línea de comandos ni por ficheros
 * versionados (invariante 7). Sin dependencias de terceros: solo node built-ins.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_PG_DUMP_PATH = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";

function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // sin .env.local: se usa solo el entorno del proceso
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL no está definida. Añádela a .env.local (ver .env.example) antes de hacer backup.");
  process.exit(1);
}

let url;
try {
  url = new URL(databaseUrl);
} catch {
  console.error("DATABASE_URL no es una cadena de conexión válida (postgres://usuario:password@host:puerto/base).");
  process.exit(1);
}

const databaseName = url.pathname.replace(/^\//, "");
if (!databaseName) {
  console.error("DATABASE_URL no incluye el nombre de la base de datos.");
  process.exit(1);
}

const pgDumpPath =
  process.env.PG_DUMP_PATH ?? (existsSync(DEFAULT_PG_DUMP_PATH) ? DEFAULT_PG_DUMP_PATH : "pg_dump");

const backupsDir = join(process.cwd(), "backups");
mkdirSync(backupsDir, { recursive: true });

const timestamp = new Date()
  .toISOString()
  .replace(/[:]/g, "-")
  .replace(/\..+$/, "");
const outputFile = join(backupsDir, `${databaseName}-${timestamp}.dump`);

const args = [
  "--format=custom",
  "--host",
  url.hostname || "localhost",
  "--port",
  url.port || "5432",
  "--username",
  decodeURIComponent(url.username || "postgres"),
  "--no-password",
  "--file",
  outputFile,
  databaseName
];

const result = spawnSync(pgDumpPath, args, {
  stdio: "inherit",
  env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }
});

if (result.error) {
  console.error(`No se pudo ejecutar pg_dump (${pgDumpPath}): ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`pg_dump terminó con código ${result.status}.`);
  process.exit(result.status ?? 1);
}

console.log(`Backup creado: ${outputFile}`);
