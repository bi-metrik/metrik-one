---
name: bandeja-hibrida
description: Bot híbrido de la bandeja WA (2026-10-06) — puntos de decisión con botones/listas y modelo; qué se quitó, qué quedó muerto, el banco pendiente de la llave de pruebas y las decisiones que hay que confirmar
metadata:
  type: project
---

PR `feat/bandeja-hibrida` (2026-10-06), sin migración. Capa en `_shared/wa-decision.ts` (I/O) y `wa-decision-reglas.ts`
(puro). Corre ANTES de la memoria en `atenderEnBandeja` y en el paso 3a del intérprete: igual apagado o prendido.

**Why:** cada control sellado de Vera encontraba vocabulario nuevo en los lectores de texto libre de las preguntas
(«sí» con reserva, nombre tras «nuevo», «el de …»). Mauricio: «vamos con la mezcla».

**How to apply:**
- Una opción entra por el camino de siempre con su `canonico` («sí», «2», «descartar», «nuevo X 300…», código, «corregir:
  el 2 es de T1 26 9», `CANONICO_NO_ES_NUEVO`). Los lectores viejos quedan como lectores de canónicos.
- Tipos que devuelve el modelo: opcion, nombre (literal), llave, correccion (con `cambios` que el código valida),
  contenido, pregunta, no_se. Timeout = «No te entendí; toca una opción».
- Decisiones MÍAS a confirmar con Mauricio: (1) «sí»/«no» escritos solos se leen sin modelo (el brief solo nombraba
  toque, número y código); (2) crear cliente = toque o «sí» solo; un escrito libre que dice crear pide el toque. Eso
  baja 6 turnos del conjunto de desarrollo que main acertaba (SR6, CF1, CF7, CF8, V15, S5): cambiar `soloToque`.
- El modelo de la decisión sale de `bot_conversacional.modelo`/`timeout_ms` AUNQUE `activo` sea false;
  `WA_INTERPRETE_APAGADO=1` también lo apaga (todo escrito libre pide tocar).
- Quedó código muerto desde la bandeja (no se borró): ramas de pendiente de bandeja del validador del intérprete,
  `esSiSinReserva`, `interpretarConfirmacionNuevo` y sus listas, lectores en caja de `armarSegmentos`. PR de limpieza.
- Banco con Gemini: `scratchpad/comparador/hibrido/correr.sh` → vitest `-t "banco con Gemini"`; SOLO llave de pruebas.
- Fixture `__fixtures__/bandeja-hibrida-desarrollo.json` = turnos de controles 8–11 en un punto de decisión (sintéticos).
- Gotcha: el aislamiento niega heredocs y `cat >` fuera del worktree; escribir el archivo con Write en `.ed/` y `cp`.
Relacionado: [[entendimiento-bandeja-wa]], [[bandeja-varios-viajes]].
