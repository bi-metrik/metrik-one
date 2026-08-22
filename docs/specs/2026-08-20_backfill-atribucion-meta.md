# Spec — Backfill de atribución de campaña en los leads de Meta

**Owner de código:** Max · **Diagnóstico:** Mik (sesión SOENA S12, 2026-08-20)
**Estado:** ✅ **HECHO.** PR #329 mergeado a `main` y el backfill **ejecutado de verdad** el
2026-08-20, en dos tandas de 30 y 320 filas (13:49 y 13:50, hora de Bogotá) — las 350 que
esta spec predecía. Verificado el 2026-08-22: las **518** interacciones de Meta del
workspace tienen `campaign_id` y `campaign_name`, **cero sin campaña**.

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

## Gate — cumplido

El gate original decía *"PR abierto, no mergear: correr solo el dry run"*. Se cumplió en ese
orden y **ya está cerrado**: el dry run corrió, Mauricio autorizó con los números a la vista
y la escritura real se ejecutó, según `.claude/rules/branch-workflow-one.md`.

**No hay que volver a correrlo.** La función es idempotente (solo toca filas con
`campaign_id` en NULL), así que una segunda pasada no rompería nada, pero tampoco haría nada:
hoy no queda ninguna fila en esa condición.

### Resultado real

| | |
|---|---|
| PR | #329, mergeado a `main` |
| Ejecución | 2026-08-20, 13:49 y 13:50 (Bogotá) |
| Filas escritas | 30 + 320 = **350** (exactamente lo predicho) |
| Estado hoy (2026-08-22) | 518 interacciones de Meta en SOENA, **0 sin `campaign_id`** · 4 campañas distintas |

### Lo que el backfill NO alcanza, y hay que tener presente al leer por campaña

Que las 518 interacciones tengan campaña no significa que 518 negocios la tengan. Medido el
2026-08-22 sobre los **289** negocios del workspace:

- **56** alcanzan una campaña por su contacto (`negocios.contacto_id → contactos → contacto_interacciones`).
- **14** interacciones traen `negocio_id` directo — o sea, el vínculo fuerte cubre 14 de 289;
  el resto se resuelve por el contacto.
- **233** no tienen ninguna interacción de Meta. Eso **no** los declara "directos": solo dice
  que no hay rastro. El tablero comercial los muestra en raya, no en cero.
- **21** tienen rastro de Meta y el origen declarado dice otra cosa (14 de ellos marcados
  como `promotor`). Eso decide de qué bolsa sale la comisión y **no se resuelve solo**.

## Pendiente que sale de aquí

Con la cuenta publicitaria accesible se destraba lo que ONE hoy no puede calcular: **no
existe ninguna tabla que guarde inversión en pauta**. Sin gasto no hay costo por lead ni
costo por lead calificado, que es justo lo que pidió el equipo comercial de SOENA el
2026-08-10. Es otra spec.
