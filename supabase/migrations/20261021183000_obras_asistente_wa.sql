-- Obras por WhatsApp: rubros propios, pagos con número de transacción, llegadas de los operarios, facturas por obra y
-- el cierre de cada obra (diseño: proyectos/imperviun/proyecto-360/docs/diseno/asistente-whatsapp.md, §6.2).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Qué trae
-- ─────────────────────────────────────────────────────────────────────────────
--
--  C3   `obra_rubros`: los rubros de obra de un workspace (nombre, descripción, ejemplos y la categoría fiscal de
--       siempre a la que van). Un workspace sin filas sigue con las categorías fijas: nada cambia para los demás.
--       `gastos.obra_rubro_id` dice en qué rubro quedó un gasto.
--  C1   `numero_transaccion` en gastos y cobros (leído del pantallazo), con `numero_repetido` cuando la persona dijo que
--       es otro pago con el mismo número (D3: un pago partido entre dos obras lleva el mismo número en las dos partes).
--  C22  `huella_soporte`: sha256 de la imagen, para ver el mismo pantallazo dos veces cuando no trae número.
--       `propuesta_huella`: la huella de la propuesta que se confirmó con el toque (de dónde salió el registro).
--  C5   `wa_collaborators.tipo`: `equipo` (como hoy) u `operario` (solo marca su llegada y ve sus días).
--  C6   `colaborador_jornada_valores`: el valor de la jornada de cada colaborador con su fecha de vigencia.
--  C7   `llegadas_obra`: la marca de llegada (colaborador, obra, día de Bogotá, hora del mensaje en el servidor). Una
--       llegada por obra y día, máximo dos obras distintas por día (Anexo 2.3: jornada completa o media). El valor de la
--       jornada vigente ese día se copia al guardar: si después cambia, los días anteriores no cambian.
--  C8   `v_jornadas_dia`: el reparto se CALCULA (una obra = jornada completa; dos = media en cada una), no se guarda.
--  C9   `facturas` (vacía en producción, 0 filas) pasa a colgar de `negocio_id`, con estado abierta/pagada; los cobros
--       ya tienen `factura_id`.
--  C10  `v_facturas_obra`: recibido, saldo pendiente (abiertas) y retenido (solo pagadas = total − recibido). ONE no
--       calcula ni certifica retenciones: es la diferencia, nada más.
--  C11  `v_cierre_obra`: vendido, gastado por rubro, mano de obra, utilidad, facturado, cobrado, retenido, por cobrar.
--  C18  `negocios.anticipo_pct`, `forma_pago`, `plazo_pago_dias`: las condiciones del contrato de la obra.
--  C21  `negocios.nombre_corto`: el nombre de la obra en un botón de WhatsApp (máximo 20 caracteres).
--  C17  `bot_mensajes_mes`: los mensajes que llegaron al modelo en un mes (Anexo 1.4), con el desglose gestión /
--       operarios, de las trazas de `wa_conversacion`.
--
-- No toca datos existentes: columnas nuevas nulas o con default, tablas, vistas y funciones nuevas.
--
-- epoca: no-rompe columnas nuevas con default y objetos nuevos; nada de lo de hoy cambia de forma.

-- ─────────────────────────────────────────────────────────────────────────────
-- C3. Rubros de obra por workspace
-- ─────────────────────────────────────────────────────────────────────────────

create table public.obra_rubros (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 24),
  descripcion text,
  ejemplos text,
  -- La categoría fiscal de siempre (`gastos_categoria_check`) a la que va un gasto de este rubro.
  categoria text not null default 'otros' check (categoria = any (array['materiales', 'transporte', 'alimentacion', 'servicios_profesionales', 'software', 'arriendo', 'marketing', 'capacitacion', 'otros', 'comision', 'impuestos_recuperables', 'proveedor_viaje', 'cortesia_viaje'])),
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index obra_rubros_nombre on public.obra_rubros (workspace_id, lower(btrim(nombre)));
comment on table public.obra_rubros is 'Rubros de obra de un workspace (C3). Sin filas, el workspace usa las categorías fijas. Un rubro no se borra: se desactiva, para que el cierre de las obras viejas no cambie de forma.';

alter table public.obra_rubros enable row level security;
create policy obra_rubros_ws on public.obra_rubros for all to authenticated
  using (workspace_id = public.current_user_workspace_id()) with check (workspace_id = public.current_user_workspace_id());
grant select, insert, update, delete on public.obra_rubros to authenticated;

