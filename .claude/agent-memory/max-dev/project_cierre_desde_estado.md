---
name: cierre-desde-estado
description: PR #609 (2026-09-10) — el desenlace se deriva de `estado` y `cierre_motivo` queda retirada; por qué el mapa es una lista CERRADA (los 2 `activo`), y los dos consumidores que a propósito NO se tocaron
metadata:
  type: project
---

**PR #609**, sin mergear al cierre (los 6 checks en verde, sin migración y sin escrituras
a producción). Cierra el cambio 3 que el **#607** dejó abierto, por el camino contrario:
`cierre_motivo` no se puebla, **se deja de leer**.

El mapa vive en `src/lib/negocios/motivo-cierre.ts` (`motivoCierreDeEstado`) y lo consumen
la columna «Cierre» del Excel, los tres chips de la pestaña Cerrados y el rótulo de la
tarjeta.

## ⚠️⚠️ El criterio es una LISTA CERRADA de tres estados, no `estado !== 'abierto'`

Y no es teórico: en producción hay **2 negocios con `estado = 'activo'`** (workspace
`metrik`, los dos con `closed_at` NULL, medido 2026-09-10). Con el criterio laxo se les
inventa un desenlace.

**Eso destapó una incoherencia que ya existía**: `faseDeNegocio` **sí** usaba
`estado !== 'abierto'`, así que esos 2 bajaban al Excel con Fase «Cerrado» **y la columna
«Cierre» vacía** — dos celdas del mismo archivo contradiciéndose. Se alineó en el mismo
PR (extra declarado en el cuerpo, con su alcance medido: solo esos 2, ninguno de SOENA).

**How to apply:** al derivar un veredicto de una columna de estado, enumerar los valores
que lo producen y **medir qué otros valores existen de verdad en la base**. Un
`!== 'default'` trata como caso conocido todo lo que aún no se ha visto.

## ⚠️ Lo que NO se tocó, y por qué NO es descuido

`negocios/[id]/page.tsx` sigue leyendo `cierre_motivo` en dos sitios:

- el **banner de cierre** de la ficha (`negocioCerrado = cierre_motivo !== null`), y
- el gate de conciliación (`modules.conciliacion && !negocioCerrado`).

Encender el banner activaría el botón «Reabrir», y `reabrirNegocio`
(`src/lib/actions/reapertura.ts`) **corta antes** con «Solo se pueden reabrir negocios
cerrados» porque exige `stage_actual = 'cerrado'` — el mismo stage que este producto nunca
alcanza. Sería ofrecer una acción que la server action rechaza.

**Consecuencias vivas, medidas:** el banner solo aparece en los 5 negocios de `metrik`; y
**SOENA es el único workspace con `modules.conciliacion`** (medido 2026-09-10), así que sus
33 cerrados siguen ofreciendo «Registrar pago». Es decisión de producto, no del PR.

## Decisiones del PR que no se deducen del código

- **`cierre_motivo` sale de `NegocioResumen`, de su `select` y de `NegocioExportable`.**
  Retirar el campo del tipo es lo que impide reintroducirlo por descuido: cualquier intento
  de volver a leerlo en la lista no compila.
- **La celda va vacía en un abierto aunque arrastre `razon_cierre`.** Hoy no hay ni un
  `abierto` con razón en toda la base, pero una reapertura puede dejarlo así, y decir
  «Perdido» de uno vivo es peor que no decir nada. Va como caso latente en la prueba.
- **Los cerrados se siguen reconociendo por el ORIGEN del arreglo** (`idsCerrados` en
  `negocios-client.tsx`), no releyendo `estado`: la prop la llenó `getNegociosV2('cerrado')`
  y así no se puede desincronizar de la consulta.

## Método: la prueba de render era obligatoria

`negocios-chips-cierre-render.test.ts` monta **`NegociosClient` entero** con
`renderToStaticMarkup` y solo dos dobles (`./negocio-card` reemplazado por su código, y
`./descargar-excel-button`). Nada más hace falta: `useEstadoUrl` es `useState` puro en el
servidor y los filtros iniciales entran por la prop `searchParams`, así que la pestaña y el
chip se fijan desde ahí (`{ fase: 'cerrados', cierre: 'perdido' }`).

**6 mutaciones medidas, las 6 caen.** La que enseña algo: comparar `n.estado === m` en el
chip solo tumba **«Exitosos»**, porque es el único de los tres donde el estado y la
etiqueta difieren (`completado` ≠ `exitoso`). Un fixture con solo perdidos y cancelados
habría dado verde con el criterio equivocado.

**Cifras SOENA, medidas al empezar y RE-MEDIDAS al cerrar, idénticas** (ws `7dea141d`):
411 abiertos sin pausar, 17 completados / 11 perdidos / 5 cancelados = 33 con `closed_at`.
Los 17 completados **no** tienen `razon_cierre`; los 16 restantes sí. La columna «Cierre»
pasa de 16 celdas llenas de 33 a 33.

**Sin QA en pantalla:** nadie abrió el preview. Pasos en el cuerpo del PR.

Relacionado: [[todos-incluye-cerrados]], [[descarga-excel-negocios]],
[[pruebas-por-mutacion]], [[cifras-del-brief-caducan]], [[sql-prod-one]].
