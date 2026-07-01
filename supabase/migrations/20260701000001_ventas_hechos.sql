-- ventas_hechos: tabla de hechos de ventas a grano linea de documento.
-- Alimenta el tab "Rentabilidad Comercial" de Tableros y el panel P2 de Numeros.
-- Fuente inicial: carga desde Excel (ERP Siesa export). Futuro: conector Siesa directo.
-- Multi-tenant: RLS por workspace. Lectura por cliente authenticated; escritura por service_role (ingesta).

create table if not exists public.ventas_hechos (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  fecha         date,
  anio          integer,
  mes           text,
  tipo_docto    text,
  documento     text,
  cliente       text,
  bodega        text,
  referencia    text,
  descripcion   text,
  linea         text,
  centro_costo  text,
  cantidad      numeric,
  precio_unit   numeric,
  descuento     numeric,
  venta_neta    numeric,
  costo         numeric,
  utilidad      numeric,
  rentabilidad  numeric,
  vendedor      text,
  departamento  text,
  fuente        text default 'excel',
  lote          text,
  created_at    timestamptz not null default now()
);

alter table public.ventas_hechos enable row level security;

-- Lectura: solo el propio workspace (patron canonico current_user_workspace_id()).
create policy ventas_hechos_select on public.ventas_hechos
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

-- La ingesta corre con service_role (bypasea RLS y grants). No se otorga escritura a authenticated.
grant select on public.ventas_hechos to authenticated;

create index if not exists idx_ventas_hechos_ws        on public.ventas_hechos(workspace_id);
create index if not exists idx_ventas_hechos_ws_fecha  on public.ventas_hechos(workspace_id, fecha);
create index if not exists idx_ventas_hechos_ws_linea  on public.ventas_hechos(workspace_id, linea);
create index if not exists idx_ventas_hechos_ws_anio   on public.ventas_hechos(workspace_id, anio);

-- Agregados del tab "Rentabilidad Comercial" en un solo JSON (RLS via current_user_workspace_id).
create or replace function public.get_rentabilidad_comercial(p_anio int default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select * from ventas_hechos
    where workspace_id = current_user_workspace_id()
      and (p_anio is null or anio = p_anio)
  )
  select jsonb_build_object(
    'anios', coalesce((select jsonb_agg(a order by a) from (select distinct anio a from ventas_hechos where workspace_id = current_user_workspace_id() and anio is not null) s), '[]'::jsonb),
    'kpis', (select jsonb_build_object(
        'ventaNeta', coalesce(sum(venta_neta),0), 'costo', coalesce(sum(costo),0), 'utilidad', coalesce(sum(utilidad),0),
        'margenPct', case when coalesce(sum(venta_neta),0) > 0 then round(100*sum(utilidad)/sum(venta_neta),1) else 0 end,
        'unidades', coalesce(sum(cantidad),0), 'documentos', count(distinct documento), 'lineas', count(distinct linea)
      ) from base),
    'porMes', coalesce((select jsonb_agg(jsonb_build_object('label', left(initcap(mes),3)||' '||right(anio::text,2), 'ventaNeta', vn, 'utilidad', ut, 'margenPct', mp) order by ord) from (
        select anio, mes, sum(venta_neta) vn, sum(utilidad) ut, case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else 0 end mp, min(fecha) ord
        from base group by anio, mes) m), '[]'::jsonb),
    'porLinea', coalesce((select jsonb_agg(jsonb_build_object('linea', coalesce(linea,'(sin linea)'), 'ventaNeta', vn, 'utilidad', ut, 'margenPct', mp) order by vn desc) from (
        select linea, sum(venta_neta) vn, sum(utilidad) ut, case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else 0 end mp
        from base group by linea) l), '[]'::jsonb),
    'porVendedor', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('vendedor', coalesce(vendedor,'(sin vendedor)'), 'ventaNeta', vn, 'utilidad', ut, 'margenPct', mp) x, vn from (
          select vendedor, sum(venta_neta) vn, sum(utilidad) ut, case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else 0 end mp
          from base group by vendedor order by vn desc limit 10) v order by vn desc) vv), '[]'::jsonb),
    'topProductos', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('producto', coalesce(descripcion, referencia, '(sin nombre)'), 'ventaNeta', vn, 'utilidad', ut, 'margenPct', mp) x, vn from (
          select descripcion, referencia, sum(venta_neta) vn, sum(utilidad) ut, case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else 0 end mp
          from base group by descripcion, referencia order by vn desc limit 10) p order by vn desc) pp), '[]'::jsonb)
  );
$$;

grant execute on function public.get_rentabilidad_comercial(int) to authenticated;
