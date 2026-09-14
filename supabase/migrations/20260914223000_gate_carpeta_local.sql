-- Gate de carpeta local: un negocio no pasa de la primera etapa de su linea sin su
-- carpeta del cerebro.
--
-- ## Que exige
--
-- En los workspaces que lo declaran, ningun negocio puede quedar DESPUES de la primera
-- etapa de su linea sin `negocios.metadata.carpeta_local`: la ruta de su carpeta en el
-- cerebro local de MeTRIK (`proyectos/{cliente}/{proyecto}/`). Es lo que conecta el
-- negocio con su base de conocimiento.
--
-- ## Opt-in, y esta migracion no enciende nada
--
-- Solo el workspace de MeTRIK tiene cerebro. La clave es
-- `workspaces.config_extra.exigir_carpeta_local` y solo cuenta el booleano JSON `true`
-- (un texto "true" no lo enciende). Sin la clave, el trigger sale en la segunda
-- comprobacion y el workspace no nota ninguna diferencia.
--
-- Esta migracion es DDL PURO: crea una funcion y un trigger, no toca una sola fila.
-- Encender la clave para `metrik` es un UPDATE aparte que aprueba Mauricio.
--
-- ## Por que un trigger y no el server action
--
-- `etapa_actual_id` lo escriben seis caminos de la aplicacion (`cambiarEtapaNegocio`,
-- el retorno al punto de decision, el reproceso, la reapertura, la devolucion y la
-- reversa de ruta), los scripts de cargue y cualquier SQL directo de un agente. Un
-- control en uno solo deja los demas abiertos. La regla vive aqui y solo aqui; la
-- aplicacion no la repite: reconoce el rechazo por su SQLSTATE (`MK001`) para
-- mostrarlo como gate (`src/lib/negocios/gate-carpeta-local.ts`).
--
-- ## Que cuenta y que no
--
--   · Cuenta: cambiar `etapa_actual_id` a una etapa que no es la primera de su linea,
--     y INSERTAR un negocio directamente en una etapa asi.
--   · No cuenta: cerrar (perder, cancelar y completar no tocan `etapa_actual_id`),
--     pausar, editar cualquier otro campo, ni un UPDATE que nombra `etapa_actual_id`
--     con el mismo valor (`UPDATE OF` dispara igual; se descarta con
--     IS NOT DISTINCT FROM, el mismo criterio de `sync_negocio_stage_from_etapa`).
--     Tampoco quitarle la carpeta a un negocio que ya avanzo: la regla es de transito.
--   · Mover a NULL no cuenta (incluido el `on delete set null` de la FK).
--   · "Primera etapa" = el menor `orden` de la linea. Medido el 2026-09-14: las 15
--     lineas de la base empiezan en orden 1, asi que hoy equivale a `orden > 1`.
--     Contra el minimo, renumerar una linea no deja la primera etapa bloqueada (y con
--     ella la creacion de negocios) ni la segunda sin guarda.
--   · Carpeta vacia = ausente, null JSON, un valor que no es texto, o solo espacios.
--
-- ## Por que tambien el INSERT
--
-- Un negocio que NACE en la etapa 3 llega al mismo estado prohibido sin pasar por
-- ningun UPDATE, y es justo la puerta que usa un agente o un script: el SQL directo es
-- la forma mas probable de crear un negocio sin su vinculo al cerebro. Los caminos
-- normales no lo notan: `crearNegocio` nace en la primera etapa de la linea (en
-- `metrik`, `stages_activos` incluye `venta` y no hay `entrada_manual_orden`), y la
-- reapertura como negocio nuevo nace en la primera etapa no cerrada. Un INSERT que
-- trae la carpeta en `metadata` pasa.
--
-- ## Convivencia con los demas triggers de `negocios`
--
-- Los BEFORE disparan en orden alfabetico. `trg_zz_` lo deja de ultimo, para juzgar la
-- fila ya terminada: despues de `negocio_auto_codigo` (el codigo que cita el mensaje),
-- `trg_negocios_init_etapa_cambiada_at`, `trg_negocios_track_etapa_change` y
-- `trg_sync_negocio_stage_from_etapa`. Ninguno escribe `etapa_actual_id` ni `metadata`
-- hoy (leido de `pg_get_functiondef` el 2026-09-14), pero ir de ultimo lo mantiene
-- correcto si alguno empieza a hacerlo. `trg_sync_negocios_pausa` no dispara en un
-- cambio de etapa (es `UPDATE OF is_paused, pausado`).
--
-- Si el gate rechaza, la sentencia aborta antes de los AFTER: `trg_avisar_entrada_etapa`
-- no manda el aviso de entrada y `trg_asignar_responsable_area_entrante` no asigna.
--
-- ## SECURITY DEFINER
--
-- Lee `workspaces` y `etapas_negocio`, que tienen RLS por workspace. Como invocador, una
-- etapa que la sesion no alcanzara a leer daria `orden` NULL y el gate dejaria pasar en
-- silencio. EXECUTE revocado a public, anon y authenticated: un trigger no lo necesita
-- para disparar (verificado en `20260811100000`).

