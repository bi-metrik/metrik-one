---
name: funciones-mapa-salon
description: Módulo funciones de ONE (Sabor etapa 2, PR #1234): migración 20261022170000 SIN aplicar, tras 20261021090000; SIN mapa desde el 22-oct; candado por función; PDF solo borrador
metadata:
  type: project
---

PR #1234 (rama `feat/funciones-mapa-salon`): módulo `funciones` (experiencias, funciones con cupo, reservas,
formulario con PDF). Migración `20261022170000_modulo_funciones.sql` **SIN aplicar**; va DESPUÉS de
`20261021090000_asistente_chatwoot.sql` (#1225; main la da por aplicada, confirmarlo en el ledger): referencia
`chatwoot_consentimientos` y le pone un trigger de borrado. Dry-run: `node scripts/funciones-dry-run.mjs`.

**Why:** el 2026-10-22 Mauricio sacó el mapa del salón de la Fase 1: Sabor no asigna puestos (orden de llegada; a
grupos de 5+ les guarda mesa a mano fuera de ONE). Antes (21-oct) había decidido F1: formulario con PDF que solo
pre-llena. Precio, abono, preventa, campaña y cupo del asistente distinto de la capacidad ESPERAN su sí.

**How to apply:**
- No reintroducir mesas/montajes/puestos sin decisión nueva; lo que pide el cliente es `solicitud_cliente` (texto).
- La primera versión se llamó `20261021120000_modulo_funciones` y chocaba con `20261021120000_servicios_fechas_tramos`
  (aplicada): renumerar una migración sin aplicar es editarla en el archivo renombrado, sin reversa.
- La llave de módulo vive en CUATRO listas (también `documentos_versiones_modulo`): `catalogo.test.ts` lo exige.
- Nadie escribe las tablas `funcion_*` directo, ni service_role. Cancelar y el formulario no se conceden a service_role.
- PGlite no prueba el `for update`: la concurrencia real va en el job de CI con Postgres 16 y su mutación sin candado.
- El fixture `src/lib/funciones/__fixtures__/esquema-base.sql` crea service_role con BYPASSRLS (como Supabase).
- Lo próximo (precio, preventa…) entra como columnas de `funcion_funciones`/`funcion_reservas` y condiciones dentro de
  `funcion_apartar`, que ya tiene el candado.
