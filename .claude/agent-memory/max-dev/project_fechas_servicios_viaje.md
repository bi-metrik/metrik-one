---
name: fechas-servicios-viaje
description: Fechas completas de negocio_servicios (Trappvel, base de hitos de gestión) — migración 20261021120000 SIN aplicar; corrección a mano manda; reproceso pierde correcciones con rastro
metadata:
  type: project
---

PR `feat/trappvel-fechas-de-servicios` (2026-10-21). Migración `20261021120000_servicios_fechas_tramos.sql`
SIN aplicar (va antes del merge): `fecha_fin`, `hora_inicio/fin`, `tramos` jsonb (solo vuelos, CHECK por
función `negocio_servicios_tramos_validos`), `fechas_leidas_at`, `fechas_corregidas_por/at`, vista plana
`negocio_servicio_fechas` (security_invoker, `ancla` = tramo/inicio/fin). Dry-run en prod NO hecho (la sesión
no tenía MCP de Supabase): solo PGlite.

**Why:** los hitos de gestión (`noor-hana-hitos-de-gestion-2026-10-21.md`) necesitan fechas confiables; la
regla de Hana es leer de la cotización, corregir en la fila, nunca pedir aparte.

**How to apply:**
- `fechas_corregidas_at` puesto = nada (generar, completar) toca las fechas; la guarda va en la lectura Y en
  el UPDATE (quitar una sola no tumba pruebas).
- Filas viejas se completan al abrir el tablero (solo sin `fechas_leidas_at`) y al traer/generar (todas las no
  corregidas). Completar nunca borra: si la lectura no trae inicio, no escribe.
- Prerreserva vencida y corregir aceptación BORRAN filas: las correcciones a mano se pierden a propósito y
  quedan en la Actividad (`rastroDeFechasCorregidas`).
- `tren` NO cabe sin migración (CHECK de `tipo`); tramos/fechas sí le sirven.
- Hitos (fuente «servicio» del motor) siguen sin construir; firma propuesta en el cuerpo del PR.

Relacionado: [[post-cotizacion-servicios-f0]], [[pruebas-por-mutacion]].
