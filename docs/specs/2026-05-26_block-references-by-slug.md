# Spec — Referencias entre bloques por `slug` (no por etapa/orden)

**Fecha:** 2026-05-26
**Owner:** Max
**Estado:** Pendiente, planificado para próxima sesión `/one`
**Origen:** Sesión SOENA 2026-05-25/26 — al reordenar bloques en E2/E5/E8 los `campos_fuente` de F01/F02/F03 quedaron apuntando a `bloque_orden` viejos y los formularios fallaron con "faltan datos" aunque la data sí estaba extraída.

## Problema

Hoy conviven 3 sistemas de referencia entre bloques en `config_extra`:

| Sistema | Usado en | Robustez |
|---|---|---|
| `(etapa_orden, bloque_orden)` | F01/F02/F03 `campos_fuente[].source` | Frágil — cualquier reorden rompe |
| `(source_etapa_orden, source_bloque_nombre)` | `cross_check` DC9, `doc_link` DA7 | Robusto a reorden dentro de etapa, frágil si el bloque cambia de etapa |
| `source_etapa_orden` solo | `auto_fill`, `condition`, herencia readonly (`propuesta_economica`, `documento`) | Depende de etapa — frágil si el bloque cambia de etapa |

El problema raíz: ninguno apunta a una **identidad estable del bloque**. Cualquier refactor del workflow (reorden, cambio de etapa, rename) rompe references silenciosamente.

## Propuesta

Agregar `slug` único por `bloque_config` dentro de una línea. Todas las references migran a `source_bloque_slug` (independiente de etapa y orden). Mantener fallback hacia atrás durante la transición.

Ejemplos de slug por bloque SOENA: `rut`, `factura_venta`, `concepto_upme`, `cert_bancario`, `cedula`, `comprobante_pago`, `propuesta_economica`, `registro_upme`, `fecha_cita_dian`.

Restricción: `UNIQUE (linea_id, slug)`.

## Plan en 4 fases

### Fase 1 — Schema DB

```sql
ALTER TABLE bloque_configs ADD COLUMN slug text;

-- Unique por línea
CREATE UNIQUE INDEX bloque_configs_linea_slug_uq
  ON bloque_configs (etapa_id, slug)
  WHERE slug IS NOT NULL;
-- (mejor: por linea_id via JOIN — definir constraint con trigger o function check)

-- Backfill: para cada bloque, slug = normalize(nombre)
-- normalize: NFD + strip accents + lowercase + reemplazar espacios por '_' + solo [a-z0-9_]
UPDATE bloque_configs bc
SET slug = LOWER(REGEXP_REPLACE(
  UNACCENT(COALESCE(bc.nombre, bd.nombre)),
  '[^a-zA-Z0-9]+', '_', 'g'
))
FROM bloque_definitions bd
WHERE bc.bloque_definition_id = bd.id;
```

Validar duplicados manualmente antes de aplicar el unique constraint.

### Fase 2 — Helper único

`src/lib/workflow/block-resolver.ts`:

```typescript
export async function resolveBlockBySlug(
  supabase, negocioId, slug
): Promise<{ data: Record<string, unknown>; campos: Record<string, CampoResultado>; bloque_config_id: string } | null>
```

Reemplaza los lookups por `(etapa_orden, bloque_orden)` que están repartidos en:
- `formulario-actions.ts` (`resolverCamposFuente`)
- `negocio-v2-actions.ts` (`datosOtrasEtapas`, herencia readonly de documento, herencia readonly de propuesta_economica)
- `documento-actions.ts` (`runCrossCheck`)
- `guia-devolucion-actions.ts` (lookup RUT/Factura/FechaCita)

### Fase 3 — Adaptación de consumidores (compat hacia atrás)

Cada consumidor acepta `bloque_slug` **prioritariamente** y cae a la lógica vieja si no está:

- **`campos_fuente[].source`** (formularios):
  ```ts
  type Source =
    | { tipo: 'ai' | 'datos'; bloque_slug: string; campo_slug: string }      // NEW preferido
    | { tipo: 'ai'; campo_slug: string; etapa_orden: number; bloque_orden: number }  // legacy
  ```
- **`auto_fill`**:
  ```ts
  { field; source: 'ai_field'; source_bloque_slug?: string; source_etapa_orden?: number; mapping? }
  ```
  Si `source_bloque_slug` → resolver via helper. Si solo `source_etapa_orden` → agregar de `datosOtrasEtapas[orden]` (legacy).
- **`cross_check.checks[]`**: agregar `source_bloque_slug` con prioridad sobre `source_bloque_nombre`.
- **`doc_link`**: agregar `source_bloque_slug`.
- **`condition`**: agregar `source_bloque_slug` con prioridad sobre `source_etapa_orden`.
- **Herencia readonly** (`config_extra.source_etapa_orden` en bloques tipo `documento` y `propuesta_economica`): agregar `source_bloque_slug` opcional con prioridad.

### Fase 4 — Migración SOENA

Reescribir todas las references existentes en `bloque_configs.config_extra` de la línea GIT EV/HEV usando `source_bloque_slug`. Esto puede automatizarse:

1. Cargar todos los bloques de la línea con su slug recién backfilled.
2. Construir mapa `{(etapa_orden, bloque_orden) → slug}`.
3. Para cada `bloque_configs.config_extra` que contenga referencias `(etapa_orden, bloque_orden)`, sustituir por `bloque_slug`.

## Áreas de impacto (archivos a tocar)

- DB: 1 migration
- `src/lib/workflow/block-resolver.ts` (nuevo)
- `src/lib/actions/formulario-actions.ts` (resolverCamposFuente)
- `src/app/(app)/negocios/negocio-v2-actions.ts` (herencia readonly de documento/propuesta + auto_fill loop + condition eval)
- `src/lib/actions/documento-actions.ts` (runCrossCheck)
- `src/lib/actions/guia-devolucion-actions.ts` (lookup datos negocio)
- `src/app/(app)/negocios/[id]/negocio-detail-client.tsx` (condition eval cliente)

## Beneficios

- **Cero rotura silenciosa** cuando se reordena, mueve de etapa o renombra un bloque.
- **Legibilidad** de configs: `source: { bloque_slug: 'rut', campo_slug: 'razon_social' }` lee como código natural.
- **Patrón único** reemplaza 3 sistemas mezclados.
- **Onboarding más simple** para próximos clientes Clarity — un solo patrón a aprender.

## Riesgos

- Inconsistencia entre nombres "humanos" y slugs si se renombra un bloque después del backfill. Mitigación: el slug es estable después del backfill, renames solo cambian `nombre` (no `slug`). Para renombrar el slug → migration específica.
- Slugs duplicados al backfill si dos bloques tienen el mismo nombre normalizado. Mitigación: validar antes del unique constraint, ajustar slugs manualmente.

## Out of scope (sigue después)

- Migrar líneas de otros clientes que se agreguen — se hace cuando arranca cada cliente.
- Refactor del UI admin `/admin/workflows` para mostrar/editar slugs.
- Validación en runtime de slugs faltantes al crear/editar `bloque_configs`.
