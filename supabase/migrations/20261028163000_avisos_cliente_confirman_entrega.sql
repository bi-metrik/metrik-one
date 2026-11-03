-- ============================================================
-- SOE-031 — El acuse del correo al cliente confirma la entrega (y el rebote avisa al equipo)
--
-- LO QUE SE LE PROMETIÓ A SOENA (texto enviado a la clienta, 2026-10-28):
--   · el bloque muestra a qué correo se envió el certificado, cuándo, y si fue entregado;
--   · cuando el correo llegue, la confirmación de entrega se marca sola;
--   · si el correo rebota, la plataforma les avisa para corregir la dirección del cliente.
--
-- QUÉ TRAE ESTE ARCHIVO (genérico, no toca a ningún workspace por sí solo):
--   1. El tipo de bloque `avisos_cliente` (solo lectura). La configuración de SOENA va aparte
--      en 20261028163100.
--   2. `aviso_cliente_rebotado` entra al vocabulario de `notificaciones.tipo`.
--   3. El trigger `avisos_cliente_tras_acuse` sobre `avisos_cliente`.
--
-- ¿POR QUÉ UN TRIGGER Y NO EL WEBHOOK DE RESEND?
--   · El hecho que importa es «la fila del aviso pasó a entregada / rebotada», no «llegó un
--     POST de Resend». Esa fila la cambian el webhook (`resend-webhook`) y el backfill de acuses
--     (`scripts/backfill-acuses-resend.ts`); el trigger los cubre a los dos y a cualquiera que
--     venga, sin una segunda copia de la regla en Deno.
--   · Corre en la MISMA transacción que el acuse: o quedan los dos, o ninguno. Con el webhook
--     haría falta una segunda escritura que puede fallar después de que el acuse ya quedó.
--   · No hay que redesplegar ninguna edge function: aplicar la migración basta.
--   · No mira la etapa en la que está el negocio hoy: busca el bloque por la etapa del AVISO
--     (`avisos_cliente.etapa_id`), así que el acuse que llega con el caso ya en Facturación
--     igual marca la confirmación de Entrega.
--
-- OPT-IN POR BLOQUE. El trigger solo actúa cuando la etapa del aviso tiene un bloque de tipo
-- `avisos_cliente`. Sin eso, ningún workspace cambia. Contrato de su `config_extra`:
--   {
--     "canal": "email",
--     "que_se_envio": "el certificado UPME",          -- cómo se nombra en los textos
--     "confirmar": {                                  -- opcional: el gate que se marca solo
--       "bloque_config_id": "<uuid del bloque datos>",
--       "campo": "certificado_entregado",             -- checkbox (obligatorio en el contrato)
--       "campo_fecha": "fecha_entrega",               -- opcional: YYYY-MM-DD, hora Bogotá
--       "campo_notas": "notas"                        -- opcional: deja la nota de la marca
--     },
--     "avisar_rebote": true                           -- campana al equipo (por defecto sí)
--   }
--
-- GUARDAS (todas en la base, ninguna en la pantalla):
--   · Solo el aviso de ENTRADA a la etapa (`bloque_config_id is null`). Los avisos por
--     documento cargado (la factura) también guardan la etapa donde estaba el caso: si
--     contaran, «llegó la factura» marcaría «certificado entregado».
--   · Solo correo. WhatsApp no da acuse de entrega.
--   · Solo avisos de los últimos 7 días. El backfill de acuses reescribe filas viejas: sin
--     esto marcaría gates de casos cerrados y llenaría la campana de rebotes de septiembre.
--     Svix reintenta hasta ~10 h, así que un acuse real nunca queda por fuera.
--   · Entregado: solo si la fila sigue `enviado` (un `delivered` tardío sobre un rebote no
--     marca nada). Rebote/supresión: solo en el cambio de estado.
--   · Idempotente: el webhook ya garantiza que cada acuse cambia la fila una sola vez, y
--     además la marca no se repite si el campo ya está en `true`.
--   · NUNCA pisa una marca manual: si `campo` ya es `true`, no toca nada. La fecha y las
--     notas que ya escribió una persona tampoco se reemplazan (la nota se agrega al final).
--   · Rebote después de una entrega que ya marcó el gate: se deshace SOLO la marca
--     automática de ESE aviso (lo registra `_auto_entrega` en la data del bloque). Una marca
--     manual nunca se deshace.
--   · Un error aquí NO tumba el acuse: se registra como WARNING y el acuse queda. Perder la
--     marca es un clic del equipo; perder el acuse (y que Svix reintente 10 h) es peor.
--
-- TRAZA: cada marca, cada reversión y cada rebote deja una fila en `activity_log` con tipo
-- `cambio_sistema` / `sistema` (no cuentan como gestión del negocio: lista blanca de
-- `ultima_actividad_negocio`).
--
-- ⚠️ ORDEN: esta migración ANTES que 20261028163100 (la de SOENA usa el tipo nuevo). Antes del
-- merge del PR: el código nuevo pinta el bloque; sin la migración el tipo no existe y nadie lo
-- configura, así que el orden inverso tampoco rompe nada.
--
-- epoca: no-rompe los DROP son de un CHECK que se vuelve a crear ampliado y de un trigger que se recrea en este mismo archivo
-- ============================================================


