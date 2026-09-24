-- ============================================================
-- 20260924235500 — Módulo Ferretería (piloto Marketplace, alianza Dimpro x MeTRIK)
-- Spec: docs/specs/2026-09-24_modulo-ferreteria-dimpro.md (aprobada por Mauricio el 2026-09-24).
--
-- Qué crea:
--   1. Llave de módulo nueva `ferreteria` en las TRES listas que repiten el catálogo
--      (`workspace_modulos_modulo`, `catalogo_servicios_modulo` y `proyectar_modulos`).
--      `src/lib/modulos/catalogo.test.ts` lee este archivo y falla si se separan.
--   2. Ocho tablas `ferreteria_*`:
--        productos        — uno por SKU (exacto: EKM80 y EKM80-B son dos), con ficha y fotos.
--        costos           — historial por lista de precios (columna F con revista, D sin).
--        publicaciones    — un aviso en un canal, con `pendiente_en_canal`.
--        eventos          — bitácora, SOLO se agrega (trigger que prohíbe UPDATE y DELETE).
--        mediciones       — clics acumulados por publicación y día (la escribe el cron).
--        conversaciones   — interesado visible, canal y resultado. Sin teléfono ni documento.
--        ventas           — venta = primer pago; guarda el costo del día y la ganancia.
--        tokens           — credenciales del endpoint para escritores SIN sesión.
--   3. La activación del módulo en el workspace `dimpro`: una fila en `workspace_modulos`
--      (origen `interno`) y la llave `ferreteria: true` en `workspaces.modules`, que es lo que
--      leen hoy el gate por ruta, el menú y las pantallas. NO toca ninguna otra llave.
--
-- Quién escribe: NADIE con el cliente `authenticated`. Las siete tablas de datos conceden solo
-- SELECT (acotado por workspace); toda escritura pasa por el servidor con service_role, en
-- `src/lib/ferreteria/nucleo.ts`, que valida el piso de precio y escribe la bitácora. Si el
-- navegador pudiera hacer UPDATE por PostgREST, el piso y la bitácora serían opcionales.
--
-- Verificación después de aplicar (solo lectura):
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relname like 'ferreteria\_%';
--     -> 8 filas, todas con relrowsecurity = true
--   select t.relname,
--          has_table_privilege('anon', t.oid, 'select')            as anon_sel,
--          has_table_privilege('authenticated', t.oid, 'select')   as auth_sel,
--          has_table_privilege('authenticated', t.oid, 'update')   as auth_upd
--     from pg_class t
--    where t.relnamespace = 'public'::regnamespace and t.relname like 'ferreteria\_%';
--     -> anon_sel false en las 8; auth_sel true en 7 y false en ferreteria_tokens; auth_upd false en las 8
--   select modules->'ferreteria' from public.workspaces where slug = 'dimpro';      -> true
--   select modulo, origen, activo_hasta from public.workspace_modulos
--    where workspace_id = '67f7af44-b5ac-4d5c-aa9e-44954368447c';                   -> ferreteria, interno, null
--   select public.proyectar_modulos('67f7af44-b5ac-4d5c-aa9e-44954368447c')->'cambios';
--     -> sin 'ferreteria' entre los cambios (la fila y la llave coinciden)
-- ============================================================

-- ── 1. La llave de módulo nueva en las tres listas ───────────────────────────

