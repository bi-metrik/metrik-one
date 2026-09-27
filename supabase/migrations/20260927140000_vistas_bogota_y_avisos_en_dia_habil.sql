-- ============================================================
-- 20260927140000_vistas_bogota_y_avisos_en_dia_habil
-- ============================================================
-- Remate de #929 (hora de Bogota) y la decision de Mauricio del 2026-09-27:
-- todo aviso automatico al cliente sale solo en dia habil del pais del cliente.
--
-- NO reescribe filas de ninguna tabla de negocio. Hace:
--
--   1. Las dos vistas que seguian contando con el reloj de UTC pasan a Bogota. La
--      instancia corre en UTC: entre las 19:00 y la medianoche de Bogota
--      `CURRENT_DATE` ya es mañana, y el ultimo dia del mes `to_char(now(), 'YYYY-MM')`
--      ya es el mes siguiente.
--        v_facturas_estado          dias_antiguedad = hoy_bogota() - fecha_emision
--        v_gastos_fijos_mes_actual  periodo del mes de Bogota
--      Mismas columnas, mismos tipos y mismo orden: `create or replace` no puede
--      renombrar ni reordenar (gotcha 42P16), y ningun consumidor cambia.
--      Cada una DECLARA `security_invoker = on` en la propia sentencia: `create or
--      replace view` sin `with` lo borra (paso con v_cobro_valor el 2026-09-02).
--      Definiciones de partida leidas de produccion el 2026-09-27 (`pg_get_viewdef`),
--      no del repo: el ledger esta derivado.
--
--      ⚠️ `v_cartera_negocio` (la tercera del encargo) NO va aqui: la reescribio
--      `20260927120000_cartera_vencido_por_cuota` (#934) el mismo dia, ya con los dias
--      en hora de Bogota y columnas nuevas. Reescribirla aqui borraria esas columnas.
--      La guarda de abajo comprueba que siga sin CURRENT_DATE.
--
--   2. Grants de esas dos vistas, escritos (gana el ultimo del ledger). Estado leido
--      de produccion el 2026-09-27:
--        v_facturas_estado          anon=m, authenticated=arwdm    (sobra todo lo que no es r)
--        v_gastos_fijos_mes_actual  anon=m, authenticated=arwdm    (idem)
--      Quedan en: SELECT para authenticated, nada para anon ni PUBLIC. `revoke ...
--      from public` no le quita nada a authenticated, por eso se nombran los tres
--      roles. service_role no se toca. Ninguna de las dos tiene consumidor en el codigo
--      (medido con grep el 2026-09-27): no se les quita un privilegio que alguien use.
--
--   3. `workspaces.pais` (ISO-3166 alfa-2, default 'CO'). Es el pais del cliente para
--      la regla de dia habil. No existia ningun campo de pais en workspaces, contactos
--      ni empresas (medido el 2026-09-27). DEFAULT constante: en PG17 es solo catalogo,
--      no reescribe la tabla (18 filas).
--
--   4. `avisos_cliente` aprende a DIFERIR: estado `diferido`, `programado_para` (el
--      dia habil en que sale) y `liberado_at` (cuando el cron lo tomo). Un aviso de
--      `notificar-etapa` cuyo evento cae en dia no habil queda asi, y el cron nuevo
--      `avisos-cliente-diferidos` lo manda ese dia. No se pierde.
--
--   5. Crons nuevos, los dos seguros ANTES de desplegar las funciones (el codigo viejo
--      les contesta 400 y no manda nada):
--        avisos-cliente-diferidos  13:00 UTC diario -> notificar-etapa {liberar_diferidos}
--        wa-alertas-corridas       12:00 UTC diario -> wa-alerts {action: corridas}
--      El segundo saca el resumen de los lunes (W29) o el aviso de saldo de martes y
--      viernes (W33) que cayo en festivo, el primer dia habil despues. Los crons
--      existentes de W29 y W33 NO se tocan: volverlos diarios antes de desplegar
--      `wa-alerts` mandaria el resumen todos los dias con el codigo viejo.
-- ============================================================


-- ------------------------------------------------------------
-- 1 y 2. Vistas en el dia de Bogota, invoker y con sus grants
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_facturas_estado WITH (security_invoker = on) AS
 SELECT f.id AS factura_id,
    f.workspace_id,
    f.proyecto_id,
    f.numero_factura,
    f.monto,
    f.fecha_emision,
    f.notas,
    COALESCE(sum(c.monto), 0::numeric) AS cobrado,
    f.monto - COALESCE(sum(c.monto), 0::numeric) AS saldo_pendiente,
        CASE
            WHEN (f.monto - COALESCE(sum(c.monto), 0::numeric)) <= 0::numeric THEN 'pagada'::text
            WHEN COALESCE(sum(c.monto), 0::numeric) > 0::numeric THEN 'parcial'::text
            ELSE 'pendiente'::text
        END AS estado_pago,
    public.hoy_bogota() - f.fecha_emision AS dias_antiguedad,
    f.created_at
   FROM facturas f
     LEFT JOIN cobros c ON c.factura_id = f.id
  GROUP BY f.id, f.workspace_id, f.proyecto_id, f.numero_factura, f.monto, f.fecha_emision, f.notas, f.created_at;

CREATE OR REPLACE VIEW public.v_gastos_fijos_mes_actual WITH (security_invoker = on) AS
 SELECT b.id AS borrador_id,
    b.workspace_id,
    b.nombre,
    b.categoria,
    b.monto_esperado,
    b.confirmado,
    b.fecha_confirmacion,
    g.monto AS monto_real,
    g.fecha AS fecha_pago_real
   FROM gastos_fijos_borradores b
     LEFT JOIN gastos g ON g.id = b.gasto_id
  WHERE b.periodo = to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM'::text);

REVOKE ALL ON public.v_facturas_estado FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_gastos_fijos_mes_actual FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_facturas_estado TO authenticated;
GRANT SELECT ON public.v_gastos_fijos_mes_actual TO authenticated;


-- ------------------------------------------------------------
-- 3. Pais del workspace
-- ------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS pais text NOT NULL DEFAULT 'CO';

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_pais_iso2_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_pais_iso2_check CHECK (pais ~ '^[A-Z]{2}$');

COMMENT ON COLUMN public.workspaces.pais IS
  'Pais del cliente (ISO-3166 alfa-2). Decide los dias habiles en que salen los avisos automaticos al cliente (decision 2026-09-27): CO usa sus festivos calculados; un pais sin calendario cargado solo salta sabado y domingo. Ver src/lib/dates/dias-habiles.ts.';


-- ------------------------------------------------------------
-- 4. avisos_cliente puede diferir
-- ------------------------------------------------------------
ALTER TABLE public.avisos_cliente DROP CONSTRAINT IF EXISTS avisos_cliente_estado_check;
ALTER TABLE public.avisos_cliente
  ADD CONSTRAINT avisos_cliente_estado_check
  CHECK (estado IN ('enviado', 'disparado', 'omitido', 'fallido', 'rebotado', 'diferido'));

ALTER TABLE public.avisos_cliente ADD COLUMN IF NOT EXISTS programado_para date;
ALTER TABLE public.avisos_cliente ADD COLUMN IF NOT EXISTS liberado_at timestamptz;

COMMENT ON COLUMN public.avisos_cliente.programado_para IS
  'Solo en estado diferido: el dia habil (del pais del cliente) en que el cron avisos-cliente-diferidos lo manda.';
COMMENT ON COLUMN public.avisos_cliente.liberado_at IS
  'Cuando el cron tomo el aviso diferido. El envio real deja su propia fila (enviado, disparado, omitido o fallido).';

CREATE INDEX IF NOT EXISTS avisos_cliente_diferidos_idx
  ON public.avisos_cliente (programado_para)
  WHERE estado = 'diferido' AND liberado_at IS NULL;


-- ------------------------------------------------------------
-- 5. Crons
-- ------------------------------------------------------------
-- El secreto viaja desde el vault, no escrito en el comando: `cron.job` es legible.
SELECT cron.unschedule('avisos-cliente-diferidos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-cliente-diferidos');

SELECT cron.schedule(
  'avisos-cliente-diferidos',
  '0 13 * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/notificar-etapa',
  body := '{"liberar_diferidos": true}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET')
  )
);
  $cron$
);

