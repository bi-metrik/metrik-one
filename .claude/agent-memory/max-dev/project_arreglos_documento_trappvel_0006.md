---
name: arreglos-documento-trappvel-0006
description: "#822 — cinco arreglos del PDF de Trappvel vistos en COT-2026-0006: un grupo libre borraba un vuelo del itinerario, el «·» no partía números de vuelo, el redondeo salía como cobro por el grupo; y la propuesta (sin construir) del texto que redacta ONE"
metadata:
  type: project
---

**PR [#822](https://github.com/bi-metrik/metrik-one/pull/822)** — sin migración y sin una sola
escritura a producción. Sigue a [[tres-tarifas-y-tabla-de-vuelos]] y al sistema visual (#819).

## ⚠️⚠️ Un `items.grupo` libre borra la línea del documento, aunque su lectura esté completa

COT-2026-0006: «AVIANCA BOG - ADZ» tenía la lectura entera en `tarifa_pax` y grupo
`avianca bog - adz`, que no resuelve a ninguna ranura (la gramática es `tipo [n] [: nombre]`).
`vuelosDeItems` solo preguntaba por el grupo: el vuelo se cobraba en Inversión y no salía en la
tabla ni en el día a día. **How to apply:** para saber QUÉ es una línea, el grupo manda si
resuelve; si no, `ranuraDeLectura` (etiquetas que solo una ranura declara; «Moneda»/«Precio»
no cuentan). Cualquier consumidor nuevo del detalle usa `ranuraDelItem`, no `ranuraDeGrupo`.

## Lo que se decidió y por qué

- **Números de vuelo:** la lectura los escribe con `·`, `,` o `/`. Con regreso y cantidad par,
  mitad y mitad; si no se puede saber cuál es de cuál van en `sinAsignar`, bajo el vuelo entero.
  Nunca todo en la fila de la ida: eso afirma que el regreso no tiene vuelo.
- **Redondeo por pasajero:** `precioPorPasajero` divide y redondea al peso, así que `total −
  cubierto` puede dar 2 pesos sin que nada se cobre por el grupo. Se trata como redondeo solo si
  `sinReparto` está vacío y cabe en un peso por pasajero y línea; se absorbe en la fila donde
  entra entero (c/u × cantidad sigue cuadrando). ⚠️ Con IVA > 0 y `sinReparto` vacío, la
  diferencia es el IVA y se sigue rotulando «Se cobra por el grupo» (defecto previo, no tocado).
- **«Incluido en el plan»** solo sale con `viaje.incluye` (sin llenar). ⚠️ Al quitarlo, la regla
  que pega la firma a la última sección se quedaba sin ancla: ahora arranca en `inversion`.
- **Capítulo único** cuyo nombre ya dice el título: no se imprime el nombre (`yaEstaEnElTitulo`,
  por palabras enteras, sin tildes). Con varios destinos no cambia.
- QA: `proyectos/trappvel/clarity/qa/2026-09-22_arreglos-1-5/`.

## Propuesta (NO construida): el texto que redacta ONE

Titular, intro, «Incluido» y «Antes de viajar», redactados por Gemini y corregidos por el equipo.
Recomendación entregada: columna nueva `cotizaciones.documento_cliente jsonb` (**requiere
migración**, DDL puro), panel en el editor de la cotización junto al botón PDF, redacción por
botón con `responseSchema` (patrón de `src/lib/actas/generacion.ts`), y el PDF imprime solo lo
revisado por una persona. Descartados: `observaciones_extra` (es `string[]` del camino
WeasyPrint de WMC) y un bloque `datos` (grano de negocio, sin textarea, y crear el
`bloque_configs` siembra instancias en todos los negocios que ya pasaron la etapa).

Relacionado: [[documento-cliente-trappvel]], [[tarifa-por-pasajero]], [[mirar-pdf-renderizado]],
[[pruebas-por-mutacion]].