alter table public.workspace_modulos drop constraint workspace_modulos_modulo;
alter table public.workspace_modulos add constraint workspace_modulos_modulo check (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria'));

alter table public.catalogo_servicios drop constraint catalogo_servicios_modulo;
alter table public.catalogo_servicios add constraint catalogo_servicios_modulo check (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria'));

-- Mismo cuerpo que `20260915210000_workspace_modulos.sql`; solo cambia el arreglo de llaves.
-- Sigue siendo `stable` (solo ensayo): encenderla es otra migración.
create or replace function public.proyectar_modulos(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claves_modulo constant text[] :=
    array['business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria'];
  v_hoy jsonb;
  v_vigentes text[];
  v_proyectado jsonb;
  v_cambios jsonb;
begin
  select coalesce(w.modules, '{}'::jsonb)
    into v_hoy
    from public.workspaces w
   where w.id = p_workspace_id;

  if not found then
    raise exception 'proyectar_modulos: el workspace % no existe', p_workspace_id;
  end if;

  select coalesce(array_agg(distinct wm.modulo), '{}')
    into v_vigentes
    from public.workspace_modulos wm
   where wm.workspace_id = p_workspace_id
     and wm.activo_desde <= now()
     and (wm.activo_hasta is null or wm.activo_hasta > now());

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_proyectado
    from jsonb_each(v_hoy) e
   where e.key <> all (v_claves_modulo);

  v_proyectado := v_proyectado
    || coalesce((select jsonb_object_agg(m, true) from unnest(v_vigentes) m), '{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
           'modulo', c,
           'hoy', coalesce(v_hoy -> c = 'true'::jsonb, false),
           'proyectado', c = any (v_vigentes)
         ) order by c), '[]'::jsonb)
    into v_cambios
    from unnest(v_claves_modulo) c
   where coalesce(v_hoy -> c = 'true'::jsonb, false) is distinct from (c = any (v_vigentes));

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'hoy', v_hoy,
    'proyectado', v_proyectado,
    'cambios', v_cambios
  );
end;
$$;

-- server-only: la corren el ensayo de operación y, al encenderla, el cron con service_role.
revoke execute on function public.proyectar_modulos(uuid) from public, anon, authenticated;

-- ── 2. Productos ─────────────────────────────────────────────────────────────

create table public.ferreteria_productos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  -- Exacto, sin normalizar: EKM80 y EKM80-B son productos distintos.
  sku text not null check (length(btrim(sku)) > 0 and sku = btrim(sku)),
  nombre text not null check (length(btrim(nombre)) > 0),
  marca text,
  categoria text,
  proveedor text,
  pagina_catalogo text,
  -- Arreglo de URLs.
  fotos jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array'),
  -- Arreglo de { etiqueta, valor, fuente, verificado }. fuente: "catalogo pag N", "lista", "Dietmar".
  ficha jsonb not null default '[]'::jsonb check (jsonb_typeof(ficha) = 'array'),
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ferreteria_productos_sku_unico unique (workspace_id, sku)
);

-- ── 3. Costos por lista ──────────────────────────────────────────────────────

create table public.ferreteria_costos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  producto_id uuid not null references public.ferreteria_productos(id) on delete cascade,
  fecha_lista date not null,
  -- Columna F de la lista Uyusa: IVA incluido, con descuento de revista. Es el costo del piso.
  costo_f numeric(14, 2) not null check (costo_f > 0),
  -- Columna D: sin descuento de revista.
  costo_d numeric(14, 2) check (costo_d is null or costo_d > 0),
  created_at timestamptz not null default now(),
  constraint ferreteria_costos_lista_unica unique (producto_id, fecha_lista)
);

create index idx_ferreteria_costos_producto on public.ferreteria_costos (producto_id, fecha_lista desc);

-- ── 4. Publicaciones ─────────────────────────────────────────────────────────

create table public.ferreteria_publicaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  codigo text not null check (length(btrim(codigo)) > 0 and codigo = btrim(codigo)),
  producto_id uuid not null references public.ferreteria_productos(id),
  canal text not null default 'marketplace'
    check (canal in ('marketplace', 'tienda', 'whatsapp')),
  titulo text not null default '',
  descripcion text,
  etiquetas text[] not null default '{}',
  precio numeric(14, 2) check (precio is null or precio > 0),
  linea text check (linea is null or linea in ('impulso', 'ticket_alto', 'precio_agresivo')),
  link text,
  id_aviso text,
  perfil text,
  fecha_publicacion date,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'en_revision', 'activa', 'pausada', 'agotada', 'vendida', 'rechazada', 'eliminada')),
  -- Un cambio hecho en ONE (precio, estado o texto) que el cron aún no aplicó en el canal.
  pendiente_en_canal boolean not null default false,
  pendiente_desde timestamptz,
  -- Sube con cada cambio que queda pendiente. El cron la devuelve al confirmar: si no coincide,
  -- hubo otro cambio mientras aplicaba y la confirmación no borra el pendiente nuevo.
  version_canal integer not null default 0,
  -- Confirmaciones con error desde que quedó pendiente. Con 2, la pantalla lo pinta en rojo.
  intentos_fallidos integer not null default 0,
  ultimo_error_canal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ferreteria_publicaciones_codigo_unico unique (workspace_id, codigo),
  constraint ferreteria_publicaciones_pendiente_coherente
    check (pendiente_en_canal = (pendiente_desde is not null))
);

