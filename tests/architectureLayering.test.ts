import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guarda de capas (CLAUDE.md / .claude/rules): la direccion es app -> application -> domain, con content
// como hoja. domain es PURO. Evita reintroducir el ciclo application<->content que se rompio el 16-jun.

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("clean architecture: direccion de dependencias", () => {
  it("src/content NUNCA importa de @/application (sin ciclo application<->content)", () => {
    const offenders = walkTsFiles(join("src", "content")).filter((file) =>
      /from\s+["']@\/application/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("src/domain es una capa PURA (no importa de application/infrastructure/app/server/content)", () => {
    const offenders = walkTsFiles(join("src", "domain")).filter((file) =>
      /from\s+["']@\/(application|infrastructure|app|server|content)/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
