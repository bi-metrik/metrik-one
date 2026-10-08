-- ============================================================
-- Autorizacion de tratamiento de datos por link del cliente final (Trappvel primero)
-- ------------------------------------------------------------
-- Decision de Mauricio (2026-10-08) y texto de Emilio
-- (proyectos/trappvel/clarity/docs/entrega/legal/2026-10-08_autorizacion-datos-link-cliente.md):
-- la autorizacion la da el TITULAR en una pagina publica con token, no la comercial con un clic.
--
--   1. `autorizacion_datos_textos` — el texto, versionado y POR WORKSPACE. Una fila por version
--      (`mayor.menor`). No se edita: un cambio de texto es una version nueva (lo impide el trigger).
--      `plantilla_sha256` lo calcula la base al insertar, para que nadie lo escriba a mano.
--      El Encargado, el canal de datos y el Responsable viajan en `variables` de la version: son
--      parte del texto (cambiar el Encargado es una version menor), no una constante del codigo.
--   2. `autorizacion_datos_enlaces` — un enlace por CONTACTO (no por viaje), con su token y, cuando
--      el titular responde, la evidencia: casillas marcadas una por una, version mayor y menor,
--      sha256 del texto que vio, medio, ip y navegador. Aceptado, no cambia (salvo `revocadas`).
--   3. `autorizacion_datos_estado()` — la regla de vigencia, UNA vez, para la app (gate, bloque) y
--      para el bot (edge function): vale sin plazo; solo una version MAYOR posterior la vuelve a
--      pedir; las marcas manuales viejas (`custom_data.autorizacion_datos`) NO cuentan.
--   4. `autorizacion_datos_enlace()` — reusa el enlace pendiente del contacto o crea uno.
--
-- No escribe datos: crea dos tablas vacias y dos funciones. Nada cambia en ningun workspace hasta
-- que (a) se publique un texto en `autorizacion_datos_textos` y (b) la etapa declare el gate
-- `autorizacion_datos` en `config_extra.gates`.
--
-- Verificacion despues de aplicar (solo lectura):
--   select relname, relrowsecurity, relacl from pg_class
--    where relname in ('autorizacion_datos_textos', 'autorizacion_datos_enlaces');
--     -> relrowsecurity = true, sin entradas para anon ni authenticated
--   select proname, has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth,
--          has_function_privilege('service_role', p.oid, 'execute') as svc
--     from pg_proc p where proname like 'autorizacion_datos%';
--     -> anon false, auth false, svc true en las dos RPC
-- ============================================================

-- ── 1. El texto, versionado por workspace ──────────────────────────────────────

-- server-only: la lee la pagina publica (service_role) y la carga la sesion principal por SQL.
-- Ningun usuario con sesion la consulta directo: el bloque y el gate leen el estado por la RPC.
create table public.autorizacion_datos_textos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),

  -- La version tal como se cita en la evidencia: `trappvel-autorizacion-cliente-v1.0`.
  version text not null
    constraint autorizacion_textos_version_largo check (char_length(btrim(version)) between 1 and 80),
  -- Mayor y menor por separado: el gate compara SOLO la mayor (Emilio, pieza 4.2). Una version
  -- menor (redaccion, un proveedor, el Encargado) se informa y no vuelve a pedir la autorizacion.
  mayor integer not null constraint autorizacion_textos_mayor check (mayor >= 1),
  menor integer not null default 0 constraint autorizacion_textos_menor check (menor >= 0),

  titulo text not null constraint autorizacion_textos_titulo check (char_length(btrim(titulo)) > 0),
  -- Lo que el cliente ve antes de las casillas (pieza 1), en markdown simple: parrafos, **negrita**,
  -- listas con «- » y titulos con «## ». Marcadores [NOMBRE_CLIENTE], [AGENCIA], [RESPONSABLE],
  -- [ENCARGADO], [CANAL_DATOS], [URL_DETALLE], [VERSION]: los llena ONE al mostrarlo.
  cuerpo_md text not null constraint autorizacion_textos_cuerpo check (char_length(btrim(cuerpo_md)) > 0),
  -- El detalle completo (pieza 1b), en su propia pagina. Opcional.
  detalle_md text,
  -- Las casillas, en orden: [{ "clave": "generales"|"sensibles"|"menores"|"ofertas", "texto": "…" }].
  -- `generales` es obligatoria siempre; `menores` la exige el gate si el viaje lleva menores;
  -- `ofertas` solo se muestra si el workspace la activa (config_extra.autorizacion_datos.ofertas).
  casillas jsonb not null
    constraint autorizacion_textos_casillas check (
      jsonb_typeof(casillas) = 'array'
      and jsonb_path_exists(casillas, '$[*] ? (@.clave == "generales")')
      and not jsonb_path_exists(casillas, '$[*] ? (!(@.clave == "generales" || @.clave == "sensibles" || @.clave == "menores" || @.clave == "ofertas"))')
    ),
  -- Los valores de los marcadores que no salen del workspace: { "encargado": "…", "canal_datos":
  -- "…", "responsable": "…" (opcional; sin el, razon social + NIT del perfil fiscal) }.
  variables jsonb not null default '{}'::jsonb
    constraint autorizacion_textos_variables check (jsonb_typeof(variables) = 'object'),
  -- Los mensajes de envio (pieza 3): { "correo_asunto", "correo_cuerpo", "whatsapp",
  -- "instruccion_comercial" }. Lo que falte, ONE lo cubre con su texto por defecto.
  mensajes jsonb not null default '{}'::jsonb
    constraint autorizacion_textos_mensajes check (jsonb_typeof(mensajes) = 'object'),

  -- Huella de todo lo anterior. La calcula el trigger: no se escribe a mano.
  plantilla_sha256 text not null default '',

  -- Desde cuando rige. Una version con fecha futura no es vigente todavia.
  publicado_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint autorizacion_textos_version_unica unique (workspace_id, version),
  constraint autorizacion_textos_numero_unico unique (workspace_id, mayor, menor)
);

