---
name: entra-al-precio
description: PR #728 SIN mergear (migración 20260915120000 sin aplicar, la aplica la sesión principal) — el segundo interruptor de la cotización; por qué la regla es POR LÍNEA y no mira si la cotización usa días; los siete consumidores; y #729 (tipos de viaje sin categoría de gasto, pregunta abierta)
metadata:
  type: project
---

**PR [#728](https://github.com/bi-metrik/metrik-one/pull/728)**, rama
`feat/sugerencia-fuera-del-precio`, **7 checks verdes y SIN MERGEAR**. Decisión de
Mauricio del 2026-09-15 («Sí, adelante») sobre la pregunta que dejó
[[dia-relativo-sugeridos]]: una sugerencia puede **mostrar** su precio sin **cobrarlo**.

## ⛔ Orden: aplicar la migración → corregir el ledger → mergear

`supabase/migrations/20260915120000_items_entra_al_precio.sql`: `items.entra_al_precio
boolean not null default true`. La aplica la sesión principal (a un subagente el
clasificador le bloquea el token). Sin la columna la lectura sigue sana
(`select('*')`, `undefined` = entra) y la escritura del interruptor falla con 42703.

**Default `true` verificado LEYENDO, no razonando** (2026-09-15): 41 ítems, 37 sin grupo
y 4 `vuelo`, **cero** con grupo no combinable. Las 41 filas corridas por el código de
`main` y por el del PR: 16 de 16 cotizaciones idénticas. Ni un `false` sembrado cambiaría
nada, porque ninguna fila real es sugerencia.

## ⚠️⚠️ La regla es POR LÍNEA, y la versión «por cotización» mueve plata sola

`fueraDelPrecio` exige `false` explícito **y** sin día **y** grupo declarado no
combinable. Se evaluó hacerla depender de que la cotización use días (así solo aplicaría
donde hay sección de sugeridos) y se descartó: quitarle el último día a un tour le
devolvería al total el precio de OTRA línea. El costo de la regla por línea es que una
sugerencia fuera del precio tiene que imprimirse aunque la cotización no use días, por
eso `itemsSugeridos` sin días devuelve **solo las fuera del precio** (antes devolvía `[]`).

Una marca que no cumple las otras dos se IGNORA y la línea entra: el documento sigue
sumando lo que imprime. Las server actions impiden escribirla así (guards de sugerencia,
de día, y de cambio de grupo).

## ⚠️ La trampa que evitó una prueba: la ofrecida no puede competir por la ranura

Dos tours del mismo grupo, el ofrecido primero por `orden`: si entra como candidato, el
supuesto lo toma, lo saca por estar fuera, y el total queda **sin ninguno de los dos**.
Sale en `compitePorElTotal`, ANTES de armar ranuras.

## Los consumidores eran siete

`itemsQueAportanAlTotal` (y sus hermanas de `itinerarios.ts`), `recalcularTotales`, el
editor, las dos ramas del PDF (sin días e itinerarios también ofrecen la sugerencia),
`contextoDeCotizacion` (gate del piso y total del principal),
`calcularPresupuestoPorRubro` y `duplicarCotizacion` (que además perdía el día y el check
de mostrar desde el #718). ⚠️ Quien arme un `ItemConGrupo` desde una fila TIENE que pasar
`dia_relativo` y `entra_al_precio`: omitirlos compila y deja la sugerencia sumando. Lo
delata el aviso rojo, que se alimenta del mismo juego de ids (por eso NO se filtra otra
vez dentro del aviso).

Verificación: 48 pruebas nuevas, 15 mutaciones y las 15 tumban algo.

## #729 mergeado: tipos de viaje sin categoría de gasto (PREGUNTA ABIERTA)

`tarifa`, `impuestos` y `fee_proveedor` no tienen categoría de gasto que les
corresponda (CHECK de `gastos.categoria` leído en producción: once valores). `transporte`
cubriría solo tiquetes contra un bucket de vuelos+hoteles+tours; `impuestos_recuperables`
es lo contrario; `comision` es la de ePayco. **No se inventó categoría.** Lo cerrado es que
la barra no mienta: `tipoRubroMedible` (derivado del mapa) y el rubro se pinta sin barra.
Crear la categoría de pago a proveedores de viaje es decisión de producto.

⚠️ `20260914172108 rubros_tipo_conceptos_viaje` está en el ledger **sin archivo** en el
repo. Y `viaticos`/`mano_de_obra` están en el mapa y no en el CHECK.

Relacionado: [[dia-relativo-sugeridos]], [[aporte-al-total-y-sugeridos]],
[[presupuesto-vs-ejecutado]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