create index idx_ferreteria_publicaciones_producto on public.ferreteria_publicaciones (producto_id);
create index idx_ferreteria_publicaciones_pendientes
  on public.ferreteria_publicaciones (workspace_id) where pendiente_en_canal;

-- ── 5. Bitácora (solo se agrega) ─────────────────────────────────────────────

create table public.ferreteria_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  publicacion_id uuid not null references public.ferreteria_publicaciones(id),
  tipo text not null check (tipo in (
    'creada', 'cambio_precio', 'cambio_estado', 'cambio_texto', 'cambio_dato',
    'venta', 'nota', 'aplicado_en_canal', 'error_en_canal'
  )),
  -- Qué campo cambió (titulo, descripcion, etiquetas, linea, link, ...). Null en los demás tipos.
  campo text,
  valor_anterior text,
  valor_nuevo text,
  motivo text,
  autor_tipo text not null check (autor_tipo in ('persona', 'agente', 'cron')),
  autor_id uuid references public.profiles(id),
  autor_nombre text,
  created_at timestamptz not null default now()
);

create index idx_ferreteria_eventos_publicacion on public.ferreteria_eventos (publicacion_id, created_at desc);

create or replace function public.ferreteria_eventos_solo_agrega()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ferreteria_eventos: la bitácora solo se agrega (% no permitido)', tg_op;
end;
$$;

create trigger trg_ferreteria_eventos_solo_agrega
  before update or delete on public.ferreteria_eventos
  for each row execute function public.ferreteria_eventos_solo_agrega();

-- PostgreSQL no exige EXECUTE para DISPARAR un trigger: el revoke no la apaga.
revoke execute on function public.ferreteria_eventos_solo_agrega() from public, anon, authenticated;

-- ── 6. Mediciones diarias ────────────────────────────────────────────────────

create table public.ferreteria_mediciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  publicacion_id uuid not null references public.ferreteria_publicaciones(id),
  fecha date not null,
  -- Acumulados como los muestra Marketplace. Los clics del día salen de la diferencia.
  clics_acumulados integer not null check (clics_acumulados >= 0),
  guardados integer check (guardados is null or guardados >= 0),
  estado_visto text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Reintentar el lote del día lo sobrescribe, no lo duplica.
  constraint ferreteria_mediciones_dia_unico unique (publicacion_id, fecha)
);

-- ── 7. Conversaciones ────────────────────────────────────────────────────────

create table public.ferreteria_conversaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  publicacion_id uuid not null references public.ferreteria_publicaciones(id),
  fecha date not null,
  -- Solo el nombre visible. Sin teléfono ni documento en V1 (minimización de datos).
  interesado text not null check (length(btrim(interesado)) > 0),
  canal text not null check (canal in ('messenger', 'whatsapp')),
  resultado text not null default 'pregunto'
    check (resultado in ('pregunto', 'cotizo', 'vendio', 'perdida')),
  motivo_perdida text,
  -- Llave de idempotencia: el id del hilo si el cron lo tiene; si no, publicacion|fecha|interesado|canal.
  clave text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ferreteria_conversaciones_clave_unica unique (workspace_id, clave)
);

create index idx_ferreteria_conversaciones_publicacion on public.ferreteria_conversaciones (publicacion_id);

-- ── 8. Ventas ────────────────────────────────────────────────────────────────

create table public.ferreteria_ventas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  publicacion_id uuid not null references public.ferreteria_publicaciones(id),
  conversacion_id uuid references public.ferreteria_conversaciones(id),
  -- Venta = primer pago.
  fecha_primer_pago date not null,
  precio_final numeric(14, 2) not null check (precio_final > 0),
  -- Costo F vigente ese día, congelado: una lista nueva no reescribe la ganancia realizada.
  costo_dia numeric(14, 2) not null check (costo_dia > 0),
  ganancia numeric(14, 2) not null,
  ruta text not null check (ruta in ('recoge', 'despacho')),
  registrado_por uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_ferreteria_ventas_publicacion on public.ferreteria_ventas (publicacion_id);

-- ── 9. Tokens del endpoint ───────────────────────────────────────────────────

