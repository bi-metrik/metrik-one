-- ============================================================
-- Una etapa puede declarar que NO genera aviso de inactividad
--
-- ## EL PEDIDO
--
-- "Comercial no debe recibir avisos de los negocios que estan en validacion ni en
-- propuesta, solo los que superen la etapa de negociacion; en ese punto empezar a
-- notificar" (Mauricio, 2026-09-02).
--
-- Tiene sentido operativo: antes de que el negocio pase Negociacion no hay nada que
-- gestionar contra un tercero, y el silencio del cliente no es trabajo sin hacer del
-- comercial. La etapa de venta temprana se sigue midiendo con el SLA y su "vencido"
-- en el tablero; lo que se apaga es el aviso, no la medicion.
--
-- ## POR QUE UN FLAG POR ETAPA Y NO UN UMBRAL DE ORDEN
--
-- "Avisar desde el orden N" callaria por omision cualquier etapa nueva que se inserte
-- antes, y un aviso que falta no se ve. Con un flag explicito por etapa, una etapa
-- nueva AVISA hasta que alguien decida callarla: el error queda del lado visible.
-- Es el mismo criterio de lista blanca con el que se eligio que cuenta como gestion
-- en `ultima_actividad_negocio` (20260901000011).
--
-- Solo el literal `false` calla. Cualquier otro valor (ausente, `true`, o algo mal
-- escrito) deja la etapa avisando, que otra vez es el lado ruidoso y visible. Y se
-- compara como texto a proposito: un cast reventaria la funcion, o sea el cron
-- entero, por la configuracion de una sola etapa.
--
-- ## ALCANCE MEDIDO (SOENA, 2026-09-02, con el umbral por SLA ya aplicado)
--
--   etapa (orden)      abiertos   disparan hoy   avisos pendientes
--   Validacion (1)           25             22          33
--   Inclusion (2)             0              0           0
--   Propuesta (4)            55             46          49
--   Negociacion (5)           2              2           3
--
-- Son **70 de los 132** negocios que todavia disparan aviso en venta, y **85 de los
-- 252** avisos pendientes. Los pendientes los cierra el propio resolver en su
-- siguiente corrida, sin barrido aparte, porque consulta esta misma funcion.
--
-- La config de SOENA va aparte, en
-- `proyectos/soena/ve/migrations/20260902_sin_aviso_inactividad_antes_de_negociacion.sql`:
-- sin ese dato esta migracion no cambia nada en ningun workspace.
-- ============================================================

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
     and coalesce(e.config_extra->>'avisar_inactividad', 'true') <> 'false'
     and dias_habiles_sin_actividad(n.id) >= umbral_inactividad_negocio(n.id)
  from negocios n
  left join etapas_negocio e on e.id = n.etapa_actual_id
  where n.id = p_negocio_id;
$$;

comment on function public.debe_alertar_inactividad(uuid) is
  'Unica definicion de "este negocio amerita aviso de inactividad": abierto, sin '
  'pausar, en venta o ejecucion, en una etapa que no declare '
  'config_extra.avisar_inactividad = false, y quieto al menos '
  'umbral_inactividad_negocio dias habiles. La consultan los crons (via '
  'negocios_ultima_actividad) y resolver_notificaciones_obsoletas. Reimplementarla en '
  'un cron reabre el bucle que cerro 20260901000011.';

revoke execute on function public.debe_alertar_inactividad(uuid) from public, anon, authenticated;
grant execute on function public.debe_alertar_inactividad(uuid) to service_role;
