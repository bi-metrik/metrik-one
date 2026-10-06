---
name: bandeja-hibrida
description: Bot híbrido de la bandeja WA (#1056, 2026-10-06) — puntos de decisión con botones/listas y modelo; soloToque en todo lo que escribe; timeouts de 3.8 al 19 %; banco ×1 con llave de pruebas
metadata:
  type: project
---

PR #1056 `feat/bandeja-hibrida` (2026-10-06), sin migración. Capa en `_shared/wa-decision.ts` (I/O) y
`wa-decision-reglas.ts` (puro). Corre ANTES de la memoria en `atenderEnBandeja` y en el paso 3a del intérprete.

**Why:** cada control sellado de Vera encontraba vocabulario nuevo en los lectores de texto libre de las preguntas.
Mauricio: «vamos con la mezcla». Tras la corrida real (SR3 «👌» → creó el viaje) pidió: nada que escriba sale del modelo.

**How to apply:**
- Una opción entra por el camino de siempre con su `canonico`; los lectores viejos quedan como lectores de canónicos.
- `soloToque` = la opción escribe en un viaje o crea algo (Cargar, «sí» de cruce/sin_solicitud, elegir viaje en lista,
  parecidos u ocultos, «Sí, es la misma» y ficha del contacto, Crear). Solo el toque, número, código o «sí» solo la
  aplican. NO lo son: «Viaje nuevo» (muestra el cliente antes de crear), correcciones, preguntas de la caja abierta (no
  escriben). Opción nueva que escriba ⇒ marcarla `soloToque` y que el texto de la pregunta no invite a escribirla.
- Decisiones 1 y 2 aceptadas por Mauricio el 2026-10-06. Decisión 5 (elegir viaje con palabras pide toque) a confirmar.
- Banco real: `scratchpad/comparador/hibrido/correr.sh`, una sola corrida ×1, SOLO llave de pruebas (fila «Gemini API
  Key (pruebas)»). Latencia con `performance.now()` (Date es falso en el vivo). 3.8 a 4 s: ~19 % timeouts, 0 × 429; la
  latencia correlaciona con el razonamiento (0,6), no con la entrada.
- Quedó código muerto desde la bandeja (validador del intérprete, `interpretarConfirmacionNuevo`, lectores de la caja):
  PR de limpieza aparte.
- Gotcha: el aislamiento niega heredocs que escriben fuera del worktree y comandos compuestos complejos; escribir el .py
  con Write en `.ed/` y correrlo solo.
Relacionado: [[entendimiento-bandeja-wa]], [[bandeja-varios-viajes]].