-- ── 1. Tipo de bloque `avisos_cliente` ─────────────────────────────────────────

do $$
declare
  v_def text;
  v_nueva text;
  v_codigo text;
  n int;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'bloque_definitions_tipo_check'
     and conrelid = 'public.bloque_definitions'::regclass;
  if v_def is null then
    raise exception 'avisos_cliente: no existe bloque_definitions_tipo_check; no se amplía a ciegas';
  end if;

  if position('''avisos_cliente''' in v_def) = 0 then
    v_nueva := regexp_replace(v_def, '\]\)\)\)$', ', ''avisos_cliente''::text])))');
    if position('''avisos_cliente''' in v_nueva) = 0 then
      raise exception 'avisos_cliente: forma inesperada de bloque_definitions_tipo_check: %', v_def;
    end if;
    alter table public.bloque_definitions drop constraint bloque_definitions_tipo_check;
    execute format('alter table public.bloque_definitions add constraint bloque_definitions_tipo_check %s', v_nueva);
  end if;

  if exists (select 1 from public.bloque_definitions where tipo = 'avisos_cliente') then
    return;
  end if;

  -- `codigo` es único y no se puede leer producción desde el PR: el primer Bnn libre desde B33.
  n := 33;
  loop
    v_codigo := 'B' || lpad(n::text, 2, '0');
    exit when not exists (select 1 from public.bloque_definitions where codigo = v_codigo);
    n := n + 1;
  end loop;

  insert into public.bloque_definitions
    (codigo, tipo, nombre, descripcion, is_visualization, can_be_gate, supports_array_items, default_estado, icon_name)
  values
    (v_codigo, 'avisos_cliente', 'Correos al cliente',
     'Solo lectura: los correos que la plataforma le mandó al cliente al entrar a esta etapa, a qué dirección, cuándo y si llegaron o rebotaron. Con `confirmar` marca solo el gate de entrega cuando llega el acuse',
     true, false, false, 'visible', 'MailCheck');
end $$;


-- ── 2. `aviso_cliente_rebotado` en la campana ──────────────────────────────────

do $$
declare
  v_def text;
  v_nueva text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'notificaciones_tipo_check'
     and conrelid = 'public.notificaciones'::regclass;
  if v_def is null then
    raise exception 'aviso_cliente_rebotado: no existe notificaciones_tipo_check; no se amplía a ciegas';
  end if;
  if position('''aviso_cliente_rebotado''' in v_def) > 0 then
    return;
  end if;
  v_nueva := regexp_replace(v_def, '\]\)\)\)$', ', ''aviso_cliente_rebotado''::text])))');
  if position('''aviso_cliente_rebotado''' in v_nueva) = 0 then
    raise exception 'aviso_cliente_rebotado: forma inesperada de notificaciones_tipo_check: %', v_def;
  end if;
  alter table public.notificaciones drop constraint notificaciones_tipo_check;
  execute format('alter table public.notificaciones add constraint notificaciones_tipo_check %s', v_nueva);
end $$;


-- ── 3. La marca: el correo llegó ────────────────────────────────────────────────

