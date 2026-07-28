-- Aviso al entrar a una etapa: in-app + correo, config-driven por etapa
--
-- CASO QUE LO ORIGINA (Juan David, reunion 2026-07-24): cuando operaciones
-- termina el certificado UPME y el negocio pasa a Entrega, el COMERCIAL tiene
-- que enterarse para entregarselo al cliente. Hoy no se entera de nada: tiene
-- que estar mirando el tablero.
--
-- POR QUE UN TRIGGER Y NO UN CAMBIO EN `cambiarEtapaNegocio*`:
--   1. Ese motor es territorio de otra sesion en curso (S1, flujo de IVA).
--      Un trigger consigue lo mismo sin tocar una linea de su archivo.
--   2. Cubre TODOS los caminos por los que un negocio cambia de etapa: la UI,
--      el routing automatico, el salto de Cobro cuando el saldo queda en cero,
--      un backfill por SQL. Enganchar en el codigo habria cubierto solo uno.
--
-- QUIEN RECIBE: `destinatarios_negocio` resuelve por el stage de la etapa
-- nueva (venta -> comercial, ejecucion -> operaciones, cobro -> ambos). Entrega
-- es stage `venta`, asi que le llega al comercial del caso. No hay lista de
-- destinatarios que mantener aparte.
--
-- CONFIG (por etapa, generico para cualquier workspace):
--   etapas_negocio.config_extra.avisar_al_entrar = {
--     "email": true,
--     "titulo": "Certificado UPME listo para entregar",
--     "mensaje": "El certificado de {negocio} esta listo. Entregaselo al cliente."
--   }
-- Placeholders: {negocio}, {codigo}, {etapa}. Sin la config, no pasa nada.

-- Tipo nuevo para este aviso
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (
  tipo = any (array[
    'inactividad_oportunidad', 'handoff', 'asignacion_responsable',
    'asignacion_colaborador', 'mencion', 'streak_roto', 'inactividad_proyecto',
    'proyecto_entregado', 'proyecto_cerrado', 'cobro_vencido', 'cobro_proximo',
    'plan_terminado', 'cuenta_cobro_pendiente_aprobacion', 'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo', 'responsable_faltante_area',
    'negocio_cancelado', 'negocio_reabierto', 'negocio_reactivado',
    'conciliacion_solicitada', 'mencion_equipo',
    'reproceso',          -- S1 (su migracion de tipo aun no estaba aplicada en prod)
    'negocio_en_etapa'   -- el negocio entro a una etapa que pide aviso
  ])
);

create or replace function public.avisar_entrada_etapa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cfg jsonb;
  v_etapa_nombre text;
  v_titulo text;
  v_mensaje text;
  v_dest record;
  v_url text;
  v_secret text;
begin
  -- Solo al CAMBIAR de etapa (no en cualquier update del negocio)
  if new.etapa_actual_id is null or new.etapa_actual_id is not distinct from old.etapa_actual_id then
    return new;
  end if;

  select e.config_extra -> 'avisar_al_entrar', e.nombre
    into v_cfg, v_etapa_nombre
  from etapas_negocio e where e.id = new.etapa_actual_id;

  if v_cfg is null then return new; end if;

  v_titulo := coalesce(v_cfg ->> 'titulo',
    coalesce(new.nombre,'Un negocio') || ' llegó a ' || coalesce(v_etapa_nombre,'una etapa nueva'));

  v_mensaje := coalesce(v_cfg ->> 'mensaje', 'Este negocio pasó a tu etapa y espera tu gestión.');
  v_mensaje := replace(v_mensaje, '{negocio}', coalesce(new.nombre, ''));
  v_mensaje := replace(v_mensaje, '{codigo}',  coalesce(new.codigo, ''));
  v_mensaje := replace(v_mensaje, '{etapa}',   coalesce(v_etapa_nombre, ''));

  -- ── In-app, a quien le toca la etapa nueva ────────────────────────────────
  -- Se permite repetir: cada entrada a la etapa es un hecho distinto (un
  -- negocio puede volver a Entrega tras un reproceso, y ese aviso es real).
  for v_dest in select * from destinatarios_negocio(new.id) loop
    perform crear_notificacion(
      new.workspace_id, v_dest.profile_id, 'negocio_en_etapa',
      v_titulo, 'negocio', new.id, '/negocios/' || new.id::text,
      jsonb_build_object('etapa', v_etapa_nombre, 'mensaje', v_mensaje, 'via', v_dest.via),
      true
    );
  end loop;

  -- ── Correo (opt-in por etapa) ─────────────────────────────────────────────
  -- La edge function resuelve destinatarios y correos; aca solo se dispara.
  -- Si el secreto no esta configurado, el aviso in-app ya quedo hecho.
  if coalesce((v_cfg ->> 'email')::boolean, false) then
    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET' limit 1;

    if v_secret is not null then
      select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL' limit 1;

      if v_url is not null then
        perform net.http_post(
          url := v_url || '/notificar-etapa',
          body := jsonb_build_object('negocio_id', new.id),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
          )
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_avisar_entrada_etapa on public.negocios;
create trigger trg_avisar_entrada_etapa
  after update of etapa_actual_id on public.negocios
  for each row execute function public.avisar_entrada_etapa();

comment on function public.avisar_entrada_etapa() is
  'Avisa (in-app + correo opcional) cuando un negocio entra a una etapa con config_extra.avisar_al_entrar. Destinatario resuelto por el stage de la etapa. Trigger para cubrir todos los caminos de cambio de etapa sin acoplarse al motor.';
