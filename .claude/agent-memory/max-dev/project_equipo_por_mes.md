---
name: equipo-por-mes
description: /equipo por mes ya está en main (#597 mergeado); el perfil individual va en el PR #626 sin mergear — el 4925%, el corte de la tabla, el reloj propio de la pestaña de operaciones y lo que NO se segmenta
metadata:
  type: project
---

`/equipo` (hoja por persona con ranking, workspaces con `modules.comercial_negocios`) se
segmenta por mes con el periodo en la URL (`?mes=YYYY-MM`).

- **`#597` MERGEADO** el 2026-09-09 16:35 (`d7a7ffb`): la LISTA de `/equipo`. Los cinco puntos
  de su brief están en `main`, incluido el mes propagado al enlace «Ver mi hoja».
- **`#626` SIN MERGEAR** (2026-09-10, checks verdes): el PERFIL individual
  (`/equipo/comercial/[staff_id]`). No se mergea a propósito: el brief exige QA en pantalla
  y no hay navegador ni sesión gerencial de SOENA desde la sesión.

**Why:** el resumen se pedía sin periodo (histórico completo) mientras las metas por vendedor
sí venían del mes. El cumplimiento dividía dos relojes: en SOENA una comercial mostraba
**4925%** (197 ventas de siempre sobre una meta mensual de 4). No es un adorno: es la cifra
con la que se mira al equipo comercial.

**How to apply:** antes de tocar `/equipo` o el perfil, mirar si el #626 sigue abierto. Si se
retoma el QA, los puntos que deciden son (1) que el pill `Vendidos en {mes}` dé el mismo
número que el KPI `Ventas` y (2) el cruce contra `/tableros` → Comercial del mismo mes.

## ⚠️⚠️ La premisa «esto no se ejecutó» se comprueba contra el LEDGER, no contra el brief

El brief del 2026-09-10 declaraba que el brief hermano del 09-09 **no se había ejecutado**, y
lo «verificaba» citando `main` en `a1617ca`. Ese commit es de las **13:48** y el #597 se
mergeó a las **16:35 del mismo día**: el brief se escribió contra un árbol de tres horas
antes y su verificación caducó sin que nadie lo notara. Cuesta un `gh pr view <n>` o un
`git log` comprobarlo, y evita reimplementar algo que ya está o abrir un PR que revierte.
Hermano de [[cifras-del-brief-caducan]]: acá lo que caduca no es un número, es un hecho del
repo. **Al recibir un brief que dice «esto sigue pendiente», la primera medición es si sigue
pendiente.**

## Lo que ya existía y no había que rehacer (en los dos PR)

- La RPC `get_comercial_resumen_soena(p_workspace_id, p_anio, p_mes)` **ya aceptaba** el
  periodo y `getComercialResumen(anio, mes)` ya lo pasaba: la página la llamaba en `null`.
  **Sin migración.** Antes de construir un "falta segmentar por mes", mirar la firma de la RPC.
- Igual en el perfil: `get_comercial_perfil_soena` **ya recibía** `p_anio`/`p_mes` y la página
  ya se los pasaba. El periodo solo entraba en el KPI `num_ventas` y en el honorario; el
  arreglo `negocios` salía de `FROM base` **sin filtro**, con un campo `es_venta` que la
  pantalla no usaba. O sea: el dato estaba, faltaba usarlo.

## El corte de la tabla del perfil (#626), y por qué no se reemplaza

`Vendidos en {mes}` / `Todos sus casos` son **dos preguntas distintas y las dos se usan**:
desempeño y carga de trabajo (un caso de junio que sigue abierto es suyo hoy). Detalles que
no son obvios:

- **Fase, etapa y búsqueda operan DENTRO del corte**, y sus contadores se recalculan sobre el
  subconjunto: un contador que siguiera contando el histórico mientras la tabla muestra el mes
  es el mismo defecto un nivel más abajo.
- **Al cambiar de corte se sueltan fase y etapa.** La fase elegida puede no existir en el otro
  conjunto, y entonces la tabla queda vacía **sin ningún pill que explique por qué**.
- El pill del mes y el KPI `Ventas` salen del **mismo CTE de la misma RPC** (`es_venta` ES
  `es_venta_periodo`), así que coinciden por construcción. Si no coinciden, se separaron las
  definiciones de venta: la pantalla lo dice en ámbar en vez de dejar que alguien cruce las
  cifras a mano.

## ⚠️ El drawer no abre el histórico, y no es un olvido

`get_comercial_ventas_mes_soena` filtra con `EXTRACT(YEAR FROM v.fecha_venta) = p_anio`: con
`null` devuelve **vacío**, no todo. Por eso en `?mes=acumulado` la cifra no es botón y el
histórico se alcanza navegando. Abrirlo pediría un `(p_anio IS NULL OR ...)` en esa RPC.

⚠️ **La única diferencia conocida entre lo que cuenta el KPI y lo que abre el panel** son las
**ventas en cero** (`20260903120000`): `v_venta_mes_comercial` las incluye por la puerta de
`v_negocio_bonificable` y el perfil no (exige `min(cobro.fecha)`). Fecha y atribución son
idénticas en las dos (`min(v_cobro_valor.fecha)` y `v_negocio_comercial.comercial_staff_id`).
Si el panel abre un caso de más, ese es el motivo.

## ⚠️ Un componente compartido con reloj PROPIO no se resincroniza solo

`TabOperacionesPersonas` (de `tableros/components/`) guarda su mes en `useState(inicial)` y
trae **su propio navegador de flechas**. Montado desde `/equipo`, un cambio del mes de la URL
**no lo mueve**: React reusa la instancia y el bloque se queda en el mes anterior, sin error y
sin aviso. Se resuelve con `key={\`${anio}-${mes}\`}` en `equipos-client.tsx`. Su navegador
interno sigue ahí, así que los dos selectores pueden discrepar si alguien usa el de adentro.

**Regla general:** al alimentar desde la URL un componente que ya traía estado propio,
preguntarse si se remonta. `props` nuevas no mueven un `useState` inicializado.

## ⚠️ Un selector que solo ofrece los meses CON datos esconde justo el que hay que mirar

El perfil tenía un `<select>` con los meses de `perfil.serie`, o sea **solo los meses en los
que la persona vendió**. Un mes sin ventas no se podía abrir, y ese es el que se quiere
revisar. Pasó a las flechas compartidas de `/equipo` (`selector-mes.tsx`, ahora con
`conAcumulado`/`enAcumulado`), que llegan a cualquier mes.

⚠️ De paso se cerró un hueco silencioso: un `?mes=` con basura **caía al acumulado** sin
avisar (el parseo dejaba `anio`/`mes` en `null`), así que la pantalla mostraba el histórico
mientras el usuario creía mirar un mes. Ahora se parsea con el mismo `parsearPeriodo` y solo
la palabra `acumulado` abre el histórico.

## ⚠️ Dos RPC sirven "las ventas del mes" por caminos distintos

`get_comercial_resumen_soena` cuenta negocios cuyo primer cobro (`min(v_cobro_valor.fecha)`)
cae en el mes; `get_comercial_kpis_mes_soena` cuenta filas de `v_venta_mes_comercial` con
`fecha_venta` en el mes, y atribuye por otra columna de responsable. **La tarjeta toma las
ventas del RESUMEN**, que es la misma fuente que la meta y el ranking: si tomara el KPI podría
mostrar "4 ventas" al lado de un cumplimiento calculado sobre 5, en la misma tarjeta. Y así
una discrepancia entre las dos definiciones se hace VISIBLE al cruzar con `/tableros`, que es
justo el diagnóstico que el QA busca ([[tableros-soena-olas-1-y-2]], las tres definiciones de
venta).

⚠️ El honorario recaudado tampoco es la misma pregunta en las dos: en el resumen es lo
recaudado EN el mes sobre todos los negocios; en `v_venta_mes_comercial`, lo recaudado por las
ventas HECHAS en el mes. Pueden no cuadrar sin que nada esté roto.

## Lo que a propósito NO se segmenta (en las dos pantallas)

Las RPC filtran por periodo las ventas y el honorario, pero **no** `negocios_total`,
`negocios_abiertos`, `valor_aprobado`, los contadores por stage ni el embudo por etapa del
perfil: son inventario a hoy. Se quedan como están (un caso abierto está abierto hoy, no en
agosto) **con la etiqueta diciéndolo** ("Inventario a hoy, no depende del mes"). Sin esa nota,
cambiar de mes y ver la misma cifra se lee como un tablero congelado — misma familia que el
resto de "una pantalla sana que miente" del repo.

Relacionado: [[tableros-soena-olas-1-y-2]], [[soena-ve-pipeline]],
[[render-tarjeta-negocio-aislada]], [[medir-antes-de-construir]], [[pruebas-por-mutacion]].
