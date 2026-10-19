-- Dry-run de supabase/migrations/20261019120000_guardar_reparto_comercial.sql contra producción.
--
-- UN solo statement: cuenta los cobros, crea la función (cuerpo pegado TAL CUAL entre $mig$),
-- la ejerce como un usuario de SOENA sobre una referencia inventada y dos negocios abiertos
-- con honorario, vuelve a contar y aborta con RAISE EXCEPTION. Nada queda escrito: el
-- resultado vuelve en el mensaje del error. Correrlo por MCP execute_sql y después confirmar:
--   select to_regprocedure('public.guardar_reparto_comercial(text,numeric,jsonb,date,text,text)');  -- null
--   select count(*) from cobros where external_ref = 'DRYRUN-REPARTO-20261019';                     -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false
--   cobros_antes = cobros_despues (no deja nada escrito)
--   nuevo = 2 (crea las dos porciones en una sola llamada)
--   doble_nuevo = true (un segundo «nuevo» sobre la misma ref lo frena REPARTO_YA_ENVIADO)
--   no_cuadra = true (porciones que no suman el total: REPARTO_NO_CUADRA y nada cambia)
--   editar = true (reemplaza: quedan 2 porciones, de la versión 2, con los montos nuevos)
--   aprobado = true (con confirmado_at en una porción, editar lo frena REPARTO_APROBADO)
--   invoker = true
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia     boolean;
  cobros_antes   bigint;
  cobros_despues bigint;
  perfil         uuid;
  ws             uuid;
  a              uuid;
  b              uuid;
  r              jsonb;
  nuevo          int := -1;
  doble_nuevo    boolean := false;
  no_cuadra      boolean := false;
  editar         boolean := false;
  aprobado       boolean := false;
  invoker        boolean;
  ref            constant text := 'DRYRUN-REPARTO-20261019';
BEGIN
  SELECT to_regprocedure('public.guardar_reparto_comercial(text,numeric,jsonb,date,text,text)') IS NOT NULL INTO ya_existia;
  SELECT count(*) INTO cobros_antes FROM public.cobros;

  EXECUTE $mig$
