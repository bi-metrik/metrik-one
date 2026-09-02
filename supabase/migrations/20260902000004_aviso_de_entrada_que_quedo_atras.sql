-- ============================================================
-- El aviso de entrada a una etapa deja de ser eterno
--
-- ## EL DEFECTO
--
-- `avisar_entrada_etapa()` crea el aviso `negocio_en_etapa` cuando el negocio ENTRA a una
-- etapa, y **nada lo cierra cuando sale**. Es un detector sin resolver: la imagen espejo
-- del desacuerdo que cerro `20260901000011`. Alla las dos partes existian y decian cosas
-- distintas; aca solo existe una.
--
-- Medido en produccion (yfjqscvvxetobiidnepa) el 2026-09-02 sobre los 242 pendientes de
-- ese tipo, comparando la etapa que guarda el aviso contra la etapa actual del negocio:
--
--   142 (59%)  apuntan a una etapa que el negocio YA DEJO   <- se cierran aca
--   100 (41%)  el negocio sigue en esa etapa                <- siguen pendientes, y esta bien
--   ---
--   242 pendientes sobre 147 negocios, el mas viejo del 2026-07-31
--
-- Reparto de los 242 por via: 177 `responsable_comercial`, 39 `responsable_operaciones`,
-- 26 `area_financiera`. Una sola persona (la comercial de SOENA) acumula 148 avisos de
-- este tipo sobre 109 negocios, contra 5 de inactividad: despues de las correcciones del
-- 01 y 02 de septiembre, este tipo es lo que de verdad llena su bandeja.
--
-- Y no se estanca: crece con cada negocio que avanza. Todo movimiento de etapa crea el
-- aviso de la etapa nueva y deja atras el de la anterior, para siempre.
--
-- ## POR QUE NO SE COMPARA SOLO EL NOMBRE
--
-- El aviso guardaba unicamente `metadata->>'etapa'`, que es el NOMBRE de la etapa. Una
-- clausula que compare nombres cierra bien hoy (medido: ninguna linea tiene dos etapas con
-- el mismo nombre, y los 242 nombres guardados existen en la linea de su negocio) y se
-- rompe **en silencio** el dia que alguien renombre una etapa: todos los avisos vivos de
-- esa etapa pasarian a verse vencidos de golpe. Es exactamente la fragilidad por la que
-- este producto migro sus referencias de workflow a `slug`.
--
-- Por eso la parte 1 hace que el trigger estampe tambien `etapa_id`, y la parte 2 pone la
-- resolucion en UNA funcion que prefiere el id y solo cae al nombre para los avisos que ya
-- estaban escritos. Si no puede identificar la etapa devuelve NULL y **el aviso no se
-- cierra**: retener es el lado seguro.
--
-- ## QUE SE ESPERA EN LA PRIMERA CORRIDA
--
-- La corrida de las 12:45 cierra los 142 y deja los 100 vivos. Ninguno se borra:
-- `estado='completada'` los saca de la campana (que lee solo `pendiente`) y conserva
-- destinatario, fecha, contenido y `grupo_clave`. `resuelta_por` queda **NULL**, que es la
-- verdad: no los resolvio nadie, dejaron de aplicar. Es la misma marca que dejan las cinco
-- clausulas que ya existian.
--
-- ## QUE NO CAMBIA
--
-- Los avisos de un negocio que sigue en su etapa. El aviso al cliente por correo y
-- WhatsApp, que lo despacha la edge function y no esta tabla. Y `mencion` /
-- `mencion_equipo`, que siguen fuera de todas las clausulas: un mensaje de una persona a
-- otra vale por su texto, no por el estado del negocio al que apunta.
-- ============================================================


-- ── 1. El trigger estampa la etapa por ID, no solo por nombre ──────────────
--
-- `avisar_entrada_etapa` cuelga del UPDATE de `negocios.etapa_actual_id`: una version mal
-- transcrita rompe el avance de etapa en produccion. Por eso NO se reescribe. Se toma la
-- definicion VIVA, se le aplica un reemplazo exacto contado, y si no aplica dos veces
-- —una por cada rama de destinatarios, area y responsable— aborta sin tocar nada.

