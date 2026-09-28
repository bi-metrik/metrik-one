---
name: purga-registros-bot
description: Purga de los registros del bot de WhatsApp (#726, SIN mergear, migracion SIN aplicar) — la Politica de Datos de Valida v1.4 espera a que corra; el wamid lleva el telefono en base64; las dos aceptaciones comparten un PDF; la GUC no es candado
metadata:
  type: project
---

**PR #726 (`feat/purga-registros-bot`, 2026-09-15), checks 7/7 verdes, SIN mergear y migracion
`20260915060000_purga_registros_bot.sql` SIN aplicar.** Toca datos de produccion: espera el si de
Mauricio. La Politica de Datos de Valida v1.4 **no se publica hasta que la purga corra en prod**
(decision Mauricio, `proyectos/4d-soft/valida/decisions.md`).

**Why:** los plazos aprobados (aceptacion = contrato + 10 anios; sin respuesta 90 d; conversaciones
90 d; otros acuses 12 meses; sesiones 7 d) no los ejecutaba ningun proceso.

**How to apply:**
- Orden: si de Mauricio → migracion por MCP (alinear ledger) → verificacion de la cabecera → merge
  (publica el cron de Vercel `purgar-objetos-bot`). Aplicar NO borra nada: la **primera corrida del
  pg_cron (08:00 UTC del dia siguiente) si**. Dry-run 2026-09-15 15:55Z: 332 filas de
  `wa_message_log` y 158 `bot_sessions`; lo demas en 0. Re-medir al aplicar ([[cifras-del-brief-caducan]]).
- ⚠️⚠️ **El wamid ES el telefono:** el prefijo de `wamid.HBgM...` decodifica en base64 al numero en
  claro. Toda anonimizacion de algo con wamid tiene que anular el wamid tambien; anular `phone` solo
  deja el numero a un `base64 -d`.
- ⚠️ **Las dos aceptaciones de prod apuntan al MISMO PDF** (`4d-soft/terminos-uso-valida-4d-soft-v1.pdf`):
  borrar el PDF de una aceptacion purgada sin mirar las vivas destruye evidencia ajena.
- `contrato_fin` NO existe como dato de negocio en ONE: se escribe a mano al terminar la relacion; null
  = no se purga nunca (4D SOFT queda null; la prueba interna `41233b25` quedo en 2026-09-15, decision
  mia a confirmar). Rechazada sin contrato cuenta desde `respondido_at`.
- La GUC `metrik.purga_registros_bot` **encauza, no protege**: service_role puede ponerla. El candado es
  `retencion_hasta`. No venderla como "solo la funcion puede borrar".
- Abierto: el acuse del DOCUMENTO (`documento_wamid`) no se copia; tras 12 meses se pierde su estado.

**Metodo que sirvio (PGlite en ONE, primera vez):** devDependency exacta 0.5.8 con el lockfile editado a
mano (`npm install --package-lock-only` metio entradas ajenas de tailwind oxide) y validado con
`npm ci --ignore-scripts --dry-run` en una copia. Esquemas `vault` y `cron` de stub; **sembrar las filas
reales de prod ANTES de aplicar la migracion** para probar que el relleno pasa por las guardas nuevas.
⚠️ `it.skipIf(variable)` se evalua al COLECTAR, antes del `beforeAll`: usar `ctx.skip()` dentro. En un
trigger BEFORE, una columna generada no esta calculada: excluirla del `to_jsonb(new) - ...`.
Mutaciones: 20 de la migracion + 2 del cron, todas muertas ([[pruebas-por-mutacion]]).

Relacionado: [[aceptacion-terminos-wa]], [[retencion-control-en-ci]], [[pglite-pruebas-sql]].
