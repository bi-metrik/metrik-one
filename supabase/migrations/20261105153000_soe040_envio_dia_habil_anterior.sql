-- ============================================================
-- 20261105153000_soe040_envio_dia_habil_anterior
-- ============================================================
-- SOE-040 (SOENA). Regla del indicador de Envío que pide SOENA: «mínimo 95% de los casos
-- enviados al cliente el día hábil anterior a la cita, antes de las 5:00 p. m.».
--
-- Hasta hoy Envío exige DOS condiciones en horas corridas: `confirmacion_envio_de_correo`
-- completado a más tardar `horas_desde_certificado` (48) después de `certificado_bancario` y
-- al menos `horas_antes_cita` (36) antes de la medianoche de la cita. Con horas no se puede
-- escribir «el día hábil anterior»: una cita en lunes, o el día después de un festivo, necesita
-- el viernes (o el día hábil que toque), y en octubre de 2026 fueron 17 de 62 citas.
--
-- Qué hace:
--   1. `dia_habil_anterior(fecha, sabado_habil)`: el último día hábil ANTES de la fecha.
--      Mismo calendario que `horas_habiles_jornada`: domingo nunca, sábado según
--      `jornada_sabado_habil`, festivos de Colombia desde `festivos_colombia` (cache de
--      `festivos_colombia_de`, sembrada 2025-2100).
--   2. `limite_envio_cita(cita, hora_corte, sabado_habil)`: ese día a la hora de corte, en hora
--      de Bogotá. Una sola expresión para el resumen y el detalle: así no pueden contar distinto.
--   3. Config nueva, en la tabla por defecto y en la del mes:
--        envio_modo        'horas_antes_cita' (default, lo de hoy) | 'dia_habil_anterior'
--        envio_hora_corte  hora de Bogotá, 1-24, default 17
--      NOT NULL con default: toda fila existente (meses congelados incluidos) queda en
--      'horas_antes_cita' y no cambia de cifra.
--   4. Modo 'dia_habil_anterior': cumple si el envío se completó a más tardar a la hora de corte
--      del día hábil anterior a la cita (17:00:00 exactas cuenta; 17:00:01 ya no).
--      ⚠️ En ese modo NO aplica la condición de las 48 h desde el certificado bancario: la regla
--      de SOENA no la menciona. `horas_desde_certificado` sigue guardada y vuelve a regir si el
--      mes vuelve al modo de horas.
--   5. El universo NO cambia: un envío cuenta como medible solo si tiene certificado bancario Y
--      fecha de cita, igual que hoy. Sin cita (o sin certificado) el caso suma a `eventos`, no a
--      `medibles` ni a `a_tiempo`, y el detalle lo muestra con `a_tiempo` null y su motivo.
--   6. `congelar_config_bono_meses_pasados` copia también las dos columnas nuevas: sin eso,
--      congelar un mes con la general en 'dia_habil_anterior' lo dejaría en el default de la
--      tabla y no en lo que regía.
--
-- ⚠️ POR QUÉ REEMPLAZOS SOBRE `pg_get_functiondef` Y NO LA COPIA DEL REPO
-- Las dos RPC del bono ya divergieron del repo (ver 20261008223000 y 20261010113000, que las
-- parchan por reemplazo de texto sobre la definición viva). Reescribirlas desde el repo podría
-- revertir en silencio lo que cambió allá. Cada parche toma la definición VIVA, cambia un
-- fragmento y ejecuta la definición completa resultante (`CREATE OR REPLACE FUNCTION` de
-- `pg_get_functiondef`, que conserva dueño, SECURITY DEFINER, search_path y grants; el guard
-- `current_user_workspace_id()` no se toca). Cada parche ABORTA si su fragmento no aparece
-- exactamente una vez o si el bloque vivo no es, sin comentarios ni espacios, el esperado.
-- Idempotente: si la función ya trae la marca `SOE-040 envio`, se salta.
--
-- Escribe datos: solo agrega dos columnas con default a dos tablas de configuración (las
-- filas existentes toman el default, que preserva el comportamiento). No cambia ningún valor.
-- ============================================================

-- ── 1. Día hábil anterior ────────────────────────────────────────────────────

