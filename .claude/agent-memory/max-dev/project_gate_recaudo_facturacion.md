---
name: gate-recaudo-facturacion
description: PR #578 + su enmienda — el recaudo como condición para FACTURAR (no para verse); la banda del 1%, dónde vive cada pieza, y por qué la adopción nunca se gatea por saldo
metadata:
  type: project
---

Desde el **2026-09-08** el honorario recaudado decide **si se puede facturar** un caso de la
cola de `/conciliacion`, no si el caso existe. La decisión se movió **dos veces el mismo
día** y las dos mitades importan:

- **PR [#578](https://github.com/bi-metrik/metrik-one/pull/578)** (`30eba08`, **mergeado**):
  el recaudo pasa a condición de entrada y los retenidos **salen** de la cola.
- **Enmienda** (PR **#580**, abierto sin mergear al cerrar): vuelven a la pantalla, a una
  **sección propia**, marcados y sin botón de facturar.

```
banda(honorario) = max(TOLERANCIA_SALDO_COP, round(1% del honorario))

falta <= TOLERANCIA          -> cubierto          lista, botón directo
TOLERANCIA < falta <= banda  -> descuadre_menor   lista, marcado, exige justificación escrita
falta > banda                -> retenido          se ve aparte, NO se factura, SÍ se adopta
```

**Why:** el operador veía 56 casos, con botón en unos y sin botón en otros, y no tenía forma
de saber cuáles podía resolver hoy. Cobrar no se resuelve en esa pantalla. Pero esconderlos
tampoco: **$18,5M no pueden salir de pantalla en silencio**, y sin ellos se perdía la
adopción.

**How to apply:**

- El criterio vive **entero** en `src/lib/facturacion/caso-listo.ts`
  (`bandaMaterialidadFacturacion`, `estadoDeRecaudo`, `razonDeRetencion`). Servidor y
  pantalla lo consumen; no reescribir la resta en ninguno de los dos.
- **`TOLERANCIA_SALDO_COP` no se toca.** Es vara de todo el producto y de ella cuelgan el
  motor de avance y los gates de etapa. La banda se construye encima. Con honorario nulo o
  cero **colapsa al piso**: no hay de qué sacar el 1%.
- Un `descuadre_menor` **no** es `casoListoParaFacturar`. Si contara como listo, la bandeja lo
  sumaría a los de un clic y la pantalla saltaría la justificación.

## ⚠️⚠️ La adopción NUNCA se gatea por saldo, y así se perdió sin que nadie lo decidiera

`AdoptarFacturaExistente` declara por escrito que no depende del recaudo: **una factura que
Siigo ya tiene existe pase lo que pase**, y traer su PDF al bloque **no emite nada**. Aun
así, el #578 se la llevó por delante — no tocando la regla, sino **sacando los casos de la
lista donde vivía el botón**.

Lección para el diseño: **quitar una fila de una lista borra TODAS las acciones de esa fila,
no solo la que se quería bloquear.** Antes de filtrar en el servidor, mirar qué más ofrece la
tarjeta. Aquí eran 27 casos, los 27 adoptables.

## ⚠️ El filtro es solo para los CANDIDATOS, y el brief nunca lo trajo

`estado_recaudo === 'retenido'` **no alcanza** para decidir a qué grupo va un caso: uno ya
**facturado** o **descartado** puede estar retenido y es un **REGISTRO**, no un candidato.
Aplicado literal, desaparecería de "Ya facturados" / "Descartados" y `totales.ya_facturados`
mentiría. Por eso el servidor expone el booleano ya resuelto (`retenido_por_recaudo`) en vez
de dejar que la pantalla combine los tres campos: ese matiz escrito dos veces es como el
contador de la bandeja y la lista se desincronizan.

**Invariante que vale la pena conservar:**
`totales.retenidos_por_recaudo.n === casos.filter(c => c.retenido_por_recaudo).length`.

## ⚠️ Mostrarlos no puede inflar la bandeja

El badge de la pestaña es `listos + incompletos`. Un retenido no entra en ninguno de los dos:
no es "le falta un dato" (eso se arregla tecleando) ni es trabajo de hoy. Contarlo devolvería
el problema original **justo por haberlo hecho visible**.

## Cifras medidas (producción SOENA, 2026-09-08, server action real)

Sobre los pendientes sin factura ni descarte, etapa > 5: **13 listos**, **3 incompletos**,
**27 retenidos** ($18.487.625 de honorarios, $13.739.219 por recaudar). Los 27 van del
**11,8%** (V0406, faltan $50.000 de $425.000) al **100%** (14 casos sin un peso pagado);
**ninguno** tiene honorario nulo o en cero, y **los 27 son adoptables**.

⚠️ El brief traía 56/27/29 y el propio #578 midió 46/18/27 unas horas antes: hay facturas
emitiéndose en el medio. Ver [[cifras-del-brief-caducan]].

**El 1% no parte ningún grupo por la mitad:** entre el 0,47% del caso en la banda y el 11,8%
del retenido más cercano no hay un solo caso. Si algún día se discute el porcentaje, se
vuelve a medir la distribución antes que a razonar.

## Dónde quedó cada cosa

- `src/lib/facturacion/caso-listo.ts` — criterio puro, banda, `razonDeRetencion`
  (monto + porcentaje, un decimal como máximo).
- `src/lib/actions/facturacion-actions.ts` — `estado_recaudo`, `banda_materialidad`,
  `retenido_por_recaudo`, `totales.retenidos_por_recaudo { n, valor, falta }`.
- `src/lib/siigo/facturas.ts` — tres ramas en el bloque del saldo, `justificacionDescuadre`,
  motivo `descuadre_de_recaudo`, marca con el faltante congelado. **El bloqueo del retenido
  en el servidor es lo que obliga a la pantalla a no ofrecer el botón**, no al revés.
- `src/app/(app)/conciliacion/conciliacion-client.tsx` — sección colapsable, contador que la
  abre, y las dos decisiones de la tarjeta como funciones puras EXPORTADAS
  (`ofreceEmitirFactura`, `ofreceAdoptarFactura`) para poder probarlas sin DOM.
- `test/cola-facturacion-doble.ts` — `sembrar` con `recaudo(i)`/`metadata(i)`/`rut(i)`, y
  `casoFalso()` para las pruebas de pantalla.

⚠️ **No hay pruebas de render en este repo:** vitest corre con `environment: 'node'` y el
`include` solo recoge `*.test.ts` — un `.test.tsx` **ni se colectaría**. Lo que se prueba de
una pantalla son funciones puras exportadas del componente, como `filtrarCasos`.

Relacionado: [[medir-antes-de-construir]], [[pruebas-por-mutacion]], [[sql-prod-one]],
[[siigo-sucursal-adopcion]].