-- server-only: la lee solo el endpoint /api/ferreteria con service_role para autenticar al
-- agente y al cron. Guarda el sha256 del token, nunca el token.
create table public.ferreteria_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  nombre text not null check (length(btrim(nombre)) > 0),
  escritor text not null check (escritor in ('agente', 'cron')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Los primeros caracteres, para reconocer el token en una lista sin poder usarlo.
  prefijo text not null,
  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  revocado_at timestamptz,
  ultimo_uso_at timestamptz,
  constraint ferreteria_tokens_hash_unico unique (token_hash)
);

-- ── 10. RLS y grants ─────────────────────────────────────────────────────────

alter table public.ferreteria_productos enable row level security;
alter table public.ferreteria_costos enable row level security;
alter table public.ferreteria_publicaciones enable row level security;
alter table public.ferreteria_eventos enable row level security;
alter table public.ferreteria_mediciones enable row level security;
alter table public.ferreteria_conversaciones enable row level security;
alter table public.ferreteria_ventas enable row level security;
alter table public.ferreteria_tokens enable row level security;

-- Lectura por workspace. Sin políticas de escritura y sin grant de escritura: escribe el servidor.
create policy ferreteria_productos_lectura on public.ferreteria_productos
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy ferreteria_costos_lectura on public.ferreteria_costos
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy ferreteria_publicaciones_lectura on public.ferreteria_publicaciones
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy ferreteria_eventos_lectura on public.ferreteria_eventos
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy ferreteria_mediciones_lectura on public.ferreteria_mediciones
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy ferreteria_conversaciones_lectura on public.ferreteria_conversaciones
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy ferreteria_ventas_lectura on public.ferreteria_ventas
  for select using (workspace_id = (select public.current_user_workspace_id()));

revoke all on table public.ferreteria_productos from public, anon, authenticated;
revoke all on table public.ferreteria_costos from public, anon, authenticated;
revoke all on table public.ferreteria_publicaciones from public, anon, authenticated;
revoke all on table public.ferreteria_eventos from public, anon, authenticated;
revoke all on table public.ferreteria_mediciones from public, anon, authenticated;
revoke all on table public.ferreteria_conversaciones from public, anon, authenticated;
revoke all on table public.ferreteria_ventas from public, anon, authenticated;
revoke all on table public.ferreteria_tokens from public, anon, authenticated;

grant select on public.ferreteria_productos to authenticated;
grant select on public.ferreteria_costos to authenticated;
grant select on public.ferreteria_publicaciones to authenticated;
grant select on public.ferreteria_eventos to authenticated;
grant select on public.ferreteria_mediciones to authenticated;
grant select on public.ferreteria_conversaciones to authenticated;
grant select on public.ferreteria_ventas to authenticated;

-- ── 11. Activación en dimpro ─────────────────────────────────────────────────
-- Escritura de datos: una fila de historia y una llave del jsonb. Aborta si el workspace no es
-- el esperado, y es idempotente (correrla dos veces no duplica la fila).

do $$
declare
  v_ws constant uuid := '67f7af44-b5ac-4d5c-aa9e-44954368447c';
  v_mauricio constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';
  v_slug text;
begin
  select slug into v_slug from public.workspaces where id = v_ws;
  if v_slug is distinct from 'dimpro' then
    raise exception 'modulo_ferreteria: el workspace % no es dimpro (slug %)', v_ws, v_slug;
  end if;
  if not exists (select 1 from public.profiles where id = v_mauricio) then
    raise exception 'modulo_ferreteria: no existe el perfil % para registrar la activación', v_mauricio;
  end if;

  if not exists (
    select 1 from public.workspace_modulos
     where workspace_id = v_ws and modulo = 'ferreteria' and activo_hasta is null
  ) then
    insert into public.workspace_modulos (workspace_id, modulo, origen, activo_desde, motivo, registrado_por)
    values (
      v_ws, 'ferreteria', 'interno', now(),
      'Piloto Marketplace alianza Dimpro x MeTRIK (1-oct a 31-dic-2026). Spec del módulo aprobada por Mauricio el 2026-09-24.',
      v_mauricio
    );
  end if;

  update public.workspaces
     set modules = coalesce(modules, '{"business": true}'::jsonb) || '{"ferreteria": true}'::jsonb
   where id = v_ws;
end;
$$;