create or replace function public.dia_habil_anterior(p_fecha date, p_sabado_habil boolean default false)
returns date
language sql
stable
set search_path = public
as $$
  -- El primer día hacia atrás que no es domingo, ni sábado (salvo jornada con sábado), ni
  -- festivo. 15 días alcanzan de sobra: en Colombia no hay más de 3 días seguidos no hábiles.
  select p_fecha - k
  from generate_series(1, 15) as k
  where p_fecha is not null
    and extract(isodow from p_fecha - k) <> 7
    and (extract(isodow from p_fecha - k) <> 6 or coalesce(p_sabado_habil, false))
    and (p_fecha - k) not in (select fecha from public.festivos_colombia)
  order by k
  limit 1
$$;

revoke execute on function public.dia_habil_anterior(date, boolean) from public, anon;
grant execute on function public.dia_habil_anterior(date, boolean) to authenticated, service_role;

comment on function public.dia_habil_anterior(date, boolean) is
  'Último día hábil de Colombia antes de la fecha (sin domingos, sin sábados salvo p_sabado_habil, '
  'sin festivos de festivos_colombia). Mismo calendario que horas_habiles_jornada. SOE-040.';

-- ── 2. Límite de envío frente a una cita ─────────────────────────────────────

create or replace function public.limite_envio_cita(p_cita date, p_hora_corte integer, p_sabado_habil boolean default false)
returns timestamptz
language sql
stable
set search_path = public
as $$
  -- La hora de corte es hora de Bogotá; la instancia corre en UTC, por eso el ancla explícita.
  select (public.dia_habil_anterior(p_cita, p_sabado_habil)::timestamp
          + (p_hora_corte * interval '1 hour')) at time zone 'America/Bogota'
$$;

revoke execute on function public.limite_envio_cita(date, integer, boolean) from public, anon;
grant execute on function public.limite_envio_cita(date, integer, boolean) to authenticated, service_role;

comment on function public.limite_envio_cita(date, integer, boolean) is
  'Instante límite para enviar la documentación al cliente: el día hábil anterior a la cita, a la '
  'hora de corte (hora de Bogotá). Lo usan get_operaciones_bono_resumen y _detalle. SOE-040.';

-- ── 3. Configuración ─────────────────────────────────────────────────────────

alter table public.config_bono_operaciones
  add column if not exists envio_modo text not null default 'horas_antes_cita',
  add column if not exists envio_hora_corte integer not null default 17;

alter table public.config_bono_operaciones_mes
  add column if not exists envio_modo text not null default 'horas_antes_cita',
  add column if not exists envio_hora_corte integer not null default 17;

alter table public.config_bono_operaciones
  drop constraint if exists config_bono_operaciones_envio_modo_check,
  add constraint config_bono_operaciones_envio_modo_check
    check (envio_modo in ('horas_antes_cita', 'dia_habil_anterior')),
  drop constraint if exists config_bono_operaciones_envio_hora_corte_check,
  add constraint config_bono_operaciones_envio_hora_corte_check
    check (envio_hora_corte between 1 and 24);

alter table public.config_bono_operaciones_mes
  drop constraint if exists config_bono_operaciones_mes_envio_modo_check,
  add constraint config_bono_operaciones_mes_envio_modo_check
    check (envio_modo in ('horas_antes_cita', 'dia_habil_anterior')),
  drop constraint if exists config_bono_operaciones_mes_envio_hora_corte_check,
  add constraint config_bono_operaciones_mes_envio_hora_corte_check
    check (envio_hora_corte between 1 and 24);

comment on column public.config_bono_operaciones.envio_modo is
  'Regla de Envío. horas_antes_cita: horas_desde_certificado y horas_antes_cita (corridas). '
  'dia_habil_anterior: a más tardar envio_hora_corte del día hábil anterior a la cita, sin la '
  'condición del certificado. SOE-040.';
comment on column public.config_bono_operaciones_mes.envio_modo is
  'Ver config_bono_operaciones.envio_modo. SOE-040.';

-- ── 4. Congelar meses copia las columnas nuevas ──────────────────────────────

do $$
declare
  v_firma constant text := 'public.congelar_config_bono_meses_pasados(uuid)';
  v_viejo_1 constant text := 'horas_desde_certificado, horas_antes_cita,';
  v_nuevo_1 constant text := 'horas_desde_certificado, horas_antes_cita, envio_modo, envio_hora_corte,';
  v_viejo_2 constant text := 'c.horas_desde_certificado, c.horas_antes_cita,';
  v_nuevo_2 constant text := 'c.horas_desde_certificado, c.horas_antes_cita, c.envio_modo, c.envio_hora_corte,';
  v_def text;
  v_n   int;