create or replace function public.gate_carpeta_local_negocio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exige        boolean;
  v_linea_id     uuid;
  v_orden        integer;
  v_etapa_nombre text;
  v_primer_orden integer;
  v_carpeta      jsonb;
begin
  if new.etapa_actual_id is null then
    return new;
  end if;

  -- Solo cuenta un cambio de etapa.
  if tg_op = 'UPDATE' and new.etapa_actual_id is not distinct from old.etapa_actual_id then
    return new;
  end if;

  select coalesce(w.config_extra -> 'exigir_carpeta_local' = 'true'::jsonb, false)
    into v_exige
  from public.workspaces w
  where w.id = new.workspace_id;

  if v_exige is not true then
    return new;
  end if;

  select e.linea_id, e.orden, e.nombre
    into v_linea_id, v_orden, v_etapa_nombre
  from public.etapas_negocio e
  where e.id = new.etapa_actual_id;

  -- Etapa inexistente: la rechaza la FK, no este gate.
  if v_orden is null then
    return new;
  end if;

  select min(e.orden)
    into v_primer_orden
  from public.etapas_negocio e
  where e.linea_id = v_linea_id;

  if v_orden <= v_primer_orden then
    return new;
  end if;

  v_carpeta := new.metadata -> 'carpeta_local';
  if v_carpeta is not null
     and jsonb_typeof(v_carpeta) = 'string'
     and (v_carpeta #>> '{}') ~ '[^[:space:]]' then
    return new;
  end if;

  -- El MESSAGE se basta solo: varios caminos lo muestran tal cual, sin mirar el hint.
  raise exception using
    errcode = 'MK001',
    message = format(
      'El negocio %s no puede %s la etapa "%s" sin su carpeta del cerebro: registra la ruta proyectos/{cliente}/{proyecto}/ en metadata.carpeta_local.',
      coalesce(new.codigo, new.nombre),
      case when tg_op = 'INSERT' then 'crearse en' else 'pasar a' end,
      v_etapa_nombre
    ),
    detail = 'Este workspace exige la carpeta local (config_extra.exigir_carpeta_local) para pasar de la primera etapa de la linea. Cerrar, pausar o editar otros campos no la exige.',
    hint = 'Llena negocios.metadata.carpeta_local y vuelve a mover el negocio.';
end;
$$;

comment on function public.gate_carpeta_local_negocio() is
  'Gate opt-in (workspaces.config_extra.exigir_carpeta_local = true): rechaza con SQLSTATE MK001 que un negocio pase de la primera etapa de su linea (o nazca despues de ella) sin metadata.carpeta_local. La aplicacion reconoce el codigo en src/lib/negocios/gate-carpeta-local.ts.';

revoke execute on function public.gate_carpeta_local_negocio() from public, anon, authenticated;

drop trigger if exists trg_zz_gate_carpeta_local on public.negocios;

create trigger trg_zz_gate_carpeta_local
  before insert or update of etapa_actual_id on public.negocios
  for each row execute function public.gate_carpeta_local_negocio();