alter table public.autorizacion_datos_textos enable row level security;
revoke all on table public.autorizacion_datos_textos from public, anon, authenticated;

create index idx_autorizacion_textos_vigente
  on public.autorizacion_datos_textos (workspace_id, publicado_at desc);

comment on table public.autorizacion_datos_textos is
  'Texto de la autorizacion de datos del cliente final, versionado por workspace. No se edita: un cambio es una version nueva. Solo la version mayor vuelve a pedir la autorizacion.';

create or replace function public.autorizacion_datos_textos_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'autorizacion_datos_textos %: un texto publicado no se edita; publica una version nueva', old.id;
  end if;
  -- `sha256()` es nativa de PostgreSQL (11+): sin pgcrypto. El texto canonico es el jsonb de los
  -- campos que el cliente ve o que llenan sus marcadores; jsonb ordena las llaves solo.
  new.plantilla_sha256 := encode(sha256(convert_to(jsonb_build_object(
    'version', new.version, 'mayor', new.mayor, 'menor', new.menor, 'titulo', new.titulo,
    'cuerpo_md', new.cuerpo_md, 'detalle_md', new.detalle_md, 'casillas', new.casillas,
    'variables', new.variables, 'mensajes', new.mensajes
  )::text, 'UTF8')), 'hex');
  return new;
end;
$$;

revoke execute on function public.autorizacion_datos_textos_guardas() from public, anon, authenticated;

create trigger trg_autorizacion_datos_textos_guardas
before insert or update on public.autorizacion_datos_textos
for each row execute function public.autorizacion_datos_textos_guardas();

-- ── 2. El enlace del contacto y su evidencia ────────────────────────────────────