begin
  v_def := pg_get_functiondef(v_firma::regprocedure);
  if position('envio_hora_corte' in v_def) > 0 then
    raise notice '% ya copia envio_hora_corte: se salta', v_firma;
    return;
  end if;
  -- El 2 se reemplaza primero con un marcador: el 1 no lo contiene, pero así el conteo del 1
  -- no depende de eso.
  v_n := (length(v_def) - length(replace(v_def, v_viejo_2, ''))) / length(v_viejo_2);
  if v_n <> 1 then
    raise exception '% cambió en producción: "%" aparece % veces (se esperaba 1). Revisar a mano.', v_firma, v_viejo_2, v_n;
  end if;
  v_def := replace(v_def, v_viejo_2, '@@SOE040@@');
  v_n := (length(v_def) - length(replace(v_def, v_viejo_1, ''))) / length(v_viejo_1);
  if v_n <> 1 then
    raise exception '% cambió en producción: "%" aparece % veces (se esperaba 1). Revisar a mano.', v_firma, v_viejo_1, v_n;
  end if;
  v_def := replace(v_def, v_viejo_1, v_nuevo_1);
  v_def := replace(v_def, '@@SOE040@@', v_nuevo_2);
  execute v_def;
end;
$$;

-- ── 5. Las RPC del bono: resumen y detalle ───────────────────────────────────
-- Por función:
--   a. `cfg` expone `envio_modo` y `envio_hora_corte` (y con eso `parametros` del resumen);
--   b. el bloque que juzga Envío se reemplaza entero, después de comprobar que el bloque vivo
--      es, sin comentarios ni espacios, el que se espera. La rama del modo de horas es la
--      expresión de hoy copiada tal cual: con el default, las cifras no se mueven.
--   c. (solo detalle) cada caso trae su límite y, si llegó tarde en el modo nuevo, el motivo.