alter table public.gastos
  add column obra_rubro_id uuid references public.obra_rubros(id) on delete restrict,
  add column numero_transaccion text check (numero_transaccion is null or char_length(numero_transaccion) between 1 and 60),
  add column numero_repetido boolean not null default false,
  add column huella_soporte text check (huella_soporte is null or huella_soporte ~ '^[0-9a-f]{64}$'),
  add column propuesta_huella text;
create index gastos_numero_transaccion on public.gastos (workspace_id, numero_transaccion) where numero_transaccion is not null;
create index gastos_huella_soporte on public.gastos (workspace_id, huella_soporte) where huella_soporte is not null;
create index gastos_obra_rubro on public.gastos (obra_rubro_id) where obra_rubro_id is not null;

alter table public.cobros
  add column numero_transaccion text check (numero_transaccion is null or char_length(numero_transaccion) between 1 and 60),
  add column numero_repetido boolean not null default false,
  add column huella_soporte text check (huella_soporte is null or huella_soporte ~ '^[0-9a-f]{64}$'),
  add column propuesta_huella text;
create index cobros_numero_transaccion on public.cobros (workspace_id, numero_transaccion) where numero_transaccion is not null;
create index cobros_huella_soporte on public.cobros (workspace_id, huella_soporte) where huella_soporte is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- C18, C21. La obra: nombre corto y condiciones del contrato
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.negocios
  add column nombre_corto text check (nombre_corto is null or char_length(btrim(nombre_corto)) between 1 and 20),
  add column anticipo_pct numeric check (anticipo_pct is null or (anticipo_pct >= 0 and anticipo_pct <= 100)),
  add column forma_pago text check (forma_pago is null or char_length(forma_pago) <= 300),
  add column plazo_pago_dias integer check (plazo_pago_dias is null or plazo_pago_dias between 0 and 365);

-- ─────────────────────────────────────────────────────────────────────────────
-- C9. Facturas por obra
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.facturas
  add column negocio_id uuid references public.negocios(id) on delete restrict,
  add column estado text not null default 'abierta' check (estado in ('abierta', 'pagada')),
  add column pagada_at timestamptz,
  add column pagada_por uuid references public.profiles(id),
  add column numero_repetido boolean not null default false,
  add column soporte_url text,
  add column created_by uuid references public.profiles(id),
  add column created_by_wa_name text,
  add column propuesta_huella text,
  add constraint facturas_pagada_con_fecha check ((estado = 'pagada') = (pagada_at is not null));
-- Una factura de obra cuelga del negocio, no de un proyecto legado: `proyecto_id` deja de ser obligatorio (0 filas hoy).
alter table public.facturas alter column proyecto_id drop not null;
create index facturas_negocio on public.facturas (negocio_id) where negocio_id is not null;
create index facturas_numero on public.facturas (workspace_id, lower(numero_factura));

-- ─────────────────────────────────────────────────────────────────────────────
-- C5, C6. Operarios y valor de la jornada
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.wa_collaborators
  add column tipo text not null default 'equipo' check (tipo in ('equipo', 'operario'));
comment on column public.wa_collaborators.tipo is 'equipo = como siempre. operario = por WhatsApp solo marca su llegada a la obra y ve sus días (candado de rol en el código, C5).';

create table public.colaborador_jornada_valores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collaborator_id uuid not null references public.wa_collaborators(id) on delete cascade,
  valor numeric not null check (valor > 0),
  vigente_desde date not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (collaborator_id, vigente_desde)
);
comment on table public.colaborador_jornada_valores is 'Valor de la jornada completa de un colaborador desde una fecha (C6). El vigente un día es el de mayor vigente_desde <= ese día.';

alter table public.colaborador_jornada_valores enable row level security;
create policy colaborador_jornada_valores_ws on public.colaborador_jornada_valores for all to authenticated
  using (workspace_id = public.current_user_workspace_id()) with check (workspace_id = public.current_user_workspace_id());
grant select, insert, update, delete on public.colaborador_jornada_valores to authenticated;

-- El valor vigente de un colaborador un día. null = no tiene valor registrado.
create or replace function public.valor_jornada_vigente(p_collaborator_id uuid, p_fecha date)
returns numeric
language sql
stable
set search_path = public
as $$
  select v.valor from public.colaborador_jornada_valores v
  where v.collaborator_id = p_collaborator_id and v.vigente_desde <= p_fecha
  order by v.vigente_desde desc limit 1;
$$;
revoke execute on function public.valor_jornada_vigente(uuid, date) from public, anon;
-- ejecutable-por-cliente: la usa el trigger de llegadas_obra (corre como quien escribe); no devuelve nada de otro workspace que el RLS de la tabla no deje ver.
grant execute on function public.valor_jornada_vigente(uuid, date) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C7. Llegadas a la obra
-- ─────────────────────────────────────────────────────────────────────────────