-- server-only: la escriben la app (service_role, tras validar permiso del bloque o la etapa), la
-- pagina publica (service_role, con el token) y el bot (edge function). Guarda ip y navegador del
-- titular: nadie la lee con sesion; el estado sale por `autorizacion_datos_estado`.
create table public.autorizacion_datos_enlaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  -- Por CONTACTO, no por viaje: un cliente recurrente autoriza una vez.
  contacto_id uuid not null references public.contactos(id) on delete cascade,
  -- El viaje desde el que se pidio, solo como contexto. No condiciona nada.
  negocio_id uuid references public.negocios(id) on delete set null,

  -- 32 bytes al azar en base64url: no se adivina. Se valida la forma para que una ruta con `/` o
  -- `..` no llegue nunca a una consulta.
  token text not null unique
    constraint autorizacion_enlaces_token_forma check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  -- staff que lo pidio (bloque, gate o bot). Null si lo genero el correo automatico.
  creado_por uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Hasta cuando se puede AUTORIZAR con este token. Ya autorizado, el token sigue sirviendo
  -- para ver lo que se autorizo (pieza 2).
  expira_at timestamptz not null,

  -- El ultimo correo con este enlace. Es la llave de «no mandarlo dos veces».
  correo_enviado_at timestamptz,
  correo_destino text,
  correo_origen text constraint autorizacion_enlaces_correo_origen check (correo_origen in ('al_crear', 'manual')),
  correo_resend_id text,

  -- «No autorizo». No cierra el enlace: si cambia de opinion, lo abre de nuevo y autoriza.
  rechazado_at timestamptz,

  -- ── La aceptacion ──
  aceptado_at timestamptz,
  -- `correo` / `whatsapp_reenviado` / `otro`: por dónde le llegó el LINK. `papel` / `whatsapp`: por dónde llegó la
  -- autorización que se registró con evidencia (vía `evidencia`).
  medio text constraint autorizacion_enlaces_medio check (medio in ('correo', 'whatsapp_reenviado', 'otro', 'papel', 'whatsapp')),
  texto_id uuid references public.autorizacion_datos_textos(id),
  texto_version text,
  texto_mayor integer,
  texto_menor integer,
  -- sha256 del texto EXACTO que se mostro (con el nombre del cliente y las casillas visibles).
  texto_sha256 text constraint autorizacion_enlaces_sha check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  -- Cada casilla por separado: { "generales": true, "sensibles": false, "menores": true,
  -- "ofertas": null }. null = no se le mostro.
  casillas jsonb,
  -- El Responsable y el Encargado como los leyo el titular.
  responsable text,
  encargado text,
  ip text,
  user_agent text,

  -- ── La vía «recibida por otro medio» (Emilio, pieza 4.4) ──
  -- `link`: la dio el titular en la página. `evidencia`: la registró alguien del equipo con el archivo que la prueba
  -- (papel firmado, captura del correo o del WhatsApp del cliente). Apagada por defecto en cada workspace
  -- (`config_extra.autorizacion_datos.registro_con_evidencia`). En la vía evidencia, `aceptado_at` es la fecha en que el
  -- CLIENTE autorizó, no la del registro (que es `created_at`).
  via text not null default 'link' constraint autorizacion_enlaces_via check (via in ('link', 'evidencia')),
  -- Referencia `one://` del archivo (bucket ve-documentos). Sin archivo no hay vía evidencia.
  evidencia_ref text,
  registrado_por uuid references public.staff(id) on delete set null,
  constraint autorizacion_enlaces_evidencia_completa check (
    via = 'link' or (evidencia_ref is not null and registrado_por is not null and aceptado_at is not null)
  ),

  -- Revocatoria por casilla (pieza 4.3): { "sensibles": { "at": "…", "motivo": "…" } }. Es lo UNICO
  -- que cambia en un enlace aceptado. La marca la sesion principal o el dueno del workspace.
  revocadas jsonb not null default '{}'::jsonb
    constraint autorizacion_enlaces_revocadas check (jsonb_typeof(revocadas) = 'object'),

  -- Una aceptacion trae toda su evidencia, y un enlace sin aceptar no trae ninguna.
  constraint autorizacion_enlaces_aceptacion_completa check (
    (aceptado_at is not null) = (
      medio is not null and texto_id is not null and texto_version is not null
      and texto_mayor is not null and texto_menor is not null and texto_sha256 is not null
      and casillas is not null and (casillas ->> 'generales') = 'true'
    )
  )
);

alter table public.autorizacion_datos_enlaces enable row level security;
revoke all on table public.autorizacion_datos_enlaces from public, anon, authenticated;

create index idx_autorizacion_enlaces_contacto
  on public.autorizacion_datos_enlaces (workspace_id, contacto_id, created_at desc);

comment on table public.autorizacion_datos_enlaces is
  'Enlace de autorizacion de datos por contacto y su evidencia (casillas, version, sha256, medio, ip, navegador). Aceptado, solo cambia `revocadas`.';

