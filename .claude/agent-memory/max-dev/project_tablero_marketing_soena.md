---
name: tablero-marketing-soena
description: Pestaña Marketing de SOENA — el módulo YA está encendido (caducó lo contrario), el sync de Meta sigue sin correr, la atribución es LAST-touch, y el corte por ciudad del #689
metadata:
  type: project
---

Pestaña **Marketing** en `/tableros`, salida de la reunión con Daniela Játiva del
2026-09-02. PRs **#509** (`72b8ff6`) y **#510** (`aa40c2a`), mergeados a `main` el
2026-09-03. Migración `20260903000001_marketing_campana` **aplicada** a producción y
registrada en el ledger con la versión del archivo.

**Why:** cierra el punto **#45** del frente de tableros, que desde el 2026-08-31 estaba
declarado en pantalla como no replicable. Daniela decide con esto qué campaña apagar.

## ⚠️⚠️ El módulo YA está encendido, y eso cambia el riesgo de cada cambio

**Medido el 2026-09-14: `modules.marketing_campanas` está en `true` en soena**, 1 de los
17 workspaces. Esta memoria decía lo contrario hasta ese día: caducó.

Consecuencia que importa más que el dato: `getMarketingData()` vive dentro del
`Promise.all` de `src/app/(app)/tableros/page.tsx` y **esa rama NO tiene catch propio**.
Un throw suyo (una columna que no existe, una vista sin grant) **tumba `/tableros`
entero**, no solo la pestaña. Y la acción está escrita para lanzar a propósito («una
pestaña que no pudo armar sus datos DICE que falló»).

**How to apply:** cualquier PR que cambie lo que esta pestaña consulta lleva la migración
**ANTES** del merge. Al revés siempre es inofensivo: agregar una columna que nadie pide
todavía no rompe nada.

## ⚠️ El sync de Meta sigue sin correr (2026-09-14)

`campana_insights` con `sincronizado_at` **null en las 16 filas** de campaña de soena, o
sea que la edge function `meta-insights-sync` nunca ha corrido. La pestaña pinta leads,
ventas, conversión y recaudo, y el gasto / CPL / CAC / ROAS salen **con raya y un aviso**
— nunca un cero. Falta: `supabase functions deploy meta-insights-sync`, el secreto
`META_INSIGHTS_SYNC_SECRET` (cae a `META_LEADS_VERIFY_TOKEN` si no existe) y el cron
diario. Pasos en `proyectos/soena/ve/2026-09-03_activar-sync-marketing.md`.

## ⚠️⚠️ La atribución es LAST-touch, no first-touch — la spec afirma lo contrario

`v_negocio_atribucion.campana` resuelve con
`order by ci2.ocurrida_at DESC limit 1` y **no mira `custom_data.origen`**. La sección 4.2
de la spec dice que esa vista "hace mandar a `custom_data.origen` (first-touch inmutable)
sobre el derivado". Es falso: leído `pg_get_viewdef` el 2026-09-03.

**Consecuencia medida, con caso concreto:** **V0024 (DIANA GIRALDO)** se vendió el
2026-07-07 y su única interacción de Meta es del **2026-08-07** — un mes DESPUÉS. Queda
atribuida a una campaña que no existía cuando compró, y aparece como venta de julio de la
campaña de agosto.

No se tocó: la spec prohíbe tocar la atribución (tiene dueño en la tanda del 2026-09-02) y
los números de QA cuadran igual. Pero **al leer esa vista, no asumir first-touch**.

## Lo que el QA destapó y no estaba en el código

- **Una campaña puede tener un mes con nombre viejo y otro con el nombre nuevo.** Los
  meses sincronizados traen la etiqueta vigente de Meta; los no sincronizados, la foto del
  payload. Acumular "el último nombre que se cruce" etiquetaba la cohorte con el nombre que
  Daniela ya no usa. Es el PR #510.
- **Meta confirmó el renombre contra la API real:** el id `52656511383228`, que ONE guarda
  como `CLIENTES POTENCIALES AGO 2026 PLUS`, hoy se llama `CLIENTES POTENCIALES AGO
  ($100)`. Las **dos** cuentas publicitarias (`1603671527655761` y `3229968600725628`)
  están en **COP**. ⚠️ Como el sync nunca corrió, `v_marketing_campana` todavía sirve el
  nombre del **payload** («…AGO 2026 PLUS»): el nombre vigente no se ve en pantalla.
- **El system user lee campañas por id pero NO puede enumerar cuentas.** Consecuencia
  asumida: una campaña que nunca trajo un lead a ONE es **invisible** para el sync. Su
  gasto existe en Meta y no aparece. Cambiarlo pide `business_management`.

Relacionado: [[marketing-ventas-por-ciudad]], [[tableros-soena-olas-1-y-2]],
[[cifras-del-brief-caducan]], [[medir-antes-de-construir]], [[sql-prod-one]].
