---
name: migracion-haiku-55
description: Gemini → Claude Haiku 5.5 en ONE (rama feat/migracion-haiku-5-5, 2026-10-20) — traductor en un solo archivo, interruptor LLM_PROVEEDOR, eval sin correr de verdad
metadata:
  type: project
---

Mauricio aprobó el 2026-10-20 apagar Gemini y poner `claude-haiku-5-5` en todo ONE salvo el audio.

Diseño elegido: los sitios siguen armando el cuerpo de `generateContent` de Gemini y cambian `fetch` por
`fetchModelo` (`supabase/functions/_shared/llm-anthropic.ts`, que Next re-exporta en `src/lib/ai/modelo-llm.ts`).
El traductor devuelve una `Response` con forma de Gemini: prompts, esquemas y manejo de errores quedan intactos.
NO se usó `@ai-sdk/anthropic` (decisión mía, explicada en el encabezado de `modelo-llm.ts`).

- `LLM_PROVEEDOR=gemini` vuelve a Gemini sin redeploy. Sin `ANTHROPIC_API_KEY` también sigue en Gemini.
- Haiku 5.5 rechaza `temperature` (tabla de capacidades de `@ai-sdk/anthropic` 4.0.82): se quita.
- Audio, HEIC y las imágenes de más de 5 MB siguen en Gemini: **no borrar `GEMINI_API_KEY`**, y además los sitios
  cortan con `if (!apiKey)` sobre esa llave.
- La telemetría (`wa_message_log.gemini_model`, la traza `uso.modelo` del bot) sigue diciendo el modelo de Gemini.
- vitest fija `LLM_PROVEEDOR=gemini` para que una llave en la shell no desvíe las pruebas de los sitios.

**Why:** reemplazo de proveedor por decisión de Mauricio; el clasificador del modo auto le NEGÓ al subagente las
llamadas reales a Anthropic («Real-World Transactions») y leer el `.env.local` principal («Credential»), aunque el
coordinador lo autorizó. El eval real lo corre la sesión principal.

**How to apply:** antes de tocar un sitio de IA, pasar por `fetchModelo`. Si llega un brief de «correr el eval», no
lo intentes desde el subagente: entrega el comando (`scripts/eval-haiku/README.md`).