do $$
declare
  v_def text;
  v_old text := '''etapa'', v_etapa_nombre,';
  v_new text := '''etapa'', v_etapa_nombre, ''etapa_id'', new.etapa_actual_id,';
  v_n integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'avisar_entrada_etapa';

  if v_def is null then
    raise exception 'ABORTA: no existe public.avisar_entrada_etapa';
  end if;

  -- Idempotente: si ya estampa el id, no hay nada que hacer.
  if position('''etapa_id'', new.etapa_actual_id' in v_def) > 0 then
    raise notice 'avisar_entrada_etapa ya estampa etapa_id, sin cambios';
    return;
  end if;

  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 2 then
    raise exception 'ABORTA: se esperaban 2 ocurrencias de %, hay %', v_old, v_n;
  end if;

  execute replace(v_def, v_old, v_new);

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'avisar_entrada_etapa';
  if position('''etapa_id'', new.etapa_actual_id' in v_def) = 0 then
    raise exception 'ABORTA: el reemplazo no quedo en la funcion desplegada';
  end if;
end $$;


-- ── 2. Que etapa anuncia un aviso ──────────────────────────────────────────
--
-- UNA sola definicion, para que la clausula del resolver no tenga su propia copia del
-- criterio. Devuelve NULL cuando no puede identificarla, y ese NULL significa "no se puede
-- juzgar", nunca "esta vencido".
--
-- Tres formas de no poder identificarla, y las tres retienen el aviso:
--   * el `etapa_id` no es un uuid o apunta a una etapa borrada
--   * el nombre guardado ya no existe en la linea (alguien renombro la etapa)
--   * el nombre esta repetido en la linea, asi que no hay una sola respuesta

create or replace function public.etapa_del_aviso_entrada(p_linea_id uuid, p_metadata jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_txt text := p_metadata ->> 'etapa_id';
  v_id uuid;
  v_n integer;
begin
  -- Preferido: el id que estampa el trigger. Sobrevive a que la etapa se renombre.
  if v_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select e.id into v_id from etapas_negocio e where e.id = v_txt::uuid;
    if v_id is not null then return v_id; end if;
  end if;

  -- Legado: los avisos anteriores a esta migracion solo guardaron el NOMBRE.
  -- `min()` no existe para uuid; `array_agg` si, y de paso deja el conteo y el valor en
  -- una sola pasada.
  select count(*), (array_agg(e.id))[1] into v_n, v_id
  from etapas_negocio e
  where e.linea_id = p_linea_id
    and e.nombre = p_metadata ->> 'etapa';

  if v_n <> 1 then return null; end if;
  return v_id;
end;
$$;

comment on function public.etapa_del_aviso_entrada(uuid, jsonb) is
  'La etapa que anuncia un aviso `negocio_en_etapa`, preferentemente por el `etapa_id` que '
  'estampa avisar_entrada_etapa y solo por nombre para los avisos viejos. NULL = no se '
  'puede identificar, y el resolver lo trata como "no cerrar".';

revoke execute on function public.etapa_del_aviso_entrada(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.etapa_del_aviso_entrada(uuid, jsonb) to service_role;


-- ── 3. La clausula (e) del resolver ────────────────────────────────────────
--
-- Ademas de la clausula nueva, `negocio_en_etapa` entra a las dos que ya administraban el
-- ciclo de vida de un aviso sobre un negocio: (a) el negocio se cerro —el trigger ya se
-- niega a crear el aviso en un negocio cerrado desde `20260818000003`, asi que detector y
-- resolver vuelven a decir lo mismo— y (f) el negocio ya no existe.

create or replace function public.resolver_notificaciones_obsoletas()
returns table (motivo text, resueltas integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  -- (a) El negocio ya se cerro: nada que perseguir sobre el.
  with cerrados as (
    update notificaciones n set estado = 'completada', updated_at = now()
    from negocios neg
    where neg.id = n.entidad_id
      and n.entidad_tipo = 'negocio'
      and n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto',
                     'responsable_faltante_area', 'negocio_en_etapa')
      and neg.estado <> 'abierto'
    returning n.id
  ) select count(*) into v_n from cerrados;
  motivo := 'negocio_cerrado'; resueltas := v_n; return next;

  -- (b) ANTES: cerraba si existia cualquier responsable. AHORA los dos preguntan lo mismo.
  with sin_motivo as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo = 'responsable_faltante_area'
      and n.entidad_tipo = 'negocio'
      and not debe_alertar_responsable_faltante(n.entidad_id)
    returning n.id
  ) select count(*) into v_n from sin_motivo;
  motivo := 'responsable_asignado'; resueltas := v_n; return next;

  -- (c) ANTES: cerraba con cualquier fila de `activity_log`, mientras el cron solo
  --     contaba `comentario`. AHORA las dos leen `ultima_actividad_negocio`.
  --     Cierra el aviso que YA SE ATENDIO: hubo gestion despues de que nacio. No lo
  --     cubre (d), porque un negocio trabajado hace una semana vuelve a superar el
  --     umbral y sigue ameritando aviso; lo que corresponde ahi es un aviso NUEVO, no
  --     dejar vivo el viejo.
  with reactivados as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto')
      and n.entidad_tipo = 'negocio'
      and ultima_actividad_negocio(n.entidad_id) > n.created_at
    returning n.id
  ) select count(*) into v_n from reactivados;
  motivo := 'hubo_actividad'; resueltas := v_n; return next;

  -- (d) El aviso ya no cumple la regla con la que se emite hoy. Sin esta clausula,
  --     subir un umbral deja vivos para siempre avisos que el detector no volveria a
  --     crear: el mismo desacuerdo de 20260901000011, en espejo.
  with fuera_de_umbral as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto')
      and n.entidad_tipo = 'negocio'
      and not debe_alertar_inactividad(n.entidad_id)
    returning n.id
  ) select count(*) into v_n from fuera_de_umbral;
  motivo := 'bajo_umbral'; resueltas := v_n; return next;

  -- (e) NUEVO: el aviso de entrada quedo atras. `avisar_entrada_etapa` lo crea al ENTRAR
  --     el negocio a una etapa y nada lo cerraba al salir: detector sin resolver, la
  --     imagen espejo del bucle de 20260901000011. Medido el 2026-09-02: de 242
  --     pendientes, 142 (59%) apuntan a una etapa que el negocio ya dejo, la mas vieja
  --     del 31-jul.
  --
  --     La etapa del aviso se resuelve con `etapa_del_aviso_entrada`, que devuelve NULL
  --     cuando no puede identificarla. Ese NULL NO cierra: un aviso que no se puede
  --     juzgar se queda, porque el lado seguro de un control es retener.
  with etapa_superada as (
    update notificaciones n set estado = 'completada', updated_at = now()
    from negocios g
    where g.id = n.entidad_id
      and n.entidad_tipo = 'negocio'
      and n.estado = 'pendiente'
      and n.tipo = 'negocio_en_etapa'
      and etapa_del_aviso_entrada(g.linea_id, n.metadata) is not null
      and etapa_del_aviso_entrada(g.linea_id, n.metadata) is distinct from g.etapa_actual_id
    returning n.id
  ) select count(*) into v_n from etapa_superada;
  motivo := 'etapa_superada'; resueltas := v_n; return next;

  -- (f) El negocio ya no existe. Las cinco clausulas de arriba resuelven contra
  --     `negocios`, y las funciones que consultan devuelven NULL —no false— cuando no
  --     encuentran la fila, asi que `not <funcion>` nunca es true y el aviso sobrevive a
  --     todas. Es la unica clausula que pregunta por la EXISTENCIA en vez de por el
  --     estado, y por eso tiene que ir despues: mientras el negocio exista, mandan las
  --     reglas de negocio; solo cuando no existe deja de haber regla que aplicar.
  --     Fuera, a proposito: `mencion` y `mencion_equipo` (ver cabecera).
  with sin_entidad as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.entidad_tipo = 'negocio'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto',
                     'responsable_faltante_area', 'negocio_en_etapa')
      and not exists (select 1 from negocios g where g.id = n.entidad_id)
    returning n.id
  ) select count(*) into v_n from sin_entidad;
  motivo := 'entidad_inexistente'; resueltas := v_n; return next;
end;
$$;


comment on function public.resolver_notificaciones_obsoletas() is
  'Cierra avisos que ya no aplican, usando las MISMAS funciones que los detectores usan '
  'para crearlos. (e) cierra el aviso de entrada cuyo negocio ya dejo esa etapa: lo crea un '
  'trigger al entrar y nada lo cerraba al salir. (f) cierra los que apuntan a un negocio '
  'borrado, que ninguna otra alcanza porque todas resuelven contra `negocios` y una funcion '
  'que no encuentra la fila devuelve NULL, no false.';

revoke execute on function public.resolver_notificaciones_obsoletas() from public, anon, authenticated;
grant execute on function public.resolver_notificaciones_obsoletas() to service_role;
