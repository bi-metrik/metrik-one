-- ============================================================
-- Los avisos que apuntan a algo que ya no se puede abrir
--
-- ## EL DEFECTO
--
-- `resolver_notificaciones_obsoletas()` tiene cuatro clausulas y las cuatro resuelven
-- contra `negocios`: (a) por join, (b)(c)(d) llamando a una funcion que lee esa tabla.
-- Cuando el negocio NO existe, ninguna cierra el aviso, y no por descuido: las tres
-- funciones son `language sql` sobre `from negocios where id = $1`, asi que con cero
-- filas devuelven **NULL, no false**. `not NULL` es NULL, y un `where` con NULL no
-- actualiza nada. El aviso queda pendiente para siempre.
--
-- (La excepcion es `debe_alertar_responsable_faltante`, que es plpgsql y devuelve false
-- explicito cuando el stage sale null. Por eso hoy no hay ni un `responsable_faltante_area`
-- huerfano pendiente: la clausula (b) ya los cierra, de rebote. Este archivo lo vuelve
-- explicito en vez de dejarlo colgando del manejo de nulos de una funcion.)
--
-- Medido en produccion (yfjqscvvxetobiidnepa) el 2026-09-02, comprobando cada aviso
-- contra SU tabla y no contra `negocios`:
--
--   39  entidad_tipo='negocio'      el negocio fue borrado (jun-jul)     -> /negocios/<id> da 404
--   20  entidad_tipo='proyecto'     14 borrados + 6 que aun existen      -> /proyectos, ruta extirpada
--   11  entidad_tipo='oportunidad'  6 borradas + 5 que aun existen       -> /pipeline, ruta extirpada
--   ---
--   70  avisos pendientes que ninguna clausula puede cerrar
--
-- Ninguno es alcanzable: los tres `deep_link` llevan a una pagina que no existe. Los 39
-- del primer grupo tampoco esconden trabajo vivo — ninguno de los 38 nombres distintos
-- corresponde hoy a un negocio del mismo workspace.
--
-- Reparto: Indira Gomez 11 de sus 13 pendientes (85% de su bandeja), Maria Camila Garzon
-- 28 de 101, Mauricio 20 de 123, Carlos Reyes 5 de 5, Dietmar Nino 4 de 6, Julian Guzman
-- 2 de 5. Los seis perfiles estan vivos y sus workspaces tambien.
--
-- ## POR QUE UNA CLAUSULA Y NO SOLO UN UPDATE
--
-- Porque el primer grupo puede volver. `notificaciones.entidad_id` es polimorfica y no
-- tiene FK; `negocios` no tiene trigger que limpie sus avisos al borrarse; y la app no
-- expone ninguna via de borrado, asi que los negocios se borran a mano, por SQL, cuando
-- se sanea un cargue — que es exactamente lo que dejo estos 39 entre junio y julio. La
-- proxima limpieza de datos vuelve a producirlos. Historico: 280 avisos huerfanos de
-- tipo `negocio` en toda la tabla; 39 quedaron pendientes, el resto alcanzo a cerrarse
-- por otra clausula antes de que el negocio desapareciera.
--
-- ## POR QUE LA CLAUSULA NO CUBRE `oportunidad` NI `proyecto`
--
-- Porque ahi el criterio no es "la entidad no existe" — 11 de los 31 SI existen — sino
-- "el modulo se extirpo en mayo". Son cosas distintas y una clausula que las mezclara
-- cerraria por la razon equivocada. Ademas no puede repetirse: nada ha creado un aviso
-- de esos tipos desde el 2026-04-03, y no queda un solo sitio que pueda hacerlo (los
-- unicos `entidad_tipo` que el codigo escribe hoy son negocio, workspace, contacto,
-- cobro y cuenta_cobro). Una clausula permanente para eso seria codigo muerto: se van
-- por el UPDATE de una vez, en la parte 2.
--
-- ## LISTA BLANCA, NO LISTA NEGRA
--
-- La clausula cierra los tres tipos que el resolver ya administra. **`mencion` y
-- `mencion_equipo` quedan fuera a proposito**, igual que en la clausula (a): un mensaje
-- de una persona a otra vale por su texto, no por su enlace, y borrar el negocio no
-- borra lo que alguien quiso decir. Y un tipo nuevo que apunte a negocios no empieza a
-- cerrarse solo el dia que lo agreguen.
-- ============================================================


