# Auditoría Bloques VE — SOENA

**Fecha:** 2026-04-05
**Auditor:** Max
**Contexto:** Módulo `/negocios` — proceso VE/HEV/PHEV de SOENA configurado sobre MéTRIK ONE

---

## Resumen ejecutivo

- El módulo `negocios` y el módulo `pipeline` son dos sistemas **paralelos e independientes**. SOENA opera en `/negocios` (sistema nuevo con bloques). El `/pipeline` con su módulo VE (`oportunidad-detail.tsx` + `ve-documentos-section.tsx`) es el sistema **legacy** de un diseño anterior y no debería confundirse con el sistema de bloques actual.
- El sistema de bloques está correctamente conectado al schema `negocios` (tablas: `negocios`, `etapas_negocio`, `bloque_configs`, `negocio_bloques`, `bloque_items`, `lineas_negocio`). No hay contaminación con tablas legacy de `oportunidades` o `proyectos` en el flujo principal.
- Existen **11 tipos de bloque** definidos en `bloque_definitions`. Para SOENA están activos: `equipo`, `cotizacion`, `datos`, `documentos`, `checklist`, `cobros`, `resumen_financiero`, `ejecucion`.
- El gate de avance de etapa está implementado via la función SQL `puede_avanzar_etapa()` que verifica bloques con `es_gate=true` en estado `pendiente`. Funciona correctamente si los bloques se instancian al crear/cambiar etapa.
- **Problema crítico:** `BloqueEjecucion` siempre recibe `hasProyecto={false}` — el prop está hardcodeado en `negocio-detail-client.tsx` línea 565. Muestra "Disponible al iniciar ejecución" siempre, incluso cuando hay negocios activos en etapas avanzadas.
- El routing condicional de la Etapa 3 (UPME sí/no) está modelado en `config_extra.routing` de `etapas_negocio` pero la lógica de evaluación de esa condición **no está implementada** en el cliente — `cambiarEtapaNegocioConGate` avanza siempre a la etapa siguiente en orden +1, ignorando el routing condicional.

---

## Mapa de bloques

| Bloque | Tipo | Estado config (default) | Tabla DB principal | Conectado schema negocios |
|--------|------|-------------------------|--------------------|--------------------------|
| Equipo | `equipo` | editable / visible según etapa | `negocio_bloques.data` | SI |
| Cotización | `cotizacion` | editable (etapas 1-2), visible (etapa 3+) | `cotizaciones` (negocio_id) + `negocio_bloques` | SI |
| Datos anticipo | `datos` | editable, es_gate=true | `negocio_bloques.data` | SI |
| Documentos | `documentos` | editable, es_gate=true | `negocio_bloques.data` (URLs) | SI |
| Checklist UPME | `checklist` | editable, es_gate=false | `bloque_items` | SI |
| Datos inclusión | `datos` | editable, es_gate=true | `negocio_bloques.data` | SI |
| Datos radicación (soloLectura) | `datos` | visible | `negocio_bloques.data` | SI |
| Datos radicación (editable) | `datos` | editable, es_gate=true | `negocio_bloques.data` | SI |
| Documentos certificación | `documentos` | editable, es_gate=true | `negocio_bloques.data` (URLs) | SI |
| Resumen financiero | `resumen_financiero` | visible (is_visualization=true) | calculado de `cobros` | SI |
| Ejecución | `ejecucion` | visible (is_visualization=true) | sin impl. real | PARCIAL |
| Cobros | `cobros` | editable | `cobros` (negocio_id) | SI |

---

## Fichas por bloque