create or replace function public.guardar_reparto_comercial(
  p_referencia text,
  p_split_total numeric,
  p_porciones jsonb,
  p_fecha date,
  p_fuente text,
  p_modo text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_ws uuid := current_user_workspace_id();
  v_ref text := btrim(coalesce(p_referencia, ''));
  v_staff uuid;
  v_vigentes jsonb;
  v_n_vigentes int;
  v_aprobado boolean;
  v_ajeno record;
  v_neg record;
  v_split uuid := gen_random_uuid();
  v_suma numeric := 0;
  v_n int;
  v_ids uuid[];
  v_p jsonb;
  v_version int;
  v_despues jsonb := '[]'::jsonb;
begin
  if v_ws is null then
    raise exception 'REPARTO_SIN_SESION' using errcode = 'P0001';
  end if;
  if v_ref = '' then
    raise exception 'REPARTO_SIN_REFERENCIA' using errcode = 'P0001';
  end if;
  if p_modo not in ('nuevo', 'editar') then
    raise exception 'REPARTO_MODO_INVALIDO' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_porciones) is distinct from 'array' or jsonb_array_length(p_porciones) = 0 then
    raise exception 'REPARTO_SIN_PORCIONES' using errcode = 'P0001';
  end if;
  if p_split_total is null or p_split_total <= 0 then
    raise exception 'REPARTO_SIN_TOTAL' using errcode = 'P0001';
  end if;

  select id into v_staff from staff
   where profile_id = auth.uid() and workspace_id = v_ws
   limit 1;

  -- Una referencia a la vez: dos guardados del mismo pago se forman en fila.
  perform pg_advisory_xact_lock(hashtextextended(v_ws::text || ':reparto:' || v_ref, 0));

  -- Los cobros de la referencia quedan bloqueados hasta el final: la aprobación de la
  -- financiera (que escribe sobre estas filas) espera a que esta transacción termine.
  perform 1 from cobros
   where workspace_id = v_ws and external_ref = v_ref
   for update;

  -- Plata de esta referencia que NO es una propuesta del comercial: un pago registrado
  -- entero, o un reparto de la financiera. El comercial no la reemplaza.
  select c.negocio_id, n.codigo into v_ajeno
    from cobros c left join negocios n on n.id = c.negocio_id
   where c.workspace_id = v_ws and c.external_ref = v_ref and c.anulado_at is null
     and c.negocio_id is not null
     and coalesce(c.split_json->>'origen', '') <> 'comercial'
   limit 1;
  if found then
    raise exception 'REPARTO_REF_EN_USO:%', coalesce(v_ajeno.codigo, v_ajeno.negocio_id::text) using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cobro_id', c.id, 'negocio_id', c.negocio_id, 'codigo', n.codigo, 'monto', c.monto)
           order by n.codigo), '[]'::jsonb),
         count(*),
         coalesce(bool_or(
           coalesce(btrim(c.split_json->>'confirmado_at'), '') <> ''
           or coalesce(nc.conciliado, false)), false),
         coalesce(max((c.split_json->>'version')::int), 1)
    into v_vigentes, v_n_vigentes, v_aprobado, v_version
    from cobros c
    left join negocios n on n.id = c.negocio_id
    left join negocio_conciliacion nc on nc.negocio_id = c.negocio_id and nc.workspace_id = v_ws
   where c.workspace_id = v_ws and c.external_ref = v_ref and c.anulado_at is null
     and c.negocio_id is not null
     and c.split_json->>'origen' = 'comercial';

  if v_aprobado then
    raise exception 'REPARTO_APROBADO' using errcode = 'P0001';
  end if;
  if p_modo = 'nuevo' and v_n_vigentes > 0 then
    raise exception 'REPARTO_YA_ENVIADO' using errcode = 'P0001';
  end if;
  if p_modo = 'editar' and v_n_vigentes = 0 then
    raise exception 'REPARTO_NO_EXISTE' using errcode = 'P0001';
  end if;

  -- Porciones nuevas: negocios distintos, del workspace, abiertos, con monto positivo.
  select array_agg((e->>'negocio_id')::uuid), count(*)
    into v_ids, v_n
    from jsonb_array_elements(p_porciones) e;
  if (select count(distinct x) from unnest(v_ids) x) <> v_n then
    raise exception 'REPARTO_NEGOCIO_REPETIDO' using errcode = 'P0001';
  end if;
  for v_p in select * from jsonb_array_elements(p_porciones) loop
    if coalesce((v_p->>'monto')::numeric, 0) <= 0 then
      raise exception 'REPARTO_MONTO_INVALIDO' using errcode = 'P0001';
    end if;
    v_suma := v_suma + (v_p->>'monto')::numeric;
    select id, codigo, estado into v_neg from negocios
     where id = (v_p->>'negocio_id')::uuid and workspace_id = v_ws;
    if not found then
      raise exception 'REPARTO_NEGOCIO_AJENO' using errcode = 'P0001';
    end if;
    if v_neg.estado <> 'abierto' then
      raise exception 'REPARTO_NEGOCIO_CERRADO:%', coalesce(v_neg.codigo, v_neg.id::text) using errcode = 'P0001';
    end if;
  end loop;

  -- Cuadra: lo repartido es el pago completo (tolerancia de redondeo de 1 peso).
  if abs(v_suma - p_split_total) > 1 then
    raise exception 'REPARTO_NO_CUADRA' using errcode = 'P0001';
  end if;

  -- Reemplazo: fuera las porciones vigentes del comercial (ninguna aprobada, ver arriba).
  delete from cobros
   where workspace_id = v_ws and external_ref = v_ref and anulado_at is null
     and split_json->>'origen' = 'comercial';

  insert into cobros (workspace_id, negocio_id, monto, tipo_cobro, fecha, external_ref, fuente,
                      notas, created_by, split_json)
  select v_ws, (e->>'negocio_id')::uuid, (e->>'monto')::numeric, 'pago',
         coalesce(p_fecha, (now() at time zone 'America/Bogota')::date), v_ref,
         nullif(btrim(coalesce(p_fuente, '')), ''),
         case when p_modo = 'editar'
              then format('Reparto corregido por el comercial — Ref %s entre %s negocios', v_ref, v_n)
              else format('Reparto de pago propuesto por el comercial — Ref %s entre %s negocios', v_ref, v_n) end,
         auth.uid(),
         jsonb_build_object(
           'split_id', v_split, 'split_total', p_split_total, 'split_n', v_n,
           'origen', 'comercial', 'propuesto_por', v_staff,
           'version', case when p_modo = 'editar' then v_version + 1 else 1 end)
    from jsonb_array_elements(p_porciones) e;

  -- Cambió el cobrado de estos negocios: la financiera los vuelve a mirar.
  update negocio_conciliacion
     set conciliado = false, updated_at = now()
   where workspace_id = v_ws
     and negocio_id in (
       select unnest(v_ids)
       union
       select (x->>'negocio_id')::uuid from jsonb_array_elements(v_vigentes) x);

  select coalesce(jsonb_agg(jsonb_build_object(
           'cobro_id', c.id, 'negocio_id', c.negocio_id, 'codigo', n.codigo, 'monto', c.monto)
           order by n.codigo), '[]'::jsonb)
    into v_despues
    from cobros c left join negocios n on n.id = c.negocio_id
   where c.workspace_id = v_ws and c.external_ref = v_ref and c.split_json->>'split_id' = v_split::text;

  return jsonb_build_object('split_id', v_split, 'antes', v_vigentes, 'despues', v_despues);
end;
$function$;