-- Mismo patron de autenticacion que los crons de wa-alerts vivos (secreto del vault).
SELECT cron.unschedule('wa-alertas-corridas')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-alertas-corridas');

SELECT cron.schedule(
  'wa-alertas-corridas',
  '0 12 * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/wa-alerts',
  body := '{"action":"corridas"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'WA_ALERTS_SECRET')
  )
);
  $cron$
);


-- ------------------------------------------------------------
-- Guardas: la migracion aborta si no quedo lo que dice
-- ------------------------------------------------------------
DO $$
DECLARE
  v_malas text;
BEGIN
  -- Ninguna puede seguir contando con el reloj de UTC (v_cartera_negocio incluida:
  -- la dejo en Bogota #934 y esta guarda cuida que siga asi).
  SELECT string_agg(c.relname, ', ') INTO v_malas
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('v_cartera_negocio', 'v_facturas_estado', 'v_gastos_fijos_mes_actual')
    AND (pg_get_viewdef(c.oid) ~* '\mcurrent_date\M'
         OR pg_get_viewdef(c.oid) ~* 'to_char\(now\(\),');
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'vistas que siguen en UTC: %', v_malas;
  END IF;

  -- Y tienen que quedar en invoker (se guarda como =on o =true).
  SELECT string_agg(c.relname, ', ') INTO v_malas
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('v_cartera_negocio', 'v_facturas_estado', 'v_gastos_fijos_mes_actual')
    AND NOT coalesce(c.reloptions && ARRAY['security_invoker=on', 'security_invoker=true'], false);
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'vistas sin security_invoker: %', v_malas;
  END IF;

  -- anon no lee ninguna, authenticated solo lee.
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['v_cartera_negocio', 'v_facturas_estado', 'v_gastos_fijos_mes_actual']) v
    WHERE has_table_privilege('anon', 'public.' || v, 'select')
       OR has_table_privilege('authenticated', 'public.' || v, 'insert')
       OR has_table_privilege('authenticated', 'public.' || v, 'update')
       OR has_table_privilege('authenticated', 'public.' || v, 'delete')
       OR NOT has_table_privilege('authenticated', 'public.' || v, 'select')
  ) THEN
    RAISE EXCEPTION 'grants de las vistas fuera de lo declarado';
  END IF;

  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('avisos-cliente-diferidos', 'wa-alertas-corridas')) <> 2 THEN
    RAISE EXCEPTION 'faltan los crons nuevos';
  END IF;
END;
$$;
