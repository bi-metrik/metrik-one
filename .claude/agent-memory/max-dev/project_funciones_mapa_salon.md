---
name: funciones-mapa-salon
description: Módulo funciones de ONE (Sabor etapa 2, PR #1234): migración 20261022170000 SIN aplicar; Experiencia → Campaña → Función; dos cupos; tarifa única y foto del monto; pantallas esperan el panel
metadata:
  type: project
---

PR #1234 (rama `feat/funciones-mapa-salon`). Migración `20261022170000_modulo_funciones.sql` **SIN aplicar**; va
DESPUÉS de `20261021090000_asistente_chatwoot.sql` (#1225; main la da por aplicada, confirmarlo en el ledger).
Dry-run: `node scripts/funciones-dry-run.mjs`.

**Why:** decisiones de Mauricio del 2026-10-22: sin mapa del salón (Sabor no asigna puestos); «Todo sale y vuelve a
ONE» (precio, abono, cupos y monto viven en la base, el asistente no hace cuentas); jerarquía Experiencia → Campaña →
Función con código de atribución por campaña. Las pantallas nuevas las diseñan Noor y Sofía: NO tocar pantallas hasta
recibir ese diseño.

**How to apply:**
- Una regla, un lugar: `funcion_tarifa` (precio), `funcion_motivo_asistente` (disponible para el bot),
  `funcion_ocupadas` (la suma de los dos cupos). No duplicar esas reglas en TS salvo en el doble `memoria.ts`, que las
  pruebas de contrato comparan con la base.
- `minutos_apartado` vive en la CAMPAÑA (decisión de Max: es condición comercial de la tanda, como el abono).
- La app de hoy tiene un puente mínimo (`datos.ts` traduce capacidad→cupo_total y activa→abierta; el alta de funciones
  responde que espera el panel). Se borra con el panel nuevo.
- Lo genérico de atribución está (`campana_id`, `atribucion_fuente`, `atribucion_ref`); el anuncio y el link exactos
  esperan la verificación en Meta y Chatwoot.
- PGlite no prueba el `for update`: la concurrencia real va en el job de CI con Postgres 16 y su mutación sin candado.
- El fixture `src/lib/funciones/__fixtures__/esquema-base.sql` crea service_role con BYPASSRLS (como Supabase).
