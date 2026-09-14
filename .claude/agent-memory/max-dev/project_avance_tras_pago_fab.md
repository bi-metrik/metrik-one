---
name: avance-tras-pago-fab
description: PR #707 sin mergear — el gate de anticipo que el motor cierra SOLO casi produce un falso «retenido» en el caso central; la confirmación no es borde sino la ruta principal; y el alcance real son dos workspaces, no uno
metadata:
  type: project
---

**PR [#707](https://github.com/bi-metrik/metrik-one/pull/707)**, rama `feat/avance-tras-pago-fab`, seis checks verdes, **sin mergear**, **sin migración** y sin una sola escritura a producción. Tras `agregarPagoFab`, el modal ofrece el avance con un clic.

**Why:** quien registra el pago (financiera) no es quien mueve el caso (el comercial), así que el negocio se quedaba quieto hasta que el comercial volvía a entrar solo a oprimir Avanzar.

## Lo que muerde

⚠️⚠️ **`cambiarEtapaNegocioConGate` cierra gates ANTES de preguntarle a `puede_avanzar_etapa`.** Corre `autocompletarGatesAnticipoPorSaldo`, que pasa a `completo` todo bloque `es_pagos_epayco` cuyo anticipo ya cubra el saldo. Cualquier lector que consulte la RPC **sin correr eso antes** ve el gate en `pendiente` y concluye «retenido» sobre un caso que el clic SÍ movería. La primera versión del panel fallaba justo ahí: registrar el anticipo y no poder seguir. Medido 2026-09-14: los gates vivos con esa marca son **dos**, «Pagos» de Negociación (etapa 5, por donde pasa TODA la línea a registrar su anticipo) y «Pagos» de Cartera (11). Se resolvió leyendo, no escribiendo: `anticipoCubiertoPorSaldo` ahora se exporta de `negocio-v2-actions.ts` y el predicado puro es `esGateDeAnticipo`.
**How to apply:** antes de construir cualquier lectura que anticipe si un negocio puede avanzar, listar qué ESCRIBE el motor antes de su propio chequeo. La RPC no es el estado final.

⚠️ **La confirmación de etapa destino NO es un caso borde: es la ruta principal.** «Segundo cobro» (orden 10) no tiene routing, así que su destino por defecto es la siguiente por orden, **Cartera**, que sí declara `confirmar_al_avanzar`. Con saldo pendiente el diálogo sale siempre; con saldo cuadrado Cartera se salta (`aplicaSaltoPorSaldo`, stage `cobro`) y no sale. Por eso `ModalConfirmarAvance` salió de la ficha a `src/components/` en vez de dejar el atajo de «llevar a la ficha».

⚠️ **El alcance son DOS workspaces, y en SOENA solo por una puerta.** `modules.fab_registrar_pago` está en **soena y termotech** nada más (de 17). Y en SOENA, con `modules.conciliacion` activo, el bloque Movimientos de la ficha abre **`DistribuirPagoModal`**, no `RegistrarPagoModal`: el panel llega solo por el FAB global. En Termotech (sin conciliación) llega por las dos. Ver [[cifras-del-brief-caducan]].

## Premisas del brief que se corrigieron

- El brief pedía el botón **«Avanzar a X»**. Se dejó **«Avanzar de etapa»**, neutral, con el destino al lado como referencia: es la decisión que el repo ya tomó en el PR #33 porque el routing puede mandar el caso a otra parte. El nombre real lo pinta el servidor al responder.
- El brief no mencionaba el autocierre del gate de anticipo (arriba). Era el hueco central.
- Premisas que **sí** se confirmaron contra producción: `Segundo cobro` es orden 10, stage `venta`, `areas_que_avanzan: ["financiera"]`, sin gates, sin routing, `saltar_si_saldo_cero: true`; y el guard del FAB es por rol, no por etapa.

## Decisiones que no se revierten

- **`sin_permiso` va ANTES que `retenido`.** Listarle los gates a quien de todas formas no puede avanzar sugiere que resolverlos lo desbloquea.
- **`avanzar` NO promete que el servidor deje pasar.** Los gates que viven dentro de `cambiarEtapaNegocioConGate` (saldo, handoff, campo, sobrepago, conciliación, duplicado, aviso de recaudo) no se reimplementan: el clic devuelve `gate_bloqueado` y el panel los lista entonces.
- **`estadoAvanceTrasPago` se calla ante cualquier tropiezo** (devuelve `no_aplica`): el pago ya quedó, y un error encima de una operación exitosa enseña a desconfiar del registro.

Relacionado: [[aviso-recaudo-sin-salida]], [[qa-pantalla-viva-cdp]], [[pruebas-por-mutacion]].
