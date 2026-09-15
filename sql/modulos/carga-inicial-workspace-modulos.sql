-- ============================================================
-- Carga inicial de `workspace_modulos` desde los flags de hoy (entrega A1)
-- Spec: proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md, §2.2
--
-- ⚠️ NO SE HA CORRIDO CONTRA PRODUCCIÓN. Escribe datos: necesita autorización de Mauricio.
-- ⚠️ ORDEN: requiere la migración `20260915210000_workspace_modulos.sql` aplicada.
--
-- Qué hace: una fila por cada llave de MÓDULO encendida hoy en `workspaces.modules` (20 filas
-- en 17 workspaces, medido el 2026-09-15), con el origen que la cubre:
--   · servicio              — el contrato vigente que cobra ese módulo;
--   · incluido_en_proyecto  — Clarity que llegó con un proyecto financiado. SIN fecha de fin, a
--                             propósito: que termine la financiación (la de SOENA vence hoy) no
--                             puede apagar el módulo antes de que exista su contrato con tarjeta;
--   · interno               — el workspace de MeTRIK;
--   · cortesia / demo       — los 7 sin contrato (hallazgo 9 de la spec). QUÉ ES CORTESÍA Y QUÉ ES
--                             DEMO LO CONFIRMA MAURICIO antes de correr esto: aquí solo ana-demo
--                             y reposteria-dulce-hogar van como demo (las dos son de demostración
--                             según el cerebro); el resto va como cortesía.
--
-- Con esta carga, `proyectar_modulos` no cambia ningún workspace. El bloque lo COMPRUEBA dentro de
-- la misma transacción y aborta si algún workspace cambiaría: nunca queda una carga a medias.
--
-- ── Cómo se corre ──────────────────────────────────────────────────────────────
-- Es UN solo statement (un bloque DO), para que el ensayo sea atómico por el pooler.
--   Paso 0, ENSAYO: correrlo tal cual, con `v_ensayo := true`. Inserta, proyecta los 17
--     workspaces y termina con RAISE EXCEPTION 'ENSAYO OK …': la excepción deshace todo.
--     Lo esperado: "ENSAYO OK: 20 filas nuevas, 0 workspaces cambiarían".
--   Paso 1, CARGA: cambiar a `v_ensayo := false` y volver a correrlo.
--   Paso 2, VERIFICACIÓN (solo lectura):
--     select count(*) from public.workspace_modulos;                            -- 20
--     select w.slug, p.r->'cambios'
--       from public.workspaces w
--       cross join lateral (select public.proyectar_modulos(w.id) as r) p
--      where jsonb_array_length(p.r->'cambios') > 0;                             -- 0 filas
--
-- Idempotente: una segunda corrida no inserta nada (no repite una activación vigente con el mismo
-- workspace, módulo y origen) y vuelve a dar 0 cambios.
--
-- Guardas que abortan antes de escribir, con el motivo en el mensaje:
--   · quien registra no es el platform admin;
--   · un slug de la lista no existe;
--   · una fila de la lista es de un módulo que HOY está apagado en ese workspace (la lista quedó
--     vieja: se remide, no se fuerza);
--   · después de insertar, algún workspace cambiaría con la proyección (la lista no cubre algo
--     encendido: se agrega la fila que falta, no se apaga el módulo).
-- ============================================================

do $carga$
declare
  -- ⚠️ true = ensayo (no escribe). Solo con autorización se cambia a false.
  v_ensayo constant boolean := true;
  -- Perfil de Mauricio (platform admin), leído de producción el 2026-09-15.
  v_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';

  v_faltantes text;
  v_apagados text;
  v_insertadas int;
  v_cambios text;