comment on function public.guardar_reparto_comercial(text, numeric, jsonb, date, text, text) is
  'Guarda (nuevo) o reemplaza (editar) en una transaccion las porciones del reparto que propone el comercial para una referencia. Rechaza si la financiera ya aprobo alguna porcion, si la referencia ya esta registrada por otra via o si no cuadra. Devuelve {split_id, antes, despues}.';

-- ejecutable-por-cliente: la invoca el servidor con la sesion del comercial (cliente
-- authenticated). Es SECURITY INVOKER y toma el workspace de current_user_workspace_id(),
-- asi que no concede nada que el RLS de `cobros` no conceda ya.
revoke execute on function public.guardar_reparto_comercial(text, numeric, jsonb, date, text, text) from public, anon;
grant execute on function public.guardar_reparto_comercial(text, numeric, jsonb, date, text, text) to authenticated, service_role;

$mig$;

  SELECT NOT p.prosecdef INTO invoker FROM pg_proc p WHERE p.proname = 'guardar_reparto_comercial';

  -- Un usuario de SOENA con staff, y dos negocios abiertos con honorario (el trigger de
  -- cobros exige honorario confirmado cuando la línea lo pide).
  SELECT w.id INTO ws FROM public.workspaces w WHERE w.slug = 'soena';
  SELECT s.profile_id INTO perfil FROM public.staff s JOIN public.profiles pr ON pr.id = s.profile_id
   WHERE s.workspace_id = ws AND pr.workspace_id = ws LIMIT 1;
  SELECT n.id INTO a FROM public.negocios n WHERE n.workspace_id = ws AND n.estado = 'abierto'
     AND coalesce(n.precio_aprobado, 0) > 0 ORDER BY n.created_at DESC LIMIT 1;
  SELECT n.id INTO b FROM public.negocios n WHERE n.workspace_id = ws AND n.estado = 'abierto'
     AND coalesce(n.precio_aprobado, 0) > 0 AND n.id <> a ORDER BY n.created_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', perfil, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', perfil::text, true);

  r := public.guardar_reparto_comercial(ref, 300000, jsonb_build_array(
         jsonb_build_object('negocio_id', a, 'monto', 100000),
         jsonb_build_object('negocio_id', b, 'monto', 200000)), null, 'epayco', 'nuevo');
  SELECT count(*) INTO nuevo FROM public.cobros WHERE external_ref = ref;

  BEGIN
    PERFORM public.guardar_reparto_comercial(ref, 300000, jsonb_build_array(
      jsonb_build_object('negocio_id', a, 'monto', 300000)), null, 'epayco', 'nuevo');
  EXCEPTION WHEN others THEN doble_nuevo := SQLERRM = 'REPARTO_YA_ENVIADO';
  END;

  BEGIN
    PERFORM public.guardar_reparto_comercial(ref, 300000, jsonb_build_array(
      jsonb_build_object('negocio_id', a, 'monto', 150000),
      jsonb_build_object('negocio_id', b, 'monto', 100000)), null, 'epayco', 'editar');
  EXCEPTION WHEN others THEN
    no_cuadra := SQLERRM = 'REPARTO_NO_CUADRA'
      AND (SELECT sum(monto) FROM public.cobros WHERE external_ref = ref AND negocio_id = a) = 100000;
  END;

  r := public.guardar_reparto_comercial(ref, 300000, jsonb_build_array(
         jsonb_build_object('negocio_id', a, 'monto', 120000),
         jsonb_build_object('negocio_id', b, 'monto', 180000)), null, 'epayco', 'editar');
  editar := (SELECT count(*) FROM public.cobros WHERE external_ref = ref) = 2
        AND (SELECT monto FROM public.cobros WHERE external_ref = ref AND negocio_id = a) = 120000
        AND (SELECT bool_and((split_json->>'version')::int = 2) FROM public.cobros WHERE external_ref = ref)
        AND jsonb_array_length(r->'antes') = 2;

  UPDATE public.cobros SET split_json = split_json || jsonb_build_object('confirmado_at', now()::text)
   WHERE external_ref = ref AND negocio_id = a;
  BEGIN
    PERFORM public.guardar_reparto_comercial(ref, 300000, jsonb_build_array(
      jsonb_build_object('negocio_id', a, 'monto', 300000)), null, 'epayco', 'editar');
  EXCEPTION WHEN others THEN aprobado := SQLERRM = 'REPARTO_APROBADO';
  END;

  DELETE FROM public.cobros WHERE external_ref = ref;
  SELECT count(*) INTO cobros_despues FROM public.cobros;

  RAISE EXCEPTION '% ya_existia=% cobros_antes=% cobros_despues=% nuevo=% doble_nuevo=% no_cuadra=% editar=% aprobado=% invoker=%',
    CASE WHEN NOT ya_existia AND cobros_antes = cobros_despues AND nuevo = 2 AND doble_nuevo
              AND no_cuadra AND editar AND aprobado AND invoker
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN FALLA' END,
    ya_existia, cobros_antes, cobros_despues, nuevo, doble_nuevo, no_cuadra, editar, aprobado, invoker;
END $dry$;
