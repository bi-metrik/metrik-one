-- ============================================================
-- El umbral de inactividad sale del SLA de la etapa
--
-- ## EL DEFECTO
--
-- El aviso de inactividad se dispara con DOS numeros fijos escritos en los crons:
-- 3 dias habiles en venta, 2 en ejecucion. La misma vara para una etapa que se
-- resuelve el mismo dia y para una que espera a un tercero durante dos semanas.
--
-- Medido en produccion el 2026-09-02, negocios abiertos por su etapa actual:
--
--   etapa (SOENA GIT EV/HEV)  stage       sla_horas   dias habiles   abiertos
--   Seguimiento               venta            240         10           140
--   Notificacion              venta            240         10            48
--   Anexos                    venta            120          5            39
--   Propuesta                 venta             72          3            55
--   Validacion                venta             24          1            25
--   Cita                      ejecucion        168          7            26
--   Cargue                    ejecucion         48          2            17
--
-- Seguimiento y Notificacion son etapas de ESPERA: el caso esta con la DIAN o con el
-- cliente y el proceso les concede 10 dias habiles. El aviso llegaba a los 3 y volvia
-- cada dia hasta que alguien lo cerrara a mano. Cita concede 7 dias habiles para una
-- cita que agenda un tercero, y avisaba a los 2.
--
-- El SLA de la etapa ya existe, se edita en /flujo, pinta el "vencido" de las tarjetas
-- y de los tableros, y NINGUN aviso lo leia. Era un numero decorativo.
--
-- ## LA CORRECCION
--
--   umbral = max(piso del stage, SLA de la etapa en dias habiles)
--
-- Dos clausulas, y las dos importan:
--
-- 1. El SLA solo puede ALARGAR el umbral, nunca acortarlo. Validacion tiene SLA de
--    24 h = 1 dia habil: sin el piso, sus 25 negocios abiertos recibirian aviso a
--    diario. El SLA mide cuanto puede durar la etapa COMPLETA; la inactividad mide
--    silencio. Que una etapa deba resolverse en un dia no vuelve reclamable que nadie
--    la haya tocado desde ayer. Consecuencia buscada: este cambio solo puede QUITAR
--    avisos, nunca adelantar ninguno.
--
-- 2. Una etapa sin `sla_horas` declarado conserva el umbral de hoy. Quien no declara
--    nada recibe lo que ya tenia, no una suposicion: afi, metrik, advise, wmc-sm y las
--    etapas de SOENA sin SLA no cambian.
--
-- Efecto medido contra produccion ANTES de aplicar (abiertos que superan el umbral, o
-- sea los que disparan aviso en la proxima corrida del detector):
--
--                abiertos    hoy   con SLA   dejan de disparar
--     venta           374    208       132          76
--     ejecucion        70     40        20          20
--
-- De los 76 de venta, 73 salen del umbral nuevo y 3 son los pausados de mas abajo.
--
-- ## Y EL RESOLVER PREGUNTA LO MISMO (leccion de 20260901000011)
--
-- Subir un umbral sin tocar el resolver reproduce en espejo el bucle que aquella
-- migracion cerro: el detector deja de crear el aviso, el resolver no cierra los que
-- ya estan, y quedan de por vida avisos que el sistema no volveria a emitir. Por eso
-- la regla vive en UNA funcion, `debe_alertar_inactividad`, que consultan los dos
-- lados. El cron ya no compara nada: pregunta.
--
-- Medido sobre los 491 avisos de inactividad pendientes: 95 los cierra la clausula (c)
-- que ya existe (hubo gestion despues de que nacieron) y **144** los cierra la nueva.
-- La bandeja queda en 252. Entre los 144 estan los 9 avisos de negocios que ya
-- avanzaron a la etapa de cobro, que hoy no cierra nadie porque el detector solo mira
-- venta y ejecucion.
--
-- De paso, `debe_alertar_inactividad` exige `not is_paused`. Los crons nunca lo
-- miraron: un negocio pausado a proposito seguia reclamando gestion. Hoy hay 3
-- pausados abiertos (workspace metrik), los tres en venta y los tres con 6 dias
-- habiles quietos, o sea que hoy reciben aviso y dejan de recibirlo. El efecto es
-- minimo; el defecto estaba, y el lugar de arreglarlo es la definicion y no cada cron.
--
-- LO QUE NO CAMBIA: el escalamiento sigue en los crons, porque decide DESTINATARIOS y
-- no si hay motivo de aviso. Se expresa como distancias sobre el umbral (+2, +4, +12),
-- asi que con umbral 3 reproduce exactamente los 3/5/7/15 de hoy.
-- ============================================================

