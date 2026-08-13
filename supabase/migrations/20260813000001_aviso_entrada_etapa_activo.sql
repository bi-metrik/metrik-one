-- El aviso de entrada a etapa se puede APAGAR sin perder su configuración.
--
-- `avisar_entrada_etapa()` decidía solo por presencia: si `avisar_al_entrar` existe,
-- avisa. Para apagarlo había que borrar la clave, y con ella las áreas, el título y el
-- mensaje que alguien redactó. Eso vuelve el apagado destructivo y desanima a usarlo.
--
-- Ahora respeta `avisar_al_entrar.activo`:
--   - clave ausente  → avisa (idéntico al comportamiento actual: nadie cambia)
--   - activo = true  → avisa
--   - activo = false → NO avisa, y la configuración queda intacta para reactivarla
--
-- Hace falta para el selector de avisos por etapa de `/flujo`, donde el aviso interno
-- se prende y apaga con un interruptor.
--
-- ⚠️ La función NO se transcribe: se edita sobre su definición VIGENTE volcada de la
-- base y con el reemplazo CONTADO, que aborta si no aplica. Esta función cuelga del
-- UPDATE de `negocios.etapa_actual_id`: una transcripción con una firma desactualizada
-- (`crear_notificacion` cambió de parámetros) rompería el avance de etapa en
-- producción. Mismo método que la tanda de funciones del 2026-08-10.

do $$
declare
  v_def text;
  v_guard constant text := 'if v_cfg is null then return new; end if;';
  v_nuevo constant text :=
    'if v_cfg is null then return new; end if;' || E'\n' ||
    '  -- Apagado explicito: la config se conserva, el aviso no sale.' || E'\n' ||
    '  if coalesce((v_cfg ->> ''activo'')::boolean, true) = false then return new; end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'avisar_entrada_etapa';

  if v_def is null then
    raise exception 'avisar_entrada_etapa no existe: nada que editar';
  end if;

  -- Idempotente: si ya trae el guard, no se toca.
  if position('''activo''' in v_def) > 0 then
    raise notice 'avisar_entrada_etapa ya respeta activo; sin cambios';
    return;
  end if;

  if position(v_guard in v_def) = 0 then
    raise exception 'no se encontro el guard esperado en avisar_entrada_etapa: la funcion cambio, revisar a mano';
  end if;

  v_def := replace(v_def, v_guard, v_nuevo);
  execute v_def;
end $$;

comment on function public.avisar_entrada_etapa() is
  'Avisa (in-app + correo opcional) cuando un negocio entra a una etapa con config_extra.avisar_al_entrar. Se apaga con avisar_al_entrar.activo=false sin perder la config. Destinatario por areas declaradas o por el stage de la etapa.';
