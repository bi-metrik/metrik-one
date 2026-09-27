---
name: cardumen-guarda-triada-g03
description: PR #931 (sin mergear) — guarda de sustento en la triada del lector Navigate (G03); como probar una guarda cuando el modelo no vuelve a fallar
metadata:
  type: project
---

PR #931 (`fix/cardumen-guarda-triadas`): `dominanteSinSustento` en `interprete.ts`. Un dominante suelto (sin segundo ni solo_uno) en respuesta de mas de 5 palabras sin marca de elegir/ordenar queda no leido. Benchmark v5 en `proyectos/metrik/cardumen/evals/golden-lector/resultados-v5.md`. Mergear NO despliega la edge function.

**Why:** G03 salia dominante 1 en 3/3 en v4. En la corrida v5 el modelo no lo ubico ni una vez por su cuenta, asi que el benchmark solo no probaba la guarda.

**How to apply:** para probar una guarda del lector sin depender del azar del modelo, re-leer las salidas CRUDAS de benchmarks previos (`llamadas[].text`) con el interprete nuevo y un adaptador que las devuelve en orden (script `replay.ts`, cero llamadas a Gemini); mas un aislado N=20 contra el modelo vivo. Correr deno desde un wrapper `.sh` en el scratchpad: el guard del worktree rechaza `export VAR=$(...)` y heredocs complejos. Relacionado: [[cardumen-polaridad-matiz]].
