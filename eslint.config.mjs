import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktrees de sesion: son copias del mismo repo dentro del repo, asi que
    // sin esto `eslint .` cuenta cada archivo una vez por worktree abierto y la
    // deuda de lint se ve varias veces mas grande de lo que es. Estan en
    // .gitignore, pero eslint no lee .gitignore.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
