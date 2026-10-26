---
name: doble-hace-cumplir-llaves
description: Un doble en memoria de un script que escribe en la base tiene que hacer cumplir las llaves foráneas AL ESCRIBIR, cruzadas contra los tipos de la base; si solo las revisa al borrar, el --apply real cae en el primer insert
metadata:
  type: feedback
---

Un doble en memoria contra el que se prueba un script de escritura (clonador, seed, provisión)
tiene que hacer cumplir las llaves foráneas al insertar/actualizar, al cierre de la sentencia,
y su lista de llaves tiene que cruzarse por prueba contra `src/types/database.ts`
(Relationships), no escribirse a mano.

**Why:** el 2026-10-14 el primer `--apply` de `clonar-config-workspace.ts` (#1151/#1154) cayó en
producción por `workspaces_linea_activa_id_fkey` (circular con `lineas_negocio.workspace_id`),
con todas las pruebas en verde: el doble solo revisaba llaves al borrar. Mauricio lo corrió y
tuvo que verificar el rollback por SQL.

**How to apply:** antes de entregar un script que inserta en varias tablas relacionadas, buscar
ciclos de llaves (A→B y B→A, o self-ref) entre las tablas que toca: van en null y se fijan con
UPDATE al final. Probar el doble por mutación (ver [[pruebas-por-mutacion]]). Para la acción
al borrar (`set null`/`cascade`), mirar la migración: los tipos no la traen.
