---
name: migracion-haiku-55
description: Gemini → Claude Haiku 5.5 en ONE (PR #1217, 2026-10-20) — traductor en un solo archivo, interruptor LLM_PROVEEDOR; actas a Haiku medium (2026-11-05); parser de Notas de Gemini roto
metadata:
  type: project
---

PR #1217 abierto el 2026-10-20, checks verdes, NO mergear sin Mauricio: Vercel ya tiene la llave y el default es
`anthropic`, así que el merge pasa a Haiku documentos, RUT y actas sin eval real. Edge: deploy aparte + secreto en Supabase.
Eval de la sesión principal (2.ª corrida): bot 20/20, intención WA 24/34, gastos 15/18 (revisados).
El esquema de carga del bot pasaba de 24 opcionales (400): el traductor ahora lo dice en el sistema de una.

Decisiones del 2026-10-20 (Mauricio): respaldo SIEMPRE en Gemini (bot: respaldo directo; fetchModelo: 429/5xx/red
→ mismo pedido a Gemini si el sitio trae su llave); bot Voz de Venezuela APAGADO por código (`VE_APAGADO`, la palabra
clave era el único interruptor); cardumen y customer en Haiku vía `_shared/modelo-texto.ts` (ex `venezuela/gemini.ts`).
Documentos y actas tienen interruptor propio (`LLM_PROVEEDOR_DOCUMENTOS` / `_ACTAS`, por defecto gemini) tras el
eval real: documento 91 % de campos, rut con cercas de código, acta 8/12. El arnés tiene que aplicar
`aplicarNormalizaciones` como producción o reporta NIT con DV que en prod no pasa.

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

**How to apply:** antes de tocar un sitio de IA, pasar por `fetchModelo`. Desde el 2026-11-05 el subagente SÍ pudo
correr el eval (familia acta) con el `.env.local` principal; si el clasificador lo niega, entrega el comando.

Actualización 2026-11-05: actas a Haiku por defecto (`OPCIONES_ACTAS` con `esfuerzo: 'medium'`). El «8/12» del
arnés es parecido a Gemini, no calidad: en 4 actas da 7–9/12 en low, medium y high (ruido). A ojo el fallo de Haiku
es atribuir tareas a quien solo las enumera, no inventar fechas. **Gotcha:** las Notas de Gemini de Meet ya no traen
la línea «Transcripción» sola (viene «Registros de la reunión Transcripción» y «<título> - Transcripción»):
`parseTranscripcion` da cuerpo vacío en 2 de las 4 transcripciones de prod. Sin arreglar al 2026-11-05.
