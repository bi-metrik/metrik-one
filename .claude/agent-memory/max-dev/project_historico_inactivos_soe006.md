---
name: historico-inactivos-soe006
description: SOE-006 — is_active es estado de HOY; el bono de operaciones incluye inactivos con actividad en el mes; migración 20261008223000 SIN aplicar (reemplazo de texto sobre la viva); rótulo «(inactivo)» en servidor
metadata:
  type: project
---

Regla de Mauricio (2026-10-08): inactivar no borra histórico; todo indicador de un periodo
incluye a quien tuvo actividad en él, rotulado «(inactivo)». Selectores de asignación,
avisos y cupo de licencias SÍ filtran `is_active`.

**Estado al abrir el PR (2026-10-08):** migración `20261008223000_bono_operaciones_historico_inactivos`
SIN aplicar; dry-run en `sql/soena/2026-10-08_dry-run_bono-historico-inactivos.sql` (lo corre
la sesión principal; debe decir md5_antes = 72fcf9e4…). Sin la migración, el código solo
rotula: Jhon sigue sin aparecer.

**Why:** la viva de `get_operaciones_bono_resumen` NO coincide con el repo (repo cargado en
PGlite da d7f841b5…, prod 72fcf9e4…), y la lectura de producción estaba bloqueada para el
subagente. Por eso la migración reemplaza SOLO `WHERE s.is_active IS NOT FALSE` sobre
`pg_get_functiondef` y aborta si no aparece exactamente una vez.

**How to apply:**
- «Actividad» = bloque completado (`completado_por` = profile_id) o `activity_log` tipo
  `cambio_etapa` de su autoría (`autor_id` = staff.id) en el mes. Un comentario NO cuenta, ni
  un reproceso atribuido después del retiro.
- El bono del supervisor de un mes con el retirado cambia (vuelve a promediarlo): es esperado.
- Rótulo: `src/lib/equipo/inactivos.ts` (`staffInactivos` + `rotularFilas`), aplicado tras la
  caché de Tableros; la entrada cacheada queda cruda.
- Nómina en `v_pyl_mes` y `/numeros` sigue con `is_active` (foto del presente, sin historial
  de salarios): pendiente de decisión, no se tocó.
- Propuesto, no construido: `retirarUsuario` debería pedir a quién pasan los casos abiertos.

Relacionado: [[ensayo-sql-pglite]], [[medicion-sin-mcp-supabase]].
