---
name: equipo-por-mes
description: PR #597 (sin mergear) segmenta /equipo por mes — el 4925% que lo motivó, lo que a propósito NO se segmenta, y la trampa del estado propio de la pestaña de operaciones
metadata:
  type: project
---

`/equipo` (hoja por persona con ranking, workspaces con `modules.comercial_negocios`) pasa a
segmentarse por mes con el periodo en la URL (`?mes=YYYY-MM`). **PR #597, checks verdes, SIN
MERGEAR** a propósito: el brief exige QA en pantalla antes del merge y no se pudo hacer desde
la sesión (sin navegador ni sesión gerencial de SOENA).

**Why:** el resumen se pedía sin periodo (histórico completo) mientras las metas por vendedor
sí venían del mes. El cumplimiento dividía dos relojes: en SOENA una comercial mostraba
**4925%** (197 ventas de siempre sobre una meta mensual de 4). No es un adorno: es la cifra
con la que se mira al equipo comercial.

**How to apply:** antes de tocar `/equipo` o de dar el frente por cerrado, mirar si el #597
sigue abierto. Si se retoma el QA, los dos puntos que importan son (1) que el 4925% aterrice
y (2) el cruce contra `/tableros` → Comercial del mismo mes.

## Lo que ya existía y no había que rehacer

- La RPC `get_comercial_resumen_soena(p_workspace_id, p_anio, p_mes)` **ya aceptaba** el
  periodo y `getComercialResumen(anio, mes)` ya lo pasaba: la página la llamaba en `null`.
  **Sin migración.** Antes de construir un "falta segmentar por mes", mirar la firma de la RPC.
- **El perfil (`/equipo/comercial/[staff_id]`) ya leía `?mes=` y ya pedía su resumen por
  periodo desde antes.** O sea que el precedente de esta decisión estaba a un archivo de
  distancia: la lista era la única que hablaba en histórico. Propagarle el mes al enlace
  "Ver mi hoja" fue una línea.

## ⚠️ Un componente compartido con reloj PROPIO no se resincroniza solo

`TabOperacionesPersonas` (de `tableros/components/`) guarda su mes en `useState(inicial)` y
trae **su propio navegador de flechas**, porque en Tableros ese reloj es suyo. Montado desde
`/equipo`, un cambio del mes de la URL **no lo mueve**: React reusa la instancia y el bloque
de operaciones se queda en el mes anterior mientras el resto de la pantalla ya cambió, sin
error y sin aviso. Se resuelve con `key={\`${anio}-${mes}\`}` en `equipos-client.tsx`, que lo
remonta sobre los datos del mes elegido. Su navegador interno sigue ahí (es del componente
compartido, fuera del perímetro), así que los dos selectores pueden discrepar si alguien usa
el de adentro.

**Regla general:** al alimentar desde la URL un componente que ya traía estado propio,
preguntarse si se remonta. `props` nuevas no mueven un `useState` inicializado.

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

## Lo que a propósito NO se segmenta

La RPC filtra `num_ventas`, `num_bonificables` y `honorario_recaudado`, pero **no**
`negocios_total`, `negocios_abiertos`, `valor_aprobado` ni `en_venta/en_ejecucion/en_cobro/
cerrados`: son inventario a hoy. Alimentan los bloques **"Casos que llevan los líderes"** y
**"Sin responsable"**, que se quedan como están (un caso abierto está abierto hoy, no en
agosto) **con la etiqueta diciéndolo** ("Inventario a hoy: no depende del mes seleccionado",
"N activos hoy"). Sin esa nota, cambiar de mes y ver la misma cifra se lee como un tablero
congelado — misma familia que el resto de "una pantalla sana que miente" del repo.

Relacionado: [[tableros-soena-olas-1-y-2]], [[soena-ve-pipeline]], [[probar-render-sin-dom]],
[[medir-antes-de-construir]].
