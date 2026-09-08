---
name: presupuesto-vs-ejecutado
description: El bloque de Ejecución (PRs #529 y #532) — solo existe en 7 negocios de 4 workspaces, SOENA no lo tiene; la invariante que sostiene la sección, el caso de $75M que espera una aprobación, y por qué el caso de prueba sale null con el filtro de workspace
metadata:
  type: project
---

El motor de "Presupuesto vs Ejecutado" del detalle de negocio se corrigió en dos tandas:
**PR #529** (`866f951`, 2026-09-04) y **PR #532** (`ecfc669`, 2026-09-04). La aritmética
vive completa en `src/lib/negocios/presupuesto-ejecucion.ts`.

**Why:** el presupuesto salía **794 veces más chico** en el caso real que lo destapó
(COT-2026-0002: $71.132 en vez de $56.479.070, porque no se leía `items.cantidad`), y la
barra "Total" medía margen mientras decía medir presupuesto.

## ⚠️⚠️ Lo primero: este bloque casi no existe en producción

**Medido el 2026-09-05: hay instancias del bloque `ejecucion` en CUATRO workspaces y
SIETE negocios.** `soena` —donde vive casi todo el dato del producto— **no tiene ni un
`bloque_configs` de tipo `ejecucion`**.

| workspace | negocios |
|---|---|
| ana-demo | E1 26 1, I1 26 1, T1 26 2 |
| dimpro | E1 26 2 |
| termotech | C1 26 1 |
| wmc-sm | B1 26 1, B1 26 2 |

**How to apply:** toda cifra global sobre gastos, horas o cotizaciones (300 gastos, 119
negocios con ejecución sin cotización aceptada, 41 staff sin salario) es **irrelevante
para esta pantalla**. Antes de dimensionar cualquier cambio aquí, acotar con:

```sql
select distinct nb.negocio_id from negocio_bloques nb
join bloque_configs bc on bc.id = nb.bloque_config_id
join bloque_definitions bd on bd.id = bc.bloque_definition_id
where bd.tipo = 'ejecucion';
```

Es la misma familia que el error de contar filas en vez de eventos: la población que
importa es la que **ve** la pantalla, no la que tiene el dato.

## La invariante que sostiene la sección

    suma(rubros.ejecutado) + sinPresupuesto.total === totalGastos + costoHoras

o sea el KPI "Costo total". Cada peso cae en **exactamente un lado**, nunca en dos y
nunca en ninguno. Es lo que permite que la sección reconcilie de arriba abajo. Al tocar
`asignarEjecutadoPorRubro`, esta igualdad es el contrato; hay pruebas que la fijan sobre
filas reales.

Sigue vigente del #529: **la suma de los rubros DEBE cuadrar con `cotizaciones.costo_total`**
(contrato con `recalcularTotales` en `cotizacion-actions.ts`, que es quien llena esa
columna). Verificado contra las 6 cotizaciones aceptadas de la base.

## ⚠️ El caso que espera una aprobación para explotar

**`B1 26 2` (wmc-sm): $84.354.054 de gasto, cotización COT-2026-0003 en BORRADOR** con
rubros `mo_propia` / `materiales` / `servicios_prof`. El día que alguien la apruebe, el
89% del gasto ($75.259.054 en `otros`, `transporte`, `marketing`, `arriendo`) queda fuera
de toda barra. Antes del #532 desaparecía; ahora sale nombrado en la fila "Sin
presupuesto". **Hoy la fila no se ve en ninguna pantalla** — los dos negocios con
presupuesto no tienen un peso huérfano.

## Decisiones que no se deben deshacer

- **`precioAprobado` y `presupuestoCosto` son cosas distintas y la pantalla lo dice.**
  Sobrecosto contra el segundo, margen contra el primero. No fusionarlas otra vez.
- **La fila "Sin presupuesto" va SIN barra y sin `X / Y`.** Una barra necesita
  denominador; pintarla haría leer esa plata como presupuestada.
- **`salary / 160` sin default inventado.** Una tarifa promedio metería plata que nadie
  acordó dentro del costo de un negocio. El hueco se declara (`horasSinTarifa`), no se
  tapa. Y `costoHoras` se calcula en UN solo sitio: antes estaba copiado en dos IIFEs de
  `getNegocioDetalleCompleto`. **Ojo con el tamaño del hueco: hay 41 filas de `staff` con
  el salario en 0**, y esas horas cuestan cero pase lo que pase — no es un caso raro.
- **Una cotización en borrador o enviada NUNCA es presupuesto.** Se nombra por su
  consecutivo, sin su valor: un número al lado de un presupuesto ausente se lee como
  presupuesto.

## ⚠️ Dos cotizaciones aceptadas en el mismo negocio: ya pasa

`E1 26 2` (dimpro) tiene **COT-2026-0001 y COT-2026-0002 aceptadas a la vez**, 17 minutos
aparte. Antes la elegía un `.find()` cuyo orden lo fijaba el `.order('created_at', desc)`
de una consulta mil líneas más arriba. Ahora manda `resolverLineaBase`: la más reciente,
con **desempate estable por `id`**, y `otrasAprobadas` lo declara en pantalla.

## ⚠️ La traza de "la línea base se soltó" NO existe como dato limpio

`cotizaciones` no tiene `aceptada_at`, y en `activity_log` **`corregirCotizacionAceptada`
y `revertirAprobacionPropuesta` escriben el MISMO triple** (`cambio` /
`campo_modificado='precio_aprobado'` / `valor_nuevo` nulo): indistinguibles por clave.
Medido: 3 eventos en toda la base, los 3 del segundo mecanismo y los 3 en SOENA (que no
tiene este bloque) — **cero casos vivos**. Se decidió NO montar una consulta extra en la
pantalla más pesada del producto para eso. Si se necesita la traza precisa: migración
(`cotizaciones.aceptada_at` o un tipo propio de `activity_log`).

## ⚠️ El caso de la cotización aprobada SIN presupuesto

Una cotización puede estar `aceptada` y no dejar línea base: ítems sin rubros y
`costo_total = 0`. El borrador de termotech `COT-2026-0003` es exactamente eso (12 ítems
sin rubro). `motivoSinLineaBase` lo cubre — sin ese caso, aprobarlo devolvería la sección
en blanco, que es el defecto que el #532 vino a cerrar.

## ⚠️ El caso de prueba NO está en el workspace `metrik`

`COT-2026-0002` con `costo_total = 56.479.070,02` vive en el workspace
`971a4e80-e923-4a29-8730-f40b88e4be4e`. Buscarla con el **filtro de workspace obligatorio**
de `.claude/rules/agent-cerebro.md` (`a21bfc88…`, que es `metrik`) devuelve **null**, y ese
null se lee como "el brief está desactualizado" cuando lo que pasa es que el dato es de
otro tenant. Además el consecutivo **se repite entre workspaces**: hay cuatro
`COT-2026-0002` en la base. Al medir un caso que llega en un encargo, buscarlo primero sin
filtro para ver **de qué workspace es**, y recién entonces acotar.

Relacionado: [[cotizacion-margen-rubros]], [[medir-antes-de-construir]],
[[pruebas-por-mutacion]], [[sql-prod-one]].