create table public.llegadas_obra (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collaborator_id uuid not null references public.wa_collaborators(id) on delete restrict,
  negocio_id uuid not null references public.negocios(id) on delete restrict,
  -- El día de Bogotá de la llegada.
  fecha date not null,
  -- La hora del mensaje en el servidor (nunca la que diga el texto). En una corrección de la oficina, la que ella ponga.
  hora timestamptz not null,
  -- El valor de la jornada vigente ese día, copiado al guardar (trigger). null = el colaborador no tenía valor.
  valor_jornada numeric check (valor_jornada is null or valor_jornada > 0),
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'app')),
  wa_message_id text,
  propuesta_huella text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collaborator_id, fecha, negocio_id)
);
create index llegadas_obra_ws_fecha on public.llegadas_obra (workspace_id, fecha);
create index llegadas_obra_negocio on public.llegadas_obra (negocio_id);
comment on table public.llegadas_obra is 'Marca de llegada de un colaborador a una obra (C7). Máximo dos obras distintas por día. El reparto por mitades no se guarda: v_jornadas_dia.';

alter table public.llegadas_obra enable row level security;
create policy llegadas_obra_ws on public.llegadas_obra for all to authenticated
  using (workspace_id = public.current_user_workspace_id()) with check (workspace_id = public.current_user_workspace_id());
grant select, insert, update, delete on public.llegadas_obra to authenticated;

-- Invariantes de la llegada: colaborador y obra del mismo workspace, máximo dos obras por día, y el valor vigente copiado.
create or replace function public.llegadas_obra_guardar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_otras integer;
begin
  if not exists (select 1 from public.wa_collaborators c where c.id = new.collaborator_id and c.workspace_id = new.workspace_id) then
    raise exception 'llegada: el colaborador no es de este workspace' using errcode = '23514';
  end if;
  if not exists (select 1 from public.negocios n where n.id = new.negocio_id and n.workspace_id = new.workspace_id) then
    raise exception 'llegada: la obra no es de este workspace' using errcode = '23514';
  end if;
  -- Serializa las llegadas de un colaborador en un día (dos toques a la vez no hacen tres obras).
  perform pg_advisory_xact_lock(hashtextextended(new.collaborator_id::text || new.fecha::text, 0));
  select count(distinct l.negocio_id) into v_otras from public.llegadas_obra l
  where l.collaborator_id = new.collaborator_id and l.fecha = new.fecha and l.negocio_id <> new.negocio_id
    and (tg_op = 'INSERT' or l.id <> new.id);
  if v_otras >= 2 then
    raise exception 'llegada: ya hay dos obras ese día (jornada completa o media, Anexo 2.3)' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.fecha is distinct from old.fecha or new.collaborator_id is distinct from old.collaborator_id then
    new.valor_jornada := public.valor_jornada_vigente(new.collaborator_id, new.fecha);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.llegadas_obra_guardar() from public, anon;

create trigger llegadas_obra_guardar before insert or update on public.llegadas_obra
  for each row execute function public.llegadas_obra_guardar();

-- ─────────────────────────────────────────────────────────────────────────────
-- C8. El reparto del día: se calcula
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_jornadas_dia with (security_invoker = on) as
  select l.id, l.workspace_id, l.collaborator_id, c.name as colaborador, l.negocio_id, l.fecha, l.hora, l.valor_jornada,
         1.0 / count(*) over (partition by l.collaborator_id, l.fecha) as fraccion,
         l.valor_jornada / count(*) over (partition by l.collaborator_id, l.fecha) as costo
  from public.llegadas_obra l
  join public.wa_collaborators c on c.id = l.collaborator_id;
grant select on public.v_jornadas_dia to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C10. Facturas por obra: recibido, saldo y retenido (calculados)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_facturas_obra with (security_invoker = on) as
  select f.id, f.workspace_id, f.negocio_id, n.empresa_id, f.numero_factura, f.fecha_emision, f.monto, f.estado, f.pagada_at,
         coalesce(r.recibido, 0) as recibido,
         case when f.estado = 'abierta' then f.monto - coalesce(r.recibido, 0) end as saldo_pendiente,
         case when f.estado = 'pagada' then f.monto - coalesce(r.recibido, 0) end as retenido
  from public.facturas f
  left join public.negocios n on n.id = f.negocio_id
  left join lateral (
    select sum(c.monto) as recibido from public.cobros c where c.factura_id = f.id and c.anulado_at is null and c.fecha is not null and c.tipo_cobro is distinct from 'devolucion_pendiente'
  ) r on true
  where f.negocio_id is not null;
