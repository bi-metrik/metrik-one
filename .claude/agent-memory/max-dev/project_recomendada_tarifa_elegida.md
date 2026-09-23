---
name: recomendada-tarifa-elegida
description: PR #836 (Trappvel, 2026-09-23) — la principal se decide por el NOMBRE «Recomendada», Aprobar guarda la tarifa elegida en cotizaciones.tarifa_aceptada_id
metadata:
  type: project
---

PR #836 (2026-09-23). La migración `20260923200000_tarifa_aceptada_y_eleccion_del_cliente.sql`
la aplicó la sesión principal ANTES del merge (Max comprobó por PostgREST que la columna
existía antes de mergear). Sin la columna, aprobar una cotización CON tarifas da 42703.

Al rebasar sobre #837 el motivo quedó como el quinto de `src/lib/cotizaciones/motivos-borrador.ts`
(`recomendada`, segundo en el orden, detrás de los pantallazos): la marca y el aviso del PDF
salen de esa lista. Un motivo nuevo de borrador se agrega AHÍ, no en `marca-borrador.ts`.

Lo que conviene saber al tocar cotizaciones con tarifas después de esto:

- **`cotizacion_itinerarios.es_principal` ya no decide nada.** La principal es la fila
  llamada «Recomendada» (por `claveTarifa`) que va en la propuesta: `idDelPrincipal` en
  `src/lib/cotizaciones/tarifas.ts`, aplicada en `leerItinerarios` vía `conPrincipalPorRegla`.
  Leer la columna para decidir algo reintroduce el bug.
- **`valor_total` = la Recomendada (el documento); `negocios.precio_aprobado` = la tarifa que
  el cliente escogió** (`cotizaciones.tarifa_aceptada_id`), con la regla de IVA de
  `preciosDeLasTarifas`. `costo_total` sigue siendo el de la Recomendada: hueco declarado en
  el PR, el presupuesto contra ejecutado mide contra otra tarifa si el cliente no tomó esa.
- `decisiones_combinacion` guarda salida Y aceptación, distinguidas por `evento`;
  `propuesta` sigue nula (es la del motor, R1).
- ⚠️ **El gate `margen_sobre_piso` NO aplica la regla de la Recomendada**: usa
  `evaluarSalida`, no `motivoParaNoSalir`. Enviar, Aprobar y el PDF sí la aplican.
- Duplicar tiene UN camino (`duplicarCotizacionCompleta`); el botón del bloque (solo en
  rechazadas) antes creaba una copia vacía.
- Quedó SOLO PROPUESTO, sin construir: estado `reemplazada` para la original enviada cuando
  se envía su copia (`duplicada_de`), para no ensuciar la tasa de cierre.

**Why:** decisión de Mauricio del 2026-09-22 (la Recomendada manda el documento; el cliente
escoge al aprobar). **How to apply:** antes de tocar el cálculo de precio de una cotización
con tarifas, partir de `idDelPrincipal` y `preciosDeLasTarifas`, no de `es_principal`.

Relacionado: [[iva-ingreso-propio]], [[registro-decisiones-combinacion]],
[[tres-tarifas-y-tabla-de-vuelos]].