create or replace function public.aviso_cliente_confirmar_entrega(
  p_aviso public.avisos_cliente,
  p_cfg jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_conf        jsonb := p_cfg -> 'confirmar';
  v_bc_id       uuid;
  v_campo       text;
  v_campo_fecha text;
  v_campo_notas text;
  v_que         text := coalesce(nullif(btrim(p_cfg ->> 'que_se_envio'), ''), 'el aviso');
  v_gate_nombre text;
  v_nb          record;
  v_fecha       text;
  v_nota        text;
  v_data        jsonb;
  v_puso_fecha  boolean := false;
begin
  if v_conf is null or jsonb_typeof(v_conf) <> 'object' then return 'sin_confirmar'; end if;
  v_campo := nullif(btrim(v_conf ->> 'campo'), '');
  v_campo_fecha := nullif(btrim(v_conf ->> 'campo_fecha'), '');
  v_campo_notas := nullif(btrim(v_conf ->> 'campo_notas'), '');
  begin
    v_bc_id := (v_conf ->> 'bloque_config_id')::uuid;
  exception when invalid_text_representation then
    return 'config_invalida';
  end;
  if v_bc_id is null or v_campo is null then return 'config_invalida'; end if;

  -- El gate tiene que ser del MISMO workspace que el aviso: un id copiado de otro espacio no
  -- puede escribir en un negocio ajeno.
  select coalesce(bc.nombre, 'Confirmación de entrega') into v_gate_nombre
    from bloque_configs bc
   where bc.id = v_bc_id and bc.workspace_id = p_aviso.workspace_id;
  if not found then return 'gate_inexistente'; end if;

  -- La fila del gate. Normalmente ya existe (se crea al entrar a la etapa); si no, se crea
  -- vacía. `for update` serializa contra un guardado manual simultáneo.
  insert into negocio_bloques (negocio_id, bloque_config_id)
  values (p_aviso.negocio_id, v_bc_id)
  on conflict (negocio_id, bloque_config_id) do nothing;

  select id, data, estado into v_nb
    from negocio_bloques
   where negocio_id = p_aviso.negocio_id and bloque_config_id = v_bc_id
   for update;

  -- Marca manual (o automática anterior): no se toca nada.
  if coalesce(v_nb.data -> v_campo, 'null'::jsonb) = 'true'::jsonb then return 'ya_marcado'; end if;

  v_fecha := to_char((p_aviso.entregado_at at time zone 'America/Bogota')::date, 'YYYY-MM-DD');
  v_nota := 'Marcado automáticamente: el correo con ' || v_que || ' a '
    || coalesce(p_aviso.destino, 'el cliente') || ' fue entregado el ' || v_fecha || '.';

  v_data := coalesce(v_nb.data, '{}'::jsonb) || jsonb_build_object(v_campo, true);
  if v_campo_fecha is not null and coalesce(v_nb.data ->> v_campo_fecha, '') = '' then
    v_data := v_data || jsonb_build_object(v_campo_fecha, v_fecha);
    v_puso_fecha := true;
  end if;
  if v_campo_notas is not null then
    v_data := v_data || jsonb_build_object(
      v_campo_notas,
      case when coalesce(btrim(v_nb.data ->> v_campo_notas), '') = '' then v_nota
           else (v_nb.data ->> v_campo_notas) || E'\n' || v_nota end
    );
  end if;
  -- Lo que hizo la máquina, para poder deshacer SOLO esto si el correo rebota después.
  v_data := v_data || jsonb_build_object('_auto_entrega', jsonb_build_object(
    'aviso_id', p_aviso.id,
    'destino', p_aviso.destino,
    'entregado_at', p_aviso.entregado_at,
    'marcado_at', now(),
    'fecha', case when v_puso_fecha then v_fecha end,
    'nota', case when v_campo_notas is not null then v_nota end
  ));

  update negocio_bloques
     set data = v_data,
         estado = 'completo',
         completado_at = coalesce(completado_at, now()),
         -- Nadie lo completó: lo completó el acuse. `completado_por` es FK a profiles.
         completado_por = null
   where id = v_nb.id;

  insert into activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, campo_modificado, valor_nuevo, contenido)
  values (p_aviso.workspace_id, 'negocio', p_aviso.negocio_id, 'cambio_sistema', null, 'bloque_datos', v_fecha,
          left('«' || v_gate_nombre || '» marcado automáticamente: el correo con ' || v_que || ' a '
               || coalesce(p_aviso.destino, 'el cliente') || ' fue entregado el ' || v_fecha || '.', 1000));

  return 'marcado';
end;
$fn$;

comment on function public.aviso_cliente_confirmar_entrega(public.avisos_cliente, jsonb) is
  'SOE-031. Marca el gate declarado en `config_extra.confirmar` del bloque avisos_cliente cuando el correo al cliente queda entregado. No pisa una marca manual. La llama el trigger avisos_cliente_tras_acuse.';

revoke execute on function public.aviso_cliente_confirmar_entrega(public.avisos_cliente, jsonb) from public, anon, authenticated;


-- ── 4. El rebote: se deshace la marca automática y se avisa al equipo ──────────

