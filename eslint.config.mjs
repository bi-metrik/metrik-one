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
      // Escribir en `activity_log` sin pasar por `registrarActividad` deja el insert
      // sin nadie que lea su `error`: Postgres rechaza la fila y el evento desaparece
      // sin ruido. Eso es lo que borro 311 aprobaciones de propuesta del timeline.
      // La regla es lo unico que impide que el patron vuelva a entrar: convertir los
      // ~60 sitios no sirve de nada si el 61 se escribe a mano.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(insert|upsert|update)$/] > MemberExpression.callee > CallExpression[callee.property.name='from'] > Literal[value='activity_log']",
          message:
            "No escribas en activity_log directamente: usa registrarActividad/actualizarActividad de @/lib/activity/registrar-actividad. Lee el error del insert — si no, el evento se pierde en silencio.",
        },
      ],
    },
  },
  {
    // Dos excepciones, y las dos declaradas:
    //   - `src/lib/activity/**` ES el helper: es el unico que toca la tabla de frente.
    //   - `supabase/functions/**` corre en Deno y NO puede importar de `src/`, asi que
    //     el helper no le llega. Su unico insert (`_shared/handlers/actividad.ts`) ya
    //     lee su `error`; si aparece otro, tiene que hacer lo mismo a mano.
    files: ["src/lib/activity/**", "supabase/functions/**"],
    rules: { "no-restricted-syntax": "off" },
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
