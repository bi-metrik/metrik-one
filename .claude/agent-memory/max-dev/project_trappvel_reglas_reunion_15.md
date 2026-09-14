---
name: trappvel-reglas-reunion-15
description: PR #712 mergeado — combinaciones solo vuelo+hotel, recargo fijo como INGRESO, y el gate margen_sobre_piso; las tres INERTES hasta que se aplique la config de datos, que sigue sin aplicar
metadata:
  type: project
---

Las tres reglas de la reunión del 2026-09-14 con Daniela y Alejandra (Trappvel).
**PR #712 mergeado** (`30a4334`), los cuatro checks obligatorios en verde. Sin migración
de esquema y sin una sola escritura a producción.

## ⚠️⚠️ Lo construido es INERTE hasta que alguien aplique la config

`proyectos/trappvel/clarity/migrations/2026-09-14_reglas-reunion-15-datos-pendientes.sql`,
**sin aplicar**, tres bloques comentados:

1. **Umbrales de la línea.** Medido: `Viaje a medida` (`42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887`,
   workspace `cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc`) declara `convencion` y `default_pct`
   y **NO** `piso_pct` ni `aviso_pct` → caen a 5% y 10% de fábrica. **Eso NO es una
   decisión de Trappvel**, es el default del producto; los dos números quedaron de
   revisarse con Edgar. Escribir 5 y 10 borraría la distinción para siempre.
2. **El gate en la etapa 2 «Cotización»** (`0138f4b0-6382-4377-b1ff-15d3e31bb051`).
   Sin esto la Regla 3 existe y no frena nada. **Ninguna de las 11 etapas de la línea
   declara un solo gate hoy.**
3. **El recargo.** No hace falta SQL: se enciende desde **Mi Negocio → Margen y recargo**.

## Regla 1 · el producto cartesiano

`RANURAS_COMBINABLES = ['vuelo_detalle','hotel_detalle']` vive en
`ranuras-pantallazo.ts`, **no** en el motor: ese catálogo ya es la única pieza que sabe
qué es un vuelo, con sus sinónimos (`vuelos`, `aéreo`, `tiquete`, `hoteles`,
`alojamiento`). Una segunda lista se desincroniza y el síntoma es una columna que
desaparece sin que nada falle.

- 3 vuelos × 3 hoteles × 2 traslados: **18 → 9 filas**. El traslado suma en las nueve.
- ⚠️ Un grupo NO combinable con alternativas aporta **UNA** opción (la primera por
  orden, o la que la selección nombre) y el supuesto se **anuncia**. Sumarlas todas
  cobraría dos traslados; no sumar ninguna dejaría el viaje sin el componente.
- ⚠️ `ranurasSinResolver` mira **solo** las combinables. Exigir el tour dejaría el
  itinerario bloqueado por una columna que la tabla ya no dibuja.
- Radio real medido: **0 filas** en `cotizacion_itinerarios` e `itinerario_opciones` en
  toda la base, y solo **4 ítems con `grupo`** (los cuatro `vuelo`, en 2 cotizaciones).
  No había nada que invalidar.
- `TOPE_COMBINACIONES` sigue en 60. Con dos ranuras hacen falta 8×8=64 para tocarlo.

## Regla 2 · el recargo es INGRESO, y la pregunta abierta

**Decidido: INGRESO.** Como costo entraría a `costoDirecto`, recibiría administrativos y
**después** margen: $100.000 saldrían cobrados en **$117.647** con `sobre_venta` al 15%.
Como ingreso es una línea sin costo con `precio_manual = true`.

Medido: costo 2.000.000 fijo; precio 2.352.941 → 2.452.941 (defecto) → **2.502.941**
(editado a 150.000); margen 15,0% → 18,5% → **20,1%**.

⚠️ **PREGUNTA VIVA PARA MAURICIO**, escrita en el encabezado de `recargo-linea.ts`: si
algún día el recargo corresponde a algo que Trappvel **paga** (fee de GDS, tasa del
consolidador), es COSTO y su sitio es un rubro de la línea de vuelo. Hoy no hay
evidencia: en la hoja el fee se suma al precio del pasajero y nunca aparece como egreso.
Misma familia que `comision_proveedor`.

- Default en `lineas_negocio.config_extra.recargo`, **nace apagado**.
- ⚠️ La línea se reconoce **por el nombre** normalizado contra la etiqueta. No hay
  columna donde marcarla. Si alguien la renombra, el sistema vuelve a **ofrecer** —
  ofrecer, no agregar, así que lo peor es un botón de más.
- ⚠️ Nace **sin `grupo`**. Con grupo abriría ranura y dos recargos se cobrarían como uno.
- No dice «editado a mano»: el mismo estado sale cuando sube el vigente sin que nadie
  toque la cotización. Dice **las dos cifras**.

## Regla 3 · el gate y la copia que mentía

Gate `margen_sobre_piso`, opt-in por etapa. `evaluarGateMargen` (en
`gate-margen-datos.ts`, con supabase por parámetro para poder doblarlo) recalcula con
`cascadaVigente` — **no** con `valor_total / costo_total`, que ignora el AIU.

- Precedencia: **aceptada > enviada > borrador**. Rechazadas y vencidas nunca.
- ⚠️ Margen **no medible NO frena** (al revés que `motivoDeRechazo`). Allá el objeto es
  un documento que va al cliente; aquí, un caso que va a la etapa donde se costea.
- ⚠️ Si no se pueden **leer** las cotizaciones, **frena**.
- ⚠️⚠️ La copia del editor decía en rojo *«es una marca, no un bloqueo: la cotización se
  puede enviar igual»*. Con el gate eso es FALSO. Ahora el texto depende de
  `pisoBloqueaAvance`, que `page.tsx` resuelve leyendo los gates de la etapa actual del
  negocio (embed `etapas_negocio!negocios_etapa_actual_id_fkey`, **verificado contra
  producción**). Si no se puede leer, no se afirma nada.
- `congelar-umbrales.ts` **borrado**: la migración `20260914160000` ya está aplicada
  (comprobado leyendo las dos columnas por PostgREST) y la tolerancia solo tragaba un
  `42703` real.

## ⚠️ El defecto que cazó el doble y el tipo no

`itinerarioPrincipal<T extends { es_principal?: boolean | null }>` lee la columna
**cruda**, y como la declara **opcional**, pasarle una `FilaItinerario` (que expone
`esPrincipal`) **compila** y devuelve `null` SIEMPRE. El gate habría medido la suma por
supuesto en vez del itinerario elegido: dejaría avanzar una combinación al 3,1% porque
la alternativa cara aporta al total. `cascadaVigente` usa `filas.find(f => f.esPrincipal)`.

Relacionado: [[cotizacion-margen-rubros]], [[pruebas-por-mutacion]],
[[medir-antes-de-construir]], [[capturas-ui-sin-servidor]].
