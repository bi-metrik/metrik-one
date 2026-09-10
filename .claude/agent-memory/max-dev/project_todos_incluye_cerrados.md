---
name: todos-incluye-cerrados
description: PR #607 (2026-09-10, mergeado) — "Todos" pasa a listar cerrados; por qué escribir `cierre_motivo` es IMPOSIBLE (CHECK contra `stage_actual`) y el SLA que seguía corriendo en los cerrados. Su cabo suelto lo cerró el #609
metadata:
  type: project
---

**PR #607**, mergeado (`9eeebbf`), sin migración y sin escrituras.
La pestaña **Todos** de `/negocios` pasa a ser abiertos + cerrados, y la lista de cerrados
se pide con `getNegociosV2('cerrado')` → `estado in ('completado','perdido','cancelado')`.

## ⚠️⚠️ `cierre_motivo` NO se puede escribir desde el código, y el backfill tampoco

El brief pedía que los cierres por éxito escribieran `cierre_motivo = 'exitoso'`. **Merged
tal cual, ningún negocio del producto habría podido cerrar.** Lo impide
`negocios_cierre_motivo_coherente` (`20260520000003`):

```sql
CHECK ((stage_actual =  'cerrado' AND cierre_motivo IS NOT NULL)
    OR (stage_actual <> 'cerrado' AND cierre_motivo IS NULL))
```

Y **los cierres de este producto no mueven el stage**: `completarNegocio`,
`cerrarNegocioSiQuedaResuelto` y el cierre automático escriben `estado='completado'` y dejan
el negocio parado donde está. En SOENA la etapa de cierre es **Facturación, stage `cobro`**,
y su línea **no tiene ni una etapa con stage `cerrado`** (19 activas, medido 2026-09-10). O
sea: `23514` y el negocio no cierra.

El camino de cierre automático fallaba distinto y **mudo**: ahí el cierre viaja en el MISMO
update que `etapa_actual_id`, así que `trg_sync_negocio_stage_from_etapa` (`20260520000009`,
BEFORE UPDATE **OF etapa_actual_id**) corre antes y hace `NEW.cierre_motivo := NULL` cuando
el destino no es stage `cerrado`. Update exitoso, motivo perdido, cero error.

**La prueba que lo cierra, y es barata:** en TODA la base hay **5 filas** con
`cierre_motivo` no nulo y **las 5** tienen `stage_actual='cerrado'`. Si el CHECK estuviera
muerto habría filas con valor y otro stage.

**✅ Cerrado el 2026-09-10 por el camino contrario, en el PR #609: `cierre_motivo` no se
puebla, se deja de leer.** El desenlace se deriva de `estado`
(`src/lib/negocios/motivo-cierre.ts`), así que el backfill y la migración del CHECK ya no
hacen falta. Detalle en [[cierre-desde-estado]].

Lo que era «consecuencia abierta» y ya no aplica: el backfill que iba a correr Mauricio
(`UPDATE … SET cierre_motivo='exitoso' …`), y que `perderNegocio` / `cancelarNegocio`
tampoco escriban la columna. Los tres chips de motivo cuentan y filtran desde `estado`.

**How to apply:** antes de escribir una columna que hoy está NULL en el 100% de las filas,
buscar el CHECK que la gobierna (`grep -rn "<columna>" supabase/migrations/`). Un NULL
universal casi nunca es olvido: suele ser una restricción haciendo su trabajo.

## ⚠️ El SLA seguía corriendo en los cerrados (y el brief pedía "verificar", no arreglar)

`sla_exceso_horas` se calcula contra `ahora` y nada excluía a los cerrados. **Medido: los 33
cerrados de SOENA están parados en etapas CON `sla_horas`** (Facturación 120 h, Cita 168 h,
Validación 24 h, Propuesta 72 h) y con `etapa_cambiada_at` poblado → los 33 daban atraso
positivo. En "Todos" habrían salido **primeros** en «Más atrasado» (el más viejo arriba),
habrían inflado el contador de atrasados y habrían bajado al Excel con un reloj parado hace
meses. Cortado en la única fuente: `slaHorasVigentes(estado, config_extra)` en
`horas-habiles.ts`.

## ⚠️ La tarjeta reconocía un cerrado por `cierre_motivo`, que nunca tiene valor

`isCerrado = negocio.cierre_motivo !== null` → **false en todo cierre real**. Un cerrado se
pintaba con su pill de etapa (`OPERACIONES › E13 Cita`), su fecha de llegada, su chip de cita
y el aviso rojo de atención inmediata: idéntico a uno abierto. Pasa a `estado !== 'abierto'`.
La prueba de render se vio caer con el criterio viejo, y el HTML del fallo es la mejor
descripción del defecto.

## Decisiones del PR que no se deducen del código

- **`'completado'` conserva su significado literal**; el valor nuevo es `'cerrado'`. Los dos
  llamadores (`negocios/page.tsx` y `api/negocios/export`) tienen que pasar EL MISMO valor:
  lo que la ruta no encuentre en su mapa se cae del Excel en silencio.
- **Las fases de stage siguen siendo solo abiertos.** Un cerrado conserva el `stage_actual`
  que tenía al salir (hay cerrados con stage `venta`), y contarlo en Venta diría que sigue
  ahí. Hay una prueba de control que pasa en ambas direcciones a propósito.
- **Los cerrados van en un grupo propio al FINAL, dentro de `grupos`**, no al margen: el
  Excel baja `grupos.flatMap(g => g.items)`, así que un cerrado pintado por fuera se vería
  en pantalla y no bajaría al archivo — la misma pérdida silenciosa que el PR viene a
  corregir. Vive en `src/lib/negocios/agrupar-con-cerrados.ts`.
- **Quién es cerrado se decide por el ORIGEN de la fila** (pertenencia al arreglo `cerrados`),
  no por un campo derivado: no puede desincronizarse de la consulta.
- **Lo que NO se tocó:** `seccionalesDisponibles` y `responsablesDisponibles` se siguen
  armando solo con los abiertos, así que un responsable que solo tenga cerrados no aparece
  en el desplegable. (`origenesDisponibles` sí los incluye desde antes.)

**Cifras medidas contra producción el 2026-09-10** (SOENA, ws `7dea141d`): 411 abiertos sin
pausar + 33 cerrados = **444**; los 33 se reparten 17 completados / 11 perdidos / 5
cancelados, los 33 con `pausado=false` y `cierre_motivo` NULL. Coinciden con el brief.

**Sin QA en pantalla:** nadie abrió el preview. Pasos en el cuerpo del PR.

Relacionado: [[descarga-excel-negocios]], [[cifras-del-brief-caducan]],
[[pruebas-por-mutacion]], [[sql-prod-one]].