create or replace function public.autorizacion_datos_enlaces_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.contactos c where c.id = new.contacto_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'autorizacion_datos_enlaces: el contacto % no es del workspace %', new.contacto_id, new.workspace_id;
  end if;
  if new.texto_id is not null and not exists (
    select 1 from public.autorizacion_datos_textos t where t.id = new.texto_id and t.workspace_id = new.workspace_id
  ) then
    raise exception 'autorizacion_datos_enlaces: el texto % no es del workspace %', new.texto_id, new.workspace_id;
  end if;
  if tg_op = 'UPDATE' and old.aceptado_at is not null and (
       new.aceptado_at   is distinct from old.aceptado_at
    or new.workspace_id  is distinct from old.workspace_id
    or new.contacto_id   is distinct from old.contacto_id
    or new.token         is distinct from old.token
    or new.medio         is distinct from old.medio
    or new.texto_id      is distinct from old.texto_id
    or new.texto_version is distinct from old.texto_version
    or new.texto_mayor   is distinct from old.texto_mayor
    or new.texto_menor   is distinct from old.texto_menor
    or new.texto_sha256  is distinct from old.texto_sha256
    or new.casillas      is distinct from old.casillas
    or new.responsable   is distinct from old.responsable
    or new.encargado     is distinct from old.encargado
    or new.ip            is distinct from old.ip
    or new.user_agent    is distinct from old.user_agent
    or new.via           is distinct from old.via
    or new.evidencia_ref is distinct from old.evidencia_ref
    or new.registrado_por is distinct from old.registrado_por
  ) then
    raise exception 'autorizacion_datos_enlaces %: ya tiene la aceptacion del titular y es evidencia; solo se marca la revocatoria', old.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.autorizacion_datos_enlaces_guardas() from public, anon, authenticated;

create trigger trg_autorizacion_datos_enlaces_guardas
before insert or update on public.autorizacion_datos_enlaces
for each row execute function public.autorizacion_datos_enlaces_guardas();

-- ── 3. El estado: la regla de vigencia, una sola vez ────────────────────────────

