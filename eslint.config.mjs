import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // private-data/, real-data/, backups/ y los arneses de replay locales (tests/_*.test.ts,
    // gitignorados) son material local; no deben poder romper el lint del proyecto.
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "private-data/**",
      "real-data/**",
      "backups/**",
      "tests/_*.test.ts"
    ]
  }
];

export default eslintConfig;
