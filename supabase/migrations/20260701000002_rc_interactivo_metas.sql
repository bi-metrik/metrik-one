-- Dashboard Rentabilidad Comercial interactivo + perfil de vendedor.
-- Metas por vendedor (presupuesto Siesa) + RPC con filtros cruzados + RPC de perfil.

create table if not exists public.metas_vendedor (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  anio integer, mes text, centro_costo text, vendedor text,
  meta_venta numeric, meta_rentabilidad numeric, meta_utilidad numeric, dias_laborales integer,
  created_at timestamptz not null default now()
);
alter table public.metas_vendedor enable row level security;
create policy metas_vendedor_select on public.metas_vendedor for select to authenticated using (workspace_id = current_user_workspace_id());
grant select on public.metas_vendedor to authenticated;
create index if not exists idx_metas_vendedor_ws on public.metas_vendedor(workspace_id, anio, mes, vendedor);

drop function if exists public.get_rentabilidad_comercial(int);

create or replace function public.get_rentabilidad_comercial(p_anio int default null, p_mes text default null, p_vendedor text default null, p_linea text default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with ws as (select current_user_workspace_id() as id),
  full_base as (select v.* from ventas_hechos v, ws where v.workspace_id=ws.id and (p_anio is null or v.anio=p_anio) and (p_mes is null or v.mes=p_mes) and (p_vendedor is null or v.vendedor=p_vendedor) and (p_linea is null or v.linea=p_linea)),
  control_base as (select v.* from ventas_hechos v, ws where v.workspace_id=ws.id and (p_anio is null or v.anio=p_anio) and (p_vendedor is null or v.vendedor=p_vendedor) and (p_linea is null or v.linea=p_linea)),
  global_base as (select v.* from ventas_hechos v, ws where v.workspace_id=ws.id and (p_anio is null or v.anio=p_anio))
  select jsonb_build_object(
    'anios', coalesce((select jsonb_agg(a order by a) from (select distinct anio a from ventas_hechos v, ws where v.workspace_id=ws.id and anio is not null) s),'[]'::jsonb),
    'kpis', (select jsonb_build_object('ventaNeta',coalesce(sum(venta_neta),0),'costo',coalesce(sum(costo),0),'utilidad',coalesce(sum(utilidad),0),'margenPct',case when coalesce(sum(venta_neta),0)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else null end,'margenValido',coalesce(sum(venta_neta),0)>0,'unidades',coalesce(sum(cantidad),0),'documentos',count(distinct documento),'lineas',count(distinct linea),'vendedores',count(distinct vendedor)) from full_base),
    'ventaNetaGlobal', (select coalesce(sum(venta_neta),0) from global_base),
    'porAnio', coalesce((select jsonb_agg(jsonb_build_object('anio',anio,'label',anio::text,'ventaNeta',vn,'utilidad',ut,'margenPct',mp,'documentos',docs) order by anio) from (select anio,sum(venta_neta) vn,sum(utilidad) ut,case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else null end mp,count(distinct documento) docs from control_base group by anio) a),'[]'::jsonb),
    'porMes', coalesce((select jsonb_agg(jsonb_build_object('mes',mes,'anio',anio,'label',left(initcap(mes),3)||' '||right(anio::text,2),'ventaNeta',vn,'utilidad',ut,'margenPct',mp,'documentos',docs) order by ord) from (select anio,mes,sum(venta_neta) vn,sum(utilidad) ut,case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else null end mp,count(distinct documento) docs,min(fecha) ord from control_base group by anio,mes) m),'[]'::jsonb),
    'porLinea', coalesce((select jsonb_agg(jsonb_build_object('linea',coalesce(linea,'(sin linea)'),'ventaNeta',vn,'utilidad',ut,'margenPct',mp,'documentos',docs) order by vn desc) from (select linea,sum(venta_neta) vn,sum(utilidad) ut,case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else null end mp,count(distinct documento) docs from full_base group by linea) l),'[]'::jsonb),
    'porVendedor', coalesce((select jsonb_agg(x order by vn desc) from (select jsonb_build_object('vendedor',coalesce(vendedor,'(sin vendedor)'),'ventaNeta',vn,'utilidad',ut,'margenPct',mp,'documentos',docs) x,vn from (select vendedor,sum(venta_neta) vn,sum(utilidad) ut,case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else null end mp,count(distinct documento) docs from full_base group by vendedor order by vn desc limit 15) v) vv),'[]'::jsonb),
    'topProductos', coalesce((select jsonb_agg(x order by vn desc) from (select jsonb_build_object('producto',coalesce(descripcion,referencia,'(sin nombre)'),'ventaNeta',vn,'utilidad',ut,'margenPct',mp,'documentos',docs) x,vn from (select descripcion,referencia,sum(venta_neta) vn,sum(utilidad) ut,case when sum(venta_neta)>0 then round(100*sum(utilidad)/sum(venta_neta),1) else null end mp,count(distinct documento) docs from full_base group by descripcion,referencia order by vn desc limit 10) p) pp),'[]'::jsonb)
  );
$$;
grant execute on function public.get_rentabilidad_comercial(int,text,text,text) to authenticated;

-- Perfil de vendedor (get_vendedor_perfil) y lista (get_vendedores_resumen): ver instancia.
-- Aplicadas via MCP por tamano; definiciones identicas a las de esta rama.
