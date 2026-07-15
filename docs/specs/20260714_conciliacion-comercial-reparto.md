# Conciliación — reparto de un pago propuesto por el comercial + eliminar porción en venta

**Fecha:** 2026-07-14
**Owner código:** Max
**Genérico / opt-in:** sí — todo el flujo se activa por `workspaces.modules.conciliacion` (no hardcodea SOENA).

## Problema

Un mismo pago (una referencia ePayco o una transferencia) a veces cubre varios
negocios. Hoy el reparto de un pago entre negocios (`repartirPago`) solo lo puede
hacer el área financiera (`ctxFinanciero`). El comercial, que es quien recibe y
conoce cómo se compone el pago, no tiene forma de declararlo — y si aplicó una
porción a un negocio por error, no puede corregirla.

## Decisión (control de dos personas)

1. El **comercial PROPONE** el reparto de un pago entre varios negocios. La
   **financiera VALIDA** contra el dinero real y **concilia**. El reparto del
   comercial NO se auto-concilia.
2. El comercial puede **ELIMINAR** una porción SOLO si el negocio de esa porción
   está en `stage_actual='venta'` **Y** su conciliación no está confirmada
   (`negocio_conciliacion.conciliado` != true). Fuera de eso, bloqueado.
3. Reparto **PARCIAL** permitido: la suma de porciones puede ser menor al total
   (queda saldo sin asignar). La financiera no concilia hasta que el remanente sea
   $0 (lo exige el flujo existente `conciliarNegocio` / `conciliarReferencia`).

## Modelo (liviano — no toca el cálculo de `cobrado`)

- El reparto del comercial crea **cobros reales** con `split_id` (cuentan al
  instante para saldo/MC/EBITDA como cualquier split). NO se agregó columna a
  `cobros`. NO se tocó el cálculo de `cobrado` en ningún lado.
- "Propuesto vs confirmado" se expresa con lo que ya existe:
  - `negocio_conciliacion.conciliado` (el check de la financiera), y
  - marcadores en `split_json`: `origen='comercial'` + `propuesto_por=staffId`
    (trazabilidad; no cambian ningún cálculo financiero).

## Backend (`src/lib/actions/conciliacion-actions.ts`)

- **`repartirPagoCore(supabase, workspaceId, staffId, input, origen, opts)`** —
  fuente ÚNICA de la escritura del split (extraído del núcleo de `repartirPago`,
  mismo patrón que `registrarPagoEnNegocio`). El guard lo aplica el caller.
  - `origen='comercial'` marca `split_json.origen='comercial'` + `propuesto_por`,
    NO pone el check de conciliación, y registra `activity_log` por negocio
    ("Reparto de pago propuesto por el comercial — Ref X").
  - `opts.validarNegociosAbiertos` — regla dura: todos los destino existen, son del
    workspace y `estado='abierto'`. `opts.bloquearReferenciaExistente` — rechaza si
    la referencia ya existe suelta (no-split) en otro negocio (`refDuplicadaNoSplit`)
    o si ya tiene un reparto (pide eliminar + re-repartir; el reparto es atómico, MVP).
  - Parcial permitido (suma ≤ total, tol 1 peso). Idempotente por (external_ref, negocio_id).
- **`repartirPago`** — ahora wrapper: `ctxFinanciero` + `origen='financiera'`.
- **`repartirPagoComercial(input)`** — wrapper: guard **comercial** `ctxFabPago`
  (owner/admin sí; supervisor/operator sí salvo que su única área sea operaciones;
  contador/read_only no) + `origen='comercial'` + las dos reglas duras.
  - **ePayco:** valida `estado==='Aceptada'` y que el total ≤ `monto_bruto` real
    (techo de plata) vía `consultarTransaccionEpayco`; si no se declara total, lo
    toma del pago real. **Manual:** el comercial declara el total.
