-- Guarda de misma empresa: la base rechaza una fila hija cuyo padre es de otra empresa.
--
-- Por qué (recomendación 1 del informe de arquitectura de agentes, 2026-10-30): wa-webhook y
-- chatwoot-agente escriben con service_role, así que el RLS no corre y la separación entre empresas
-- la hace solo el código con `.eq('workspace_id', ws)`. Esta guarda es la segunda capa: si un cambio
-- futuro deja pasar el id de un negocio o contacto de otra empresa, la escritura falla, venga de
-- Agus, de la app o de un cron.
--
-- Cubre cinco relaciones (padre nulo pasa sin revisar):
--   gastos.negocio_id                     -> negocios
--   cobros.negocio_id                     -> negocios
--   activity_log.entidad_id (tipo negocio) -> negocios
--   contacto_perfil_hechos.contacto_id    -> contactos
--   negocios.contacto_id                  -> contactos
--
-- Disparador y no llave compuesta: activity_log es polimórfica y no admite llave foránea, y una sola
-- forma para las cinco es más fácil de auditar. Filas cruzadas en producción al 2026-11-05: 0 en las
-- cinco, así que entra sin limpiar datos.
--
-- La función es SECURITY DEFINER a propósito: con RLS, quien escribe como `authenticated` no ve el
-- padre de otra empresa, la lectura devolvería nulo y la fila pasaría. Así la guarda ve el padre siempre.
-- El EXECUTE de una función de disparador solo se revisa al crear el disparador; se revoca a todos.
--
-- Rechaza con SQLSTATE MK002 (MK001 es el gate de carpeta local).

create or replace function public.guarda_misma_empresa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_columna text := tg_argv[0];
  v_tabla_padre text := tg_argv[1];
  v_padre uuid;
  v_ws_padre uuid;
begin
  v_padre := (to_jsonb(new) ->> v_columna)::uuid;
  if v_padre is null then
    return new;
  end if;

  execute format('select workspace_id from public.%I where id = $1', v_tabla_padre)
    into v_ws_padre
    using v_padre;

  if v_ws_padre is not null and v_ws_padre is distinct from new.workspace_id then
    raise exception 'guarda de misma empresa: %.% apunta a % de otra empresa', tg_table_name, v_columna, v_tabla_padre
      using errcode = 'MK002',
            detail = format('%s.%s=%s; empresa de la fila %s, empresa del padre %s',
                            tg_table_name, v_columna, v_padre, new.workspace_id, v_ws_padre);
  end if;

  return new;
end;
$$;

revoke execute on function public.guarda_misma_empresa() from public, anon, authenticated;

comment on function public.guarda_misma_empresa() is
  'Disparador genérico (tg_argv: columna, tabla padre). Rechaza con SQLSTATE MK002 una fila cuyo padre existe y es de otra empresa (workspace_id distinto). Padre nulo o inexistente pasa. 20261105170000.';

drop trigger if exists guarda_misma_empresa_negocio on public.gastos;
create trigger guarda_misma_empresa_negocio
  before insert or update of negocio_id, workspace_id on public.gastos
  for each row when (new.negocio_id is not null)
  execute function public.guarda_misma_empresa('negocio_id', 'negocios');

drop trigger if exists guarda_misma_empresa_negocio on public.cobros;
create trigger guarda_misma_empresa_negocio
  before insert or update of negocio_id, workspace_id on public.cobros
  for each row when (new.negocio_id is not null)
  execute function public.guarda_misma_empresa('negocio_id', 'negocios');

drop trigger if exists guarda_misma_empresa_negocio on public.activity_log;
create trigger guarda_misma_empresa_negocio
  before insert or update of entidad_id, entidad_tipo, workspace_id on public.activity_log
  for each row when (new.entidad_tipo = 'negocio')
  execute function public.guarda_misma_empresa('entidad_id', 'negocios');

drop trigger if exists guarda_misma_empresa_contacto on public.contacto_perfil_hechos;
create trigger guarda_misma_empresa_contacto
  before insert or update of contacto_id, workspace_id on public.contacto_perfil_hechos
  for each row
  execute function public.guarda_misma_empresa('contacto_id', 'contactos');

drop trigger if exists guarda_misma_empresa_contacto on public.negocios;
create trigger guarda_misma_empresa_contacto
  before insert or update of contacto_id, workspace_id on public.negocios
  for each row when (new.contacto_id is not null)
  execute function public.guarda_misma_empresa('contacto_id', 'contactos');
