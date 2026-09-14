---
name: aporte-al-total-y-sugeridos
description: PR #709 mergeado y migración APLICADA — el defecto vivo no era el que decía el brief (la etiqueta duplicada ya estaba cerrada); el TOTAL del PDF trae IVA y el Subtotal no; y por qué «tomar el primero» le ganó a «no sumar ninguna»
metadata:
  type: project
---

**PR [#709](https://github.com/bi-metrik/metrik-one/pull/709) mergeado el 2026-09-14**
(squash `ae157f8d`), 6 checks verdes, deploy OK 18:14:58Z. Migración
`20260914230000_rubros_sugerido` **APLICADA y en el ledger**. Cierra los dos frentes
que dejó abiertos el [[pantallazo-ranuras]] (#700).

## ⚠️⚠️ De los tres defectos del brief, UNO ya estaba cerrado

El brief pedía corregir «RECOMENDADA · RECOMENDADA». **Ya lo había arreglado el #684**
con `tituloDeBloquePDF`. Comprobado sobre el documento renderizado: imprime
`RECOMENDADA $ 4.080.460` y `ECONÓMICA $ 3.879.310`. Quedó una prueba que lo fija, con
su control (un nombre que NO la dice sí recibe el sufijo).

Confirma [[cifras-del-brief-caducan]]: la premisa se comprueba, no se hereda.

## ⚠️⚠️ La premisa de mi PROPIA memoria también había caducado

Decía que las migraciones de umbrales (#682) y de itinerarios (#684) seguían **sin
aplicar**. Medido el 2026-09-14: las DOS están aplicadas, y el bloque 1 del DDL
(`rubros_tipo_conceptos_viaje`) también, como `20260914172108`. Ya corregido en
[[itinerarios-cotizacion]] y [[margen-visible-trappvel]]. **Se re-mide siempre.**

## El defecto que sí estaba vivo no es el que cubre `totalDelPrincipal`

`totalDelPrincipal` resuelve «hay itinerarios y uno es principal». Lo que llegó vivo a
producción es **alternativas cargadas y CERO itinerarios**: medido, COT-2026-0001 y
COT-2026-0003 de trappvel tienen titular + alternativa en `grupo='vuelo'`, y
`cotizacion_itinerarios` estaba **vacía en toda la base** (20 cotizaciones, 41 ítems,
61 rubros). Ahí devuelve `null` y todo caía a sumar los dos vuelos.

**La regla vive en `itemsQueAportanAlTotal`** (`src/lib/cotizaciones/itinerarios.ts`) y
la consumen el total en pantalla, `recalcularTotales` y **las dos ramas** del PDF
(@react-pdf y el servicio externo, que también mapeaba todos los ítems).

**Sin ranuras con alternativas devuelve todos los ítems.** Es R6 y es la mitad de las
pruebas: Termotech, Arca y WMC no cambian una línea.

### Sin principal: aporta el PRIMERO por `orden`, declarado supuesto

No sumar ninguna deja el precio **por debajo** del real (la cotización sale sin el
vuelo), que es la dirección que pierde plata. Tomar el primero deja el documento
cuadrado y el error visible en la propia línea.

⚠️ NO contradice a `itinerarioPrincipal`, que sigue devolviendo `null`: esa pregunta es
«cuál de las combinaciones que alguien construyó fija el precio», y ahí la decisión
existe y está sin tomar. Aquí no hay combinaciones.

⚠️ `seleccionSupuesta` **deriva de** `ranurasPorSupuesto`. Escritas por separado, las
dos tomaban `candidatos[0]` por su cuenta y la mutación dejaba viva la prueba del aviso.

## ⚠️⚠️ El TOTAL del PDF trae IVA y el Subtotal no

La igualdad que se cumple es **`Subtotal` == total en pantalla**, y de ahí
`TOTAL == Subtotal + IVA`. Exigir que las tres fueran iguales era una **expectativa mal
escrita**, no un defecto — se vio leyendo el documento, no razonando.

Cifras medidas (AVIANCA 2.000.000, WINGO 1.825.000, hotel 1.350.000, traslado 200.000,
margen 13% sobre venta):

| Escenario | Pantalla | Costo | Subtotal PDF | TOTAL PDF |
|---|---|---|---|---|
| sin alternativas (control) | 4.080.460 | 3.550.000 | 4.080.460 | 4.855.747 |
| con alternativa, sin principal | 4.080.460 | 3.550.000 | 4.080.460 | 4.855.747 |
| con alternativa y principal (WINGO) | 3.879.310 | 3.375.000 | 3.879.310 | 4.616.379 |

**Antes del arreglo, misma siembra: 6.178.161 y costo 5.375.000.**

## Frente 2 · `rubros.sugerido`, aplicado

La columna y el filtro **en el mismo movimiento**. Migración **ANTES del merge**:
aplicada primero nace en `false` y ninguna lectura cambia (riesgo cero); al revés, el
insert del pantallazo la nombra y falla.

⚠️ **`sugerido` ausente cuenta como CONFIRMADO.** Es lo que llega de toda consulta que
no pida la columna; al revés dejaría el costo de TODA cotización en cero, y un margen
del 100% se ve como buena noticia. Por eso las consultas usan **`rubros(*)`** y no
nombran la columna: el código corre igual antes y después.

⚠️ **Solo se persiste lo que está en COP.** La tasa se escribe DESPUÉS de leer; guardar
un número cuya moneda nadie pueda recuperar deja el costo ~4.000 veces corto. Cuando no
es COP el panel lo dice antes de que alguien lo descubra recargando.

Cinco consumidores filtran (`src/lib/cotizaciones/rubros-sugeridos.ts`):
`recalcularTotales`, `contextoDeCotizacion`, el editor, `calcularPresupuestoPorRubro` y
el guard de costo manual de `updateItem`. `duplicarCotizacion` copia solo lo confirmado.
`updateRubro` **dejó de aceptar `sugerido`**: era puerta trasera al costo desde un
endpoint que acepta cualquier columna.

Verificado contra la server action real: con y sin la propuesta encima, `costo_total`
3.550.000 y `valor_total` 4.080.460 **idénticos**; confirmarla sube a 5.375.000 /
6.178.161 (el control).

## ⚠️ Deuda abierta, anotada y NO resuelta

`CATEGORIA_GASTO_A_TIPOS_RUBRO` no mapea `tarifa`, `impuestos` ni `fee_proveedor`, que
el CHECK ya admite. El día que el paso 3 los escriba, la barra de Ejecución leerá
ejecutado 0. El comentario quedó donde vive el mapeo; **el mapeo no se tocó**.

Sigue sin DDL la parte de **campos leídos estructurados** del bloque 3 (el insumo del
`puntaje_experiencia`): tras recargar quedan los rubros, no los campos ni los avisos.
⚠️ La otra mitad del bloque 3, la de PRESENTACIÓN, sí se cerró en
[[dia-relativo-sugeridos]] (#718, migración sin aplicar).

Relacionado: [[pantallazo-ranuras]], [[itinerarios-cotizacion]], [[dia-relativo-sugeridos]],
[[margen-visible-trappvel]], [[leer-texto-de-un-pdf-de-react-pdf]],
[[pruebas-por-mutacion]], [[cifras-del-brief-caducan]].
