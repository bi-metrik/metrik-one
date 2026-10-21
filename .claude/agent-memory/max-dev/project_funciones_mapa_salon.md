---
name: funciones-mapa-salon
description: Módulo funciones de ONE (Sabor etapa 2, PR #1234): migración 20261021120000 SIN aplicar, depende de 20261021090000; candado por función; formulario = única puerta; PDF solo borrador
metadata:
  type: project
---

PR #1234 (rama `feat/funciones-mapa-salon`, 2026-10-21): módulo `funciones` (cupo, reservas, mapa, formulario con PDF).
Migración `20261021120000_modulo_funciones.sql` **SIN aplicar**; va DESPUÉS de `20261021090000_asistente_chatwoot.sql`
(#1225, tampoco aplicada): referencia `chatwoot_consentimientos` y le pone un trigger de borrado. Dry-run:
`node scripts/funciones-dry-run.mjs` (el archivo pesa 72 KB, no cabe en el cuerpo del PR).

**Why:** Mauricio decidió (2026-10-21) que la mesa la asigna el equipo, el precio no depende de la mesa, la recepción no
depende del mapa, y (F1) que Sabor crea montajes y funciones por formulario con PDF que solo pre-llena.

**How to apply:**
- La llave de módulo vive en CUATRO listas (también `documentos_versiones_modulo`), no tres: `catalogo.test.ts` lo exige.
- Nadie escribe las tablas `funcion_*` directo, ni service_role (se le revocan las escrituras). Todo por RPC.
- `funcion_asignar_mesas`, `funcion_cancelar_reserva` y las del formulario NO se conceden a service_role: en "Ver como"
  (cliente de servicio) fallan a propósito.
- PGlite no prueba el `for update`: la concurrencia real va en el job de CI con Postgres 16 y su mutación sin candado.
- El fixture `src/lib/funciones/__fixtures__/esquema-base.sql` crea service_role con BYPASSRLS (como Supabase); sin eso
  una lectura del servicio sobre una tabla con RLS sale vacía y parece un bug del código.
- `funcion_mesas_etiqueta_unica` es DIFERIBLE para intercambiar etiquetas en un guardado; la RPC la fuerza inmediata.
- Servicios del asistente en `supabase/functions/_shared/funciones/`, sin conectar a `chatwoot-agente` (otra sesión).