### Bloque: Equipo

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueEquipo.tsx`
- Tabla DB: `negocio_bloques.data` → `{comercial_id, ejecucion_id, financiero_id}`
- Completitud: `marcarBloqueCompleto()` se llama cuando al menos **un** responsable tiene valor. `actualizarBloqueData()` si ninguno tiene valor.
- Estado por etapa SOENA:

| Etapa | Estado config | es_gate |
|-------|--------------|---------|
| 1 — Por Contactar | editable | NO |
| 2 — Contactado | visible | NO |
| 3 — Recolección Docs | visible | NO |
| 4 — Por Inclusión | visible | NO |
| 5 — Por Radicación | visible | NO |
| 6 — Por Certificación | visible | NO |
| 7 — Por Cobrar | (no configurado) | — |

**Para validación (no técnico):**
- Qué hace: Asigna tres responsables al negocio: comercial, de ejecución y financiero.
- Está listo cuando: Al menos uno de los tres roles tiene un responsable asignado.
- En etapa 1 el usuario puede: Asignar los tres roles (editable).
- En etapas 2 en adelante: Solo lectura — muestra los responsables asignados pero no permite cambiar.
- Se bloquea automáticamente cuando: El bloque pasa a estado `visible` al avanzar de etapa.
- Nota: Este bloque nunca bloquea el avance (`es_gate=false` siempre).

---

### Bloque: Cotización

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueCotizacion.tsx`
- Acción aprobar/rechazar: `src/app/(app)/negocios/[id]/cotizacion/actions.ts` — `aceptarCotizacionNegocio`, `rechazarCotizacionNegocio`
- Tabla DB: `cotizaciones` (filtrado por `negocio_id`) + `negocio_bloques.estado` se marca `completo` al aceptar una cotización
- Completitud: Automático cuando `aceptarCotizacionNegocio()` se llama — escribe `negocio_bloques.estado='completo'`. Mientras no hay aceptada, el bloque queda `pendiente`.
- Estado por etapa SOENA:

| Etapa | Estado config | es_gate |
|-------|--------------|---------|
| 1 — Por Contactar | editable (fix migration 005) | NO |
| 2 — Contactado | editable (fix migration 005) | NO |
| 3 — Recolección Docs | visible | NO |
| 4 — Por Inclusión | (no configurado) | — |
| 5 — Por Radicación | (no configurado) | — |
| 6 — Por Certificación | (no configurado) | — |
| 7 — Por Cobrar | (no configurado) | — |

**Para validación (no técnico):**
- Qué hace: Muestra las cotizaciones del negocio y permite crear nuevas, aprobar o rechazar la enviada.
- Está listo cuando: Se aprueba una cotización (estado `aceptada`). El bloque pasa a solo lectura con banner verde "Cotización aprobada".
- En etapa 1 (Por Contactar): Puede crear cotizaciones nuevas, enviarlas, aprobarlas, rechazarlas.
- En etapa 2 (Contactado): Igual que etapa 1.
- En etapa 3 (Recolección Docs): Solo visualización — no puede crear ni aprobar.
- Se bloquea automáticamente cuando: Se acepta una cotización — el botón "Nueva cotización" desaparece y los botones Aprobar/Rechazar se ocultan.
- Problema detectado: El precio aprobado del negocio (`negocios.precio_aprobado`) no se actualiza automáticamente cuando se acepta la cotización en `aceptarCotizacionNegocio`. El precio del header queda como `precio_estimado` hasta que alguien llame `actualizarPrecioAprobado()` manualmente.

---

### Bloque: Datos anticipo (Etapa 2 — Contactado)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueDatos.tsx`
- Tabla DB: `negocio_bloques.data` → `{referencia_anticipo: texto, valor_anticipo: numero}`
- Completitud: Auto-save en `BloqueDatos` — llama `marcarBloqueCompleto()` cuando todos los campos `required` están llenos (800ms debounce). Al completarse, el trigger en `marcarBloqueCompleto()` detecta `triggers[action=auto_cobros]` y llama `autoCrearCobros(negocioId, valorAnticipo)`.
- Estado por etapa: Solo presente en Etapa 2 (Contactado), `editable`, `es_gate=true`.
- Campos: `referencia_anticipo` (texto, required), `valor_anticipo` (número, required)
- Trigger: `auto_cobros` al completarse → crea cobro anticipo + cobro saldo en tabla `cobros` con `negocio_id`.

**Para validación (no técnico):**
- Qué hace: Registra la referencia del pago del anticipo por Epayco y el valor del anticipo.
- Está listo cuando: Ambos campos tienen valor y se guardaron.
- En etapa 2: Editable — el usuario escribe la referencia y el valor.
- Se bloquea automáticamente cuando: Se completa → el sistema crea automáticamente dos cobros en el bloque de cobros (anticipo + saldo pendiente).
- Este bloque es GATE: no puede avanzar a etapa 3 sin completarlo.

