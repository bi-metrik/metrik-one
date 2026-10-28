---
name: bloqueo-trappvel
description: Viajes en bloqueo de Trappvel (2026-10-27, feat/trappvel-bloqueo) — ranura «paquete» (migración 20261027174500 APLICADA 27-oct) y config modalidad_viaje SIN aplicar; dos pantallazos por paquete; íconos a 5 categorías
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/briefs/2026-10-27_brief-max-bloqueo.md` (reunión Mauricio–Tatiana del 26-oct). PR
contra main SIN mergear (lo mergea la sesión principal).

**Why:** un operador (Aliados, Tu Reserva) vende un paquete por persona con vuelo + hotel en fechas cerradas; la
asesora no cotiza vuelo ni hotel por separado.

**How to apply (lo que no se ve a primera vista):**
- Migración `20261027174500_cotizacion_ranuras_tipo_paquete.sql` APLICADA en producción (27-oct, sesión principal). La config `sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql` DESPUÉS
  del deploy; sin ella nadie es Bloqueo y nada cambia.
- El slug es `modalidad_viaje`, NO `tipo_viaje` (ese ya es playa/naturaleza/crucero).
- La modalidad sale de la MISMA lectura del viaje (`leerViajeDelNegocio` devuelve `modalidad` aparte de `viaje`): una
  consulta propia en la página rompió `por-pasos-guard-e2e` (presupuesto de idas ≤ 2).
- Íconos (Mauricio 27-oct): cambian por operador; el modelo los lleva a 5 categorías; con íconos lo ausente es `false`,
  sin íconos todo `null`; `seguro: false` o `sin_identificar` → lista para la asesora, nunca `true`.
- `retencion.test.ts` falla con cualquier «N años» en prosa del repo (el prompt de CHD lo tuvo).
- `tarjeta-se-refresca-e2e` cuenta exactamente 3 `onCambio={refrescar}` en el editor: usar `() => refrescar()`.
- Sin QA en pantalla ni lectura real del modelo (solo fixtures simulados).

Relacionado: [[cotizacion-otro-servicio]], [[tarifa-publica-neta]], [[cotizacion-integrada-c1-c6]].
