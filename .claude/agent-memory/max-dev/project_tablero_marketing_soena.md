---
name: tablero-marketing-soena
description: Pestaña Marketing de SOENA — qué quedó en producción, las dos decisiones que esperan el sí de Mauricio, y el hallazgo de que la atribución es LAST-touch (la spec dice first)
metadata:
  type: project
---

Pestaña **Marketing** en `/tableros`, salida de la reunión con Daniela Játiva del
2026-09-02. PRs **#509** (`72b8ff6`) y **#510** (`aa40c2a`), mergeados a `main` el
2026-09-03. Migración `20260903000001_marketing_campana` **aplicada** a producción y
registrada en el ledger con la versión del archivo.

**Why:** cierra el punto **#45** del frente de tableros, que desde el 2026-08-31 estaba
declarado en pantalla como no replicable. Daniela decide con esto qué campaña apagar.

## ⚠️⚠️ Dos cosas quedaron SIN aplicar y esperan el sí de Mauricio

1. **El módulo no está encendido.** `modules.marketing_campanas` sigue ausente en el
   workspace de SOENA, así que **la pestaña no se ve todavía**. El `update` está escrito
   y sin correr en
   `proyectos/soena/ve/migrations/PENDIENTE_20260903_modulo_marketing_campanas.sql`.
2. **La edge function `meta-insights-sync` está construida pero NO desplegada ni
   programada**, y `campana_insights` está **vacía** (0 filas). Sin ella la pestaña pinta
   leads, ventas, conversión y recaudo, y declara con un aviso que el gasto no se ha
   sincronizado — nunca un cero. Falta: `supabase functions deploy meta-insights-sync`,
   el secreto `META_INSIGHTS_SYNC_SECRET` (cae a `META_LEADS_VERIFY_TOKEN` si no existe) y
   el cron diario.

**How to apply:** desplegar y correr el sync **antes** de encender el módulo, para que la
pestaña nazca con las seis cifras y no con la mitad en raya.

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
  están en **COP**.
- **El system user lee campañas por id pero NO puede enumerar cuentas.** Consecuencia
  asumida: una campaña que nunca trajo un lead a ONE es **invisible** para el sync. Su
  gasto existe en Meta y no aparece. Cambiarlo pide `business_management`.

## Cifras del cierre (2026-09-03, ~20:40 Bogotá)

Agosto, lente Mes: **15 ventas con campaña y $7.752.685,77 recaudados**, 47 sin rastro
(62 en total). La spec decía 14 y $7.216.971: la diferencia es **V0451 (JOSE NOEL
GONZALEZ)**, cuyo cobro se registró a las 12:44 de ese mismo día. Las otras 14 suman
exacto $7.216.971,48 — el criterio es idéntico, lo que se movió fue la base.

Relacionado: [[tableros-soena-olas-1-y-2]], [[cifras-del-brief-caducan]],
[[medir-antes-de-construir]], [[sql-prod-one]].
