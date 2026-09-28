---
name: entendimiento-bandeja-wa
description: Mínimo/deseable configurable (#958, mergeado) y paso de entendimiento sobre la bandeja WA (#960, SIN mergear, trae migración) — orden de aplicación y decisiones que chocaban con el brief
metadata:
  type: project
---

**#958 (mergeado 2026-09-28)**: `nivel`/`pedir_si`/`pregunta` en los campos `datos`, barras en el
bloque y gate de etapa `solicitud_minimo`. El SQL provisional de Trappvel (`sql/trappvel/...PROVISIONAL.sql`)
NO está aplicado y quita el `default: 0` de niños e infantes (decisión de Mauricio).

**#960 (SIN mergear)**: entendimiento en `wa-alerts` (acción `bandeja_entendimiento`).
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
Relacionado: [[bandeja-wa-solicitudes]], [[fixture-de-produccion-bloquea-push]].
