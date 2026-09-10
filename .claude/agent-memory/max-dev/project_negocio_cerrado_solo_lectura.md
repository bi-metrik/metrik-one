---
name: negocio-cerrado-solo-lectura
description: PR #610 (2026-09-10, SIN mergear) — un cerrado deja de recibir plata; por qué el recibo de caja NO se corta (7 de 53), y el corte que va en el choke point y no en las pantallas
metadata:
  type: project
---

**PR #610**, los 6 checks verdes, **sin mergear** (el encargo pidió reportar y esperar).
Sin migración y sin una sola escritura a producción.

Un negocio con `estado` en los tres cierres queda de solo lectura. Criterio único:
`negocioCerrado(estado)` en `src/lib/negocios/motivo-cierre.ts` — la MISMA lista cerrada
que el #609 usa para el desenlace. `cierre_motivo` no se reintroduce.

## ⚠️⚠️ El recibo de caja NO se corta, y la línea la puso la MEDICIÓN

Es la decisión que no se deduce del brief (que pedía cortar las cinco acciones de dinero):

- **Recibos: 7 de los 53 pendientes de SOENA viven en negocios cerrados**, los 7
  `completado` (V0013 ×2, V0018, V0153, V0419, V0420, V0421). `getControlRecibos` **no
  filtra por estado del negocio**, así que su botón «Emitir recibo» es alcanzable hoy.
  Cortar rompe trabajo real: el recibo acusa plata que ya entró antes del cierre.
- **Facturación: 0 alcanzables.** `getColaFacturacion` ya pide `estado = 'abierto'`. Por
  eso emitir, adoptar, descartar y restaurar SÍ cortan — no quitan nada, solo hacen que
  la acción diga lo mismo que la lectura.

**How to apply:** ante una lista de acciones a bloquear, medir **cuáles son alcanzables
hoy desde una pantalla** antes de decidir. Dos acciones de la misma familia (emitir
factura / emitir recibo) pueden merecer respuestas opuestas, y no por taxonomía.

## Dónde va el corte, y por qué ahí

- **`guardEditarBloque`**: el estado viaja en la MISMA consulta (`negocios!inner(estado)`),
  así que no hay caso «no pude leer el estado» que decidir aparte — si el negocio no
  está, `nb` sale nulo y ya caía antes.
- **`registrarPagoEnNegocio`**: vía ÚNICA de escritura de pagos (panel + FAB). Puesto en
  cada pantalla, la primera que se olvide reabre el hueco.
- **`registrarPagoExterno` ya estaba cubierta**: el brief la listaba como «llama
  `canEditBloque` directo» y en realidad usa `guardEditarBloque` desde que se creó.
- **`repartirPagoCore` ya cortaba** con `validarNegociosAbiertos` y un predicado MÁS
  estricto (`estado !== 'abierto'`, que también frena `activo`). Se dejó: aflojarlo sería
  abrir, no cerrar. Es el único sitio con un segundo criterio.
- **NO cortan** `aceptar/rechazarRepartoComercial`, `redistribuirReferencia`,
  `proponerRetroceso`, `aplicarRetrocesoFinanciero`, `resolverAvisoRecaudo`: deciden sobre
  plata ya registrada o son correcciones con motivo escrito. Cortarlas congela la
  corrección, que es justo el defecto que cerró el #569.

## El banner de cierre NO cambia, y separarlo es la mitad del punto 1

`page.tsx` tenía UNA variable para dos preguntas. Ahora `cerrado` (de `estado`, gobierna
conciliación) y `tieneBannerDeCierre` (de `cierre_motivo`, **intacto**). Encender el
banner activaría «Reabrir» y `reabrirNegocio` exige `stage_actual = 'cerrado'`, un stage
que esta línea nunca alcanza.

## Método

- **El FAB se probó por RENDER.** Hubo que sacar el catálogo de `fab.tsx` a
  `fab-acciones.tsx`: el menú vive detrás de `{open && …}` y el estado de «cerrado» lo
  trae un `useEffect`, así que renderizar `<FAB/>` no muestra nada. La mutación «quitar
  `disabled` dejando la clase gris» solo la mata el render.
- **10 mutaciones, las 10 caen** (arnés con guardas: línea base verde, aborta si el `sed`
  no cambia el archivo, verde comprobado al cerrar). Una abortó sola porque el ancla
  aparecía 3 veces — la guarda funcionando.
- **El caso «no dejó cobro escrito» se rehizo**: con la referencia vacía pasaba por la
  razón equivocada (la validación de referencia frenaba el insert igual).
- **QA contra producción con el criterio REAL**, no reimplementado: arnés vitest temporal
  que lee PostgREST y aplica `negocioCerrado` sobre las filas vivas. SOENA 444 = 33 a
  solo lectura + 411 sin cambio; en toda la base solo SOENA (33) y `metrik` (13) tienen
  cerrados, los otros 6 workspaces quedan intactos.

## Cifras medidas (2026-09-10, al empezar y RE-MEDIDAS al cerrar, idénticas)

- **46 cerrados en toda la base**: SOENA 33 (17/11/5) + `metrik` 13 (5 completados, 8
  perdidos). **Solo SOENA tiene `modules.conciliacion` y `fab_registrar_pago`.**
- **El hueco estaba abierto pero NO se explotó**: de los 35 cobros en cerrados, 6 se
  crearon después del `closed_at` — los 6 el mismo día (2026-08-24), `created_by` NULL y
  fecha de pago anterior al cierre: es el cargue de ePayco, no una persona. **0 horas y 0
  gastos posteriores al cierre.** Latente, no sangrando.

## ⚠️ Sin QA en pantalla, y no por descuido

El preview de Vercel responde **302 a `vercel.com/sso-api`**; además el producto resuelve
el workspace por SUBDOMINIO, así que una URL de preview no llega a `soena` ni con sesión.
Los pasos quedaron en el cuerpo del PR.

Relacionado: [[cierre-desde-estado]], [[todos-incluye-cerrados]], [[gate-recaudo-facturacion]],
[[aviso-recaudo-sin-salida]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
