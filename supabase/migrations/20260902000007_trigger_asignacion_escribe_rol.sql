-- ============================================================
-- El trigger de asignacion automatica deja de sembrar responsables sin `rol`
--
-- ## EL DEFECTO
--
-- Una fila de `negocio_responsables` con `rol` NULL es invisible para el motor de
-- avisos: `destinatarios_negocio` busca la fila cuyo `nr.rol` corresponde al stage
-- (venta -> comercial, ejecucion -> operaciones, cobro -> ambos) y, si no la
-- encuentra, escala al supervisor del area. El responsable real no se entera de su
-- propio caso, y la atribucion comercial se pierde.
--
-- Esto se corrigio en agosto por el lado de la aplicacion (`rolDesdeAreas` /
-- `asignarResponsable` en `src/lib/negocios/responsable-rol.ts`), pero el camino SQL
-- quedo abierto y lo vuelve a sembrar solo.
--
-- Medido contra produccion el 2026-09-02, antes de escribir esta migracion:
--
--   filas de `negocio_responsables`                884
--   filas con `rol` NULL                           158
--   de esas, con `assigned_by` NULL (o sea SYSTEM) 158 de 158
--
-- La segunda cifra cierra el caso: ninguna de las 158 es una asignacion humana.
-- Todas salen del mismo insert, `20260520000011:174`, que conoce el area entrante
-- (`v_area_nueva`) y aun asi no la deja escrita.
--
-- ## LOS TRES CAMBIOS
--
-- ### 1. El insert escribe `rol`
--
-- `v_area_nueva` ya sale del stage entrante. Si el area tiene puesto (comercial u
-- operaciones) y el puesto esta libre, se escribe. `financiera` sigue entrando con
-- `rol` NULL: solo existen DOS puestos y eso es deliberado (decision de Mauricio del
-- 2026-08-10, documentada en `responsable-rol.ts`). Es lo que explica las 84 filas
-- sin rol del area financiera en SOENA: no son un defecto, son el limite del modelo.
--
-- El `NOT EXISTS` del puesto libre va DENTRO de la sentencia, no en un `IF` previo.
-- Motivo: este trigger es AFTER UPDATE. Si el indice unico parcial
-- `negocio_responsables_un_rol_por_negocio` lanzara excepcion aca, reventaria el
-- cambio de stage del negocio y un caso se quedaria sin poder avanzar por un detalle
-- de asignacion. La regla dura es que este trigger NUNCA tumba la transicion.
--
-- ### 2. Cuando la cascada solo alcanza a un supervisor, un admin o el owner, no
--     inserta nada (decision de Mauricio, 2026-09-02)
--
-- Los pasos 3 (supervisor unico), 4 (admin unico) y 5 (owner) desaparecen. El caso
-- entra a la etapa sin nadie del area y lo levanta el cron, que ya existe y ya hace
-- exactamente eso: `detectar_responsable_faltante_area()` (diario 13:00 UTC,
-- idempotente, cascada supervisor -> admin -> owner).
--
-- Los pasos 1 (`workspace_default_responsables`) y 2 (operador unico del area) se
-- quedan: ahi si hay una persona que de verdad va a hacer el trabajo.
--
-- Que se gana: la tabla deja de ensuciarse. Las 55 filas sin rol de la supervisora de
-- operaciones de SOENA son exactamente este patron (entra el caso a ejecucion, no hay
-- operativo todavia, el trigger la pone a ella por ser la unica supervisora, y despues
-- un humano asigna al operativo real). Con este cambio nunca habrian existido.
--
-- Que se pierde, dicho explicito: los 5 casos que se arreglaron a mano hoy (V0048,
-- V0328, V0444, V0446, V0450) no habrian tenido responsable de operaciones NINGUNO,
-- en vez de tener a la supervisora sin rol. La diferencia real es que la ausencia se
-- vuelve visible en el aviso en lugar de quedar tapada por un responsable de mentira.
--
-- ### 3. El guard de salida pregunta por el PUESTO, no por el area de la persona
--
-- El guard decidia "este negocio ya tiene responsable del area" asi:
--
--   from negocio_responsables nr join staff_areas sa on sa.staff_id = nr.staff_id
--   where nr.negocio_id = ... and sa.area in (v_area_nueva, 'direccion')
--
-- Eso pregunta por el area de la PERSONA, no por el puesto que ocupa. Una fila con
-- `rol` NULL no recibe ningun aviso, pero alcanza para que el trigger se salga: el
-- negocio queda tapado sin que nadie lo este atendiendo. El criterio correcto es el
-- que ya usa el motor de avisos, `nr.rol = v_area_nueva`.
--
-- Para `financiera` se conserva el criterio viejo porque no hay puesto que consultar.
--
-- Blast radius medido antes de cambiarlo, sobre los 469 negocios abiertos y activos de
-- la base: UN solo negocio (workspace MeTRIK, stage ejecucion) deja de salirse por el
-- guard, y en ese ni el paso 1 ni el paso 2 resuelven candidato, asi que tampoco se le
-- asigna nadie. El cambio es estructural, no de datos.
--
-- ### Lo que NO hay que tocar: el lado del cron
--
-- El brief original pedia el mismo cambio de criterio en `detectar_responsable_faltante_area`.
-- Ya esta hecho: la migracion 20260901000011 saco la regla a
-- `debe_alertar_responsable_faltante(negocio)`, que en los workspaces con
-- `config_extra.notificaciones.routing_por_responsable = true` decide justamente por
-- `nr.rol`. SOENA lo tiene activo. Verificado el 2026-09-02: la alerta de hoy y la
-- alerta por rol dan el mismo resultado en SOENA (4 negocios), en AFI (53) y en los
-- cuatro workspaces chicos; solo difieren en 2 negocios del workspace MeTRIK, que no
-- ha hecho opt-in. No se toca esa funcion: el flag por workspace existe para no
-- cambiarle el comportamiento a quien todavia no migro sus responsables a los dos
-- puestos.
--
-- ## BACKFILL
--
-- Ninguno aca. Lo que se podia arreglar se aplico hoy sobre SOENA con respaldo
-- (`proyectos/soena/ve/migrations/20260902_*`). El resto queda sin backfillear a
-- proposito: las filas sin rol de la supervisora de operaciones desplazarian a los dos
-- operativos reales de sus propios casos, y las del area financiera no tienen puesto.
-- ============================================================

