-- ============================================================
-- negocios.origen + negocios.aliado_id — de dónde vino cada negocio
-- ------------------------------------------------------------
-- El ORIGEN es dato de primera clase (no metadata): se filtra, se cuenta y va a
-- alimentar el cálculo de comisiones. Por eso son columnas, no JSON.
--
-- Un negocio tiene UN solo origen. `aliado_id` solo aplica cuando el origen es
-- 'alianza' (la contraparte concreta del acuerdo, tabla `aliados`).
--
-- El catálogo de valores válidos vive en UN SOLO SITIO del código
-- (`src/lib/catalogos/constants.ts` → ORIGENES_NEGOCIO) y lo valida el server
-- action `crearNegocio`. NO se replica como CHECK aquí a propósito: la lista
-- todavía la está validando el negocio (Daniela + Juan David) y un CHECK
-- obligaría a migrar la base cada vez que se ajusta una etiqueta.
--
-- Nullable a propósito: los negocios ya existentes no tienen origen conocido y
-- NO se inventa (solo se backfillea el caso que sí es verificable: los que
-- entraron por la integración de Meta Lead Ads). La obligatoriedad se exige en
-- la creación, hacia adelante.
--
-- GRANTS: `negocios` ya existe con RLS habilitado y sus grants son a nivel de
-- TABLA (no por columna) para `authenticated` → las columnas nuevas quedan
-- cubiertas automáticamente. Las policies de `negocios` filtran por fila
-- (workspace), no por columna → tampoco requieren cambio. Verificado contra
-- prod (information_schema.role_table_grants) antes de escribir esta migración.
-- ============================================================

alter table public.negocios
  add column if not exists origen text,
  add column if not exists aliado_id uuid references public.aliados(id) on delete set null;

comment on column public.negocios.origen is
  'De dónde vino el negocio. Catálogo en src/lib/catalogos/constants.ts (ORIGENES_NEGOCIO). NULL = negocio anterior a la captura de origen.';
comment on column public.negocios.aliado_id is
  'Aliado que originó el negocio. Solo se llena cuando origen = ''alianza''.';

-- Conteos por origen dentro del workspace (tablero financiero / comisiones).
create index if not exists idx_negocios_workspace_origen
  on public.negocios (workspace_id, origen);

-- Negocios por aliado (liquidación de comisiones a futuro).
create index if not exists idx_negocios_aliado
  on public.negocios (aliado_id)
  where aliado_id is not null;

-- ── Backfill mínimo y verificable ──────────────────────────────────────────
-- Solo los negocios que la integración de Meta marcó en su momento. El resto
-- queda NULL: su origen real no está registrado en ninguna parte y adivinarlo
-- contaminaría el conteo.
update public.negocios
set origen = 'meta'
where metadata->>'fuente_cargue' = 'meta_lead'
  and origen is null;

-- ============================================================
-- ROLLBACK (correr manualmente si hay que revertir):
--
-- drop index if exists public.idx_negocios_aliado;
-- drop index if exists public.idx_negocios_workspace_origen;
-- alter table public.negocios drop column if exists aliado_id;
-- alter table public.negocios drop column if exists origen;
-- ============================================================
