-- ============================================================================
-- Trappvel · REVERSA de las reglas de margen · 2026-10-27
-- ============================================================================
-- Deshace `2026-10-27_reglas-margen-PENDIENTE.sql` en la línea «Viaje a medida»:
--   1. Quita `config_extra.margen.reglas`: las cotizaciones NUEVAS vuelven al margen plano.
--   2. Devuelve el mínimo a 5 y el aviso a 10 (los medidos antes del cambio), SOLO si siguen en
--      12: si alguien los cambió después en Mi Negocio, no se tocan y se avisa (NOTICE).
--
-- Las cotizaciones que ya nacieron con reglas las conservan (`cotizaciones.reglas_margen`): su
-- precio no se mueve por esta reversa. Para quitárselas a un borrador, se duplica sin reglas o se
-- pone `reglas_margen = null` en esa fila, a propósito y con su autorización.
--
-- Idempotente.
-- ============================================================================

do $$
declare
  v_ws    constant uuid := 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc';
  v_linea constant uuid := '42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887';
  v_cfg    jsonb;
  v_margen jsonb;
begin
  select config_extra into v_cfg from public.lineas_negocio where id = v_linea and workspace_id = v_ws for update;
  if not found then
    raise exception 'La línea % no es del workspace % (o no existe)', v_linea, v_ws;
  end if;
  v_margen := coalesce(v_cfg -> 'margen', '{}'::jsonb) - 'reglas';

  if (v_margen ->> 'piso_pct')::numeric = 12 then
    v_margen := v_margen || jsonb_build_object('piso_pct', 5);
  else
    raise notice 'El mínimo no está en 12 (%): no se toca', v_margen ->> 'piso_pct';
  end if;
  if (v_margen ->> 'aviso_pct')::numeric = 12 then
    v_margen := v_margen || jsonb_build_object('aviso_pct', 10);
  else
    raise notice 'El aviso no está en 12 (%): no se toca', v_margen ->> 'aviso_pct';
  end if;

  update public.lineas_negocio
     set config_extra = jsonb_set(coalesce(v_cfg, '{}'::jsonb), '{margen}', v_margen)
   where id = v_linea and workspace_id = v_ws;
end $$;