create or replace function public.asignar_responsable_area_entrante()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_area_nueva text;
  v_rol text;
  v_staff_id uuid;
  v_workspace uuid := new.workspace_id;
  v_n_candidatos int;
begin
  -- Solo al ENTRAR a un stage operativo distinto del anterior.
  if new.stage_actual is null then
    return new;
  end if;

  if new.stage_actual = 'cerrado' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.stage_actual is not distinct from old.stage_actual then
    return new;
  end if;

  v_area_nueva := case new.stage_actual
    when 'venta'     then 'comercial'
    when 'ejecucion' then 'operaciones'
    when 'cobro'     then 'financiera'
    else null
  end;

  if v_area_nueva is null then
    return new;
  end if;

  -- El puesto que corresponde al area. Solo existen dos; `financiera` no tiene
  -- puesto en el modelo y por eso queda en null, igual que antes de esta migracion.
  v_rol := case when v_area_nueva in ('comercial', 'operaciones') then v_area_nueva end;

  -- ── El area ya esta cubierta: salir ────────────────────────────────────────
  -- Se pregunta por el PUESTO ocupado, que es lo que mira `destinatarios_negocio`,
  -- y no por el area de quien figura: una fila con `rol` null no recibe avisos y no
  -- puede contar como cobertura. Sin puesto que consultar (financiera) se conserva
  -- el criterio por area.
  if v_rol is not null then
    if exists (
      select 1 from negocio_responsables nr
      where nr.negocio_id = new.id
        and nr.rol = v_rol
    ) then
      return new;
    end if;
  else
    if exists (
      select 1
      from negocio_responsables nr
      join staff_areas sa on sa.staff_id = nr.staff_id
      where nr.negocio_id = new.id
        and sa.area in (v_area_nueva, 'direccion')
    ) then
      return new;
    end if;
  end if;

  -- ── Paso 1: responsable por defecto del workspace para esa area ────────────
  select staff_id into v_staff_id
  from workspace_default_responsables
  where workspace_id = v_workspace
    and area = v_area_nueva
  limit 1;

  -- ── Paso 2: operador UNICO del area (o de direccion) ───────────────────────
  -- `staff` no tiene columna `role`: el rol canonico vive en `profiles.role` y se
  -- linkea por `staff.profile_id`.
  if v_staff_id is null then
    select count(*) into v_n_candidatos
    from staff s
    join profiles p on p.id = s.profile_id
    where s.workspace_id = v_workspace
      and p.role = 'operator'
      and exists (
        select 1 from staff_areas sa
        where sa.staff_id = s.id
          and sa.area in (v_area_nueva, 'direccion')
      );

    if v_n_candidatos = 1 then
      select s.id into v_staff_id
      from staff s
      join profiles p on p.id = s.profile_id
      where s.workspace_id = v_workspace
        and p.role = 'operator'
        and exists (
          select 1 from staff_areas sa
          where sa.staff_id = s.id
            and sa.area in (v_area_nueva, 'direccion')
        );
    end if;
  end if;

  -- Aca terminaba la cascada con supervisor unico, admin unico y owner. Ya no:
  -- ninguno de los tres iba a hacer el trabajo, y la fila que dejaban tapaba el
  -- hueco sin resolverlo. Sin candidato no se inserta nada y el negocio entra a la
  -- etapa sin responsable de area, que es justo lo que levanta
  -- `detectar_responsable_faltante_area()` en la corrida diaria.

  if v_staff_id is not null then
    -- El `case` con `not exists` va dentro de la sentencia a proposito: si el puesto
    -- estuviera ocupado, escribir el rol reventaria el indice unico parcial DENTRO
    -- del AFTER UPDATE y tumbaria el cambio de stage. Preferimos una fila con rol
    -- null antes que un negocio que no puede avanzar de etapa.
    insert into negocio_responsables (negocio_id, staff_id, assigned_at, assigned_by, rol)
    select new.id, v_staff_id, now(), null,
           case
             when v_rol is null then null
             when exists (
               select 1 from negocio_responsables nr
               where nr.negocio_id = new.id
                 and nr.rol = v_rol
             ) then null
             else v_rol
           end
    on conflict do nothing;
  end if;

  return new;