---

### Bloque: Documentos (Etapa 3 — Recolección de Documentos)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueDocumentos.tsx`
- Tabla DB: `negocio_bloques.data` → JSONB con `{cedula: url, tarjeta_propiedad: url, homologacion: url, soat: url}`
- Completitud: Automático — `isComplete()` verifica que todos los campos `required=true` tengan URL. Si está completo, llama `marcarBloqueCompleto()`; si no, `actualizarBloqueData()`.
- Documentos configurados (migration 004): cédula propietario, tarjeta de propiedad, documento de homologación, SOAT vigente.
- Estado: `editable`, `es_gate=true`
- Mecanismo de verificación "AI": Simulado — `handleVerify()` hace setTimeout 2s y muestra "Verificado AI". No llama ninguna API real.

| Etapa | Estado config | es_gate |
|-------|--------------|---------|
| 3 — Recolección Docs | editable | SI (GATE) |
| 6 — Por Certificación | editable, doc diferente | SI (GATE) |

**Para validación (no técnico):**
- Qué hace: El usuario pega URLs de documentos en Drive (cédula, tarjeta propiedad, homologación, SOAT).
- Está listo cuando: Los 4 documentos required tienen URL guardada.
- En etapa 3: Editable — se ingresan las URLs.
- Se bloquea automáticamente cuando: Todos los required tienen URL → bloque completo → puede avanzar a etapa 4 o 5.
- GATE: No puede avanzar a siguiente etapa sin completarlo.
- Problema detectado: La verificación AI es simulada (setTimeout 2s). No valida que la URL apunte a un documento real ni extrae datos. No tiene integración con Gemini como el sistema VE legacy (`ve-documentos-section.tsx`).

---

### Bloque: Checklist UPME (Etapa 3 — Recolección de Documentos)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueChecklist.tsx`
- Tabla DB: `bloque_items` (items individuales) + `negocio_bloques.estado`
- Completitud: Cuando todos los items `completado=true`. `marcarBloqueCompleto()` se llama al completar el último item.
- Items configurados: "Verificar estado en UPME", "Confirmar documentos completos"
- Estado: `editable`, `es_gate=false`
- config_extra incluye una condición `{field: 'verificacion_upme', value: 'no'}` pero esta condición **no está evaluada en el cliente** — el bloque siempre aparece independiente del valor de `verificacion_upme`.

**Para validación (no técnico):**
- Qué hace: Dos tareas de verificación manual: confirmar estado en UPME y que los docs estén completos.
- Está listo cuando: Ambas casillas marcadas.
- En etapa 3: Editable, el usuario marca cada tarea al completarla.
- No es GATE — no bloquea el avance aunque no esté completo.
- Problema detectado: Según el diseño, este checklist debería aparecer solo si `verificacion_upme = 'no'` (condición en `config_extra.condition`). El cliente no evalúa esa condición — siempre muestra el bloque.

---

### Bloque: Datos inclusión (Etapa 4 — Por Inclusión)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueDatos.tsx`
- Tabla DB: `negocio_bloques.data` → `{radicado_inclusion: texto, pantallazo_inclusion: imagen_clipboard}`
- Completitud: `radicado_inclusion` es required. `pantallazo_inclusion` es optional. Auto-save al completar `radicado_inclusion`.
- Estado: `editable`, `es_gate=true`

**Para validación (no técnico):**
- Qué hace: Registra el número de radicado de inclusión en UPME y opcionalmente un pantallazo de evidencia (pegar imagen desde portapapeles).
- Está listo cuando: Se ingresa el número de radicado.
- En etapa 4: Editable.
- GATE: No puede avanzar a etapa 5 sin el radicado de inclusión.
- El pantallazo se pega con Ctrl+V / Cmd+V — se guarda como base64 en `negocio_bloques.data`.

---

### Bloque: Datos radicación lectura (Etapa 5 — Por Radicación, orden 1)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueDatos.tsx`
- Tabla DB: `negocio_bloques.data` (muestra el valor guardado en etapa anterior)
- Campo: `radicado_inclusion` (texto, required=false)
- Estado: `visible` — solo lectura
- Completitud: No tiene lógica de completitud (visible no puede ser gate).

