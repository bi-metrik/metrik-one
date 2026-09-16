---
name: conciliacion-por-referencia
description: "#738 MERGEADO (squash 0af16a3e): la confirmación de la financiera baja a la porción (split_json.confirmado_at); backfill de 9 filas propuesto y NO aplicado; el limbo HOY es 0 pero los 9 vuelven con el próximo pago"
metadata:
  type: project
---

PR **#738**, squash `0af16a3e`, mergeado 2026-09-16 02:52Z con los cuatro checks verdes. Dos defectos del
panel de conciliación de SOENA, con una sola causa: **un check confirma una REFERENCIA de
pago y el sistema lo guardaba como estado del NEGOCIO.**

**Why:** V0498. La financiera aceptó el 12-sep el reparto de la ref `385563083` ($637.500
entre V0497 y V0498). El 15-sep entraron dos pagos ePayco nuevos a V0498 y
`registrarPagoEnNegocio` bajó `negocio_conciliacion.conciliado` — un `update` por negocio,
ciego a la referencia. La porción ya aceptada dejó de contar, el gate `saldo:handoff` pasó
a exigir **$212.761** cuando al cliente le faltaban **$261**, y la referencia desapareció
de "Por confirmar" porque `algun_conciliado` miraba a V0497. Sin salida por la app: hubo
que restituir el check por SQL.

**How to apply:**

- ⚠️⚠️ **El backfill (9 filas, $6.177.936) está PROPUESTO y NO aplicado**, y va **después**
  del deploy. Estampa `confirmado_at` en las porciones comerciales cuyo negocio está
  `conciliado = true` hoy: son las que solo tienen la evidencia vieja. SQL en el cuerpo del
  PR. Usa `||`, **nunca `jsonb_set`** (no crea el nivel padre y devuelve el jsonb sin tocar,
  sin error).
- ⚠️ **El limbo HOY es 0** (los 9 negocios están conciliados; V0498 lo restituyó la sesión
  principal). La exposición sí está viva: **cualquier pago nuevo** a cualquiera de los 9
  los devuelve al limbo. 3 (V0485/V0502/V0503) se frenarían en `saldo:handoff`, 2
  (V0497/V0498) en `saldo_cero` de Pago UPME, y 4 (V0256/V0282/V0283/V0284) ya pasaron los
  gates pero caerían a **"retenido"** en la cola de facturación, que usa el mismo
  `sumarRecaudoConfirmado`.
- **Los tres `conciliado = false` NO se quitaron, a propósito.** El flag por negocio
  conserva su otro significado —"la plata de este negocio cambió, vuelve a mirarla"— y es
  el que gobierna las pestañas: si no bajara, un sobrepago nuevo sería invisible. Lo que
  cambia es que ya no carga con la confirmación de nadie.
- **`sumarRecaudoConfirmado` no cambió de firma**, así que los 12 sitios que la llaman
  ganaron el arreglo sin tocar una línea. El criterio único es
  `esPorcionPendienteDeConfirmar` en `lib/negocios/recaudo-confirmado.ts`.
- **La decisión de referencia vive en `lib/cobros/confirmacion-por-referencia.ts`** y la
  consumen servidor **y** pantalla. Escrita dos veces, el síntoma vuelve: una referencia
  accionable que nadie ve.
- ⚠️ **Volver accionable una referencia abre dos riesgos que hubo que cerrar en el mismo
  PR**: `rechazarRepartoComercial` borraba TODAS las porciones comerciales (y borrar un
  cobro no se deshace) — ahora solo las sin confirmar; y `aceptarRepartoComercial`
  re-conciliaba negocios ya confirmados, borrando sobrepagos que la financiera debía mirar
  — ahora solo toca lo pendiente.
- ⚠️ **Abierto: sin QA en pantalla.** No existe hoy ninguna referencia parcialmente
  confirmada, así que el escenario hay que fabricarlo. Y una conciliación hecha a mano por
  SQL sobre `negocio_conciliacion` sigue quedando solo con la evidencia por negocio.

Relacionado: [[aviso-sobrepago-financiera]], [[tarifa-upme-mal-digitada]],
[[pruebas-por-mutacion]], [[medir-antes-de-construir]], [[cifras-del-brief-caducan]].
