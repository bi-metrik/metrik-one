---
name: entendimiento-bandeja-wa
description: Mínimo/deseable configurable (#958) y paso de entendimiento sobre la bandeja WA (#960, mergeado y migrado) — orden de aplicación y decisiones que chocaban con el brief
metadata:
  type: project
---

**#958 (mergeado 2026-09-28)**: `nivel`/`pedir_si`/`pregunta` en los campos `datos`, barras en el
bloque y gate de etapa `solicitud_minimo`. El SQL provisional de Trappvel (`sql/trappvel/...PROVISIONAL.sql`)
NO está aplicado y quita el `default: 0` de niños e infantes (decisión de Mauricio).

**#960 (mergeado; migraciones aplicadas al 2026-09-30)**: entendimiento en `wa-alerts` (acción `bandeja_entendimiento`).
Orden: migración `20260929100000` → merge + deploy `wa-alerts` y `wa-webhook` → cron `20260929100100`.
La llave `modules.bandeja_solicitudes_wa` sigue apagada (Emilio).

**Why:** Trappvel deja Airtable; lo que Edgar decida se cambia en config, sin PR.

**How to apply:**
- El modo «bloquea» NO es llave por línea como pedía el brief: es el gate de etapa existente
  (`config_extra.gates`), para no crear un patrón paralelo.
- La función vive en `src/lib/negocios/niveles-solicitud.ts` y tiene copia en `_shared/` con prueba de
  paridad (el cuerpo tiene que ser texto idéntico desde `export type NivelCampo`).
- Marca de sugerido: `negocio_bloques.data._sugeridos[slug]`; la suelta el servidor al cambiar el valor.
- El negocio se crea en Deno con un insert propio (no alcanza `crearNegocioEnWorkspace`): sin Drive
  al crear, sin auto-cotización, sin la regla de bloques `visible`. Si otra línea lo usa, revisar eso.
- «Dos personas» da adultos = 2 pero NO niños = 0: el mínimo pregunta «¿Viajan niños?».
- 2026-09-30: `pedir_si` ganó `vacio` (única comparación que mira la ausencia). La autorización de
  datos NO va como campo: vive en `contactos.custom_data` vía el bloque tipo `contacto`. Si algún día
  debe contar en el mínimo, hay que enseñarle a `calcularNiveles` a leer el contacto, no duplicarla.
- 2026-10-01 (PR fix/bandeja-wa-entendimiento-correcciones, SIN mergear, va a QA): la config
  PROVISIONAL de Trappvel YA está en producción (la simulación la leyó con los 10 campos). Nuevo SQL
  aparte SIN aplicar: `sql/trappvel/2026-10-01_opciones-no-definido-PROVISIONAL.sql` (llave
  `no_definido: true` en la OPCIÓN). Sin él, «¿cuánto sale?» sigue pudiendo volverse `sin_definir`.
- Guardianes en `validarSalida`/`cargarEnExistente`, no en el prompt: el prompt solo ayuda. Un sugerido
  sin confirmar SÍ se reemplaza (contradice el «no se pisa» del 30-sep, decisión del 1-oct).
- Gotcha del modelo: poner en el prompt una frase de ejemplo que aparece en el chat de prueba hizo que
  flash-lite la copiara como sustento (3/3). Los ejemplos del prompt no pueden salir del fixture.
- Simular contra Gemini real sin base: harness en el scratchpad (`sim2/sim.ts`) que importa las reglas
  del worktree; la config de prod se lee ahí, NUNCA entra al fixture del repo.
Relacionado: [[bandeja-wa-solicitudes]], [[fixture-de-produccion-bloquea-push]].