**Para validación (no técnico):**
- Qué hace: Muestra el número de radicado de inclusión capturado en la etapa anterior, como referencia de solo lectura.
- No requiere acción del usuario.

---

### Bloque: Datos radicación editable (Etapa 5 — Por Radicación, orden 2)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueDatos.tsx`
- Tabla DB: `negocio_bloques.data` → `{radicado_certificacion: texto, pantallazo_radicacion: imagen_clipboard}`
- Completitud: `radicado_certificacion` es required. Auto-save al completar.
- Estado: `editable`, `es_gate=true`

**Para validación (no técnico):**
- Qué hace: Registra el número de radicado de certificación ante UPME.
- Está listo cuando: Se ingresa el número de radicado de certificación.
- En etapa 5: Editable.
- GATE: No puede avanzar a etapa 6 sin este radicado.

---

### Bloque: Documentos certificación (Etapa 6 — Por Certificación)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueDocumentos.tsx`
- Tabla DB: `negocio_bloques.data` → `{concepto_certificacion: url}`
- Completitud: `concepto_certificacion` required=true. Auto-save al completar.
- Estado: `editable`, `es_gate=true`

**Para validación (no técnico):**
- Qué hace: Registra el URL al concepto de certificación emitido por UPME.
- Está listo cuando: La URL del concepto de certificación está guardada.
- GATE: No puede avanzar a etapa 7 (Por Cobrar) sin el concepto de certificación.

---

### Bloque: Resumen financiero (Etapas 6 y 7)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueResumenFinanciero.tsx`
- Tabla DB: Calculado en `getNegocioDetalleCompleto()` desde tabla `cobros` (negocio_id)
  - `totalCobrado`: cobros con `estado_causacion IN ('CAUSADO','APROBADO')`
  - `porCobrar`: cobros con `estado_causacion = 'PENDIENTE'`
  - `costosEjecutados`: hardcodeado en 0 (no implementado)
- Completitud: `is_visualization=true` — no tiene estado, no puede ser gate.
- Estado: siempre visible.

**Para validación (no técnico):**
- Qué hace: Muestra el resumen financiero del negocio: total cobrado, por cobrar, costos, ganancia y margen.
- Es solo visualización — no requiere acción del usuario.
- Actualiza en tiempo real con los datos de cobros.
- Limitación: `costosEjecutados` siempre muestra $0 (no implementado).

---

### Bloque: Ejecución (Etapas 6 y 7)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueEjecucion.tsx`
- Tabla DB: Ninguna implementada actualmente.
- Completitud: `is_visualization=true` — no tiene estado.
- Estado: siempre visible.
- **BUG CRÍTICO**: En `negocio-detail-client.tsx` línea 565, se pasa `hasProyecto={false}` hardcodeado. Siempre muestra "Disponible al iniciar ejecución" aunque el negocio exista en etapas avanzadas.

**Para validación (no técnico):**
- Qué hace: Debería mostrar gastos y horas del proyecto vinculado al negocio.
- Estado actual: No muestra nada útil — siempre dice "Disponible al iniciar ejecución".
- No requiere acción del usuario (es visualización).

---

### Bloque: Cobros (Etapa 7 — Por Cobrar)

**Para el equipo (técnico):**
- Archivo: `src/app/(app)/negocios/[id]/bloques/BloqueCobros.tsx`
- Tabla DB: `cobros` (filtrado por `negocio_id`). Lee todos los cobros del negocio.
- Completitud: No tiene lógica de completitud implementada — no llama `marcarBloqueCompleto()`. `es_gate=false`.
- Acción: `confirmarPagoCobro()` en `negocio-v2-actions.ts` — cambia `estado_causacion` a `APROBADO`.
- Muestra: resumen (cobrado / por cobrar / cartera), lista de cobros, formulario de confirmación de pago.

**Para validación (no técnico):**
- Qué hace: Muestra los cobros del negocio (anticipo y saldo creados automáticamente) y permite confirmar el pago de cada uno.
- En etapa 7: El usuario puede confirmar pagos ingresando referencia y valor.
- No bloquea el avance (no es gate).
- Nota: Los cobros ya deberían estar creados desde etapa 2 (trigger auto_cobros al completar datos anticipo).

