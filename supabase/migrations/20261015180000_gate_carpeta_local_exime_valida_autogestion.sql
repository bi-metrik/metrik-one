-- ============================================================
-- 20261015180000 — El gate de carpeta local exime a los negocios de la activación autogestionada de Valida
--
-- ## El fallo (prueba real del 2026-10-15, preview de #1169)
--
-- Al confirmar el cobro en la consulta 11, `valida_activar_autogestion` (20261012100000) inserta el
-- negocio del contrato en `metrik`, directo en la etapa «Cobro» (orden 2) de la línea Valida. `metrik`
-- tiene `config_extra.exigir_carpeta_local = true`, así que `trg_zz_gate_carpeta_local`
-- (20260914223000) lo rechaza con MK001 («no puede crearse en la etapa "Cobro" sin su carpeta del
-- cerebro») y toda la activación se revierte: ni contrato, ni módulo, ni cobro.
--
-- Una cuenta que se da de alta sola no tiene, ni va a tener, carpeta en el cerebro local: nadie de
-- MéTRIK la abre. Decisión de Mauricio (2026-10-15): «sí, exime a los de Valida autogestionada».
--
-- ## Qué cambia: UNA condición, y solo para esos negocios
--
-- El gate deja pasar un negocio sin carpeta cuando las DOS cosas son ciertas:
--
--   1. `metadata.origen = 'valida_autogestion'`: la marca que la RPC ya pone en el INSERT (no hay que
--      tocar la RPC).
--   2. `metadata.workspace_one` es el slug de un espacio que nació en el registro autogestionado: tiene
--      fila en `valida_registros`. La marca sola es texto que cualquiera escribe; esta segunda
--      condición ata la exención a un hecho de la base (el espacio existe y salió de /valida/empezar).
--      Sin filtro de `estado`: si el espacio se limpia después (`rechazado`), el negocio sigue siendo
--      el de esa cuenta y moverlo no debe empezar a pedir carpeta.
--
-- Un negocio con cualquier otro origen, o con la marca pero sin espacio de registro detrás, sigue
-- exigiendo la carpeta exactamente como antes. Los demás workspaces no notan nada (el gate sale en
-- la segunda comprobación, igual que antes).
--
-- La exención vale para la vida del negocio, no solo el INSERT: si alguien lo devuelve a «Venta» y lo
-- vuelve a pasar a «Cobro», tampoco pide carpeta.
--
-- ## Los tres caminos que crean ese negocio
--
-- La consulta 11 (`cobrarAlConfirmar`), el botón «Activar plan» (`activarPlanValida`) y el cobro del
-- día 7 (cron, `procesarCobrosTrasPrueba`, que con `activarYCobrarReclamado` comparte camino con la consulta 11) llaman todos a `activarPlanDelEspacio`, que llama a esta misma
-- RPC: un único INSERT, cubierto por esta exención.
--
-- ## Qué escribe: DDL de UNA función (create or replace). Ni una fila. El trigger no se toca.
--
-- Antes de aplicar: comparar `md5(prosrc)` de `gate_carpeta_local_negocio` en producción contra el
-- cuerpo de 20260914223000 (el repo no tiene otra versión). Si difieren, alguien la cambió fuera del
-- repo y esta migración lo pisaría.
--
-- ## Reversa
--   Volver a correr el `create or replace function` de 20260914223000_gate_carpeta_local.sql.
-- ============================================================

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

  -- Exención (20261015180000): el negocio de una cuenta de Valida autogestionada. La marca de la RPC
  -- Y un espacio del registro autogestionado detrás; la marca sola no basta.
  if new.metadata ->> 'origen' = 'valida_autogestion'
     and exists (
       select 1
         from public.workspaces w
         join public.valida_registros r on r.workspace_id = w.id
        where w.slug = new.metadata ->> 'workspace_one'
     ) then
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
  'Gate opt-in (workspaces.config_extra.exigir_carpeta_local = true): rechaza con SQLSTATE MK001 que un negocio pase de la primera etapa de su linea (o nazca despues de ella) sin metadata.carpeta_local. Exime al negocio de una cuenta de Valida autogestionada (metadata.origen = valida_autogestion con su espacio en valida_registros, 20261015180000). La aplicacion reconoce el codigo en src/lib/negocios/gate-carpeta-local.ts.';

revoke execute on function public.gate_carpeta_local_negocio() from public, anon, authenticated;