do $$
declare
  -- a. cfg: el ancla se busca SIN depender de los espacios antes de AS. En producción el resumen
  --    trae un solo espacio y el detalle varios (medido en el ensayo de SOE-040); un ancla literal
  --    fallaba en el resumen. Se cuenta con regexp y tiene que aparecer exactamente una vez.
  v_patron_cfg constant text := 'd\.horas_antes_cita\)\s+AS horas_antes_cita,';
  v_nuevo_cfg constant text := $frag$d.horas_antes_cita) AS horas_antes_cita,
      -- SOE-040 envio: regla de Envio y hora de corte del modo «dia habil anterior».
      COALESCE(m.envio_modo, d.envio_modo)                    AS envio_modo,
      COALESCE(m.envio_hora_corte, d.envio_hora_corte)        AS envio_hora_corte,$frag$;

  -- b. Resumen: `envio_agg` completo.
  v_ini_r constant text := '  envio_agg AS (';
  v_fin_r constant text := E'    FROM envios\n    GROUP BY staff_id\n  ),';
  v_esperado_r constant text := $frag$  envio_agg AS (
    SELECT
      staff_id,
      COUNT(*) AS eventos,
      COUNT(*) FILTER (WHERE cert_bancario IS NOT NULL AND cita_texto IS NOT NULL) AS medibles,
      COUNT(*) FILTER (
        WHERE cert_bancario IS NOT NULL
          AND cita_texto IS NOT NULL
          AND envio <= cert_bancario + ((SELECT horas_desde_certificado FROM cfg) * interval '1 hour')
          AND envio <= ((substring(cita_texto from 1 for 10))::timestamp AT TIME ZONE 'America/Bogota')
                       - ((SELECT horas_antes_cita FROM cfg) * interval '1 hour')
      ) AS a_tiempo
    FROM envios
    GROUP BY staff_id
  ),$frag$;
  v_nuevo_r constant text := $frag$  envio_agg AS (
    -- SOE-040 envio: dos reglas, segun `envio_modo` del mes.
    --   horas_antes_cita (default): dentro de N horas del certificado bancario Y con N horas de
    --     anticipacion a la medianoche (Bogota) de la cita. Es la expresion de antes, tal cual.
    --   dia_habil_anterior: a mas tardar a la hora de corte del dia habil anterior a la cita
    --     (regla de SOENA, SOE-040). Sin la condicion del certificado: la regla no la menciona.
    -- El universo es el mismo en los dos modos: medible = con certificado Y con cita.
    SELECT
      staff_id,
      COUNT(*)                                                          AS eventos,
      COUNT(*) FILTER (WHERE cert_bancario IS NOT NULL AND cita_texto IS NOT NULL) AS medibles,
      COUNT(*) FILTER (
        WHERE cert_bancario IS NOT NULL
          AND cita_texto IS NOT NULL
          AND CASE
            WHEN (SELECT envio_modo FROM cfg) = 'dia_habil_anterior'
              THEN envio <= public.limite_envio_cita(
                              (substring(cita_texto from 1 for 10))::date,
                              (SELECT envio_hora_corte FROM cfg),
                              (SELECT jornada_sabado_habil FROM cfg))
            ELSE envio <= cert_bancario + ((SELECT horas_desde_certificado FROM cfg) * interval '1 hour')
             -- La cita se guarda como fecha sin hora: se ancla a Bogota, no a la zona de la sesion.
             AND envio <= ((substring(cita_texto from 1 for 10))::timestamp AT TIME ZONE 'America/Bogota')
                          - ((SELECT horas_antes_cita FROM cfg) * interval '1 hour')
          END
      )                                                                 AS a_tiempo
    FROM envios
    GROUP BY staff_id
  ),$frag$;

  -- b. Detalle: `envios_medidos` + `envios_juzgados` completos.
  v_ini_d constant text := '  envios_medidos AS (';
  v_fin_d constant text := E'    FROM envios_medidos em\n  ),';
  v_esperado_d constant text := $frag$  envios_medidos AS (
    SELECT e.*,
      CASE WHEN e.cita_texto IS NOT NULL
           THEN (substring(e.cita_texto from 1 for 10))::timestamp AT TIME ZONE 'America/Bogota'
      END AS cita
    FROM envios e
  ),
  envios_juzgados AS (
    SELECT em.*,
      CASE WHEN em.cert_bancario IS NOT NULL
           THEN EXTRACT(EPOCH FROM (em.envio - em.cert_bancario)) / 3600.0 END AS horas_desde_cert,
      CASE WHEN em.cita IS NOT NULL
           THEN EXTRACT(EPOCH FROM (em.cita - em.envio)) / 3600.0 END AS horas_antes_cita,
      CASE
        WHEN em.cert_bancario IS NULL OR em.cita IS NULL THEN NULL
        ELSE em.envio <= em.cert_bancario + ((SELECT horas_desde_certificado FROM cfg) * interval '1 hour')
             AND em.envio <= em.cita - ((SELECT horas_antes_cita FROM cfg) * interval '1 hour')
      END AS a_tiempo
    FROM envios_medidos em
  ),$frag$;
  v_nuevo_d constant text := $frag$  envios_medidos AS (
    SELECT e.*,
      -- Anclada a Bogota, igual que el resumen: la cita se guarda como fecha sin
      -- hora y `::timestamptz` la leeria en UTC, cinco horas mas estricto.
      CASE WHEN e.cita_texto IS NOT NULL
           THEN (substring(e.cita_texto from 1 for 10))::timestamp AT TIME ZONE 'America/Bogota'
      END AS cita,
      -- SOE-040 envio: el limite del modo «dia habil anterior», con la MISMA funcion que el
      -- resumen. Se calcula siempre para poder mostrarlo; solo decide en ese modo.
      CASE WHEN e.cita_texto IS NOT NULL
           THEN public.limite_envio_cita(
                  (substring(e.cita_texto from 1 for 10))::date,
                  (SELECT envio_hora_corte FROM cfg),
                  (SELECT jornada_sabado_habil FROM cfg))
      END AS limite_envio
    FROM envios e
  ),
  envios_juzgados AS (
    SELECT em.*,
      CASE WHEN em.cert_bancario IS NOT NULL
           THEN EXTRACT(EPOCH FROM (em.envio - em.cert_bancario)) / 3600.0 END AS horas_desde_cert,
      CASE WHEN em.cita IS NOT NULL
           THEN EXTRACT(EPOCH FROM (em.cita - em.envio)) / 3600.0 END        AS horas_antes_cita,
      CASE
        -- Mismo universo en los dos modos (ver el resumen): sin certificado o sin cita, no se juzga.
        WHEN em.cert_bancario IS NULL OR em.cita IS NULL THEN NULL
        WHEN (SELECT envio_modo FROM cfg) = 'dia_habil_anterior'
          THEN em.envio <= em.limite_envio
        ELSE em.envio <= em.cert_bancario + ((SELECT horas_desde_certificado FROM cfg) * interval '1 hour')
             AND em.envio <= em.cita - ((SELECT horas_antes_cita FROM cfg) * interval '1 hour')
      END AS a_tiempo
    FROM envios_medidos em
  ),$frag$;

  -- c. Detalle: el limite viaja en el JSON y el motivo del modo nuevo.
  v_viejo_json constant text := $frag$'a_tiempo', e.a_tiempo,$frag$;
  v_nuevo_json constant text := $frag$'a_tiempo', e.a_tiempo,
        -- SOE-040 envio: la regla que juzgo el caso y su limite en el modo «dia habil anterior».
        'envio_modo', (SELECT envio_modo FROM cfg),
        'limite_envio', e.limite_envio,$frag$;
  v_viejo_motivo constant text := $frag$THEN 'sin fecha de cita'$frag$;
  v_nuevo_motivo constant text := $frag$THEN 'sin fecha de cita'
          WHEN (SELECT envio_modo FROM cfg) = 'dia_habil_anterior'
            THEN CASE WHEN NOT e.a_tiempo
                      THEN 'enviado después de las ' || lpad((SELECT envio_hora_corte FROM cfg)::text, 2, '0')
                           || ':00 del día hábil anterior a la cita'
                 END$frag$;

  v_firmas text[] := array[
    'public.get_operaciones_bono_resumen(uuid,integer,integer)',
    'public.get_operaciones_bono_detalle(uuid,integer,integer)'
  ];
  v_def   text;
  v_bloque text;
  v_ini   int;
  v_fin   int;
  v_n     int;
  i       int;
