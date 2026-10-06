---
name: bandeja-hibrida
description: Bot híbrido de la bandeja WA (#1056, 2026-10-06) — detrás de bot_conversacional.hibrido (apagado = main); soloToque en lo que escribe; propuesta [Sí, ese]; decisión con 3.5-flash-lite
metadata:
  type: project
---

PR #1056 `feat/bandeja-hibrida` (2026-10-06), sin migración. Capa en `_shared/wa-decision.ts` (I/O) y
`wa-decision-reglas.ts` (puro); interruptor en `wa-hibrido.ts`.

**Why:** cada control sellado de Vera encontraba vocabulario nuevo en los lectores de texto libre. Mauricio: «vamos
con la mezcla», y que se pueda mergear sin cambiar Trappvel y probarlo en vivo en un workspace de prueba.

**How to apply:**
- `config_extra.bot_conversacional.hibrido === true` lo prende. Apagado = `main` EXACTO: todo cambio de
  comportamiento nuevo en la bandeja va con compuerta (`config.hibrido`, `hibridoDelWorkspace`, `dir.contiene`,
  `opts.hibrido` en textos). Prueba de eso: los archivos de prueba de `main` (`wa-bandeja-vivo`, `wa-carga-ejecucion`…)
  se quedan sin tocar; las versiones híbridas viven en `*-hibrido*.test.ts` con la llave prendida.
- `soloToque` = escribe en un viaje o crea algo; solo toque/número/código/«sí» solo. El viaje que reconoce el modelo
  se PROPONE con [Sí, ese]; el «sí» solo vale si la propuesta es la última fila `parser_source='decision'` de
  `wa_message_log` con la misma ref y huella.
- Números escritos con artículo singular («la dos», «el segundo»); «los dos» no (es «ambos»).
- Decisión con su modelo: `modelo_decision`, por defecto gemini-3.5-flash-lite minimal. Con 3.8 a 4 s, ~19 % timeouts;
  con lite, 0 y p50 0,84 s, pero más «no sé» (13 fallas leves de 151).
- Banco real: `scratchpad/comparador/hibrido/correr.sh <modelo>` → vitest del archivo HÍBRIDO, una corrida ×1, SOLO
  llave de pruebas; latencia con `performance.now()` (Date es falso en el vivo).
- Gotcha: el aislamiento niega heredocs que escriben fuera del worktree, comandos con `$(git …)` o con variables antes
  de `sed`; escribir el .py con Write en `.ed/` y correrlo solo.
Relacionado: [[entendimiento-bandeja-wa]], [[bandeja-varios-viajes]].
