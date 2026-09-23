---
name: cotizacion-con-negocio-trappvel
description: "#872 (R1/R2 bandeja) y #874 (encabezado+columna+franja fija) mergeados 2026-09-23. Dónde vive cada dato del marco, qué NO existe y cómo medir un sticky"
metadata:
  type: project
---

**#872** mergeado el 2026-09-23 (squash `9588e5e`), sin migración. Reunión con Edgar y
Alejandra (`proyectos/trappvel/clarity/docs/diseno/reunion-edgar-alejandra-2026-09-23.md`).

## R1: «Aceptar» no respondía — la fila de server actions

Next despacha las server actions del cliente **de una en una**. Una lectura de pantallazo
(`leerCasillaDeItem`) tarda 8-25 s, así que un «Aceptar» tocado durante lecturas esperaba
detrás de todas, sin señal. Salida: una **ruta** (`/api/cotizaciones/items/[id]/confirmar-tarifa`)
que llama a la MISMA `confirmarTarifaPorPasajero`. Un `fetch` no entra a esa fila.
Regla de Mauricio: un faltante del reparto por pasajero **nunca** impide aceptar
(`codigo: 'PENDIENTE'` → aceptada + aviso; `desenlaceDeAceptar` en `aceptar-captura.ts`).

⚠️ La prueba R6 byte a byte (`cotizacion-editor-r6-render.test.ts`) atrapó un
`data-linea-id` que se pintaba también a Termotech: todo atributo nuevo del editor va
condicionado a `lineasPorTipo`.

## R7 / A3: las columnas del motivo YA están en producción

`cotizacion_itinerarios.motivo_codigo/motivo_texto` y `decisiones_combinacion` existen
(medido por GET de PostgREST con control 42703). Pero **el SQL no está en
`supabase/migrations/`**: el repo miente sobre ese esquema.

## Header + columna del negocio — #874 mergeado (squash `e01a1cc`), sin migración

Solo Trappvel. Qué hay y qué no, medido en producción:
- **Solicitud** (`condiciones_del_viaje`, etapa 1): destino, nacional/internacional,
  fechas fijas/móviles, salida, regreso, adultos/niños/infantes, composición,
  requisitos especiales. **No hay campo de presupuesto** en la solicitud.
- **Perfil del cliente** = `contactos.custom_data` que escribe el bloque «Ficha del
  cliente» (`contacto_ficha`, tipo `contacto`, solo en etapa 1): tipo_cliente,
  con_quien_viaja, preferencias, **rango_presupuesto («Bolsillo declarado»)**,
  notas_perfil, documento_identidad. El presupuesto vive AQUÍ.
- **Por qué desapareció**: D1 (2026-09-12) lo sacó de la etapa 1 al contacto; el panel
  derecho del negocio (`panel-contacto.tsx`, #498) solo lee campos nativos, y
  `getNegocio` excluye `custom_data` del join a propósito. El único sitio donde se ve es
  el bloque de etapa 1, que al avanzar queda plegado en el historial.
- **IATA del destino**: no hay tabla ciudad→aeropuerto. Solo sale de los vuelos leídos
  de la cotización (`lugarConCodigo` sobre la ruta), y sin vuelos no hay código.
- **Estados de cotización** (CHECK): borrador, enviada, aceptada, rechazada, vencida.
  Hoy Trappvel solo tiene `borrador` (13). `valor_total` YA es el total de la
  Recomendada (`itinerarios-datos.ts`).
- ⚠️ La bandeja NO tenía arrastrar y soltar (el resumen previo lo afirmaba): lo agregó #874.
- Vive en `negocios/[id]/cotizacion/layout.tsx` (no en la página) para no desmontarse al
  cambiar de cotización; el editor detecta el marco por CONTEXTO (`marco-cotizacion-contexto.ts`),
  no por prop: sin contexto, R6 byte a byte. Datos: `marco-negocio.ts` (puro) + `-datos.ts`.
- Lista de cotizaciones en etapas `numero` 2 y 3; abiertas = borrador/enviada/aceptada.
- ⚠️ `chrome --headless --screenshot` mide mal un sticky con alto medido por
  ResizeObserver (dio 105 px contra 125 reales en 390 px). Medir por CDP con
  `Emulation.setDeviceMetricsOverride` (node + `ws` del repo) y `getBoundingClientRect`.

Relacionado: [[recomendada-tarifa-elegida]], [[registro-decisiones-combinacion]],
[[pruebas-por-mutacion]].