begin
  for i in 1 .. 2 loop
    v_def := pg_get_functiondef(v_firmas[i]::regprocedure);

    if position('SOE-040 envio' in v_def) > 0 then
      raise notice '% ya trae SOE-040 envio: se salta', v_firmas[i];
      continue;
    end if;

    -- a. cfg
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_patron_cfg, 'g');
    if v_n <> 1 then
      raise exception '% cambió en producción: el ancla de cfg aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_n;
    end if;
    v_def := regexp_replace(v_def, v_patron_cfg, replace(v_nuevo_cfg, E'\\', E'\\\\'));

    -- b. el bloque que juzga Envío
    v_ini := position((case i when 1 then v_ini_r else v_ini_d end) in v_def);
    v_n := (length(v_def) - length(replace(v_def, case i when 1 then v_ini_r else v_ini_d end, '')))
           / length(case i when 1 then v_ini_r else v_ini_d end);
    if v_n <> 1 then
      raise exception '% cambió en producción: el inicio del bloque de Envío aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_n;
    end if;
    v_fin := position((case i when 1 then v_fin_r else v_fin_d end) in substr(v_def, v_ini));
    if v_fin = 0 then
      raise exception '% cambió en producción: no se encontró el cierre del bloque de Envío. Revisar a mano.', v_firmas[i];
    end if;
    v_bloque := substr(v_def, v_ini, v_fin - 1 + length(case i when 1 then v_fin_r else v_fin_d end));
    -- Sin comentarios y con los espacios colapsados, el bloque vivo tiene que ser el esperado.
    if btrim(regexp_replace(regexp_replace(v_bloque, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       <> btrim(regexp_replace(regexp_replace(case i when 1 then v_esperado_r else v_esperado_d end,
                                              '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) then
      raise exception '% cambió en producción: el bloque de Envío no es el esperado. Revisar a mano. Vivo: %', v_firmas[i], v_bloque;
    end if;
    v_def := overlay(v_def placing (case i when 1 then v_nuevo_r else v_nuevo_d end)
                     from v_ini for length(v_bloque));

    -- c. detalle: JSON y motivo
    if i = 2 then
      v_n := (length(v_def) - length(replace(v_def, v_viejo_json, ''))) / length(v_viejo_json);
      if v_n <> 1 then
        raise exception '% cambió en producción: "%" aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_viejo_json, v_n;
      end if;
      v_def := replace(v_def, v_viejo_json, v_nuevo_json);

      v_n := (length(v_def) - length(replace(v_def, v_viejo_motivo, ''))) / length(v_viejo_motivo);
      if v_n <> 1 then
        raise exception '% cambió en producción: "%" aparece % veces (se esperaba 1). Revisar a mano.', v_firmas[i], v_viejo_motivo, v_n;
      end if;
      v_def := replace(v_def, v_viejo_motivo, v_nuevo_motivo);
    end if;

    execute v_def;
  end loop;
end;
$$;
