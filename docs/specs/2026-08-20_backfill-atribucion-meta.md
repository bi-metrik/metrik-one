# Spec — Backfill de atribución de campaña en los leads de Meta

**Owner de código:** Max · **Diagnóstico:** Mik (sesión SOENA S12, 2026-08-20)
**Estado:** construido en `fix/backfill-atribucion-meta`. Corrido en dry run; la escritura real espera el sí de Mauricio.

## El hecho

De los 478 leads de Meta de SOENA (workspace `7dea141d-d4da-483d-a78d-b14ef35500c5`),
**las 478 traen `payload->>'ad_id'`**, o sea todas vinieron de un anuncio. Pero
**350 tienen `campaign_id` en NULL**, y con ellas se cae cualquier lectura por campaña.

## Por qué pasaba, y por qué dejó de pasar solo

`meta-leads-webhook/index.ts:383` pide a la Graph API:

```
field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,created_time,platform
```

Cuando el token no tiene permiso sobre la cuenta publicitaria dueña del anuncio,
**Meta omite `campaign_*` y `adset_*` sin devolver error**. Respuesta 200, JSON válido,
menos dato adentro. Fallo mudo de manual: no hay nada en los logs que delate la pérdida.

El 2026-08-18 12:11 Bogotá SOENA concedió acceso a su cuenta publicitaria
**`SOENA (MK)`, id `3229968600725628`**. El corte se ve exacto en producción:

| Fecha | Leads | Con campaña |
|---|---|---|
| 11 al 17 ago | 90 | 0 |
| 18 ago | 7 | 4 |
| 19 y 20 ago | 17 | 17 |

**Hacia adelante ya quedó arreglado sin tocar código.** Lo que falta es el pasado.

## Lo que se puede recuperar

Las 350 filas conservan su `leadgen_id` en `fuente_ref` y **ninguna se ha salido de la
ventana de retención de Meta** (la más antigua es del 2026-07-08). Volver a pedirlas a
la Graph API, ahora con el acceso puesto, devuelve la campaña que les falta. Es media
julio y casi todo agosto de SOENA recuperando su atribución.

## Contrato de la función

`supabase/functions/meta-leads-backfill/index.ts`, de un solo uso.

**Auth:** patrón de `cardumen-cron` (secreto interno verificado dentro de la función, sin
JWT de Supabase) y su bloque en `supabase/config.toml` con el comentario que explique por
qué. Secreto preferido `META_LEADS_BACKFILL_SECRET`; si no se puede crear con el CLI,
reusar `META_LEADS_VERIFY_TOKEN` y dejar escrito en el encabezado por qué se reusó.

**Cuerpo:** `{ dry_run?: boolean (default TRUE), limite?: number, workspace_id?: string }`.
Sin `workspace_id` procesa todos los workspaces, con el resumen desglosado por workspace.

**Selección:** `fuente='meta'` y `payload->>'campaign_id'` is null y `fuente_ref` not null,
ordenado por `ocurrida_at` ASC. Primero las más viejas, que son las que están más cerca de
caducar.

**Por fila:** Graph GET `/{leadgen_id}?fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,form_id,created_time`
con `META_LEADS_SYSTEM_TOKEN` y la misma `GRAPH_VERSION` del webhook.

**Merge conservador:** solo escribe las claves hoy en null que Graph devolvió con valor.
**Nunca toca `field_data`.** Agrega `payload.backfill = { en: <iso>, version: 1 }` para
dejar la fila auditable y que un segundo pase sea idempotente.

## Clasificación de resultados (el punto del ejercicio)

- `actualizado`
- `sin_campana_en_meta` — Graph respondió 200 sin campaña **y el lead no tiene `ad_id`**:
  no vino de un anuncio, no hay campaña que buscar, la fila ya está correcta
- `campana_oculta_por_permiso` — Graph respondió 200 sin campaña **pero el lead sí tiene
  `ad_id`**: vino de un anuncio, así que por definición tiene campaña, y que Meta no la
  entregue significa que el token sigue sin permiso sobre esa cuenta publicitaria
- `error_graph` — guarda `code` y `message` tal cual, sin resumir
- `rate_limit` — codes 4, 17, 32, 613. No es fallo del lead sino del ritmo al que
  preguntamos: corta la corrida en vez de marcar filas como perdidas

**Los dos primeros son el punto de todo esto.** La misma respuesta de Meta, un 200 sin
campaña, significa dos cosas opuestas según haya `ad_id` o no. Meterlas en el mismo balde
sería repetir desde adentro el fallo mudo que este backfill viene a reparar: quedaría un
conteo tranquilizador de "leads sin campaña" tapando un permiso que todavía falta.

## Operación

Concurrencia máxima 5, pausa corta entre tandas. Ante rate limit repetido, corta y reporta
cuántas quedaron sin procesar: nada de truncar en silencio.

Respuesta JSON con conteos por categoría, desglose por workspace y hasta 10 ejemplos de
error. En dry run además una muestra de 5 pares `leadgen_id -> campaign_name` que sí se
escribirían.

## Gate

Type check, lint y build en verde. PR abierto. **No mergear.** Desplegar la función (es
inofensiva: por defecto no escribe) y correr **solo el dry run** contra producción. La
escritura real toca datos de producción y la autoriza Mauricio con los números a la vista,
según `.claude/rules/branch-workflow-one.md`.

## Pendiente que sale de aquí

Con la cuenta publicitaria accesible se destraba lo que ONE hoy no puede calcular: **no
existe ninguna tabla que guarde inversión en pauta**. Sin gasto no hay costo por lead ni
costo por lead calificado, que es justo lo que pidió el equipo comercial de SOENA el
2026-08-10. Es otra spec.
