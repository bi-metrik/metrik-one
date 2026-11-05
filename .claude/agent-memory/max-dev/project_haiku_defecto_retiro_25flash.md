---
name: project-haiku-defecto-retiro-25flash
description: PR #1429 (5-nov) — documentos/capturas a Haiku por defecto; respaldo Gemini a 3.5-flash-lite; intérprete WA NO tocado; vars Vercel ocultas mandan
metadata:
  type: project
---

PR #1429 (borrador, rama `fix/llm-haiku-por-defecto-gemini-25-retiro`): `OPCIONES_DOCUMENTOS` / `OPCIONES_CAPTURAS` con `porDefecto: 'anthropic'`; actas siguen en `gemini` (eval 8/12, decisión pendiente). Los sitios que pedían `gemini-2.5-flash` piden `gemini-3.5-flash-lite` con `thinkingLevel: 'low'`. En Haiku el esfuerzo no cambia: 512/1024/2048 y 'low' dan `low`.

**Why:** Google retira `gemini-2.5-flash`: desde el 2026-12-01 lo enruta a 3.5-flash-lite. Mauricio decidió Haiku 5.5 como modelo de producción.

**How to apply:**
- `LLM_PROVEEDOR_DOCUMENTOS` y `LLM_PROVEEDOR_CAPTURAS` existen en Vercel con valor oculto. Si valen `gemini`, anulan el nuevo defecto: confirmarlo antes de dar el cambio por hecho.
- El defecto del intérprete WA (`wa-interprete-reglas.ts`) sigue en 2.5-flash a propósito. Cambiarlo a 3.5-flash-lite convierte `thinkingBudget:0` en `MINIMAL`, y eso en Haiku es esfuerzo `low` con pensamiento, tope de 2048 y JSON compacto. Le cambia el bot a Haiku con un timeout de 4 s. Hace falta eval antes.
- `vitest.config.ts` fija `LLM_PROVEEDOR=gemini` en todas las pruebas: para probar un defecto `anthropic` hay que hacer `stubEnv('LLM_PROVEEDOR','anthropic')`.
- La llave Gemini de producción dio 402 el 2026-11-04 (#1413): hoy el respaldo no atiende.
