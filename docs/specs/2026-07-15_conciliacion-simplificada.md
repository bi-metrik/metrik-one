# Rediseño del subsistema de pagos/conciliación — simplificación radical

Fecha: 2026-07-15
Owner negocio: Hana. Decisión: Mauricio. Ejecución: Max.
Módulo del dinero: cero regresiones, todo en rama `feat/soena-conciliacion-simplificada`, sin merge.
Opt-in por workspace (`modules.conciliacion`); hoy solo SOENA.

Esta spec es el contrato del trabajo. Toda decisión de borrado abajo tiene sus callers verificados.

---

## 1. Objetivo de diseño (el porqué)

Hoy el ciclo del pago está regado en 4 superficies:

1. Botón "Pedir conciliación" (tarjeta suelta al fondo del negocio) → solo escribe una etiqueta `activity_log` (`solicitud_conciliacion`), no aporta reparto ni dato de dinero.
2. Tarjeta suelta "Distribuir pago" al fondo del negocio → abre el modal de reparto del comercial.
3. "Agregar pago" en el panel financiero `/conciliacion` (fuentes ePayco/Davivienda/Otra) → registra un pago desde la financiera.
4. Reparto/edición de porciones del sobrepago por el financiero (pestaña "Por conciliar" + "Saldos").

Mauricio lo quiere como **UN gesto del comercial + UNA decisión del financiero**:

1. **Registrar + distribuir el pago viven DENTRO del bloque de pagos del negocio (`BloqueCobros`).** Al "Registrar pago", si el pago cubre varios negocios, se reparte inline en el mismo flujo. Un pago de un solo negocio ni muestra el reparto. Sigue marcándose "propuesto por el comercial, pendiente de confirmar" (ya existe).
2. **El panel `/conciliacion` de la financiera = solo ACEPTAR o RECHAZAR** lo que el comercial ya distribuyó. La financiera NO agrega pagos ni distribuye. Rechazar devuelve al comercial (nota opcional).

---

## 2. AS-IS verificado (inventario técnico)

### 2.1 Server actions — `src/lib/actions/conciliacion-actions.ts` (2020 líneas)

Fontanería sana del backend núcleo (NO se toca salvo el mínimo del rewire):

| Export | Callers verificados | Veredicto |
|---|---|---|
| `repartirPagoCore` (privada) | interno (`repartirPago`, `repartirPagoComercial`) | **Conservar** — fuente única del split |
| `registrarPagoEnNegocio` | `agregarPago`, `agregarPagoFab` (fab-pago) | **Conservar** — vía única de escritura del pago |
| `repartirPagoComercial` | `distribuir-pago-modal.tsx` | **Conservar** (se re-cablea a BloqueCobros) |
| `eliminarPorcionPago` | `BloqueCobros.tsx` | **Conservar** |
| `crearCobrosSoenaCore` | `negocio-v2-actions.ts` | **Conservar** — reparto pasante/honorario |
| `leerModeloDineroNegocio` | `negocio-v2-actions.ts` | **Conservar** |
| `getConciliacionV2` | `conciliacion/page.tsx` | **Conservar** (se adapta el shape) |
| `conciliarNegocio` | ninguno (solo mención en doc) | **HUÉRFANA** — evaluar en Fase 3 |
| `conciliarReferencia` | `conciliacion-client.tsx` | **Conservar** (es el "Aceptar") |
| `agregarPago` | `conciliacion-client.tsx` (modal "Agregar pago") | **BORRAR** — la financiera deja de agregar pagos |
| `setPorcionReferencia` | `conciliacion-client.tsx` (reparto financiero) | **BORRAR** — la financiera deja de repartir |
| `repartirSobrepago` | ninguno | **HUÉRFANA** — borrar |
| `repartirPago` | ninguno (solo `repartirPagoComercial` se usa) | **HUÉRFANA** — borrar (vía financiera del split) |
| `buscarNegociosParaSplit` | ninguno | **HUÉRFANA** — borrar |
| `getPanelConciliacion` | ninguno (reemplazado por `getConciliacionV2`) | **HUÉRFANA** — borrar |
| `solicitarConciliacionDiana` | `solicitar-conciliacion-button.tsx` | **BORRAR** con su botón |
| `aceptarDuplicado` | ninguno | **HUÉRFANA** — borrar (los duplicados dejan de existir con el rediseño) |
| `crearCobrosDesdePagoSoena` | ninguno (solo `crearCobrosSoenaCore`) | **HUÉRFANA** — borrar el wrapper |
| `FilaConciliacion`, `NegocioParaSplit`, `SobrepagoRef`, `DuplicadoRef` (tipos) | según su export | depurar los que queden sin uso |

> Nota clave: cualquier export marcado HUÉRFANA se confirma con grep en cero **antes** de borrar (Fase 3). Si aparece un caller vivo, se conserva y se anota en el PR.

### 2.2 Server actions — `src/lib/actions/fab-pago-actions.ts` (123 líneas)

