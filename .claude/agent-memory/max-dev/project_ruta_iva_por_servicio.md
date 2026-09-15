---
name: ruta-iva-por-servicio
description: PR #731 (2026-09-15) — la ruta de IVA de SOENA pasa del toggle derivado requiere_devolucion_iva a servicio; SQL PENDIENTE que va DESPUÉS del deploy; por qué la derivación dejó de guardarse (#425); V0012 sin resolver
metadata:
  type: project
---

Decisión de Mauricio (2026-09-15): la rama de IVA de SOENA VE se decide SOLO con
`servicio` (bloque `servicio_contratado`, Propuesta orden 4) ∈ {completo, solo_iva}.
El toggle `requiere_devolucion_iva` se desactiva (no se borra).

**PR #731** (código): `soloSiCumple` en `condicion-bloque.ts` para
`cita_dian_confirmacion.solo_si` y `valor_in` en `seguimiento_citas.solo_si`.
**SQL SIN aplicar:** `proyectos/soena/ve/migrations/PENDIENTE_20260915_ruta_iva_por_servicio.sql`
(5 condiciones + guardia de la cita + 6 toggles desactivados + `seguimiento_citas` +
backfill `servicio=completo` en V0121/V0130). Ensayado en PGlite con foto de prod,
reversa probada byte a byte.

**Why:** el toggle dejó de persistirse el 29-ago y 12 casos de Entrega cayeron a
Facturación. Causa: el #425 subió `servicio_contratado` de Negociación (5) a Propuesta (4);
`propagarCamposDerivados` solo escribe en instancias YA existentes, y la de
`devolucion_de_iva` nace al entrar a Negociación. El toggle es `visible`, así que el effect
del cliente tampoco escribe. `requiere_certificacion_upme` quedó igual de roto pero no tiene
consumidores; ningún otro workspace usa `lock_when`.

**How to apply:**
- ⚠️ Orden: merge+deploy del #731 ANTES del SQL. Al revés, el `solo_si` con `value_in` da
  false y la siembra RETIRA `requiere_cita_dian_iva` al abrir cada caso en Entrega.
- ⚠️ Un `lock_when` cuya fuente vive en una etapa ANTERIOR a la del derivado nunca se
  persiste. Si alguien vuelve a configurar uno así, hay que decidir en la etapa de la fuente.
- V0012 (Seguimiento) queda con servicio vacío a propósito (UPME sin dato → ambiguo); con el
  SQL su certificado bancario heredado deja de mostrarse. Decide Deisy.
- `requiere_cita_dian_iva` solo se siembra al ABRIR el negocio parado en Entrega
  (`getNegocioDetalle`). Medido para los 13 parados: 9 → Cita, 4 → Anexos.
- Verificar antes de dar por aplicado: `select config_extra->'condition' from bloque_configs
  where id='5d744172-172f-406b-8da6-4a126eb70ed3'` debe decir `servicio`.

Relacionado: [[seguimiento-citas-dian]], [[medir-antes-de-construir]], [[ensayo-sql-pglite]].
