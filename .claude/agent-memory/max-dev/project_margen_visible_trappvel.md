---
name: margen-visible-trappvel
description: PR #682 mergeado — la migración de umbrales sigue SIN aplicar (por diseño, el código la tolera), el rastro de margen está VACÍO en producción, y la única cotización de trappvel congeló markup
metadata:
  type: project
---

**PR [#682](https://github.com/bi-metrik/metrik-one/pull/682) mergeado el 2026-09-14**
(squash `327866a2`), 5 checks verdes. Paso 1 de los 7 del motor de cotización de
Trappvel (`proyectos/trappvel/clarity/docs/diseno/motor-cotizacion.md`, §9).

**Why:** en 12 meses Trappvel cerró viajes al 3,1% y uno con pérdida de -6,5% porque el
margen no se veía mientras se cotizaba.

**How to apply — lo que hay que verificar antes de construir encima:**

⚠️⚠️ **La migración `20260914160000_cotizaciones_umbrales_margen.sql` está en `main` y
NO aplicada.** DDL puro: `cotizaciones.piso_margen_pct` y `aviso_margen_pct`, anulables.
**El código la tolera a propósito** — `insertarCotizacionTolerante`
(`src/lib/cotizaciones/congelar-umbrales.ts`) reintenta el insert sin esas columnas ante
un `42703`, con `console.warn`. Mientras no se aplique, **nada se congela** y todo cae a
la política vigente de la línea. Esa pieza lleva escrita su fecha de defunción: se borra
cuando la migración esté aplicada. Comprobar el estado real antes de asumir cualquiera de
los dos mundos.

⚠️ **Las TRES vías que crean una cotización tienen que pasar por ese helper**
(`createCotizacionDetalladaNegocio`, `duplicarCotizacionNegocio`, `duplicarCotizacion`).
En la primera pasada `duplicarCotizacion` —el botón del editor— escribía las columnas de
frente y sin la migración **duplicar habría dejado de funcionar**. Si aparece una cuarta
vía, misma regla.

⚠️⚠️ **El rastro de margen está VACÍO en producción.** Medido el 2026-09-14 por PostgREST:
`activity_log` con `campo_modificado = 'margen_porcentaje'` → **0 filas en los 17
workspaces**. `registrarCambioDeMargen` lo escribe bien; nadie había usado margen por
línea todavía. «El dato ya está en base» era cierto como mecanismo y falso como hecho.
El panel nuevo (`rastro-margen-panel.tsx`) solo puede mostrar lo que pase de ahí en
adelante. **Se re-mide antes de citarlo.**

⚠️ **El rastro cuelga del NEGOCIO, no de la cotización**: `activity_log` no tiene
`cotizacion_id`. El panel cubre todas las cotizaciones del mismo negocio y lo dice.
Filtrar por nombre de ítem sería peor — se repiten entre variantes del mismo viaje.

⚠️ **La única cotización que existe en trappvel (`COT-2026-0001`, borrador) congeló
`convencion_margen: 'markup'` y `margen_default_pct: null`.** Nació antes de que la línea
«Viaje a medida» declarara su `config_extra.margen`. Abrirla da **1.150.000** para un
costo de 1.000.000 al 15%, no 1.176.471. Eso es la congelación funcionando, no un
defecto: para ver 1.176.471 hay que crear una cotización NUEVA. Los 3 negocios de
trappvel sí resuelven `{sobre_venta, default 15, piso 5, aviso 10}` por
`politicaMargenDelNegocio`.

**Dónde viven los umbrales:** `lineas_negocio.config_extra -> margen -> {piso_pct,
aviso_pct}`, junto a `convencion` y `default_pct`. Se descartó una columna en
`workspaces` porque la pregunta es de la LÍNEA (viajes a medida al 5%, corporativo al
12%) y partir la familia crea una segunda regla de precedencia. Editables en
**Configuración → Margen mínimo** (owner/admin).

**Dos defectos de duplicación corregidos de paso, que valen para cualquier tabla con
política congelada:** ninguna de las dos vías copiaba `convencion_margen` (la copia caía
al default `markup` y cambiaba el precio), y los ítems se duplicaban con
`margen_porcentaje ?? 0` — convirtiendo «hereda» en «excepción al 0%», o sea la copia
entera vendida a costo.

~~**Hoy NADA bloquea.** El piso solo pinta rojo; el rechazo en servidor llega en el paso 2,
con los itinerarios.~~

⚠️ **CADUCÓ el 2026-09-14 con el PR #684.** El piso YA rechaza en servidor, pero **solo
sobre itinerarios** (`marcarEnPropuesta` / `marcarPrincipal`). Sobre una cotización sin
itinerarios sigue sin bloquear nada: ahí el piso pinta rojo y la cotización se envía
igual. Detalle en [[itinerarios-cotizacion]].

Relacionado: [[cotizacion-margen-rubros]], [[nombre-cotizacion-variantes]],
[[pruebas-por-mutacion]], [[medir-antes-de-construir]].
