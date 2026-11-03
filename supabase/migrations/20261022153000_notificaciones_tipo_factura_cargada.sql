-- Aviso de factura cargada (pedido de Mauricio, 2026-10-22): cuando el cobrador carga la factura
-- electrónica de una cuota (`cargarFacturaCuota`), la persona designada del espacio que paga recibe
-- un aviso en la campana con el enlace a Pagos. Código: `src/lib/valida-cda/aviso-factura-cuota*.ts`.
--
-- Solo amplía el CHECK de `notificaciones.tipo` con `factura_cargada`: no toca filas ni crea
-- tablas, funciones o vistas. Sin backfill: las facturas ya cargadas no generan aviso.
--
-- Se amplía LEYENDO el CHECK que está en la base (patrón de 20260928170500), no reescribiendo la
-- lista a mano: si producción tiene un tipo que las migraciones no muestran, se conserva. Idempotente.
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
    raise exception 'factura_cargada: no existe notificaciones_tipo_check; no se amplía a ciegas';
  end if;

  if position('''factura_cargada''' in v_def) > 0 then
    raise notice 'factura_cargada: notificaciones_tipo_check ya lo admite';
    return;
  end if;

  -- Forma de Postgres: CHECK ((tipo = ANY (ARRAY['a'::text, 'b'::text])))
  v_nueva := regexp_replace(v_def, '\]\)\)\)$', ', ''factura_cargada''::text])))');
  if v_nueva = v_def or position('''factura_cargada''' in v_nueva) = 0 then
    raise exception 'factura_cargada: forma inesperada de notificaciones_tipo_check: %', v_def;
  end if;

  alter table public.notificaciones drop constraint notificaciones_tipo_check;
  execute format('alter table public.notificaciones add constraint notificaciones_tipo_check %s', v_nueva);
end $$;