-- 1. Cuanto lleva quieto, en dias habiles.
-- Existia embebido en `negocios_ultima_actividad`. Sale a funcion propia porque ahora
-- lo necesita tambien `debe_alertar_inactividad` y, por su via, el resolver: escrito
-- dos veces, un cambio de criterio moveria un lado y no el otro.
create or replace function public.dias_habiles_sin_actividad(p_negocio_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select floor(horas_habiles_entre(ultima_actividad_negocio(p_negocio_id), now()) / 24)::integer;
$$;

comment on function public.dias_habiles_sin_actividad(uuid) is
  'Dias habiles transcurridos desde la ultima actividad del negocio '
  '(horas_habiles_entre / 24, el mismo criterio con el que se mide sla_horas). '
  'Definicion unica: la usan negocios_ultima_actividad y debe_alertar_inactividad.';

revoke execute on function public.dias_habiles_sin_actividad(uuid) from public, anon, authenticated;
grant execute on function public.dias_habiles_sin_actividad(uuid) to service_role;

-- 2. El umbral de ese negocio.
create or replace function public.umbral_inactividad_negocio(p_negocio_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case n.stage_actual
           when 'venta'     then greatest(3, coalesce(sla.dias, 3))
           when 'ejecucion' then greatest(2, coalesce(sla.dias, 2))
         end
  from negocios n
  left join lateral (
    -- El cast va DENTRO del case: `sla_horas` es texto libre dentro de un jsonb y un
    -- valor no numerico reventaria la funcion entera, o sea el cron completo, por la
    -- configuracion de una sola etapa.
    select case
             when e.config_extra->>'sla_horas' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
             then ceil((e.config_extra->>'sla_horas')::numeric / 24)::integer
           end as dias
    from etapas_negocio e
    where e.id = n.etapa_actual_id
  ) sla on true
  where n.id = p_negocio_id;
$$;

comment on function public.umbral_inactividad_negocio(uuid) is
  'Dias habiles de silencio a partir de los cuales el negocio amerita aviso: el piso '
  'del stage (venta 3, ejecucion 2) alargado por el sla_horas de su etapa actual. '
  'El SLA solo alarga, nunca acorta. Etapa sin sla_horas = el piso. NULL fuera de '
  'venta y ejecucion, que son los unicos stages con cron de inactividad.';

revoke execute on function public.umbral_inactividad_negocio(uuid) from public, anon, authenticated;
grant execute on function public.umbral_inactividad_negocio(uuid) to service_role;

-- 3. La pregunta que hacen el detector y el resolver.
create or replace function public.debe_alertar_inactividad(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.estado = 'abierto'
     and not coalesce(n.is_paused, false)
     and n.stage_actual in ('venta', 'ejecucion')
     and dias_habiles_sin_actividad(n.id) >= umbral_inactividad_negocio(n.id)
  from negocios n
  where n.id = p_negocio_id;
$$;

comment on function public.debe_alertar_inactividad(uuid) is
  'Unica definicion de "este negocio amerita aviso de inactividad": abierto, sin '
  'pausar, en venta o ejecucion, y quieto al menos umbral_inactividad_negocio dias '
  'habiles. La consultan los crons (via negocios_ultima_actividad) y '
  'resolver_notificaciones_obsoletas. Reimplementarla en un cron reabre el bucle que '
  'cerro 20260901000011.';

-- Nadie la invoca desde el cliente: la consultan el resolver y negocios_ultima_actividad,
-- las dos SECURITY DEFINER de service_role. Se revoca tambien a authenticated.
revoke execute on function public.debe_alertar_inactividad(uuid) from public, anon, authenticated;
grant execute on function public.debe_alertar_inactividad(uuid) to service_role;

-- 4. Lo que el cron pide.
-- `returns table` no admite columnas nuevas con create or replace: drop + create, y los
-- dos en la misma transaccion. Las columnas son ADITIVAS y las viejas conservan su
-- significado, asi que el codigo desplegado sobrevive la ventana entre esta migracion y
-- el deploy: sigue leyendo negocio_id y dias_habiles.
drop function if exists public.negocios_ultima_actividad(uuid[]);

create function public.negocios_ultima_actividad(p_ids uuid[])
returns table (
  negocio_id uuid,
  ultima_actividad timestamptz,
  dias_habiles integer,
  umbral_dias integer,
  debe_alertar boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id,
         ultima_actividad_negocio(n.id),
         dias_habiles_sin_actividad(n.id),
         umbral_inactividad_negocio(n.id),
         debe_alertar_inactividad(n.id)
  from negocios n
  where n.id = any(p_ids);
$$;

comment on function public.negocios_ultima_actividad(uuid[]) is
  'Por negocio: ultima actividad, dias habiles quieto, umbral vigente (piso del stage '
  'alargado por el SLA de la etapa) y si amerita aviso. La usan los crons de '
  'inactividad, que no comparan nada por su cuenta: leen debe_alertar y usan los '
  'numeros solo para el texto y el escalamiento.';

revoke execute on function public.negocios_ultima_actividad(uuid[]) from public, anon, authenticated;
grant execute on function public.negocios_ultima_actividad(uuid[]) to service_role;

-- 5. El resolver cierra lo que el detector ya no crearia.
create or replace function public.resolver_notificaciones_obsoletas()
returns table(motivo text, resueltas integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto', 'responsable_faltante_area')
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

  -- (d) NUEVO: el aviso ya no cumple la regla con la que se emite hoy. Sin esta
  --     clausula, subir un umbral deja vivos para siempre avisos que el detector no
  --     volveria a crear: el mismo desacuerdo de 20260901000011, en espejo.
  with fuera_de_umbral as (
    update notificaciones n set estado = 'completada', updated_at = now()
    where n.estado = 'pendiente'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto')
      and n.entidad_tipo = 'negocio'
      and not debe_alertar_inactividad(n.entidad_id)
    returning n.id
  ) select count(*) into v_n from fuera_de_umbral;
  motivo := 'bajo_umbral'; resueltas := v_n; return next;
end;
$function$;

comment on function public.resolver_notificaciones_obsoletas() is
  'Cierra avisos que perdieron su motivo. Cada clausula pregunta EXACTAMENTE lo mismo '
  'que el detector que los crea: debe_alertar_responsable_faltante y '
  'debe_alertar_inactividad. Si un criterio se reescribe aqui en vez de en esas '
  'funciones, el aviso vuelve a nacer cada dia a las 13:00 despues de que este lo '
  'cierra a las 12:45.';

revoke execute on function public.resolver_notificaciones_obsoletas() from anon, authenticated;
grant execute on function public.resolver_notificaciones_obsoletas() to service_role;