| Export | Callers | Veredicto |
|---|---|---|
| `ctxFabPago` | `conciliacion-actions.ts` (guard comercial del reparto) | **Conservar** |
| `getNegociosParaPagoFab` | `fab.tsx`, `distribuir-pago-modal.tsx` | **Conservar** — selector de negocios reusado inline |
| `agregarPagoFab` | `fab.tsx` (FAB "Registrar pago") | **Conservar** — resuelve el caso comercial-fuera-de-área |

### 2.3 UI

| Archivo | Rol | Callers | Veredicto |
|---|---|---|---|
| `conciliacion/page.tsx` | server component del panel | ruta | Conservar (adaptar) |
| `conciliacion/conciliacion-client.tsx` (823 l) | panel financiero, 3 pestañas (Vista general / Por conciliar / Saldos) + modal "Agregar pago" | ruta | **Reescribir** a bandeja Aceptar/Rechazar + vista general read-only |
| `components/distribuir-pago-modal.tsx` (263 l) | modal reparto del comercial | `fab.tsx`, `distribuir-pago-button.tsx` | **Conservar + reubicar** dentro de BloqueCobros (dejar de ser tarjeta suelta) |
| `negocios/[id]/distribuir-pago-button.tsx` (50 l) | tarjeta suelta "Distribuir pago" al fondo del negocio | `page.tsx` | **BORRAR** — se absorbe en BloqueCobros |
| `negocios/[id]/solicitar-conciliacion-button.tsx` (71 l) | tarjeta suelta "Pedir conciliación" | `page.tsx` | **BORRAR** — no aporta dato de dinero |
| `negocios/[id]/page.tsx` (líneas 47-79, 118-123) | wiring de las 2 tarjetas sueltas | — | **Editar** — quitar el bloque `conciliacionActiva` + los 2 componentes |
| `negocios/[id]/bloques/BloqueCobros.tsx` (375 l) | bloque de pagos (read-only + eliminar porción) | detail-client | **Extender** — agregar Registrar pago + reparto inline |
| `fab.tsx` (líneas 120-137, 428-442) | FAB con acciones "Registrar pago" + "Distribuir pago entre negocios" | app-shell | **Editar** — decisión de alcance abajo |
| `app-shell.tsx` (línea 929) | render `<FAB registrarPagoEnabled distribuirPagoEnabled>` | — | Editar si cambia el FAB |

### 2.4 Modelo de datos (fontanería sana — NO se toca)

- `cobros` + `split_json` (`split_id`, `origen='comercial'`, `propuesto_por`, `por_reparto`, `ref_total`, `split_total`). Sin columnas nuevas.
- `negocio_conciliacion` (`conciliado`, `conciliado_por`, `conciliado_at`, `nota`).
- Gates `saldo_cero`, `saldo:handoff`, `conciliacion_diana` (en `negocio-v2-actions.ts`).
- RPC `count_negocios_por_conciliar` (badge del nav, `layout.tsx:128`). Al borrar `solicitarConciliacionDiana` ya nadie crea etiquetas `solicitud_conciliacion`; el badge deja de contar solicitudes y cuenta solo lo que quede (sobrepagos/pendientes de confirmar). No se rompe.

---

## 3. TO-BE

### Fase 1 — Registrar + distribuir dentro de `BloqueCobros`

- `BloqueCobros` gana, en `modo='editable'` y con permiso, una acción **"Registrar pago"** que abre un panel/modal inline. Reusa la mecánica del `distribuir-pago-modal` (selector de negocios `getNegociosParaPagoFab`, fuentes ePayco + manual/externo).
- El flujo captura: negocio ya viene fijado (el del bloque), fuente (ePayco / externo-manual), referencia, monto, fecha.
- **Reparto inline opcional:** si el usuario indica que el pago cubre varios negocios, aparece el repetidor de porciones (reusa el patrón del modal). Un pago de un solo negocio NO muestra reparto.
- Escritura:
  - Un solo negocio → `registrarPagoEnNegocio` (vía única, valida ePayco/duplicado).
  - Reparto multi-negocio → `repartirPagoComercial` (`origen='comercial'`, marca `propuesto_por` + "pendiente de confirmar").
- Quitar la fuente "Davivienda" del selector salvo que sea imprescindible: dejar **ePayco + manual/externo** (que es lo que se usa). El `registrarPagoEnNegocio` acepta `fuente:'davivienda'|'otra'`; el TO-BE colapsa a `epayco` | `otra` (manual/externo con nombre de fuente libre). Davivienda queda como texto libre bajo "otra".
- El botón "eliminar porción" de reparto del comercial se mantiene (`eliminarPorcionPago`, gate venta + no-conciliado).

### Fase 2 — Panel `/conciliacion` = bandeja Aceptar/Rechazar

- `conciliacion-client.tsx` se reescribe a:
  - **(a) Bandeja de repartos propuestos por el comercial pendientes de confirmar:** referencias con `propuesto_por_comercial === true && !algun_conciliado`. Por cada una: Aceptar (= `conciliarReferencia`) / Rechazar (= devolver al comercial con nota).
  - **(b) Vista general de solo lectura:** el registro de referencias por pago (ya existe en `RegistroReferencias`) se conserva como read-only, sin acciones de edición.
