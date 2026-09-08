---
name: gate-recaudo-facturacion
description: PR #578 — el recaudo pasa a condición de entrada a la cola de facturación; la banda del 1%, por qué el filtro es solo para pendientes, y la capacidad de adopción que se pierde
metadata:
  type: project
---

Desde el **2026-09-08** el honorario recaudado es **condición de entrada** a la cola de
facturación de `/conciliacion`, no una etiqueta de "falta". PR **#578**, sin migración y sin
una sola escritura a producción. **Abierto sin mergear** al cerrar la sesión.

```
banda(honorario) = max(TOLERANCIA_SALDO_COP, round(1% del honorario))

falta <= TOLERANCIA          -> cubierto          lista, botón directo
TOLERANCIA < falta <= banda  -> descuadre_menor   lista, marcado, exige justificación escrita
falta > banda                -> retenido          NO se lista
```

**Why:** el operador veía 56 casos, con botón en unos y sin botón en otros, y no tenía forma
de saber cuáles podía resolver hoy. Cobrar no se resuelve en esa pantalla.

**How to apply:**

- El criterio vive **entero** en `src/lib/facturacion/caso-listo.ts`
  (`bandaMaterialidadFacturacion`, `estadoDeRecaudo`). Servidor y pantalla lo consumen; no
  reescribir la resta en ninguno de los dos.
- **`TOLERANCIA_SALDO_COP` no se toca.** Es vara de todo el producto y de ella cuelgan el
  motor de avance y los gates de etapa. La banda se construye encima. Con honorario nulo o
  cero **colapsa al piso**: no hay de qué sacar el 1%.
- Un `descuadre_menor` **no** es `casoListoParaFacturar`. Si contara como listo, la bandeja lo
  sumaría a los de un clic y la pantalla saltaría la justificación.

## ⚠️ El filtro es solo para los PENDIENTES, y esa parte no la traía el brief

El brief decía "los retenidos salen de `casos`". Aplicado literal, un caso **ya facturado** o
**descartado** que estuviera retenido desaparecería de las vistas "Ya facturados" y
"Descartados", y `totales.ya_facturados` mentiría. Un caso facturado es un **registro**, no un
candidato. Medido: 0 de 266 facturados y 0 de 0 descartados están retenidos hoy, así que no
cambia nada — es latente, y basta con que a un facturado le anulen un cobro.

## ⚠️ Consecuencia abierta: los retenidos pierden "Esta factura ya existe"

`AdoptarFacturaExistente` declara **por escrito** que no se gatea por saldo, porque la factura
ya existe en Siigo pase lo que pase con el recaudo. Al sacar los retenidos de la lista, en esos
casos ya no se puede adoptar una factura hecha a mano. Pesa poco hoy (SOENA factura después de
cobrar) y quedan alcanzables por Saldos → ficha del negocio, pero es capacidad perdida y
**está reportada sin decidir**.

## Cifras medidas (producción SOENA, 2026-09-08)

Sobre los **46** pendientes sin factura ni descarte, etapa > 5: **18 cubiertos**, **1 en la
banda** (V0179, faltan $3.000 sobre $637.500 = 0,47%), **27 retenidos** ($18.487.625 de
honorarios, $13.739.219 por recaudar).

**El 1% no parte ningún grupo por la mitad:** el retenido más cercano (V0406) debe el
**11,8%**; entre 0,47% y 11,8% no hay un solo caso. Los demás van del 47% al 100%. Ese hueco
es lo que hace defendible la vara — si algún día se discute el porcentaje, se vuelve a medir la
distribución antes que a razonar.

⚠️ El brief traía 56 / 27 / 29 y salieron 46 / 18 / 28: diez facturas emitidas entre que se
escribió y la sesión. Ver [[cifras-del-brief-caducan]].

## Dónde quedó cada cosa

- `src/lib/facturacion/caso-listo.ts` — criterio puro + banda.
- `src/lib/actions/facturacion-actions.ts` — `estado_recaudo`, `banda_materialidad`,
  `totales.retenidos_por_recaudo { n, valor, falta }`, y el filtro (en el SERVIDOR).
- `src/lib/siigo/facturas.ts` — tres ramas en el bloque del saldo, `justificacionDescuadre`,
  motivo `descuadre_de_recaudo`, marca `justificacion_descuadre` con el faltante congelado.
- `src/app/(app)/conciliacion/conciliacion-client.tsx` — contador + salto a Saldos (los
  filtros de esa pestaña subieron al padre para que el enlace aterrice filtrado por faltante).
- `test/cola-facturacion-doble.ts` — ganó `recaudo(i)` y `metadata(i)`; es la palanca para
  sembrar un caso en cualquiera de los tres estados.

Relacionado: [[medir-antes-de-construir]], [[pruebas-por-mutacion]], [[sql-prod-one]].
