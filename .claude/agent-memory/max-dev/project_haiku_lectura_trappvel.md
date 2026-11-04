---
name: haiku-lectura-trappvel
description: Lecturas de Trappvel (Pegar conversación y pantallazos) con Haiku 5.5; causa del 402 del 2026-11-04, LLM_PROVEEDOR_CAPTURAS y el arnés con el banco de la QA
metadata:
  type: project
---

PR feat/haiku-lectura-trappvel (2026-11-04). Gemini de producción sin saldo (402) dejó a Trappvel sin lectura.

- **El 402 de «Pegar conversación»**: el pedido sí iba a Haiku; Anthropic daba 401 (llave de Vercel Production inválida
  11-03 16:51 → 11-04 ~14:50) y el respaldo en Gemini daba 402. Se ve en `vercel logs --json`: el campo `logs[]` de la
  fila trae el `[llm] Haiku falló (http 401)`; el `message` solo muestra el último. Desde el PR el sitio recibe el
  error de Haiku si el respaldo también falla.
- **Variables:** pantallazos (`extraer-ranura`, `bloqueo-leer`) por `fetchModeloCapturas` = `LLM_PROVEEDOR_CAPTURAS`,
  que hereda `LLM_PROVEEDOR_DOCUMENTOS` (sin ninguna, Gemini). El chat va por `fetchModeloChat` (global, esfuerzo low).
- **Esfuerzo del chat:** sin pensamiento Haiku elige mal el rango del presupuesto (45 M → «entre 5 y 8»); con `low`
  bien, pero p50 18 s (antes 6 s) y deja de inventar `fechas_tipo`/`tipo_viaje` (el prompt lo prohíbe; Gemini sí los
  llenaba, por eso la vara de «campos llenados» de las bitácoras queda arriba). `medium` fue peor.
- **Arnés:** `scripts/eval-haiku/trappvel.ts`, banco en `proyectos/trappvel/clarity/qa/2026-10-29_punta-a-punta-10-viajes/`.
  `node_modules` del repo principal no trae `sharp` (la lectura sale sin ampliar): en el worktree, `npm ci`.

**Why:** Mauricio quiere Trappvel en Haiku sin depender de Gemini; la decisión de qué variable prender es suya.
**How to apply:** antes de tocar prompts de captura o chat, correr el arnés por familia; la sesión SOE-038 (#1412)
también toca `llm-anthropic.ts` (`esfuerzo` en `crearFetchModelo`, `fetchModeloExtraccion`): mismo mecanismo, no otro.