---

## Gates por etapa

### Gate: Etapa 1 (Por Contactar) → Etapa 2 (Contactado)

- Condición: Función `puede_avanzar_etapa(negocio_id, etapa1_id)` — verifica bloques gate con estado `pendiente`.
- Bloques gate en etapa 1: NINGUNO (`equipo`: es_gate=false, `cotizacion`: es_gate=false).
- Resultado: **Sin gate**. Se puede avanzar siempre.
- SQL sugerido para tenant_rules: No aplica por ahora — alineado con decisión 2026-04-01 de tenant_rules vacío por defecto.

---

### Gate: Etapa 2 (Contactado) → Etapa 3 (Recolección de Documentos)

- Condición: Bloque `datos` (anticipo) debe tener estado `completo`.
- Bloques gate: `datos` anticipo (`es_gate=true`).
- Campos requeridos: `referencia_anticipo` (texto) + `valor_anticipo` (número).
- Resultado: Bloqueado hasta que se registren referencia y valor del anticipo.
- SQL sugerido para tenant_rules:
  ```sql
  INSERT INTO tenant_rules (workspace_id, tipo, contexto, condicion, accion, activo)
  VALUES (
    '7dea141d-d4da-483d-a78d-b14ef35500c5',
    'block_transition',
    'negocio_etapa',
    '{"etapa_origen_nombre": "Contactado", "check": "bloque_gate_completo", "bloque_tipo": "datos"}',
    '{"mensaje": "Registra la referencia y valor del anticipo antes de avanzar"}',
    true
  );
  ```

---

### Gate: Etapa 3 (Recolección de Documentos) → Etapa 4/5 (Por Inclusión / Por Radicación)

- Condición: Bloque `documentos` (cédula, tarjeta propiedad, homologación, SOAT) debe estar completo.
- Bloques gate: `documentos` (`es_gate=true`).
- Resultado: Bloqueado hasta que las 4 URLs de documentos estén guardadas.
- PROBLEMA: El routing condicional (si UPME=Sí saltar a etapa 5, si UPME=No ir a etapa 4) está modelado en `config_extra.routing` de etapa 3 pero no está implementado en `cambiarEtapaNegocioConGate()`. La función simplemente avanza `orden + 1`, siempre va a etapa 4 (Por Inclusión).

---

### Gate: Etapa 4 (Por Inclusión) → Etapa 5 (Por Radicación)

- Condición: Bloque `datos` (radicado inclusión) debe estar completo.
- Bloques gate: `datos` inclusión (`es_gate=true`).
- Campo requerido: `radicado_inclusion` (texto).
- Resultado: Bloqueado hasta que se ingrese el radicado de inclusión.

---

### Gate: Etapa 5 (Por Radicación) → Etapa 6 (Por Certificación)

- Condición: Bloque `datos` editable (radicado certificación) debe estar completo.
- Bloques gate: segundo bloque `datos` en etapa 5 (`es_gate=true`, orden=2).
- Campo requerido: `radicado_certificacion` (texto).
- Resultado: Bloqueado hasta que se ingrese el radicado de certificación.

---

### Gate: Etapa 6 (Por Certificación) → Etapa 7 (Por Cobrar)

- Condición: Bloque `documentos` (concepto de certificación) debe estar completo.
- Bloques gate: `documentos` certificación (`es_gate=true`).
- Campo requerido: `concepto_certificacion` (URL).
- Resultado: Bloqueado hasta que se suba el concepto de certificación.

---

### Gate: Etapa 7 (Por Cobrar) → Cierre

- No hay etapa siguiente configurada en la migración. La lógica de cierre del negocio (marcar como cerrado) no está implementada en el módulo de bloques.
- En etapa 7 no hay bloques gate (`cobros`: es_gate=false, `datos`: es_gate=false, `resumen_financiero` y `ejecucion` son visualización).

---

## Separación de sistemas: pipeline VE legacy vs negocios bloques

Esta sección es crítica para no confundirse durante el piloto:

