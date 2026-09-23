-- ============================================================================
-- Valida · CDA: comisión de AFI y valor del usuario adicional · 2026-09-23
--
-- Sobre los contratos `valida-cda-licencia` ya cargados (`2026-09-23_contratos-y-terminos-cdas.sql`):
--
--   1. `parametros.valor_usuario_adicional = 50000`: el valor mensual de un usuario adicional de la
--      cláusula 2.3 de los Términos. La sección Suscripción NO tiene default: sin esta llave no
--      vende licencias («El valor del usuario adicional no está registrado en tu contrato»).
--   2. `comision` de AFI INTERNATIONAL GROUP S.A.S. (NIT 902003244-6), decisión de Mauricio del
--      2026-09-23: $50.000 fijos por CDA y por mes (cada cuota cobrada) MÁS el 20 % de todo lo
--      adicional que compre el CDA (usuarios adicionales hoy; Sustenta u otro servicio mañana).
--        { modo: 'fijo_mas_porcentaje', monto_fijo: 50000, pct: 20, base: 'cada_cobro', ... }
--      La base del 20 % es la suma de `licencias_adicionales_cargos` de la cuota cobrada
--      (`CobroDeCiclo.valorAdicional` en `src/lib/servicios/comision.ts`).
--
-- Cada cambio deja su fila en `servicios_contratados_cambios` (quién, cuándo, antes, después, por qué).
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Escribe datos de producción: lo corre la sesión principal.
--
-- ── Orden ───────────────────────────────────────────────────────────────────
--   0. La migración `20260924060000_suscripcion_cda_licencias_usuarios_comision.sql` aplicada:
--      sin ella el CHECK `comision_coherente` rechaza el modo `fijo_mas_porcentaje`.
--   1. Los contratos de los CDA cargados. El bloque actualiza los que encuentre de los cuatro y dice
--      cuántos; un CDA sin contrato todavía se salta (correr el bloque otra vez después de cargarlo).
--   2. Correr tal cual (ENSAYO: tiene que terminar en «ENSAYO OK … Nada quedó escrito»), cambiar
--      `c_ensayo` a false y correrlo de nuevo. Es UN statement: el ensayo deshace todo.
--   3. Idempotente: un contrato que ya tiene los dos valores no se toca ni deja otra fila.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
--   · No liquida ni paga comisión: eso lo hace el ciclo de comisiones con la base que declare.
--   · No toca el precio mensual, las licencias ni las cuotas.
--   · La formalización con AFI (documento que respalde el 20 %) va aparte: esto solo la registra.
--
-- ── Verificación después (solo lectura) ─────────────────────────────────────
--   select w.slug, sc.parametros, sc.comision
--     from public.servicios_contratados sc
--     join public.workspaces w on w.id = sc.workspace_pagador_id
--    where sc.servicio_slug = 'valida-cda-licencia';
--   select sc.id, c.campo, c.valor_anterior, c.valor_nuevo, c.created_at
--     from public.servicios_contratados_cambios c
--     join public.servicios_contratados sc on sc.id = c.servicio_contratado_id
--    where sc.servicio_slug = 'valida-cda-licencia' and c.campo in ('parametros', 'comision')
--    order by c.created_at desc;
-- ============================================================================

do $bloque$
declare
  -- ⚠️ true = ENSAYO: actualiza, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo            constant boolean := true;
  c_registrado_por    constant uuid    := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_espacios          constant text[]  := array['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec'];
  c_valor_adicional   constant numeric := 50000;
  c_comision          constant jsonb   := jsonb_build_object(
    'modo', 'fijo_mas_porcentaje',
    'monto_fijo', 50000,
    'pct', 20,
    'base', 'cada_cobro',
    'beneficiario_empresa_id', 'ecc378c7-10c4-4984-a31d-5533a598ad71',
    'beneficiario_nit', '902003244-6'
  );
  r              record;
  v_parametros   jsonb;
  v_contratos    integer := 0;
  v_cambios      integer := 0;
begin
  if not public.comision_coherente(c_comision) then
    raise exception 'La comisión no pasa comision_coherente: falta la migración 20260924060000.';
  end if;

  for r in
    select sc.id, sc.parametros, sc.comision, sc.estado, w.slug
      from public.servicios_contratados sc
      join public.workspaces w on w.id = sc.workspace_pagador_id
     where sc.servicio_slug = 'valida-cda-licencia'
       and w.slug = any (c_espacios)
     order by w.slug
       for update of sc
  loop
    v_contratos := v_contratos + 1;
    if r.estado <> 'activo' then
      raise exception '%: el contrato % no está activo (%). Revisar antes de tocarlo.', r.slug, r.id, r.estado;
    end if;

    -- 1. El valor del usuario adicional (cláusula 2.3).
    if (r.parametros->>'valor_usuario_adicional') is distinct from c_valor_adicional::text then
      v_parametros := coalesce(r.parametros, '{}'::jsonb) || jsonb_build_object('valor_usuario_adicional', c_valor_adicional);
      update public.servicios_contratados set parametros = v_parametros where id = r.id;
      insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
      values (
        r.id, 'parametros', r.parametros, v_parametros,
        'Valor mensual del usuario adicional de la cláusula 2.3 de los Términos de Suscripción VALIDA · Licencia CDA v1.1: $50.000. Lo usa la sección Suscripción para cotizar y cobrar una licencia adicional.',
        c_registrado_por
      );
      v_cambios := v_cambios + 1;
    end if;

    -- 2. La comisión de AFI.
    if r.comision is distinct from c_comision then
      update public.servicios_contratados set comision = c_comision where id = r.id;
      insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
      values (
        r.id, 'comision', r.comision, c_comision,
        'Comisión de AFI INTERNATIONAL GROUP S.A.S. (NIT 902003244-6), decisión de Mauricio del 2026-09-23: $50.000 fijos por cuota cobrada más el 20 % de lo adicional que compre el CDA (usuarios adicionales, Sustenta u otro servicio).',
        c_registrado_por
      );
      v_cambios := v_cambios + 1;
    end if;
  end loop;

  -- Comprobación: cada contrato encontrado quedó con los dos valores y su bitácora.
  if exists (
    select 1
      from public.servicios_contratados sc
      join public.workspaces w on w.id = sc.workspace_pagador_id
     where sc.servicio_slug = 'valida-cda-licencia'
       and w.slug = any (c_espacios)
       and ((sc.parametros->>'valor_usuario_adicional')::numeric is distinct from c_valor_adicional
            or sc.comision is distinct from c_comision)
  ) then
    raise exception 'Algún contrato quedó sin el valor del usuario adicional o sin la comisión.';
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK: % contratos de CDA encontrados, % cambios registrados. Nada quedó escrito.', v_contratos, v_cambios;
  end if;
  raise notice 'Listo: % contratos de CDA, % cambios registrados.', v_contratos, v_cambios;
end
$bloque$;
