---
name: valida-cda-tarjeta-epayco
description: Pago automático con tarjeta ePayco de los CDA (30-oct) — migración 20261030220000 SIN aplicar; día 0 = inicio del período; renovar-ciclo frena a quien debe
metadata:
  type: project
---

Rama `feat/valida-cda-tarjeta-epayco` (30-oct): pago automático con tarjeta para los 4 CDA (Términos v1.5, 2.4).
Migración `20261030220000_valida_cda_tarjeta_epayco.sql` (tabla `tarjetas_pago_cda`) SIN aplicar al cerrar; el
código lee la tabla y tolera que falte (42P01/PGRST205 = sin tarjeta), pero registrar falla sin ella.

**Why:** diseño aprobado por Mauricio (`proyectos/metrik/valida/docs/legal/2026-10-30_diseno-tarjeta-cda-epayco.md`).
Decisiones que no se ven en el código a primera vista:
- El día 0 del CDA es el INICIO del período (23), no `fecha_vencimiento` (27): la 2.4 cobra en la fecha de renovación.
- «Atrasado» = período que empieza el día del registro o antes (`cobro_desde`, estricto `>`), no la vigencia 11.7.
- Un plan `epayco` de un CDA sin tarjeta activa quedaría sin enlaces (paso 6 filtra planes epayco sin rechazo): por eso
  todo camino que cierra la tarjeta devuelve el plan a `bold`.
- `renovar-ciclo` (DIAS_GRACIA_RENOVACION 5) no crea la cuota siguiente a quien debe: con atrasos no hay cobro del 23.
- El reparto FIFO de `cuotasConEstado` aplica un pago automático a la cuota más vieja en la pestaña Pagos.

**How to apply:** antes de tocar cobros con tarjeta de un CDA, leer `src/lib/valida-cda/tarjeta-cda.ts` (cabecera).
Pendiente: D5 (borrar la tarjeta al quedar Cancelado) va con el estado Cancelado; Vera revisa los textos. Ver
[[valida-terminos-v15]] y [[epayco-reversos]].
