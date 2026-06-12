# Spec — Referencias entre bloques por `slug` (no por etapa/orden)

**Fecha:** 2026-05-26
**Owner:** Max
**Estado:** ✅ Implementado 2026-06-12 (línea SOENA VE). Ver "Implementación" al final.
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

## Apéndice — segundo escenario de rotura (rename de campo AI)

Detectado en la misma sesión 2026-05-26: cuando se refactoreó DC9 Concepto UPME
para agregar `cross_check`, los slugs de los `campos_extraccion` cambiaron
(`valor_solicitado` → `valor_total_certificado`, etc.). El Formulario DIAN F01
seguía buscando `valor_solicitado` y devolvía "faltan datos" aunque la data
estaba extraída con otro slug en el mismo bloque.

Implicación para este spec: el problema no es solo de **ubicación** del bloque
(que `bloque_slug` resuelve), sino también de **identidad del campo AI** dentro
del bloque. Cuando se renombra un `campos_extraccion[].slug`, todas las
references a ese slug rompen silenciosamente.

Posibles mitigaciones (a discutir antes de ejecutar el spec):

1. **Aliases en `campos_extraccion`** — un campo puede tener `slug` actual +
   `legacy_slugs: ['valor_solicitado']` que el resolver acepta como fallback.
2. **Constraint de no-rename** — convención dura: una vez creado un slug, no
   se renombra; deprecación con flag `deprecated: true`.
3. **Validación pre-merge** — al modificar `campos_extraccion[].slug` de un
   bloque, scan de todas las references y advertencia / bloqueo.

Recomendación inicial: opción 1 (aliases) por flexibilidad. Decidir en sesión.

---

## Implementación (2026-06-12)

Ejecutado en sesión `/one` (Max). La capa de slug convive con la legacy: **cada consumidor prioriza el slug y cae a nombre/orden solo si la ref aún no trae slug** → retrocompatible, cero big-bang.

### DB
- **Columna `bloque_configs.slug`** (`text`, índice parcial) — identidad estable, única por línea. NULL en heredados readonly. Migración producto `20260612000001_bloque_configs_slug.sql`.
- **Guardián `audit_block_slug_refs(linea_id)`** — companion de `audit_workflow_refs`: valida unicidad de slug por línea + que todo slug referenciado exista. Migración `20260612000002_audit_block_slug_refs.sql`.

### Código (6 consumidores migrados, todos con fallback legacy)
| Consumidor | Archivo | Campo nuevo |
|---|---|---|
| `cross_check` (+ alternatives) | `lib/actions/documento-actions.ts` | `source_bloque_slug` |
| `campos_fuente` (+ alternatives) | `lib/actions/formulario-actions.ts` | `source.bloque_slug` |
| `auto_fill.source_bloque` (2 puntos) | `negocios/negocio-v2-actions.ts` | `auto_fill.source_bloque_slug` |
| `doc_link` | `negocios/negocio-v2-actions.ts` + `BloqueDatos.tsx` | `doc_link.source_bloque_slug` |
| preview `guia_devolucion` | `negocios/negocio-v2-actions.ts` | índice `datosGuiaPorSlug` |
| generación `guia_devolucion` | `lib/actions/guia-devolucion-actions.ts` | match por slug |
| `condition` (render + gate SQL) | `negocio-detail-client.tsx` + `condicion_cumplida()` | `condition.source_bloque_slug` |
| herencia readonly (documento + propuesta) | `negocios/negocio-v2-actions.ts` | `source_bloque_slug` |

**Condition** se evalúa en dos sitios que deben dar el mismo resultado (paridad gate⟺render): el render cliente (`datosPorSlug`, expuesto nuevo desde el server) y el gate SQL `condicion_cumplida()` (branch slug con flattening de campos). Backfill resuelve cada `condition` al bloque origen que DEFINE el field. **Herencia readonly de datos** ya era estable (por `bloque_definition_id`); se migraron los paths frágiles de `documento` (por etapa::nombre) y `propuesta_economica` (por orden) a slug, con `config_extra.source_bloque_slug` apuntando al origen.

### Backfill SOENA VE (`proyectos/soena/ve/migrations/20260612_refs_por_slug.sql`)
- 51 bloques origen con slug (24 heredados → NULL). Sumideros homónimos desambiguados: `pagos_anticipo`/`pagos_cobro`, `cobros_e{N}`.
- Referencias migradas a slug: **49 auto_fill + 10 cross_check (con alternativas) + 55 campos_fuente + 20 condition + 24 readonly = 158 refs**, todas validadas (0 inválidas).
- `audit_block_slug_refs` (7 clases) y `audit_workflow_refs` ambos en **0 problemas**.

### Beneficio comprobado
El bug DC13 (cross-check de marca/línea quedaba vacío al renombrar "Factura de venta" → "Factura Venta Vehículo") queda **estructuralmente cerrado**: la ref ahora cita `factura_venta_vehiculo` (slug), inmune a futuros renames. Igual para el preview/generación de la guía de devolución, que hardcodeaban el nombre viejo.

### Pendiente / nota
- `UNIQUE (linea_id, slug)` no se impone con índice (la tabla no tiene `linea_id`); la unicidad la vigila `audit_block_slug_refs`. Un trigger por línea es opción futura si se requiere garantía dura.
- Otras líneas/workspaces siguen 100% en modo legacy hasta que se les corra su propio backfill — sin impacto (fallback activo).