### Sistema LEGACY (`/pipeline/[id]/`)
- Archivo principal: `src/app/(app)/pipeline/[id]/oportunidad-detail.tsx`
- Usa tabla `oportunidades` con `etapa` (lead, ganada, etc.) y `custom_data` JSONB.
- El proceso VE legacy (`modoOperativoVe`) se activa cuando `oportunidad.etapa === 'ganada' && proyectoVe != null`.
- Estados VE legacy: `por_inclusion → por_radicar → por_certificar → certificado → por_cobrar → cerrado`.
- Usa tabla `proyectos.custom_data.estado_ve` para el estado operativo.
- Módulo documentos legacy: `ve-documentos-section.tsx` — sube documentos a Supabase Storage (bucket `ve-documentos`), extrae datos con Gemini AI (OCR real), guarda en `oportunidades.custom_data.docs`.
- **Este sistema es independiente del sistema de bloques**. No se usa para SOENA en el módulo `/negocios`.

### Sistema NUEVO (`/negocios/[id]/`)
- Archivo principal: `src/app/(app)/negocios/[id]/negocio-detail-client.tsx`
- Usa tablas: `negocios`, `etapas_negocio`, `bloque_configs`, `negocio_bloques`, `bloque_items`.
- El proceso SOENA VE está configurado aquí: línea "Proceso VE/HEV/PHEV" con 7 etapas.
- **SOENA debe operar en este sistema**, no en el legacy.

---

## Problemas encontrados

### P1 — CRÍTICO: Routing condicional UPME no implementado
- **Descripción:** La etapa 3 (Recolección de Documentos) tiene `config_extra.routing` que define que si `verificacion_upme=no` debe ir a etapa 4 (Por Inclusión) y si no debe saltar a etapa 5 (Por Radicación). La función `cambiarEtapaNegocioConGate()` en `negocio-v2-actions.ts` línea 505 verifica `nuevaEtapaData.orden !== etapaActualData.orden + 1` y rechaza el salto. Siempre se va a etapa 4, nunca directamente a etapa 5.
- **Archivo:** `src/app/(app)/negocios/negocio-v2-actions.ts` línea 505
- **Impacto:** Vehículos ya en UPME (mayoría del proceso SOENA) se fuerzan a pasar por etapa 4 (Por Inclusión) que es innecesaria para ellos.
- **Fix requerido:** Implementar evaluación de `config_extra.routing` en `cambiarEtapaNegocioConGate()` antes de validar el orden.

### P2 — CRÍTICO: BloqueEjecucion hardcodeado hasProyecto=false
- **Descripción:** En `negocio-detail-client.tsx` línea 565, el render de `BloqueEjecucion` pasa `hasProyecto={false}` hardcodeado. Siempre muestra el mensaje de placeholder "Disponible al iniciar ejecución".
- **Archivo:** `src/app/(app)/negocios/[id]/negocio-detail-client.tsx` línea 565
- **Impacto:** El bloque de ejecución es inútil aunque el negocio esté en etapa 6 o 7.
- **Fix requerido:** Pasar un prop real de si el negocio tiene proyecto vinculado, o eliminar el bloque hasta que esté implementado.

### P3 — MODERADO: `negocio.precio_aprobado` no se actualiza al aceptar cotización
- **Descripción:** `aceptarCotizacionNegocio()` en `cotizacion/actions.ts` marca el bloque como completo y la cotización como aceptada, pero no actualiza `negocios.precio_aprobado`. El header muestra el precio estimado (gris) en lugar del precio aprobado (negro negrita).
- **Archivo:** `src/app/(app)/negocios/[id]/cotizacion/actions.ts` (inferido del comportamiento)
- **Impacto:** El precio del negocio no refleja el valor cotizado aprobado.
- **Fix requerido:** En `aceptarCotizacionNegocio()`, después de actualizar el estado de la cotización, hacer un UPDATE a `negocios.precio_aprobado` con el `valor_total` de la cotización.

