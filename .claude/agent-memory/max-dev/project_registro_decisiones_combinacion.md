---
name: registro-decisiones-combinacion
description: "#808 en producción — el evento «sale al cliente» es generar el PDF porque `enviada` solo ocurre UNA vez y mataría R3; SQL pendiente con la tabla server-only; el motivo vive en la TARIFA, no en el registro"
metadata:
  type: project
---

**PR [#808](https://github.com/bi-metrik/metrik-one/pull/808)** mergeado el 2026-09-21
(squash `12e97072`), 4 checks obligatorios verdes, **desplegado a producción** (commit
status de Vercel en `success`). **Sin migración en el PR y sin una escritura a
producción.**

Paso **3** de `proyectos/trappvel/clarity/docs/diseno/ranuras-y-motor-de-combinacion.md`
(§3.2, §3.2.1 y §3.3). El motor de IA (paso 4) NO entra. Sigue a
[[ranuras-multiples-tres-tarifas]] (#805).

## ⚠️⚠️ El evento «la cotización sale al cliente»: se eligió GENERAR EL PDF

No existe limpio en el código. Los dos candidatos reales:

| | `generateCotizacionPDF` (elegido) | `enviarCotizacionNegocio` |
|---|---|---|
| ¿produce el documento? | **sí** (y con la plantilla propia de Trappvel desde #800) | no: solo `estado: borrador → enviada` |
| ¿se repite? | **sí** | **NO**: exige `estado === 'borrador'` y además rechaza si ya hay otra `enviada` |

**El argumento que decide es el segundo.** R3 dice *«una segunda salida agrega fila»*,
y con `enviarCotizacionNegocio` una reemisión **nunca llegaría a registrarse**: la
señal que el registro existe para capturar quedaría fuera. Y los errores no son
simétricos — registrar una descarga que nadie mandó es ruido filtrable por cotización;
perder las reemisiones no se repone.

⚠️ Si aparece un envío de verdad (correo al cliente), el disparo se mueve ahí. Queda
razonado en el encabezado de `registrarDecisionesDeLaSalida`.

⚠️ La llamada va en **los DOS caminos de render** de `generateCotizacionPDF` (PATH A
WeasyPrint y PATH B @react-pdf), justo antes de cada `return`. Trappvel usa el B
(`plantillaCotizacionPropia('trappvel')` apaga el A), pero un workspace con plantilla
externa y tarifas habría emitido sin registrar.

## ⚠️ SQL PENDIENTE, y va DESPUÉS del deploy

`proyectos/trappvel/clarity/migrations/2026-09-21_registro-decisiones-PENDIENTE.sql`.
Dos cosas: la tabla `decisiones_combinacion` y **dos columnas en
`cotizacion_itinerarios`** (`motivo_codigo`, `motivo_texto`).

**Ejercitado contra PGlite** (arnés a mano, NO commiteado: el archivo vive fuera del
repo y una prueba que lo lea falla en CI). Medido: corre, es idempotente, RLS + policy
por workspace, **cero grants a `anon`/`authenticated`** (`-- server-only:`, guarda
precios de proveedor de cada descartada), dos filas para la misma tarifa (R3), y
borrar la tarifa deja el registro con sus descartadas intactas. El control: al meterle
un `unique` sobre `itinerario_id` y un `grant`, cayeron 4 de 9.

⚠️ **La tabla es de PRODUCTO, no de este cliente.** Vive en `proyectos/` porque el
brief lo pidió; al aplicarla conviene moverla a `supabase/migrations/` para que el repo
no mienta sobre su esquema y `check:migraciones` la vigile (ya pasa sobre el archivo, y
falla si se le quita la marca o el RLS).

## El motivo (§3.3) vive en la TARIFA, no en el registro

R5: *«se pide donde se elige, en la tabla, no en un modal al emitir»*. Por eso son
columnas de `cotizacion_itinerarios` y la salida al cliente las **copia**. El catálogo
de seis razones está en `src/lib/cotizaciones/motivo-combinacion.ts`.

⚠️ `SELECT_ITINERARIO` pasó de nombrar columnas a **`'*, itinerario_opciones(item_id)'`**.
Sin eso, nombrar `motivo_codigo` antes de la migración devuelve un **400 sobre toda la
tabla** y el editor no abre. Con `*` llega `undefined`, que es el estado de una tarifa
sin motivo.

⚠️ `EstadoItinerarios.motivoDisponible` se deriva de la **presencia de la clave** en la
fila (`Object.hasOwn(data,'motivo_codigo')`), no de su valor: con la migración pendiente
la tabla **no ofrece el selector**, en vez de ofrecer un control que siempre da `42703`.

## R1, en la forma y no en un comentario

`armarFilasDeRegistro` **no acepta un parámetro** para la propuesta: los tres campos
salen `null` por construcción. *«Un valor puesto por defecto es indistinguible de una
propuesta real y el día que se mida al motor, se le estaría midiendo contra sí mismo.»*
`propuesta_origen` queda para que el día que exista se sepa QUÉ versión propuso.

## ⚠️ R4 solo se prueba MUTANDO después

«Las descartadas se copian» pasa igual con una referencia compartida si la prueba solo
mira los valores. La prueba real renombra un ítem y borra otro **después** de armar las
filas. Mutación que la tumba: reemplazar `nombre`/`precio` por getters sobre `ctx.items`.

## Qué NO se registra, y es a propósito

- Solo las tarifas **`va_en_propuesta`**: son las que salen en el PDF. Una tarifa armada
  que nadie marcó no llegó al cliente.
- El **componente suelto** (un seguro, un fee) no es una variante: no hay nada que
  decidir sobre él. Sí se registra la ranura NO combinable (traslado), marcada
  `combinable: false` — su supuesto es permanente y nadie va a elegir por ella nunca.

## Coste y R6

Para una cotización sin tarifas es **una consulta** (lee los itinerarios y sale). Con
tarifas lee además ítems, viaje y staff, repitiendo lo que hace `bloquesParaPDF`: se
prefirió repetir a atar el registro a la forma de esa función. Termotech, Arca y WMC no
escriben una fila.

## Lo que encontró MIRAR la pantalla

El rótulo de la sub-fila decía **«POR QUÉ ESTA»**, truncado. Ninguna prueba lo habría
dicho. Se vio con render + Tailwind compilado por postcss + captura con el chromium de
playwright (`~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome --headless
--screenshot`). ⚠️ De paso, el instrumento también falló: `/<th/` casa `<thead` y
contaba una columna de más.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Catálogo de motivos + `normalizarMotivo` | `src/lib/cotizaciones/motivo-combinacion.ts` |
| `armarFilasDeRegistro` (puro) + la escritura | `src/lib/cotizaciones/registro-decisiones.ts` |
| El disparo | `registrarDecisionesDeLaSalida` en `cotizacion-pdf-actions.ts` |
| `guardarMotivoDeTarifa` | `src/app/(app)/negocios/itinerario-actions.ts` |
| La sub-fila del motivo | `src/app/(app)/negocios/tabla-combinaciones.tsx` |

Relacionado: [[ranuras-multiples-tres-tarifas]], [[cobertura-opciones-cotizacion]],
[[documento-cliente-trappvel]], [[trappvel-pantalla-cotizacion]], [[pruebas-por-mutacion]],
[[ensayo-sql-pglite]], [[capturas-ui-sin-servidor]].
