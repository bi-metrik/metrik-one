---
name: gate-carpeta-local
description: Gate MK001 de metadata.carpeta_local (#691, activo en metrik) y su captura en pantalla (#702, mergeado sin QA en pantalla); el permiso tiene que contener a canAdvanceStage, la escritura es condicional sobre updated_at, y el arnes DO + tabla temporal que no dispara los AFTER
metadata:
  type: project
---

Gate opt-in por workspace (`workspaces.config_extra.exigir_carpeta_local`, solo el booleano JSON
`true`): un negocio no pasa de la primera etapa de su linea, ni nace despues de ella, sin
`negocios.metadata.carpeta_local`. Trigger `trg_zz_gate_carpeta_local`, SQLSTATE `MK001`. Solo
`metrik` lo necesita (es el unico workspace con cerebro).

**Why:** la carpeta del cerebro es el vinculo negocio↔base de conocimiento, y `etapa_actual_id`
lo escriben seis caminos de la app + scripts + SQL de agentes; por eso la regla vive en la base
y la app solo reconoce `MK001` (`src/lib/negocios/gate-carpeta-local.ts`) para abrir el modal de
gates con `omitible: false`.

**How to apply:**
- Estado medido el 2026-09-14 (PostgREST, solo lectura): #691 mergeado, clave en `true` SOLO en
  `metrik`, 42 negocios con carpeta (todos de `metrik`) y los 42 cumplen
  `^proyectos/[a-z0-9-]+/[a-z0-9-]+/$`.
- **#702 (2026-09-14, mergeado `29e50fb`) cerro el hueco de captura**: campo "Carpeta del
  cerebro" en la ficha (solo con la clave) y el modal del gate pide la carpeta, la guarda y
  reintenta el MISMO avance (con el `motivo` del override y el `confirmado`). El bloqueo viaja
  con `tipo: 'carpeta_local'`; sin esa marca el modal cae en "no se puede omitir". Reglas en
  `src/lib/negocios/carpeta-local.ts`, IO en `carpeta-local-servidor.ts`. ⚠️ **Sin QA en
  pantalla** (probarlo escribe en produccion): nadie ha visto el flujo real.
- ⚠️ **El permiso de escribir la carpeta tiene que CONTENER a `canAdvanceStage`** de la etapa
  actual (con `areas_que_avanzan`): el modal solo se abre a quien paso el guard del avance, y si
  esa persona no pudiera guardar, el gate vuelve a quedar sin salida. Hay una prueba de malla
  (roles × areas × stages × responsables) que lo fija; no reemplazarla por un rol fijo.
- ⚠️ **La escritura es un update condicionado a `updated_at`** (trigger `negocios_updated_at`),
  con relectura y hasta 3 intentos, porque PostgREST no puede mandar `metadata || ...`. La
  alternativa atomica es una RPC = migracion; se descarto. Que el trigger siga vivo se leyo en la
  migracion `20260405000000`, no en `pg_trigger`.
- "Primera etapa" es `min(orden)` de la linea, no `orden = 1` literal: hoy identicos (las 15
  lineas empiezan en 1). No "simplificar" a `orden > 1`.

**Arnes de ensayo reutilizable** para cualquier trigger BEFORE sobre `negocios` sin disparar los
AFTER con `pg_net` (`trg_avisar_entrada_etapa`): dentro de UN `DO ... RAISE EXCEPTION`, instalar
la migracion (dos veces = idempotencia), `create temp table t (like public.negocios) on commit
drop`, colgarle SOLO el trigger nuevo, y correr ahi los caminos que PASAN. Sobre la tabla real,
solo los caminos que RECHAZAN en el BEFORE (abortan antes de los AFTER), con un `raise` de
aborto previo si el caso temporal no rechazo. El resultado viaja en el mensaje del `RAISE`
final como JSON; el rollback se confirma en una llamada aparte. Ver [[sql-prod-one]].