-- Lo leen el gate y el bloque (Next, service_role) y el bot (edge function, service_role).
-- Devuelve:
--   { existe, contacto: {nombre, email},
--     texto: {id, version, mayor, menor} | null,                -- la version vigente
--     aceptacion: {enlace_id, aceptado_at, version, mayor, menor, medio, casillas} | null,
--     vigente: {generales, sensibles, menores, ofertas},        -- casilla aceptada, no revocada,
--                                                               -- de la version MAYOR vigente
--     requiere_reaceptar,                                       -- acepto una mayor anterior
--     pendiente: {enlace_id, token, expira_at, correo_enviado_at, rechazado_at} | null,
--     manual_sin_evidencia: {fecha} | null }                    -- la marca vieja: no cuenta
create or replace function public.autorizacion_datos_estado(p_workspace_id uuid, p_contacto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c   record;
  v_t   record;
  v_a   record;
  v_p   record;
  v_vig jsonb;
  v_ok  boolean;
  v_man jsonb;
  v_marca text;
begin
  select c.nombre, c.email, c.custom_data into v_c
  from public.contactos c
  where c.id = p_contacto_id and c.workspace_id = p_workspace_id;
  if not found then return jsonb_build_object('existe', false); end if;

  select t.id, t.version, t.mayor, t.menor into v_t
  from public.autorizacion_datos_textos t
  where t.workspace_id = p_workspace_id and t.publicado_at <= now()
  order by t.mayor desc, t.menor desc
  limit 1;

  select e.id, e.aceptado_at, e.texto_version, e.texto_mayor, e.texto_menor, e.medio, e.casillas, e.revocadas, e.via into v_a
  from public.autorizacion_datos_enlaces e
  where e.workspace_id = p_workspace_id and e.contacto_id = p_contacto_id and e.aceptado_at is not null
  order by e.texto_mayor desc, e.aceptado_at desc
  limit 1;

  -- Sin texto vigente no hay nada que se pueda haber autorizado: todo en falso.
  v_ok := v_t.id is not null and v_a.id is not null and v_a.texto_mayor >= v_t.mayor;
  v_vig := jsonb_build_object(
    'generales', v_ok and coalesce((v_a.casillas ->> 'generales') = 'true', false) and not (v_a.revocadas ? 'generales'),
    'sensibles', v_ok and coalesce((v_a.casillas ->> 'sensibles') = 'true', false) and not (v_a.revocadas ? 'sensibles'),
    'menores',   v_ok and coalesce((v_a.casillas ->> 'menores') = 'true', false) and not (v_a.revocadas ? 'menores'),
    'ofertas',   v_ok and coalesce((v_a.casillas ->> 'ofertas') = 'true', false) and not (v_a.revocadas ? 'ofertas')
  );
  -- Revocar la general tumba todo lo demas: sin ella no hay tratamiento.
  if v_a.id is not null and v_a.revocadas ? 'generales' then
    v_vig := jsonb_build_object('generales', false, 'sensibles', false, 'menores', false, 'ofertas', false);
  end if;

  select e.id, e.token, e.expira_at, e.correo_enviado_at, e.rechazado_at into v_p
  from public.autorizacion_datos_enlaces e
  where e.workspace_id = p_workspace_id and e.contacto_id = p_contacto_id
    and e.aceptado_at is null and e.expira_at > now()
  order by e.created_at desc
  limit 1;

  -- La marca del boton de un clic (antes del 2026-10-08). Se muestra con su etiqueta; NO cuenta.
  v_marca := lower(coalesce(v_c.custom_data ->> 'autorizacion_datos', ''));
  v_man := case when v_marca in ('true', '1') then
    jsonb_build_object('fecha', nullif(v_c.custom_data ->> 'autorizacion_datos_fecha', ''))
  else null end;

  return jsonb_build_object(
    'existe', true,
    'contacto', jsonb_build_object('nombre', v_c.nombre, 'email', nullif(btrim(coalesce(v_c.email, '')), '')),
    'texto', case when v_t.id is null then null else jsonb_build_object(
      'id', v_t.id, 'version', v_t.version, 'mayor', v_t.mayor, 'menor', v_t.menor) end,
    'aceptacion', case when v_a.id is null then null else jsonb_build_object(
      'enlace_id', v_a.id, 'aceptado_at', v_a.aceptado_at, 'version', v_a.texto_version,
      'mayor', v_a.texto_mayor, 'menor', v_a.texto_menor, 'medio', v_a.medio,
      'casillas', v_a.casillas, 'revocadas', v_a.revocadas, 'via', v_a.via) end,
    'vigente', v_vig,
    'requiere_reaceptar', v_a.id is not null and v_t.id is not null and v_a.texto_mayor < v_t.mayor,
    'pendiente', case when v_p.id is null then null else jsonb_build_object(
      'enlace_id', v_p.id, 'token', v_p.token, 'expira_at', v_p.expira_at,
      'correo_enviado_at', v_p.correo_enviado_at, 'rechazado_at', v_p.rechazado_at) end,
    'manual_sin_evidencia', v_man
  );
end;
$$;

revoke execute on function public.autorizacion_datos_estado(uuid, uuid) from public, anon, authenticated;
grant execute on function public.autorizacion_datos_estado(uuid, uuid) to service_role;

-- ── 4. El enlace: reusar el pendiente o crear uno ───────────────────────────────

-- El token lo genera quien llama (Node `crypto.randomBytes`, Deno `crypto.getRandomValues`) y
-- solo se usa si hay que crear: asi no depende de pgcrypto. Un pendiente que vence en menos de un
-- dia no se reusa: mandarle a alguien un link que se apaga manana es mandarle un problema.
-- El candado por contacto evita dos enlaces si el bot y la pantalla piden a la vez.
create or replace function public.autorizacion_datos_enlace(
  p_workspace_id uuid,
  p_contacto_id uuid,
  p_token_nuevo text,
  p_creado_por uuid default null,
  p_negocio_id uuid default null,
  p_dias integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e record;
begin
  if not exists (
    select 1 from public.contactos c where c.id = p_contacto_id and c.workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'contacto_no_encontrado');
  end if;

  perform pg_advisory_xact_lock(hashtext('autorizacion_datos_enlace:' || p_contacto_id::text));

  select e.id, e.token, e.expira_at, e.correo_enviado_at into v_e
  from public.autorizacion_datos_enlaces e
  where e.workspace_id = p_workspace_id and e.contacto_id = p_contacto_id
    and e.aceptado_at is null and e.expira_at > now() + interval '1 day'
  order by e.created_at desc
  limit 1;

  if found then
    return jsonb_build_object('ok', true, 'creado', false, 'enlace_id', v_e.id, 'token', v_e.token,
      'expira_at', v_e.expira_at, 'correo_enviado_at', v_e.correo_enviado_at);
  end if;

  insert into public.autorizacion_datos_enlaces (workspace_id, contacto_id, negocio_id, token, creado_por, expira_at)
  values (p_workspace_id, p_contacto_id, p_negocio_id, p_token_nuevo, p_creado_por,
          now() + make_interval(days => greatest(coalesce(p_dias, 60), 2)))
  returning id, token, expira_at into v_e;

  return jsonb_build_object('ok', true, 'creado', true, 'enlace_id', v_e.id, 'token', v_e.token,
    'expira_at', v_e.expira_at, 'correo_enviado_at', null);
end;
$$;

revoke execute on function public.autorizacion_datos_enlace(uuid, uuid, text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.autorizacion_datos_enlace(uuid, uuid, text, uuid, uuid, integer) to service_role;