begin
  create temp table _carga_modulos (slug text, modulo text, origen text, motivo text) on commit drop;

  insert into _carga_modulos (slug, modulo, origen, motivo) values
    -- servicio
    ('afi',            'valida_consulta', 'servicio', 'Contrato A1 26 3, Valida AFI.'),
    ('alma-afi',       'compliance',      'servicio', 'Contrato A1 26 1, One Compliance Concesión ALMA (Sustenta).'),
    ('cda-caqueta',    'valida_consulta', 'servicio', 'Contrato A1 26 4, Licencias Valida CDA (vía AFI).'),
    ('cda-elcarmen',   'valida_consulta', 'servicio', 'Contrato A1 26 4, Licencias Valida CDA (vía AFI).'),
    ('cda-puertotest', 'valida_consulta', 'servicio', 'Contrato A1 26 4, Licencias Valida CDA (vía AFI).'),
    ('maxitec',        'valida_consulta', 'servicio', 'Contrato A1 26 4, Licencias Valida CDA (vía AFI).'),
    ('termotech',      'business',        'servicio', 'Contrato A3 26 2, Suscripción ONE Termotech (licencia Clarity).'),
    -- incluido_en_proyecto (sin fecha de fin a propósito)
    ('soena',    'business', 'incluido_en_proyecto', 'Proyecto S1 26 2, Clarity Full Parte 1 Soena. Sin fin: no se apaga al terminar la financiación, sino cuando exista su contrato de licencia.'),
    ('trappvel', 'business', 'incluido_en_proyecto', 'Proyecto T1 26 1, Clarity Trappvel. Sin fin: no se apaga al terminar la financiación, sino cuando exista su contrato de licencia.'),
    ('afi',      'business', 'incluido_en_proyecto', 'Proyecto A1 26 2, Clarity Express AFI. Sin fin: no se apaga al terminar la financiación, sino cuando exista su contrato de licencia.'),
    -- interno
    ('metrik', 'business',        'interno', 'Workspace propio de MeTRIK.'),
    ('metrik', 'valida_consulta', 'interno', 'Workspace propio de MeTRIK.'),
    -- cortesía y demo: sin contrato que los cubra (hallazgo 9). Confirmar con Mauricio.
    ('advise',                 'calidad_llamadas', 'cortesia', 'Encendido antes de este registro, sin contrato que lo cubra.'),
    ('dimpro',                 'business',         'cortesia', 'Encendido antes de este registro, sin contrato que lo cubra.'),
    ('hjbc',                   'business',         'cortesia', 'Encendido antes de este registro, sin contrato que lo cubra.'),
    ('regat',                  'calidad_llamadas', 'cortesia', 'Encendido antes de este registro, sin contrato que lo cubra.'),
    ('wmc-sm',                 'business',         'cortesia', 'Encendido antes de este registro, sin contrato que lo cubra.'),
    ('wmc-sm',                 'cert_qr',          'cortesia', 'Encendido antes de este registro, sin contrato que lo cubra.'),
    ('ana-demo',               'business',         'demo',     'Workspace de demostración.'),
    ('reposteria-dulce-hogar', 'business',         'demo',     'Demo del agente de ventas para microempresa (reunión propymes).');

  if not exists (select 1 from public.profiles p where p.id = v_registrado_por and p.platform_admin) then
    raise exception 'CARGA ABORTADA: el perfil % no existe o no es platform admin', v_registrado_por;
  end if;

  select string_agg(distinct c.slug, ', ')
    into v_faltantes
    from _carga_modulos c
    left join public.workspaces w on w.slug = c.slug
   where w.id is null;
  if v_faltantes is not null then
    raise exception 'CARGA ABORTADA: estos slugs no existen: %', v_faltantes;
  end if;

  select string_agg(c.slug || '.' || c.modulo, ', ')
    into v_apagados
    from _carga_modulos c
    join public.workspaces w on w.slug = c.slug
   where coalesce(w.modules -> c.modulo = 'true'::jsonb, false) = false;
  if v_apagados is not null then
    raise exception 'CARGA ABORTADA: la lista trae módulos que hoy están apagados (remedir): %', v_apagados;
  end if;

  insert into public.workspace_modulos (workspace_id, modulo, origen, activo_desde, motivo, registrado_por)
  select w.id, c.modulo, c.origen, now(),
         c.motivo || ' Carga inicial desde workspaces.modules (A1).',
         v_registrado_por
    from _carga_modulos c
    join public.workspaces w on w.slug = c.slug
   where not exists (
     select 1 from public.workspace_modulos wm
      where wm.workspace_id = w.id
        and wm.modulo = c.modulo
        and wm.origen = c.origen
        and wm.activo_hasta is null
   );
  get diagnostics v_insertadas = row_count;

  select string_agg(w.slug || ' ' || (p.r -> 'cambios')::text, '; ' order by w.slug)
    into v_cambios
    from public.workspaces w
    cross join lateral (select public.proyectar_modulos(w.id) as r) p
   where jsonb_array_length(p.r -> 'cambios') > 0;
  if v_cambios is not null then
    raise exception 'CARGA ABORTADA: con esta carga la proyección cambiaría estos workspaces: %', v_cambios;
  end if;

  if v_ensayo then
    raise exception 'ENSAYO OK: % filas nuevas, 0 workspaces cambiarían (nada quedó escrito)', v_insertadas;
  end if;

  raise notice 'CARGA OK: % filas nuevas, 0 workspaces cambiarían', v_insertadas;
end
$carga$;
