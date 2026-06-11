import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit NO carga .env.local (solo el dev server de Next.js lo hace): lo leemos a mano, sin
// dependencias, para que `npm run db:generate` / `npm run db:migrate` funcionen sin exportar
// variables. Las variables ya presentes en el entorno tienen prioridad, así que se puede migrar
// otra base de datos por ejecución (p. ej. $env:DATABASE_URL apuntando a rose_models_test).
// La cadena de conexión (con su contraseña) vive SOLO en .env.local, gitignorado — invariante 7.
function loadEnvLocal(): void {
  let content: string;
  try {
    content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // sin .env.local (p. ej. otra máquina): se usa solo el entorno del proceso
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

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

export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
});