### P4 — MODERADO: Condición del checklist UPME no evaluada
- **Descripción:** El bloque `checklist` en etapa 3 tiene `config_extra.condition = {field: 'verificacion_upme', value: 'no'}` que indica que debería mostrarse solo si `verificacion_upme = 'no'`. El renderer en `negocio-detail-client.tsx` no evalúa esta condición — el bloque aparece siempre.
- **Archivo:** `src/app/(app)/negocios/[id]/negocio-detail-client.tsx` (sección BloqueRenderer)
- **Impacto:** El checklist UPME aparece para todos los negocios en etapa 3, incluso los que tienen UPME=Sí.
- **Fix requerido:** En `BloqueRenderer`, antes de renderizar, evaluar `config_extra.condition` contra los datos del negocio.

### P5 — MODERADO: costosEjecutados hardcodeado en 0
- **Descripción:** En `getNegocioDetalleCompleto()` línea 1165, `costosEjecutados: 0` está hardcodeado. El `BloqueResumenFinanciero` siempre muestra $0 en costos.
- **Archivo:** `src/app/(app)/negocios/negocio-v2-actions.ts` línea 1165
- **Impacto:** La ganancia y el margen mostrados en el resumen financiero son incorrectos (inflados).
- **Fix requerido:** Calcular costos reales desde `gastos` con `negocio_id` cuando esté disponible, o desde `proyecto_id` vinculado.

### P6 — MENOR: Verificación AI de documentos es simulada
- **Descripción:** El botón "Verificar AI" en `BloqueDocumentos.tsx` línea 97-103 hace `setTimeout(2000)` y simula verificación. No llama ninguna API real.
- **Archivo:** `src/app/(app)/negocios/[id]/bloques/BloqueDocumentos.tsx`
- **Impacto:** Los usuarios confían en que el documento fue verificado por AI pero no es así.
- **Fix requerido:** Para el piloto SOENA, quitar el botón "Verificar AI" o deshabilitarlo hasta implementar.

### P7 — MENOR: No hay gate/cierre para etapa 7 → negocio cerrado
- **Descripción:** No existe etapa de cierre configurada en la migración. Después de etapa 7 (Por Cobrar), no hay forma de "cerrar" el negocio desde la UI de bloques. El negocio queda en estado `activo` en `negocios.estado` indefinidamente.
- **Impacto:** Para el piloto SOENA, los negocios completados no se pueden marcar como cerrados.
- **Fix requerido:** Agregar lógica de cierre o una etapa adicional "Cerrado" en la migración.

### P8 — MENOR: datos anticipo duplicados entre etapa 2 y cobros en tabla
- **Descripción:** El bloque `datos` de etapa 2 guarda `valor_anticipo` en `negocio_bloques.data`. Los cobros se crean en tabla `cobros` con `negocio_id`. Si el bloque se modifica después de crear los cobros (por ejemplo, al reingresar el valor), los cobros ya creados no se actualizan — quedan desfasados.
- **Impacto:** En SOENA, si se corrige el valor del anticipo, los cobros no reflejan el nuevo valor.
- **Fix requerido:** Verificar si existen cobros tipo anticipo antes de crear nuevos, o eliminar/actualizar los existentes.

### P9 — INFORMATIVO: Dos instancias de `datos` en etapa 5 comparten `bloque_definition_id`
- **Descripción:** La etapa 5 (Por Radicación) tiene dos bloque_configs con el mismo `bloque_definition_id` (datos) pero diferente `orden`. El UNIQUE index en migration 004 fue modificado para incluir `orden`. Sin embargo, `negocio_bloques` tiene `UNIQUE(negocio_id, bloque_config_id)` — como son dos `bloque_config_id` distintos (uno por fila en `bloque_configs`), esto es correcto. Solo asegurarse de que al crear instancias en `cambiarEtapaNegocio()` se crean las dos instancias separadas.
- **Impacto:** Bajo — el código maneja bien el caso porque itera sobre `configIds`.

### P10 — INFORMATIVO: Sistema pipeline VE legacy existe en paralelo
- **Descripción:** El archivo `oportunidad-detail.tsx` contiene un sistema VE completo con estados `por_inclusion → cerrado`, documentos con OCR real (Gemini), y auto-cobros en `proyectos`. Este sistema opera sobre `oportunidades` + `proyectos`, no sobre `negocios`.
- **Impacto:** Si se abre una oportunidad SOENA desde `/pipeline`, se ve el sistema legacy. Si se abre el mismo negocio desde `/negocios`, se ve el sistema de bloques. No hay inconsistencia de datos entre los dos porque son entidades independientes, pero puede causar confusión operativa.
- **Recomendación:** Para el piloto SOENA, operar exclusivamente desde `/negocios`. Documentar internamente que `/pipeline` es el sistema legacy y no debe usarse para SOENA.

