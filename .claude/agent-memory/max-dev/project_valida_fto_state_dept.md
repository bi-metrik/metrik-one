---
name: valida-fto-state-dept
description: La FTO del State Dept en metrik-valida — PR #33 mergeado y la lista ACTIVA en produccion (6 fuentes SARLAFT), y PR #34 abierto que sube el alcance a v1.4; que quedo abierto de la migr. 0013 y por que la privacidad NO se toca
metadata:
  type: project
---

## Estado al 2026-09-10

- **PR #33 mergeado** (`main` = `c1c3d94`). La **parte B de `0031` SI esta aplicada**: la lista
  `state_dept_terror` esta **activa** en produccion. Medido sin credenciales, leyendo las paginas
  publicas de `app.valida.metrikone.co`: el catalogo vivo devuelve **6 fuentes SARLAFT**
  (`onu_consolidated`, `csn_colombia`, `pep_colombia`, `ofac_sdn`, `eu_consolidated`,
  `state_dept_terror`) mas 2 de Diligencia (`siri_procuraduria`, `secop2_multas`).
- La certificacion de **2026-09** dice **6 fuentes activas**, 64.411 entradas, y la fila de la FTO
  sale con **99 entradas**, tier Referencia, version vigente del 10-sep y **fuente publicada el
  16-jul-2026**.
- **PR #34 YA MERGEADO** (verificado el 2026-09-10 al abrir el #36: `origin/main` = `46ffb8c`,
  que es el merge del #35; `lib/catalogo/fuentes-sarlaft.ts` existe en main). Ejecuto la
  **condicion 3** del visto de Emilio. Tambien entro el **#35**, que generalizo el guardrail
  de version a los **siete pares** pagina/PDF, incluida la Politica Habeas Data.

## Lo que hace el #34 y por que

- **`lib/catalogo/fuentes-sarlaft.ts` (nuevo) es la UNICA copia** de la enumeracion de fuentes para
  los documentos de prosa fija. El alcance de listas (pagina + PDF), la landing y la guia del
  integrador la importan; el conteo ("seis (6) listas activas"), las frases por tier y las celdas
  de las tablas se **derivan**, no se teclean. Donde se puede leer el catalogo vivo (certificacion,
  cobertura de la landing) se sigue leyendo el catalogo.
- El **alcance de listas sube a v1.4** en el PDF y en la pagina **a la vez**: la prueba
  `alcance-publicado.test.ts` exige que las tres declaraciones de version coincidan (portada del
  PDF, encabezado del PDF, hero de la pagina).
- Guardrail nuevo, 3 casos: una ficha por fuente y ni una mas (cuenta `<ListaCard`); la
  enumeracion no se teclea (import obligatorio + regex que caza conteos a mano); y **la
  certificacion mensual sigue leyendo `activa = true` + `modulo = 'sarlaft'`**, que es lo unico que
  sostiene la paridad con la base desde una prueba sin red.

## Lo que NO se toca, con su razon

- **⚠️ La politica de privacidad NO enumera la FTO.** Las 99 entradas son `tipo = juridica`, cero
  personas naturales: meterla en el inventario del art. 3 lit. c de la Ley 1581 declararia un
  tratamiento de datos personales que no existe. Decision de Lucia, no un olvido.
- **El diccionario y el manual** donde dicen "(ONU, CSN Colombia)": son ejemplos de **Tier 1** y
  siguen correctos.

## Condiciones que siguen abiertas

- **Condicion 1 (Kaori):** la regla canonica `cerebro/reglas/valida-alcance-normativo.md` todavia
  describe 5 listas. Los tres reemplazos literales estan escritos en
  `proyectos/metrik/valida/docs/entrega/condiciones-1-3-activacion-fto.md`.
- **⚠️ La deduplicacion que exigio la migr. 0013 NO se implemento.** Hoy es inocua porque esta
  lista no tiene personas naturales. **No se activa ninguna otra fuente Tier 3 con personas
  naturales sin resolverla antes.**
- Escalamiento abierto a Emilio: si un cliente archivo una certificacion con cinco fuentes y luego
  una con seis, ¿hace falta nota al pie? Criterio de Lucia: no, si el alcance queda versionado.

## Suelto que salio en el camino

- **⚠️ El pie de pagina de `pdf-listas.tsx` no se imprime** (ni el texto ni la paginacion). Igual en
  `main` que en la rama, asi que es anterior y no lo introdujo el #34, pero esta ahi.
- La ficha de la FTO en la **pagina** cae bajo la etiqueta compartida "Volumen **aproximado**" con
  el valor "99 organizaciones vigentes", que es exacto. Etiqueta compartida, no se toco.

Relacionado: [[sql-y-publicacion-metrik-valida]], [[publicar-otro-repo-desde-worktree-aislado]],
[[mirar-pdf-renderizado]].
