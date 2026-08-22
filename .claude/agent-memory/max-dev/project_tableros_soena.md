---
name: tableros-soena-olas-1-y-2
description: Frente de tableros de SOENA — qué entregaron las olas 1 y 2, las CUATRO migraciones que siguen sin aplicar, y los huecos abiertos que deciden plata
metadata:
  type: project
---

Frente de TABLEROS de SOENA (sección 3 del inventario), en dos olas:

- **Ola 1** — PR **#357**, mergeado a `main` como `bd40d93` el 2026-08-22. Puntos 21, 23, 25, 27, 35, 41.
- **Ola 2** — PR **#366** (`feat/tableros-soena-ola-2`), 6 checks verdes, **sin mergear**.
  Puntos 13, 22, 31, 42, 43, 46.

**Why:** el bono de operaciones de SOENA se liquida con estos indicadores y el tablero
comercial decide comisiones. Un indicador mal medido no es un bug de pantalla: es plata mal
repartida sobre un mes ya trabajado.

**How to apply:** antes de tocar cualquier punto de la sección 3 del inventario
(`proyectos/soena/ve/2026-08-10_inventario-pendientes-soena.md`), leer primero las tablas
"Tableros — primera ola" y "— segunda ola" del `CONTEXT.md` del frente, que son el
registro vivo. La numeración 1-79 no se renumera nunca.

## ⚠️⚠️ CUATRO migraciones escritas y NINGUNA aplicada

**El código se mergeó y desplegó antes de aplicar las migraciones**, y eso dejó media
pestaña Comercial inerte en producción sin ruido: el front llama
`get_comercial_origen_mes_soena` y `get_comercial_perdidos_mes_soena`, que **no existen
en la base** (verificado el 2026-08-22, después del merge de #357). Las rutas de error
devuelven `[]`/`null`, así que la pantalla calla en vez de fallar.

Orden de aplicación: `20260822000001`, `20260822000002`, `20260823000001`,
`20260823000002`, y **después** las dos de configuración de la línea en
`proyectos/soena/ve/migrations/` (`venta_bonificable`, `capacidad`), que son las que
encienden lo nuevo.

**Corolario general: mergear y desplegar NO aplica las migraciones.** Cuando un PR trae
RPC nuevas o cambia firmas, la migración va **antes** del merge.

## Las tres definiciones de "venta", ya separadas (#13)

Medido jul/ago 2026: **45/44/45** y **38/33/35** para venta (entró dinero) · honorario
cubierto · bonificable (pasó Documentación). **No se contienen entre sí.** La bonificable
se prueba por **evidencia de haber visitado una etapa posterior**, no por dónde está el
caso hoy: por posición actual, 2 casos de julio que retrocedieron dejarían de bonificar.

El cambio de métrica del ranking (#31) **no movió el podio** en ninguno de los dos meses.

## Dos defectos de plata que aparecieron MIDIENDO, no leyendo código

1. **El leaderboard contaba plata de terceros como honorario del comercial.**
   `get_comercial_resumen_soena` sumaba `cobros.monto` crudo con un filtro
   `tipo_cobro <> 'pasante'` que **no filtra nada** — cero filas con ese tipo en toda la
   base. Agosto: **$45,3M mostrados contra $20,0M reales**, $25,3M de tarifa UPME. El
   corregido cuadra exacto con el panel de KPIs; el viejo no cuadraba con nada.
   **Un filtro sobre un valor que nadie escribe se lee como si filtrara.**
2. **`min(negocio_bloques.created_at)` NO sirve como "el caso entró a la etapa".** Da
   149 entradas a Certificación en julio contra 31 del `activity_log`, porque
   `sembrar_casillas_al_crear_bloque` crea instancias **en lote**: 168 negocios el
   10-ago y 119 el 30-jul, en un día cada uno. Eso es una migración, no trabajo operativo.

## Huecos abiertos que deciden dinero

1. **14 negocios con promotor declarado y rastro de Meta** (20% a terceros contra 16% de
   marketing). La ola 2 los marca con `comision_retenida` y **no liquida**. De los 14,
   **9 siguen sin honorario aprobado**, así que la plata viva son 4 casos por $2.321.428
   sin IVA — $92.857 en juego. ⚠️ El flag genérico `atribucion_en_conflicto` marca **47**,
   no 21 ni 14: el inventario cita 21, que es solo una de sus dos ramas.
2. **96 de 289 negocios sin seccional.** En las ventas de agosto ese bucket es el **más
   grande** (16 de 38, $7,9M), por encima de Bogotá (9).
3. **`reproceso_eventos` está VACÍA** (0 filas); en `metadata.reproceso` hay 1 marca y es
   de `devolucion_dian`. Por eso la serie "certificados con error" (#43) no se dibuja.
4. **97 filas de `negocio_responsables` con `rol` NULL** (deuda #57). Invisibles para el motor.

## Confirmado con el cliente (2026-08-22)

- **Hora hábil**: día = 24 h, sábado y domingo no hábiles, festivos de `festivos_colombia`.
  El default de la ola 1 se queda. Pendiente aparte: sembrar festivos más allá del 2027-12-25.
- **Corte geográfico**: **seccional DIAN tal cual**; descartado agrupar en las 5 regiones de JD.
- **Venta bonificable (#13) = pasó Documentación.** NO cambia la definición de venta (#12).
- **Los 14 conflictos se revisan a mano.** No inventar una regla que reparta plata.

## El inventario y el encargo se desincronizan en LAS DOS direcciones

Ya estaba documentado que el inventario declara abiertos puntos hechos (#25, #27, #35 en
la ola 1 — tres de seis). En la ola 2 pasó **al revés**: el brief pedía "marca cerrado el
#27, que el inventario todavía da por abierto" y el inventario **ya lo tenía ✅**, cerrado
por la ola 1 ese mismo día. **Comprobar el estado en el archivo antes de actuar sobre lo
que afirma el encargo**, en cualquiera de los dos sentidos.

Relacionado: [[soena-ve-pipeline]], [[casillas-gate-faltantes]], [[sql-prod-one]],
[[medir-antes-de-construir]].