end;
$$;

comment on function public.asignar_responsable_area_entrante() is
  'Asigna responsable del area entrante al cambiar de stage. Escribe el `rol` que '
  'corresponde al area (comercial u operaciones; financiera no tiene puesto). Solo '
  'asigna si hay responsable por defecto del workspace u operador unico del area: '
  'supervisor, admin y owner NO se asignan, el hueco lo levanta '
  'detectar_responsable_faltante_area(). Nunca tumba la transicion de stage.';

-- `create or replace` conserva la ACL, pero se reafirma el revoke de
-- 20260630000001 para que no dependa de ese detalle: es una funcion de trigger,
-- nadie la invoca desde el cliente.
revoke execute on function public.asignar_responsable_area_entrante() from public, anon, authenticated;

-- ── Verificacion ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.negocios'::regclass
      and t.tgname = 'trg_asignar_responsable_area_entrante'
      and not t.tgisinternal
  ) then
    raise exception 'ABORTA: trg_asignar_responsable_area_entrante no esta enganchado a negocios';
  end if;

  if has_function_privilege('authenticated', 'public.asignar_responsable_area_entrante()', 'execute') then
    raise exception 'ABORTA: authenticated conserva EXECUTE sobre asignar_responsable_area_entrante()';
  end if;

  if not exists (
    select 1 from pg_indexes
    where tablename = 'negocio_responsables'
      and indexname = 'negocio_responsables_un_rol_por_negocio'
  ) then
    raise exception 'ABORTA: falta el indice unico parcial de un puesto por negocio';
  end if;
end $$;