- **`eliminarPorcionPago(cobroId)`** — guard `ctxFabPago`. Carga el cobro → su
  negocio. Gate: `stage_actual='venta'` **Y** `conciliado` != true (mensajes que
  distinguen los dos motivos). Si cumple: borra el cobro, setea
  `negocio_conciliacion.conciliado=false` (defensivo), `activity_log` ("Porción de
  pago eliminada por el comercial — libera la referencia X"), revalida. Deja la
  referencia con saldo sin asignar.
- **`ctxFabPago`** se exportó desde `fab-pago-actions.ts` para reusar el guard
  comercial (import bidireccional entre los dos módulos de acciones; ambos se usan
  solo dentro de cuerpos de función → sin problema de evaluación circular).
- **`getConciliacionV2` / `ReferenciaPago`** ahora exponen `propuesto_por_comercial`,
  `algun_conciliado`, `total_declarado` y `sin_asignar` (para el panel financiero).

## UI

- **`src/components/distribuir-pago-modal.tsx`** (NUEVO, reusable) — modal
  "Distribuir pago entre negocios": fuente (epayco/davivienda/otra) + referencia +
  total (auto desde ePayco o manual) + repetidor {negocio (de `getNegociosParaPagoFab`)
  + monto}, con "saldo sin asignar" = total − suma. Submit → `repartirPagoComercial`.
  El picker de negocios ES la materialización de la regla dura (solo abiertos).
- **FAB** (`src/app/(app)/fab.tsx`) — acción "Distribuir pago entre negocios" como
  modo aparte del pago simple, opt-in por `modules.conciliacion` (prop
  `distribuirPagoEnabled` desde `app-shell.tsx`).
- **Detalle del negocio** (`distribuir-pago-button.tsx`, montado en `page.tsx` cuando
  `modules.conciliacion`) — mismo modal, accesible desde el negocio.
- **BloqueCobros** — botón "Eliminar" (con confirmación) en las porciones marcadas
  `es_reparto_comercial` cuando el negocio está en venta (modo editable) → llama
  `eliminarPorcionPago`. El server valida además "no conciliada". `getNegocioDetalleCompleto`
  ahora trae `split_json` y deriva `es_reparto_comercial` por cobro; `stageActual` se
  threadea BloqueCard → BloqueRenderer → BloqueCobros (solo etapa activa, no historial).
- **Panel financiera** (`conciliacion-client.tsx`) — marca las referencias con reparto
  del comercial como "Propuesto por el comercial · pendiente de confirmar", muestra
  "Sin asignar $X" y el total declarado. La confirmación sigue por el flujo existente
  (`conciliarNegocio` / `conciliarReferencia`) — sin reinventarlo.

## Gate de anticipo por saldo (independiente de la vía de pago)

**Problema (real, visto en SOENA V0064):** el bloque de anticipo
(`config_extra.es_pagos_epayco=true`, `es_gate`) solo cerraba su gate si el anticipo
entraba por su propio flujo ePayco (que persiste `pagos` en la instancia del bloque).
Cuando la plata llega por un **reparto** (cobro `tipo_cobro='pago'` con `split_id`),
por el **FAB** o **manual**, el negocio queda pagado pero el gate nunca se cierra → no
avanza. Con el reparto del comercial, esto le pasaría a todo negocio pagado por
reparto → el feature nacería roto.

**Opción A (aprobada):** el gate del anticipo se satisface cuando el negocio YA tiene
cubierto su anticipo esperado, sin importar la vía.

Implementación (todo en `negocio-v2-actions.ts`, genérico/opt-in por `es_pagos_epayco`):

- **`anticipoCubiertoPorSaldo(supabase, workspaceId, negocioId)`** —
  - `cobrado` = SUM(cobros.monto) del negocio (todos los cobros; mismo criterio que
    `conciliarNegocio`).
  - `anticipoEsperado` desde `aprobado_plan` (leído DIRECTO de la propuesta aprobada,
    NO vía `leerModeloDineroNegocio` que devuelve null sin tarifa pasante) +
    `precio_aprobado`:
    · Plan 1 (50/50) → `round(precio_aprobado * ANTICIPO_PCT_PLAN1)`, con
    `ANTICIPO_PCT_PLAN1 = 0.5` (constante nombrada).
    · Plan 2 (único) → `precio_aprobado` (100%).
    · Sin plan / sin precio → `precio_aprobado` (conservador: exige pago completo).
  - Devuelve true solo si `anticipoEsperado > 0` y `cobrado >= anticipoEsperado - 1`
    (tol 1 peso). `cobrado=0` con `precio>0` → false (sigue bloqueando, correcto).
  - `// TODO: validar con Carmen si la base del anticipo es honorario-only vs precio
    completo` (única duda de modelo de dinero; hoy base = precio completo).
- **`autocompletarGatesAnticipoPorSaldo(...)`** — barre los bloques de la etapa actual
  con `es_gate` + `config_extra.es_pagos_epayco=true` + `estado='pendiente'`; si el
  anticipo está cubierto, los auto-completa (`estado='completo'`, `completado_at=now`,
  `data._completado_via='saldo'` + `_nota` de traza) + `activity_log`. Idempotente (no
  toca los ya `completo`). NO auto-completa si el saldo no cubre.
- **Wire:** se llama en `cambiarEtapaNegocioConGate` JUSTO ANTES del RPC
  `puede_avanzar_etapa` (que lee `negocio_bloques.estado` de los gates). Al cerrar el
  gate antes, el RPC pasa. NO toca el cálculo de `cobrado` en ningún lado.
- **Idempotencia frente a V0064:** ese negocio ya se destrabó a mano en prod (gate
  `completo`); el barrido lo ignora porque solo actúa sobre `estado='pendiente'`.

## Permisos

- Reparto y eliminación del comercial: `ctxFabPago` (rol, desacoplado de STAGE_TO_AREA).
- El check de conciliación lo pone SIEMPRE la financiera (`ctxFinanciero`).

## Cabos sueltos / no incluido a propósito

- **Composición con el modelo de dinero pasante/honorario de SOENA:** el reparto del
  comercial crea un cobro `tipo_cobro='pago'` por porción; NO parte cada porción en
  pasante + honorario (eso lo hace `crearCobrosDesdePagoSoena` para el pago de UN
  negocio con tarifa UPME). Si un negocio destino de un reparto comercial requiere
  ese desglose pasante/honorario, hoy no se aplica automáticamente. **Señalado, NO
  implementado aquí** — decisión de producto pendiente (¿el reparto del comercial
  debe respetar la tarifa UPME de cada negocio destino?).
- **Gate de eliminación en el cliente:** la UI muestra "Eliminar" por
  `stage==='venta'` + `es_reparto_comercial`; el server es la barrera real de "no
  conciliada" (consistente con el patrón del repo: UI por rol/flag, server valida).