create or replace function public.aviso_cliente_rebote(
  p_aviso public.avisos_cliente,
  p_cfg jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_conf        jsonb := p_cfg -> 'confirmar';
  v_que         text := coalesce(nullif(btrim(p_cfg ->> 'que_se_envio'), ''), 'el aviso');
  v_bc_id       uuid;
  v_campo       text;
  v_campo_fecha text;
  v_campo_notas text;
  v_nb          record;
  v_auto        jsonb;
  v_data        jsonb;
  v_notas       text;
  v_neg         record;
  v_etiqueta    text;
  v_texto       text;
  v_destinos    uuid[];
  v_p           uuid;
  v_resultado   text := 'sin_marca';
begin
  -- (a) Si una entrega anterior de ESTE aviso marcó el gate, se deshace esa marca.
  if v_conf is not null and jsonb_typeof(v_conf) = 'object' then
    v_campo := nullif(btrim(v_conf ->> 'campo'), '');
    v_campo_fecha := nullif(btrim(v_conf ->> 'campo_fecha'), '');
    v_campo_notas := nullif(btrim(v_conf ->> 'campo_notas'), '');
    begin
      v_bc_id := (v_conf ->> 'bloque_config_id')::uuid;
    exception when invalid_text_representation then
      v_bc_id := null;
    end;

    if v_bc_id is not null and v_campo is not null then
      select nb.id, nb.data, nb.completado_por into v_nb
        from negocio_bloques nb
        join bloque_configs bc on bc.id = nb.bloque_config_id and bc.workspace_id = p_aviso.workspace_id
       where nb.negocio_id = p_aviso.negocio_id and nb.bloque_config_id = v_bc_id
       for update of nb;

      if found then v_auto := v_nb.data -> '_auto_entrega'; end if;
      if v_auto is not null
         and v_auto ->> 'aviso_id' = p_aviso.id::text
         and v_auto ->> 'revertido_at' is null
         and coalesce(v_nb.data -> v_campo, 'null'::jsonb) = 'true'::jsonb then
        v_data := v_nb.data || jsonb_build_object(v_campo, false);
        if v_campo_fecha is not null and v_auto ->> 'fecha' is not null
           and v_nb.data ->> v_campo_fecha = v_auto ->> 'fecha' then
          v_data := v_data - v_campo_fecha;
        end if;
        if v_campo_notas is not null and v_auto ->> 'nota' is not null then
          v_notas := v_nb.data ->> v_campo_notas;
          if v_notas = v_auto ->> 'nota' then
            v_data := v_data - v_campo_notas;
          elsif v_notas is not null then
            v_data := v_data || jsonb_build_object(v_campo_notas,
              replace(v_notas, E'\n' || (v_auto ->> 'nota'), ''));
          end if;
        end if;
        v_data := v_data || jsonb_build_object('_auto_entrega', v_auto || jsonb_build_object('revertido_at', now()));

        update negocio_bloques
           set data = v_data,
               -- Solo se reabre si lo cerró el acuse (`completado_por` nulo). Si una persona lo
               -- completó después, su cierre se respeta.
               estado = case when completado_por is null then 'pendiente' else estado end,
               completado_at = case when completado_por is null then null else completado_at end
         where id = v_nb.id;

        insert into activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, campo_modificado, valor_anterior, valor_nuevo, contenido)
        values (p_aviso.workspace_id, 'negocio', p_aviso.negocio_id, 'cambio_sistema', null, 'bloque_datos', 'true', 'false',
                left('Se deshizo la confirmación automática de entrega: el correo con ' || v_que || ' a '
                     || coalesce(p_aviso.destino, 'el cliente') || ' rebotó después de entregado.', 1000));
        v_resultado := 'marca_deshecha';
      end if;
    end if;
  end if;

  -- (b) Huella en la historia del negocio, siempre.
  v_texto := case when p_aviso.estado = 'suprimido'
    then 'El correo con ' || v_que || ' a ' || coalesce(p_aviso.destino, 'el cliente')
         || ' no se envió: esa dirección ya había rebotado antes. Corrijan el correo del cliente.'
    else 'El correo con ' || v_que || ' a ' || coalesce(p_aviso.destino, 'el cliente')
         || ' rebotó. Corrijan el correo del cliente y vuelvan a enviárselo.'
  end;
  insert into activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, campo_modificado, valor_nuevo, contenido)
  values (p_aviso.workspace_id, 'negocio', p_aviso.negocio_id, 'sistema', null, 'aviso_cliente', p_aviso.estado,
          left(v_texto || coalesce(' Motivo: ' || nullif(p_aviso.motivo, '') || '.', ''), 1000));

  -- (c) La campana. Por defecto sí; el bloque la apaga con `avisar_rebote: false`.
  if coalesce(p_cfg ->> 'avisar_rebote', 'true') = 'false' then return v_resultado; end if;

  select codigo, nombre into v_neg from negocios where id = p_aviso.negocio_id;
  v_etiqueta := coalesce(nullif(btrim(coalesce(v_neg.codigo, '') || ' — ' || coalesce(v_neg.nombre, '')), '—'), 'Negocio');

  -- Quien lleva el caso: sus responsables (comercial y operaciones). Sin ninguno, la regla de
  -- siempre del sistema (`destinatarios_negocio`: responsable del stage o su supervisor).
  select array_agg(distinct s.profile_id) into v_destinos
    from negocio_responsables nr
    join staff s on s.id = nr.staff_id
   where nr.negocio_id = p_aviso.negocio_id and s.profile_id is not null;
  if v_destinos is null then
    select array_agg(distinct d.profile_id) into v_destinos
      from destinatarios_negocio(p_aviso.negocio_id) d
     where d.profile_id is not null;
  end if;

  foreach v_p in array coalesce(v_destinos, array[]::uuid[]) loop
    -- Un aviso por persona y por correo rebotado, aunque el acuse se reprocese.
    if not exists (
      select 1 from notificaciones
       where destinatario_id = v_p and tipo = 'aviso_cliente_rebotado'
         and metadata ->> 'aviso_id' = p_aviso.id::text
    ) then
      insert into notificaciones (workspace_id, destinatario_id, tipo, contenido, entidad_tipo, entidad_id, deep_link, metadata, estado)
      values (p_aviso.workspace_id, v_p, 'aviso_cliente_rebotado',
              left(v_etiqueta || ': ' || v_texto, 500),
              'negocio', p_aviso.negocio_id, '/negocios/' || p_aviso.negocio_id,
              jsonb_build_object('aviso_id', p_aviso.id, 'destino', p_aviso.destino, 'estado', p_aviso.estado, 'motivo', p_aviso.motivo),
              'pendiente');
    end if;
  end loop;

  return v_resultado;