grant select on public.v_facturas_obra to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C11. El cierre de la obra
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_cierre_obra with (security_invoker = on) as
  select n.id as negocio_id, n.workspace_id, n.codigo, n.nombre, n.nombre_corto, n.estado, n.stage_actual, n.empresa_id,
         coalesce(n.precio_aprobado, n.precio_estimado, 0) as vendido,
         coalesce(g.por_rubro, '[]'::jsonb) as gastos_por_rubro,
         coalesce(g.total, 0) as gastos_total,
         coalesce(j.costo, 0) as mano_obra,
         coalesce(j.jornadas, 0) as jornadas,
         coalesce(j.sin_valor, 0) as jornadas_sin_valor,
         coalesce(n.precio_aprobado, n.precio_estimado, 0) - coalesce(g.total, 0) - coalesce(j.costo, 0) as utilidad,
         coalesce(fa.facturado, 0) as facturado,
         coalesce(co.cobrado, 0) as cobrado,
         coalesce(fa.retenido, 0) as retenido,
         coalesce(fa.saldo_facturas, 0) as saldo_facturas,
         coalesce(n.precio_aprobado, n.precio_estimado, 0) - coalesce(co.cobrado, 0) - coalesce(fa.retenido, 0) as por_cobrar
  from public.negocios n
  left join lateral (
    select sum(x.total) as total,
           jsonb_agg(jsonb_build_object('rubro', x.rubro, 'total', x.total) order by x.orden, x.rubro) as por_rubro
    from (
      select coalesce(r.nombre, ga.categoria) as rubro, coalesce(min(r.orden), 1000) as orden, sum(ga.monto) as total
      from public.gastos ga left join public.obra_rubros r on r.id = ga.obra_rubro_id
      where ga.negocio_id = n.id
      group by 1
    ) x
  ) g on true
  left join lateral (
    select sum(coalesce(d.costo, 0)) as costo, sum(d.fraccion) as jornadas, count(*) filter (where d.valor_jornada is null) as sin_valor
    from public.v_jornadas_dia d where d.negocio_id = n.id
  ) j on true
  left join lateral (
    select sum(f.monto) as facturado, sum(f.retenido) as retenido, sum(f.saldo_pendiente) as saldo_facturas
    from public.v_facturas_obra f where f.negocio_id = n.id
  ) fa on true
  left join lateral (
    -- Como `cobradoDelNegocio` de la app: sin fecha es una cuota programada sin pagar; la devolución pendiente no es cobro.
    select sum(c.monto) as cobrado from public.cobros c where c.negocio_id = n.id and c.anulado_at is null
      and c.fecha is not null and c.tipo_cobro is distinct from 'devolucion_pendiente'
  ) co on true;
grant select on public.v_cierre_obra to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C17. Mensajes del mes que llegaron al modelo (Anexo 1.4)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Cuenta 1 cada mensaje entrante (texto, nota de voz, imagen o PDF) que un turno del modelo SIN error le pasó al modelo:
-- la traza del turno lo lista en `mensajes` ({id, quien: gestion|operario}). Un mismo mensaje en dos turnos (la ventana
-- de los adjuntos repite el turno) cuenta una vez. Toques, respuestas, números no registrados, respuestas fijas y
-- turnos que fallaron por nosotros no están ahí: no cuentan.

create or replace function public.bot_mensajes_mes(p_workspace_id uuid, p_mes date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with limites as (
    select (date_trunc('month', p_mes)::timestamp at time zone 'America/Bogota') as desde,
           ((date_trunc('month', p_mes) + interval '1 month')::timestamp at time zone 'America/Bogota') as hasta
  ), msgs as (
    select distinct m->>'id' as id, coalesce(m->>'quien', 'gestion') as quien
    from public.wa_conversacion w, limites l, jsonb_array_elements(coalesce(w.traza->'mensajes', '[]'::jsonb)) m
    where w.workspace_id = p_workspace_id and w.created_at >= l.desde and w.created_at < l.hasta
      and w.traza->>'tipo' = 'modelo' and coalesce(w.traza->>'error', '') = ''
  )
  select jsonb_build_object(
    'total', count(distinct id),
    'gestion', count(distinct id) filter (where quien = 'gestion'),
    'operario', count(distinct id) filter (where quien = 'operario')
  ) from msgs;
$$;
revoke execute on function public.bot_mensajes_mes(uuid, date) from public, anon, authenticated;
grant execute on function public.bot_mensajes_mes(uuid, date) to service_role;
