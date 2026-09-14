---
name: gate-carpeta-local
description: PR #691 (2026-09-14) sin mergear — trigger que exige metadata.carpeta_local para pasar de la primera etapa; migracion SIN aplicar y clave SIN encender; y el arnes DO + tabla temporal con el que se ensayo sin tocar los AFTER
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
- Estado al cierre: checks verdes, **sin mergear** (el brief lo prohibia), **migracion
  `20260914223000` sin aplicar**, **clave sin encender** para `metrik` (el UPDATE esta en el
  cuerpo del PR y lo aprueba Mauricio). Riesgo medido: 0 negocios de metrik despues de la
  primera etapa sin carpeta (24 de 42 estan despues; los 42 la tienen).
- "Primera etapa" es `min(orden)` de la linea, no `orden = 1` literal: hoy identicos (las 15
  lineas empiezan en 1). No "simplificar" a `orden > 1`.
- ⚠️ No hay campo en pantalla para llenar `carpeta_local`: se llena por `/negocio`, `/contrato`
  (`sincronizar-negocio-contrato.ts`) o SQL. Si se enciende y alguien crea un negocio desde la
  app, no podra avanzarlo hasta que un agente escriba la carpeta.

**Arnes de ensayo reutilizable** para cualquier trigger BEFORE sobre `negocios` sin disparar los
AFTER con `pg_net` (`trg_avisar_entrada_etapa`): dentro de UN `DO ... RAISE EXCEPTION`, instalar
la migracion (dos veces = idempotencia), `create temp table t (like public.negocios) on commit
drop`, colgarle SOLO el trigger nuevo, y correr ahi los caminos que PASAN. Sobre la tabla real,
solo los caminos que RECHAZAN en el BEFORE (abortan antes de los AFTER), con un `raise` de
aborto previo si el caso temporal no rechazo. El resultado viaja en el mensaje del `RAISE`
final como JSON; el rollback se confirma en una llamada aparte. Ver [[sql-prod-one]].