end;
$fn$;

comment on function public.aviso_cliente_rebote(public.avisos_cliente, jsonb) is
  'SOE-031. Correo al cliente rebotado o suprimido: deshace la marca automática de entrega de ese aviso (nunca una manual), deja huella en activity_log y avisa en la campana a los responsables del negocio. La llama el trigger avisos_cliente_tras_acuse.';

revoke execute on function public.aviso_cliente_rebote(public.avisos_cliente, jsonb) from public, anon, authenticated;


-- ── 5. El trigger ──────────────────────────────────────────────────────────────

create or replace function public.avisos_cliente_tras_acuse()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_entregado boolean;
  v_rebote    boolean;
  v_cfg       record;
begin
  if new.canal <> 'email' or new.etapa_id is null or new.bloque_config_id is not null then return new; end if;
  if new.created_at < now() - interval '7 days' then return new; end if;

  v_entregado := old.entregado_at is null and new.entregado_at is not null and new.estado = 'enviado';
  v_rebote := old.estado is distinct from new.estado and new.estado in ('rebotado', 'suprimido');
  if not v_entregado and not v_rebote then return new; end if;

  for v_cfg in
    select bc.id, bc.config_extra
      from bloque_configs bc
      join bloque_definitions bd on bd.id = bc.bloque_definition_id
     where bc.etapa_id = new.etapa_id
       and bc.workspace_id = new.workspace_id
       and bd.tipo = 'avisos_cliente'
       and coalesce(bc.config_extra ->> 'canal', 'email') = 'email'
     order by bc.orden, bc.id
  loop
    begin
      if v_entregado then
        perform aviso_cliente_confirmar_entrega(new, coalesce(v_cfg.config_extra, '{}'::jsonb));
      end if;
      if v_rebote then
        perform aviso_cliente_rebote(new, coalesce(v_cfg.config_extra, '{}'::jsonb));
      end if;
    exception when others then
      -- El acuse se queda aunque la marca falle (ver encabezado).
      raise warning '[avisos_cliente_tras_acuse] aviso % bloque %: % (%)', new.id, v_cfg.id, sqlerrm, sqlstate;
    end;
  end loop;

  return new;
end;
$fn$;

comment on function public.avisos_cliente_tras_acuse() is
  'SOE-031. Al llegar el acuse de un correo al cliente (entregado o rebotado), aplica lo que declara el bloque avisos_cliente de la etapa del aviso. Opt-in por bloque.';

revoke execute on function public.avisos_cliente_tras_acuse() from public, anon, authenticated;

drop trigger if exists trg_avisos_cliente_tras_acuse on public.avisos_cliente;
create trigger trg_avisos_cliente_tras_acuse
after update of entregado_at, estado on public.avisos_cliente
for each row execute function public.avisos_cliente_tras_acuse();
