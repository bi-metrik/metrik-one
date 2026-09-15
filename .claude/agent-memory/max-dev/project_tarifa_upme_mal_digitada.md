---
name: tarifa-upme-mal-digitada
description: "#736 mergeado 2026-09-15: config SOENA SIN aplicar (va DESPUES del deploy) y V0497 sigue mal, no V0498; el numero colombiano ya se lee en TODO campo `numero` del producto"
metadata:
  type: project
---

PR **#736**, squash `03243061`, mergeado 2026-09-15 23:45Z con los cuatro checks verdes.
Spec y SQL de activacion: `docs/specs/2026-09-15_tarifa-upme-mal-digitada.md`.

**Why:** `769.898` (punto de miles colombiano) se guardaba como 769,898 pesos en
`tarifa_upme_confirmada`, con la referencia al lado y sin alerta. En V0498 eso bajo el
valor a recaudar de $1.195.159 a $425.769, invento $556.628 de sobrante en conciliacion
—que con el aviso de sobrepago (#734) le habria llegado a la financiera como plata a
devolver— y viajo al PDF del cliente.

**How to apply:**

- ⚠️⚠️ **El brief decia V0498 y ese YA estaba corregido. El caso vivo es V0497**, otro
  negocio con el mismo defecto (conf `769.898`, ref 770.159). Mas V0264, V0475, V0301
  (punto de miles) y V0321/V0323 (tarifa de `5`). Seis abiertos, **$4.578.341** que el
  sistema no esta exigiendo. **Listados, NO corregidos**: la correccion de datos es de la
  sesion principal.
- ⚠️ **La config de SOENA NO esta aplicada y va DESPUES del deploy.** El piso ($10.000) y
  el margen (5%) rigen por defecto al desplegar, pero sin `justificacion_field` una
  diferencia grande es **rechazo duro**: V0310 (−14,79%) y V0283 (+100%) quedan trabados
  si alguien vuelve a escribir su tarifa. El SQL (un `do $$` que agrega el campo
  `tarifa_upme_motivo_diferencia`) esta en el spec y **no se ensayo contra produccion**.
- **El parseo colombiano es GENERICO, no del bloque**: `lib/negocios/numero-colombiano.ts`
  lo aplica todo campo `tipo: 'numero'` de todo bloque `datos` del producto. La revision
  de la tarifa (`lib/upme/tarifa-confirmada.ts`) sigue siendo opt-in por
  `config_extra.tarifa_confirmacion` y solo existe un bloque con esa clave en toda la base.
- **La revision se salta si el valor no cambio** respecto de lo guardado. Sin ese corte,
  V0310 y V0283 no podrian editar ningun otro campo del bloque. Mismo criterio que
  `rechazoPorFechaPasada`.
- El cero y el vacio **no** los juzga este control: los resuelven `no_cero` y `required`.
  Dos controles sobre el mismo hueco dan dos mensajes distintos.
- ⚠️ **Hallazgo abierto**: siguen con `type="number"` y el mismo riesgo latente
  `BloqueDatosMultiPago` (valor del pago), `BloquePropuestaEconomica` (descuento y valor
  final), `BloquePlanRecurrente` y `cotizacion-editor`. No medidos.
- ⚠️ **Deuda ajena medida de paso**: NUEVE casos abiertos con la tarifa en cero, toggle
  marcado y `servicio = 'completo'` (V0017, V0131, V0133, V0142, V0144, V0169, V0408,
  V0409, V0410). Es el hallazgo del 2026-08-13 que motivo `no_cero`, y crecio de seis a
  nueve.

Relacionado: [[aviso-sobrepago-financiera]], [[pruebas-por-mutacion]],
[[medir-antes-de-construir]], [[cifras-del-brief-caducan]].
