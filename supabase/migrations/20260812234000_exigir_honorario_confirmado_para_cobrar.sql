-- Exigir honorario confirmado antes de registrar un cobro.
--
-- Decision de Mauricio (2026-08-12): "Ningun caso debe avanzar sin tener un plan
-- escogido que confirme el valor del honorario."
--
-- POR QUE EN LA BASE Y NO EN CADA SERVER ACTION
-- Hay 11 sitios distintos que insertan en `cobros` (negocio-v2-actions x2,
-- conciliacion-actions x5, epayco-actions, pago-externo-actions, ve-proyecto,
-- generar-cuentas-cobro) mas el cron de planes recurrentes. Replicar el criterio
-- en cada uno es el mismo inventario que nadie puede cerrar que ya costo caro con
-- la formula de saldo (siete sitios) y con los sumadores de cobros anulados. El
-- criterio vive UNA vez, aqui, y lo aplica el trigger sobre la tabla: ningun
-- camino futuro puede saltarselo, ni siquiera un INSERT por SQL.
--
-- OPT-IN, Y EL DEFAULT REPRODUCE EL COMPORTAMIENTO PREVIO
-- `config_extra.cobro.exige_honorario_confirmado`, linea gana sobre workspace.
-- Sin la clave no cambia nada para nadie: quien no declara recibe lo que ya tenia,
-- no una suposicion. Medido antes de escribir: metrik y advise cobran por planes
-- recurrentes (44 cobros programados); encender esto de forma global los romperia.
--
-- QUE CUENTA COMO "CONFIRMADO": `negocios.precio_aprobado > 0`
-- Medido en produccion el 2026-08-12 sobre los 192 negocios de SOENA con precio:
--   - nacido_en_one (64) y meta_lead (5): 100% con aprobacion formal y plan escogido.
--   - historico_iva_2026_07 (114) e iva_devolucion (8): 0% con aprobacion formal,
--     pero TODOS con precio confirmado por la via del cargue. 111 siguen abiertos
--     y 8 ya cobraron.
-- Exigir la marca de aprobacion del bloque (`aprobado_at`) en vez del valor habria
-- frenado esos 122 casos sin que les falte nada. Lo que la regla protege es que
-- haya un valor confirmado contra el cual medir lo que entra; el plan es la via
-- normal de confirmarlo, no el fin en si mismo.
-- Nota: el criterio tambien atrapa a V0066, que SI tiene plan escogido pero con
-- honorario en cero. Un plan que no confirma valor no cumple la regla.
--
-- QUE NO BLOQUEA, Y POR QUE
--   - Cobro sin negocio (`negocio_id is null`): no hay honorario que confirmar.
--   - Cobro de un plan recurrente (`plan_cobro_id is not null`): ahi el valor lo
--     confirma el plan, que es su propio acuerdo escrito.
--   - Monto <= 0: son las devoluciones y remanentes por devolver, que RESTAN. Un
--     control de cobro no puede impedir corregir hacia abajo.
--   - Negocio ya cerrado: el trabajo termino; frenar el registro de una plata que
--     ya entro solo esconderia el ingreso.
--
-- ROLLBACK: `drop trigger trg_cobro_exige_honorario_confirmado on public.cobros;`
-- Retirar la clave de config tambien lo desactiva, sin tocar el esquema.

-- 1. Criterio, fuente unica. Lo consumen el trigger y la RPC de aviso previo.
create or replace function public.negocio_exige_honorario_confirmado(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- la linea gana sobre el workspace; la primera que declare, manda
    (l.config_extra #>> '{cobro,exige_honorario_confirmado}')::boolean,
    (w.config_extra #>> '{cobro,exige_honorario_confirmado}')::boolean,
    false
  )
  and coalesce(n.precio_aprobado, 0) <= 0
  and n.estado = 'abierto'
  from negocios n
  join workspaces w on w.id = n.workspace_id
  left join lineas_negocio l on l.id = n.linea_id
  where n.id = p_negocio_id;
$$;

comment on function public.negocio_exige_honorario_confirmado(uuid) is
  'true si al negocio le FALTA el honorario confirmado y su linea/workspace lo exige para cobrar. Fuente unica del criterio: la consumen el trigger de cobros y la RPC de aviso previo.';

-- server-only: la invoca el trigger sobre `cobros`. El cliente usa la RPC de abajo.
revoke execute on function public.negocio_exige_honorario_confirmado(uuid) from public, anon, authenticated;

-- 2. El guard. BEFORE INSERT: ningun camino de escritura lo esquiva.
create or replace function public.cobro_exige_honorario_confirmado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
begin
  if new.negocio_id is null
     or new.plan_cobro_id is not null
     or coalesce(new.monto, 0) <= 0 then
    return new;
  end if;

  if public.negocio_exige_honorario_confirmado(new.negocio_id) then
    select codigo into v_codigo from negocios where id = new.negocio_id;
    raise exception using
      errcode = 'check_violation',
      message = format(
        'El negocio %s no tiene el honorario confirmado: aprueba la propuesta economica (elige el plan) antes de registrar el cobro.',
        coalesce(v_codigo, new.negocio_id::text)
      ),
      hint = 'La propuesta economica queda editable en el negocio mientras falte el valor, aunque el caso ya haya avanzado de etapa.';
  end if;

  return new;
end;
$$;

comment on function public.cobro_exige_honorario_confirmado() is
  'Frena el registro de un cobro cuando el negocio no tiene honorario confirmado. Opt-in por linea/workspace. Exime cobros sin negocio, de plan recurrente, de monto <= 0 y de negocios cerrados.';

revoke execute on function public.cobro_exige_honorario_confirmado() from public, anon, authenticated;

drop trigger if exists trg_cobro_exige_honorario_confirmado on public.cobros;
create trigger trg_cobro_exige_honorario_confirmado
  before insert on public.cobros
  for each row execute function public.cobro_exige_honorario_confirmado();

-- 3. Aviso previo para la pantalla: mismo criterio, con el filtro de sesion que el
--    trigger no puede tener (lo llama tambien service_role). Sin esto cada
--    superficie de captura tendria que reimplementar la pregunta, que es justo lo
--    que esta migracion evita.
create or replace function public.negocio_puede_recibir_cobro(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.negocio_exige_honorario_confirmado(p_negocio_id)
  from negocios n
  where n.id = p_negocio_id
    and n.workspace_id = current_user_workspace_id();
$$;

comment on function public.negocio_puede_recibir_cobro(uuid) is
  'Version para el cliente: false si al negocio le falta el honorario confirmado. Devuelve NULL si el negocio no es del workspace de la sesion.';

-- ejecutable-por-cliente: las superficies de captura de pago preguntan ANTES de
-- dejar llenar el formulario. Filtra por current_user_workspace_id().
revoke execute on function public.negocio_puede_recibir_cobro(uuid) from public, anon;
grant execute on function public.negocio_puede_recibir_cobro(uuid) to authenticated;