- Se QUITAN del panel: el modal "Agregar pago" (`agregarPago`), la edición de porciones / reparto de sobrepagos (`setPorcionReferencia`), las pestañas que dejen de tener sentido (la de "Saldos" con reparto y la de sobrepagos editables → se colapsan a la bandeja + read-only).
- Se CONSERVA la conciliación real como el "Aceptar": `conciliarReferencia` (referencia repartida, remanente $0) y/o `conciliarNegocio` si aplica.
- **Rechazar (nuevo):** server action `rechazarRepartoComercial(externalRef, nota?)` en `conciliacion-actions.ts` (guard `ctxFinanciero`). Elimina las porciones `origen='comercial'` de esa referencia (deja la referencia sin asignar / libera el dinero para que el comercial la re-distribuya), des-concilia los negocios tocados y registra en `activity_log` un comentario "Reparto rechazado por el área financiera{: nota}". No borra cobros que NO sean del reparto comercial.

### Fase 3 — Borrado de basura confirmada (callers en cero)

Ver tabla §2. Se borran solo con grep en cero re-verificado en el momento de la Fase 3.

### Decisión de alcance abierta — el FAB

El FAB tiene 2 acciones opt-in: "Registrar pago" (`fab_registrar_pago`, resuelve el caso comercial-cobra-fuera-de-su-área en ejecución/cobro) y "Distribuir pago entre negocios" (`conciliacion`).

- **"Distribuir pago entre negocios" del FAB:** queda DUPLICADO con el flujo inline de BloqueCobros. Candidato a quitar del FAB (Fase 3) — pero el modal (`distribuir-pago-modal.tsx`) se conserva porque BloqueCobros lo reusa. Se quita solo la ACCIÓN del FAB + su wiring, no el componente.
- **"Registrar pago" del FAB:** se CONSERVA. Resuelve un caso que BloqueCobros no cubre bien (registrar un pago sobre un negocio que no estás viendo, o cuyo bloque de pagos está en un stage de otra área). No es basura; es una entrada global legítima. Anotado en el PR como "conservado con caller vivo".

---

## 4. Lista de borrado con callers confirmados en cero

| Elemento | Tipo | Caller pre-borrado | Post-rediseño |
|---|---|---|---|
| `solicitar-conciliacion-button.tsx` | archivo UI | `page.tsx:120` | wiring removido en Fase 2 → cero |
| `solicitarConciliacionDiana` | server action | `solicitar-conciliacion-button.tsx` | archivo borrado → cero |
| `distribuir-pago-button.tsx` | archivo UI (tarjeta suelta) | `page.tsx:121` | wiring removido → cero |
| `agregarPago` | server action | `conciliacion-client.tsx` | reescrito → cero |
| `setPorcionReferencia` | server action | `conciliacion-client.tsx` | reescrito → cero |
| `getPanelConciliacion` | server action | ninguno YA | cero (verificar) |
| `buscarNegociosParaSplit` | server action | ninguno YA | cero (verificar) |
| `repartirPago` (vía financiera) | server action | ninguno YA | cero (verificar) |
| `repartirSobrepago` | server action | ninguno YA | cero (verificar) |
| `aceptarDuplicado` | server action | ninguno YA | cero (verificar) |
| `crearCobrosDesdePagoSoena` | server action | ninguno YA | cero (verificar) |
| `conciliarNegocio` | server action | ninguno YA (solo doc) | cero (verificar; si el nuevo Aceptar no lo usa) |
| Acción FAB "Distribuir pago entre negocios" | wiring en `fab.tsx` | app-shell flag | acción removida; modal conservado |
| Tipos huérfanos (`FilaConciliacion`, `NegocioParaSplit`, `SobrepagoRef`, `DuplicadoRef`, `AsignacionRef`...) | tipos | según export | depurar los sin uso |

**NO se borra** (caller vivo): `distribuir-pago-modal.tsx` (BloqueCobros lo reusa), `getNegociosParaPagoFab`, `agregarPagoFab`, `registrarPagoEnNegocio`, `repartirPagoComercial`, `eliminarPorcionPago`, `conciliarReferencia`, `crearCobrosSoenaCore`, `leerModeloDineroNegocio`, `getConciliacionV2`, FAB "Registrar pago".

---

## 5. QA en vivo (checklist para Mauricio)

1. Registrar un pago simple (1 negocio) desde el bloque de pagos → aparece en Cobros recibidos, saldo baja.
2. Registrar + distribuir un pago a 2 negocios desde el bloque → 2 porciones, badge "propuesto por el comercial · pendiente de confirmar".
3. Financiero entra a `/conciliacion` → ve el reparto en la bandeja → **Acepta** → queda conciliado, sale de la bandeja.
4. Financiero **Rechaza** un reparto con nota → vuelve al comercial (porciones liberadas), el comercial ve la nota en el timeline.
5. Verificar que el panel financiero ya NO tiene "Agregar pago" ni edición de porciones.
6. Verificar que el negocio ya NO muestra las tarjetas sueltas "Pedir conciliación" ni "Distribuir pago".
7. FAB "Registrar pago" sigue funcionando (comercial cobra fuera de su área).