-- ── 1. La clausula (e) ─────────────────────────────────────────────────────

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

  -- (e) NUEVO: el negocio ya no existe. Las cuatro clausulas de arriba resuelven contra
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
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto', 'responsable_faltante_area')
      and not exists (select 1 from negocios g where g.id = n.entidad_id)
    returning n.id
  ) select count(*) into v_n from sin_entidad;
  motivo := 'entidad_inexistente'; resueltas := v_n; return next;
end;
$$;

comment on function public.resolver_notificaciones_obsoletas() is
  'Cierra avisos que ya no aplican, usando las MISMAS funciones que los detectores usan '
  'para crearlos. La clausula (e) cierra ademas los que apuntan a un negocio borrado: '
  'ninguna otra los alcanza porque todas resuelven contra `negocios` y una funcion que no '
  'encuentra la fila devuelve NULL, no false.';

revoke execute on function public.resolver_notificaciones_obsoletas() from public, anon, authenticated;
grant execute on function public.resolver_notificaciones_obsoletas() to service_role;


-- ── 2. La limpieza de una vez ──────────────────────────────────────────────
--
-- Los 39 del primer grupo los cerraria igual la clausula (e) en la corrida de las 12:45,
-- pero se cierran aca para que quede la marca de por que: cuando el codigo repara datos
-- solo, el rastro es parte del arreglo. Los 31 de los modulos extirpados no los cierra
-- ninguna clausula, ni debe: se van solo aca.
--
-- No se borra ninguna fila. `estado='completada'` las saca de la bandeja (la campana lee
-- unicamente `estado='pendiente'`) y conserva destinatario, fecha y contenido.

do $$
declare
  v_a integer;
  v_b integer;
  v_sin_marca integer;
  v_quedan integer;
begin
  -- ⚠️ `jsonb_set(..., create_if_missing => true)` NO crea el nivel padre: si `metadata`
  -- fuera null o no tuviera la llave, escribiria el valor y perderia la marca sin dar
  -- error. Por eso se concatena con `||` sobre un `coalesce`.
  with a as (
    update notificaciones n
    set estado = 'completada', updated_at = now(),
        metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object(
          '_cerrado_por_limpieza', jsonb_build_object(
            'fecha', now(),
            'motivo', 'entidad_inexistente',
            'doc', 'proyectos/soena/ve/2026-09-01_notificaciones-diagnostico-y-sla.md'))
    where n.estado = 'pendiente'
      and n.entidad_tipo = 'negocio'
      and n.tipo in ('inactividad_oportunidad', 'inactividad_proyecto', 'responsable_faltante_area')
      and not exists (select 1 from negocios g where g.id = n.entidad_id)
    returning n.id
  ) select count(*) into v_a from a;

  with b as (
    update notificaciones n
    set estado = 'completada', updated_at = now(),
        metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object(
          '_cerrado_por_limpieza', jsonb_build_object(
            'fecha', now(),
            'motivo', 'modulo_extirpado',
            'doc', 'proyectos/soena/ve/2026-09-01_notificaciones-diagnostico-y-sla.md'))
    where n.estado = 'pendiente'
      and n.entidad_tipo in ('oportunidad', 'proyecto')
    returning n.id
  ) select count(*) into v_b from b;

  -- Una marca de auditoria que se pierde en silencio es peor que no ponerla: la fila
  -- queda cerrada y sin explicacion, indistinguible de un cierre a mano. Aborta.
  select count(*) into v_sin_marca
  from notificaciones
  where estado = 'completada'
    and updated_at >= now() - interval '1 minute'
    and metadata -> '_cerrado_por_limpieza' is null;

  select count(*) into v_quedan
  from notificaciones n
  where n.estado = 'pendiente'
    and ( (n.entidad_tipo = 'negocio' and not exists (select 1 from negocios g where g.id = n.entidad_id))
       or n.entidad_tipo in ('oportunidad', 'proyecto') );

  raise notice 'cerradas: % por entidad inexistente, % por modulo extirpado', v_a, v_b;

  if v_sin_marca > 0 then
    raise exception 'ABORTA: % filas se cerraron sin la marca _cerrado_por_limpieza', v_sin_marca;
  end if;
  if v_quedan > 0 then
    raise exception 'ABORTA: quedan % avisos pendientes sin entidad alcanzable', v_quedan;
  end if;
end $$;