---

## Recomendaciones

### Crítico — antes del piloto

1. **Implementar routing condicional UPME (P1):** Modificar `cambiarEtapaNegocioConGate()` para evaluar `config_extra.routing` de la etapa actual. Si `negocio_bloques.data.verificacion_upme === 'no'` en el bloque checklist → ir a etapa 4. Si no → ir a etapa 5. Esto requiere pasar el contexto del negocio al gate check.

2. **Fix BloqueEjecucion (P2):** Pasar `hasProyecto={false}` está hardcodeado. Para el piloto con SOENA, simplemente quitar el bloque de las etapas 6 y 7 de la migración si no está implementado, o cambiar la lógica para que no aparezca como bloque hasta que esté listo.

3. **Recorrer punta a punta una vez:** Crear un negocio de prueba SOENA y avanzar manualmente por todas las etapas verificando que cada bloque gate funciona correctamente. Este es el único test real que valida el flujo completo.

### Moderado — primera iteración post-piloto

4. **Actualizar `precio_aprobado` al aceptar cotización (P3):** Agregar `actualizarPrecioAprobado()` en la cadena de `aceptarCotizacionNegocio()`.

5. **Implementar condición del bloque (P4):** Agregar evaluación de `config_extra.condition` en `BloqueRenderer` para ocultar bloques que no aplican según el contexto del negocio.

6. **Implementar cierre de negocio (P7):** Agregar un botón o etapa final que marque `negocios.estado = 'cerrado'` y registre `negocios.closed_at`.

### Roadmap — cuando tenga más datos del piloto

7. **Verificación real de documentos:** Integrar Gemini Vision en `BloqueDocumentos` similar al sistema en `ve-documentos-section.tsx`. Requiere definir qué datos se extraen de cada documento en el contexto SOENA del módulo negocios.

8. **Costos ejecutados reales (P5):** Calcular desde gastos o desde proyecto vinculado cuando esté disponible la vinculación negocio → proyecto en el módulo negocios.

9. **Gestión de cobros corregidos (P8):** Agregar validación en `autoCrearCobros()` para detectar cobros existentes antes de crear duplicados.

---

## Tablas de referencia rápida

### Tablas DB por bloque

| Tipo bloque | Tabla primaria | Campo clave |
|-------------|---------------|-------------|
| `equipo` | `negocio_bloques.data` | `comercial_id`, `ejecucion_id`, `financiero_id` |
| `cotizacion` | `cotizaciones` | `negocio_id` |
| `datos` | `negocio_bloques.data` | JSONB flexible por config_extra.fields |
| `documentos` | `negocio_bloques.data` | JSONB con slugs de docs |
| `checklist` | `bloque_items` | `negocio_bloque_id` |
| `cobros` | `cobros` | `negocio_id` |
| `resumen_financiero` | `cobros` (calc.) | `negocio_id` |
| `ejecucion` | ninguna | — |

### Estado de bloques gate por etapa SOENA

| Etapa | Gate(s) activos | Sin completar bloquea avance |
|-------|----------------|------------------------------|
| 1 — Por Contactar | Ninguno | No |
| 2 — Contactado | Datos anticipo (ref + valor) | Sí |
| 3 — Recolección Docs | Documentos (4 docs) | Sí |
| 4 — Por Inclusión | Datos inclusión (radicado) | Sí |
| 5 — Por Radicación | Datos radicación (radicado cert.) | Sí |
| 6 — Por Certificación | Documentos (concepto cert.) | Sí |
| 7 — Por Cobrar | Ninguno | No |

### Función SQL de gate

```sql
-- Verifica si todos los bloques gate de una etapa están completos
SELECT puede_avanzar_etapa(
  'negocio-uuid'::uuid,
  'etapa-uuid'::uuid
);
-- true: puede avanzar
-- false: hay bloques gate pendientes
```
