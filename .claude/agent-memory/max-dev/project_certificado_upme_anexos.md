---
name: certificado-upme-anexos
description: PR #548 — el bloque nuevo de Anexos siembra 264 casillas sin mirar la condición, por qué NO nace como gate, y el QA anterior que estaba mal etiquetado
metadata:
  type: project
---

PR **#548** (2026-09-07), **sin mergear a propósito**: la migración
`20260907000002_certificado_upme_en_anexos.sql` escribe filas de producción y la decide
Mauricio. Crea `concepto_upme_anexos` en Anexos (etapa **orden 18**, número visible 15),
condicionado a `servicio = solo_iva`, y le da a la declaración juramentada un
`source_alternatives` hacia él.

**Why:** regla textual de Mauricio — *«para hacer solo devolución de iva el cliente debe
entregar el certificado de la upme en la etapa de anexos»*. El radicado siempre existe;
la degradación de la cláusula SEGUNDO pasa a ser red de seguridad del render.

## ⚠️⚠️ El trigger de siembra IGNORA la `condition` del bloque

`sembrar_casillas_al_crear_bloque` crea la casilla en **todo negocio abierto que ya visitó
la etapa**, sin evaluar `config_extra.condition`. Medido: **264 filas** de las cuales solo
**11 son solo IVA**; las otras 253 nacen inertes (la condición es falsa, el bloque no se
dibuja, `gates_pendientes_etapa` filtra por `condicion_cumplida`). Es lo normal en esta
etapa: `certificado_bancario` tiene 276 filas y `carta_autorizacion_notariada` 140 con
**solo 2 completas**.

**How to apply:** al estimar el alcance de un bloque condicionado, contar los que
**visitaron la etapa**, no los que cumplen la condición. Son dos números muy distintos.

## ⚠️ «La rama X se salta la etapa Y» NO implica que a X le falte el dato

El routing de Documentación (orden 6) manda `solo_iva` a la etapa 10 y se salta
Certificación (9) — cierto. Pero de los **20** negocios abiertos solo IVA, **16 YA tienen
el certificado** bajo `concepto_upme`: recorrieron el flujo antes de que existiera la
bifurcación (`servicio_contratado` nació el 2026-08-03) o respondieron el servicio después
de pasar por Documentación. **El hueco real eran 4 casos, no 20.**

Por eso el bloque **NO nace como gate**, aunque `concepto_upme` sí lo sea: un gate les
pediría a esos 16 subir el documento por segunda vez y retendría a V0238, que ya tiene su
radicado. Encenderlo después es una línea (`es_gate = true`).

## El bloque se COPIA de su origen, no se transcribe

`insert into bloque_configs … select … from bloque_configs where id = <origen>` con
`config_extra || jsonb_build_object('condition', …)`. Así los `campos_extraccion`, el
`cross_check`, el `drive_subfolder` y el `label` son idénticos por construcción. Y la
edición de `campos_fuente` es quirúrgica (`jsonb_agg` con `case` sobre los dos slugs), no
un arreglo de 18 entradas retipeado.

## ⚠️ El QA heredado estaba mal etiquetado

`declaracion-solo-iva-V0452.pdf` **no es un caso solo IVA**: V0452 es `servicio = completo`,
parado en Certificación con `concepto_upme` pendiente y **cero** casillas de Anexos. Su
propio LÉEME decía la verdad en la columna «Caso» («Sin certificado UPME»); el nombre del
archivo la contradecía, y el brief heredó el nombre. El QA se rehízo con **V0284**.

**How to apply:** el nombre de un archivo de QA no es un dato medido. Antes de reusar un
caso de prueba, comprobar en la base que sigue siendo lo que su nombre dice.

## Firmas que no son las que uno supone

`condicion_cumplida(p_cond, p_etapa_actual_id, p_linea_id, p_negocio_id)` — en ese orden.
PostgREST lo dice en el 404 (`hint: Perhaps you meant…`), que es la forma barata de
descubrir una firma sin poder leer `pg_proc`.

⚠️ **El ledger de migraciones NO se puede leer por PostgREST**: solo expone `public` y
`graphql_public`. Con varias sesiones en paralelo, un número libre en el directorio puede
estar ocupado en la base — hay que comprobarlo por otra vía antes de aplicar.

Relacionado: [[declaracion-juramentada-soena]], [[casillas-gate-faltantes]],
[[soena-ve-pipeline]], [[medir-antes-de-construir]], [[cifras-del-brief-caducan]].
