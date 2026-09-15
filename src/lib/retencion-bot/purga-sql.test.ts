import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { BUCKET_ACEPTACIONES, PLAZOS_BOT, ZONA_PLAZOS } from './plazos'

/**
 * La purga de los registros del bot, ejecutada de verdad.
 *
 * Los plazos son una promesa publicada (Política de Datos de Valida v1.4) y la
 * regla vive en SQL: triggers, una función SECURITY DEFINER y un cron. Probar
 * una copia del SQL o un doble no probaría lo que se aplica, así que aquí se
 * levanta Postgres en memoria (PGlite), se aplican LOS ARCHIVOS de migración
 * tal cual están en el repo y se corre la purga.
 *
 * Qué se replica de producción, y por qué:
 * - los privilegios por defecto (toda función nace ejecutable por anon y
 *   authenticated): sin eso, la prueba de permisos pasaría aunque faltara el
 *   revoke;
 * - `vault` y `cron` como esquemas mínimos (PGlite no trae esas extensiones);
 * - las dos aceptaciones, sus dos acciones y sus dos wa_envios con sus IDS y
 *   FECHAS reales, sembrados ANTES de aplicar la migración: así se prueba que
 *   el relleno pasa por las guardas nuevas sin abortar sobre esos datos.
 *   Teléfonos, wamids y URLs son ficticios.
 *
 * Límites: una sola conexión (el `for update` de la purga no se ejerce en
 * concurrencia) y los bordes se miden en días, no en el instante exacto.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (archivo: string) => readFileSync(join(MIGRACIONES, archivo), 'utf8')
const MIGRACION_PURGA = '20260915060000_purga_registros_bot.sql'

const WS = '00000000-0000-4000-8000-0000000000a1'
const NEG = '00000000-0000-4000-8000-0000000000b1'

// Produccion (ids reales; ver la cabecera de la migracion).
const ACE_4DSOFT = 'def579c7-2eed-4fd9-bbee-2803d1f6293f'
const ACE_PRUEBA = '41233b25-ec19-4922-9547-59bc4a9a2c92'
const ACC_4DSOFT = '530b764f-38fa-400e-baa5-64a2f31e1a05'
const ACC_PRUEBA = 'fe749f28-f445-46df-b11c-fdd8cf09a785'
const ENV_4DSOFT = 'b896558a-a4b9-4546-abc0-fc35ee121dd3'
const ENV_PRUEBA = '59e958be-ecfa-4cfb-b12b-c187355ec081'

const HOY = `(now() at time zone '${ZONA_PLAZOS}')::date`
const P = PLAZOS_BOT

const url = (ruta: string) =>
  `https://proyecto.supabase.co/storage/v1/object/sign/${BUCKET_ACEPTACIONES}/${ruta}?token=ficticio`

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como en produccion: el EXECUTE de authenticated llega por el default del esquema.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null);
  create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;

  create table public.workspaces (id uuid primary key default gen_random_uuid());
  create table public.negocios (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id)
  );

  -- wa_message_log y bot_sessions como estan en produccion (initial_schema + wa_infrastructure
  -- + las columnas de telemetria que src/types/database.ts ya conoce).
  create table public.wa_message_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id),
    phone text not null,
    direction text not null check (direction in ('inbound', 'outbound')),
    intent text,
    message_preview text,
    created_at timestamptz default now(),
    parser_source text,
    gemini_model text,
    gemini_input_tokens int,
    gemini_output_tokens int,
    gemini_latency_ms int,
    confidence numeric
  );
  create table public.bot_sessions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    user_phone text not null,
    intent text,
    state text default 'started',
    context jsonb default '{}',
    started_at timestamptz default now(),
    expires_at timestamptz default (now() + interval '5 minutes')
  );

  insert into public.workspaces (id) values ('${WS}');
  insert into public.negocios (id, workspace_id) values ('${NEG}', '${WS}');
`

/** Fila de aceptacion con todo lo obligatorio; `extra` son columnas => expresiones SQL. */
function insertAceptacion(id: string, estado: string, ruta: string, extra: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    id: `'${id}'`,
    workspace_id: `'${WS}'`,
    telefono: `'+573000000000'`,
    nombre_aceptante: `'Persona de prueba'`,
    calidad: `'apoderado'`,
    empresa_nombre: `'Empresa de prueba'`,
    documento_titulo: `'Terminos'`,
    documento_version: `'v1'`,
    documento_url: `'${url(ruta)}'`,
    documento_sha256: `'${'a'.repeat(64)}'`,
    texto_aceptacion: `'Acepto'`,
    estado: `'${estado}'`,
    ...extra,
  }
  if (estado === 'aceptado' || estado === 'rechazado') {
    cols.respondido_at ??= `now() - interval '1 day'`
    cols.reply_wamid ??= `'wamid.reply.${id}'`
    cols.button_id ??= `'${estado === 'aceptado' ? 'acepto' : 'no_acepto'}'`
    cols.payload_respuesta ??= `'{}'::jsonb`
  }
  return `insert into public.aceptaciones_terminos (${Object.keys(cols).join(', ')})
          values (${Object.values(cols).join(', ')});`
}

/**
 * Aceptacion respondida CON su accion enviada. Las acciones solo se cargan sobre una aceptacion
 * pendiente, asi que se replica el orden real: pendiente -> accion -> respuesta.
 */
function aceptacionConLlave(o: {
  id: string
  accion: string
  wamid: string
  ruta: string
  respondidoAt: string
  contratoFin?: string
  extra?: Record<string, string>
}) {
  return `
    ${insertAceptacion(o.id, 'pendiente', o.ruta, o.extra)}
    insert into public.aceptaciones_terminos_acciones
      (id, aceptacion_id, tipo, estado, intentado_at, enviada_at, wamid, secreto_borrado_at, created_at)
      values ('${o.accion}', '${o.id}', 'enviar_credencial_valida', 'enviada',
              ${o.respondidoAt}, ${o.respondidoAt}, '${o.wamid}', ${o.respondidoAt}, ${o.respondidoAt});
    update public.aceptaciones_terminos
       set estado = 'aceptado', respondido_at = ${o.respondidoAt}, reply_wamid = 'wamid.reply.${o.id}',
           button_id = 'acepto', payload_respuesta = '{}'::jsonb
           ${o.contratoFin ? `, contrato_fin = ${o.contratoFin}` : ''}
     where id = '${o.id}';
  `
}

let db: PGlite

async function filas<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows
}

async function uno<T = Record<string, unknown>>(sql: string): Promise<T | undefined> {
  return (await filas<T>(sql))[0]
}

/** Corre `sql` en una transaccion que se deshace. Devuelve el mensaje de error, o '' si paso. */
async function ensayo(sql: string): Promise<string> {
  await db.exec('begin')
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  } finally {
    await db.exec('rollback')
  }
}

// Estado capturado en el beforeAll (antes de la purga) y resultado de la primera corrida.
let trasMigracion: {
  acciones: { id: string; acuse_status: string | null; acuse_status_at: string | null }[]
  aceptaciones: { id: string; contrato_fin: string | null; retencion_hasta: string | null }[]
}
let conteos: Record<string, number>
let bordesDeRetencionExactos = false

// ── Fixtures de la purga ────────────────────────────────────────────────────────────────
const LOG_VIEJO = '10000000-0000-4000-8000-000000000001'
const LOG_JOVEN = '10000000-0000-4000-8000-000000000002'
const ENV_VIEJO = '20000000-0000-4000-8000-000000000001'
const ENV_JOVEN = '20000000-0000-4000-8000-000000000002'
const ENV_VIGENTE = '20000000-0000-4000-8000-000000000003'
const SES_VIEJA = '30000000-0000-4000-8000-000000000001'
const SES_JOVEN = '30000000-0000-4000-8000-000000000002'
const ACE_PEND_VIEJA = '40000000-0000-4000-8000-000000000001'
const ACC_PEND_VIEJA = '40000000-0000-4000-8000-0000000000c1'
const SECRETO_PEND = '40000000-0000-4000-8000-0000000000d1'
const ACE_EXP_JOVEN = '40000000-0000-4000-8000-000000000002'
const ACE_RET_AYER = '50000000-0000-4000-8000-000000000001'
const ACC_RET_AYER = '50000000-0000-4000-8000-0000000000c1'
const ACE_RET_HOY = '50000000-0000-4000-8000-000000000002'
const ACE_RET_MANANA = '50000000-0000-4000-8000-000000000003'
const ACE_VIGENTE = '50000000-0000-4000-8000-000000000004'
const ACC_VIGENTE = '50000000-0000-4000-8000-0000000000c4'
const ACE_RECH_VIEJA = '50000000-0000-4000-8000-000000000005'
const ACE_RECH_JOVEN = '50000000-0000-4000-8000-000000000006'

/** contrato_fin cuya retencion cae `dias` dias despues de hoy. */
const contratoFinParaRetencion = (dias: number) =>
  `((${HOY} + ${dias}) - interval '${P.aceptacionRespondidaAniosTrasContrato} years')::date`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer('20260901000003_wa_envios.sql'))
  await db.exec(leer('20260915040000_aceptaciones_terminos.sql'))

  // ── Produccion al 2026-09-15, antes de la migracion ──
  await db.exec(`
    insert into public.wa_envios (id, wa_message_id, phone, origen, intent, preview, status, status_at, created_at) values
      ('${ENV_4DSOFT}', 'wamid.ficticio.4dsoft', '573000000001', 'bot', 'aceptacion_terminos', 'vk_xxxxxx…', 'delivered', '2026-09-15T13:49:24Z', now() - interval '1 hour'),
      ('${ENV_PRUEBA}', 'wamid.ficticio.prueba', '573000000002', 'bot', 'aceptacion_terminos', 'vk_xxxxxx…', 'read', '2026-09-15T13:23:30Z', now() - interval '1 hour');
    ${aceptacionConLlave({
      id: ACE_PRUEBA,
      accion: ACC_PRUEBA,
      wamid: 'wamid.ficticio.prueba',
      ruta: '4d-soft/terminos-uso-valida-4d-soft-v1.pdf',
      respondidoAt: `'2026-09-15T13:23:02Z'::timestamptz`,
      extra: { calidad: `'representante_legal'`, expira_at: `'2026-09-17T05:02:40Z'` },
    })}
    ${aceptacionConLlave({
      id: ACE_4DSOFT,
      accion: ACC_4DSOFT,
      wamid: 'wamid.ficticio.4dsoft',
      ruta: '4d-soft/terminos-uso-valida-4d-soft-v1.pdf',
      respondidoAt: `'2026-09-15T13:49:21Z'::timestamptz`,
      extra: { negocio_id: `'${NEG}'`, expira_at: `'2026-09-22T13:25:06Z'` },
    })}
  `)

  await db.exec(leer(MIGRACION_PURGA))

  trasMigracion = {
    acciones: await filas(
      `select id, acuse_status, acuse_status_at::text from public.aceptaciones_terminos_acciones order by id`,
    ),
    aceptaciones: await filas(
      `select id, contrato_fin::text, retencion_hasta::text from public.aceptaciones_terminos order by id`,
    ),
  }

  // ── Un registro a cada lado de cada plazo ──
  await db.exec(`
    insert into public.wa_message_log (id, workspace_id, phone, direction, intent, message_preview, created_at,
                                       gemini_model, gemini_input_tokens, gemini_output_tokens, gemini_latency_ms, confidence) values
      ('${LOG_VIEJO}', '${WS}', '+573000000010', 'inbound', 'registrar_gasto', 'almuerzo 25 mil',
         now() - interval '${P.conversacionesDias + 1} days', 'gemini-x', 120, 30, 340, 0.9),
      ('${LOG_JOVEN}', '${WS}', '+573000000011', 'inbound', 'registrar_gasto', 'taxi 12 mil',
         now() - interval '${P.conversacionesDias - 1} days', 'gemini-x', 100, 20, 300, 0.8);

    insert into public.wa_envios (id, wa_message_id, phone, origen, intent, preview, status, status_at, error_code, error_title, created_at) values
      ('${ENV_VIEJO}', 'wamid.ficticio.viejo', '573000000020', 'alerta', 'w25', 'Tienes un saldo', 'failed', now() - interval '13 months', 131047, 'Re-engagement message',
         now() - interval '${P.acusesMeses} months' - interval '1 day'),
      ('${ENV_JOVEN}', 'wamid.ficticio.joven', '573000000021', 'alerta', 'w25', 'Tienes un saldo', 'delivered', now() - interval '11 months', null, null,
         now() - interval '${P.acusesMeses} months' + interval '1 day'),
      ('${ENV_VIGENTE}', 'wamid.ficticio.vigente', '573000000022', 'bot', 'aceptacion_terminos', 'vk_xxxxxx…', 'read', '2025-08-01T10:00:05Z', null, null,
         now() - interval '${P.acusesMeses + 1} months');

    insert into public.bot_sessions (id, workspace_id, user_phone, context, expires_at) values
      ('${SES_VIEJA}', '${WS}', '+573000000030', '{"gasto": "almuerzo"}', now() - interval '${P.sesionesDiasTrasVencer + 1} days'),
      ('${SES_JOVEN}', '${WS}', '+573000000031', '{"gasto": "taxi"}', now() - interval '${P.sesionesDiasTrasVencer - 1} days');

    ${insertAceptacion(ACE_PEND_VIEJA, 'pendiente', 'solo/pendiente.pdf', {
      expira_at: `now() - interval '${P.aceptacionSinRespuestaDiasTrasVencer + 1} days'`,
    })}
    insert into vault.secrets (id, secret) values ('${SECRETO_PEND}', 'vk_llave_ficticia');
    insert into public.aceptaciones_terminos_acciones (id, aceptacion_id, tipo, secreto_id)
      values ('${ACC_PEND_VIEJA}', '${ACE_PEND_VIEJA}', 'enviar_credencial_valida', '${SECRETO_PEND}');
    ${insertAceptacion(ACE_EXP_JOVEN, 'expirado', 'solo/expirada.pdf', {
      expira_at: `now() - interval '${P.aceptacionSinRespuestaDiasTrasVencer - 1} days'`,
    })}

    ${aceptacionConLlave({
      id: ACE_RET_AYER,
      accion: ACC_RET_AYER,
      wamid: 'wamid.ficticio.ret-ayer',
      ruta: 'compartido/terminos.pdf',
      respondidoAt: `now() - interval '${P.aceptacionRespondidaAniosTrasContrato + 1} years'`,
      contratoFin: contratoFinParaRetencion(-1),
    })}
    ${insertAceptacion(ACE_RET_HOY, 'aceptado', 'compartido/terminos.pdf', {
      respondido_at: `now() - interval '${P.aceptacionRespondidaAniosTrasContrato + 1} years'`,
      contrato_fin: contratoFinParaRetencion(0),
    })}
    ${insertAceptacion(ACE_RET_MANANA, 'aceptado', 'solo/manana.pdf', {
      respondido_at: `now() - interval '${P.aceptacionRespondidaAniosTrasContrato + 1} years'`,
      contrato_fin: contratoFinParaRetencion(1),
    })}
    ${aceptacionConLlave({
      id: ACE_VIGENTE,
      accion: ACC_VIGENTE,
      wamid: 'wamid.ficticio.vigente',
      ruta: 'solo/vigente.pdf',
      respondidoAt: `'2025-08-01T10:00:00Z'::timestamptz`,
    })}
    ${insertAceptacion(ACE_RECH_VIEJA, 'rechazado', 'solo/rechazo.pdf', {
      respondido_at: `now() - interval '${P.aceptacionRespondidaAniosTrasContrato} years' - interval '2 days'`,
    })}
    ${insertAceptacion(ACE_RECH_JOVEN, 'rechazado', 'solo/rechazo-joven.pdf', {
      respondido_at: `now() - interval '${P.aceptacionRespondidaAniosTrasContrato} years' + interval '2 days'`,
    })}
  `)

  // Un plazo en años no siempre cae en el dia exacto (29 de febrero): se comprueba, no se supone.
  const bordes = await uno<{ ok: boolean }>(`
    select bool_and(ok) as ok from (
      select retencion_hasta = ${HOY} - 1 as ok from public.aceptaciones_terminos where id = '${ACE_RET_AYER}'
      union all select retencion_hasta = ${HOY} from public.aceptaciones_terminos where id = '${ACE_RET_HOY}'
      union all select retencion_hasta = ${HOY} + 1 from public.aceptaciones_terminos where id = '${ACE_RET_MANANA}'
    ) b`)
  bordesDeRetencionExactos = bordes?.ok === true

  const r = await uno<{ conteos: Record<string, number> }>(`select public.purgar_registros_bot() as conteos`)
  conteos = r!.conteos
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('plazos fijados contra la Politica de Datos de Valida v1.4', () => {
  it('los plazos son los aprobados el 2026-09-15; moverlos exige tocar esta prueba', () => {
    // Pin deliberado. Si la prueba solo usara PLAZOS_BOT para armar los bordes, mover un plazo en
    // los dos lados (constante y SQL) dejaria todo en verde y la Politica publicada mentiria.
    expect(PLAZOS_BOT).toEqual({
      aceptacionRespondidaAniosTrasContrato: 10,
      aceptacionSinRespuestaDiasTrasVencer: 90,
      conversacionesDias: 90,
      acusesMeses: 12,
      sesionesDiasTrasVencer: 7,
    })
  })

  it('la migracion escribe exactamente esos intervalos, la zona y el bucket', () => {
    const sql = leer(MIGRACION_PURGA)
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n')
    const intervalos = [...sql.matchAll(/interval '(\d+ \w+)'/g)].map((m) => m[1]).sort()
    expect(intervalos).toEqual(
      [
        `${P.aceptacionRespondidaAniosTrasContrato} years`, // retencion_hasta
        `${P.acusesMeses} months`,
        `${P.conversacionesDias} days`,
        `${P.aceptacionSinRespuestaDiasTrasVencer} days`,
        `${P.sesionesDiasTrasVencer} days`,
      ].sort(),
    )
    const zonas = new Set([...sql.matchAll(/time zone '([^']+)'/g)].map((m) => m[1]))
    expect([...zonas]).toEqual([ZONA_PLAZOS])
    expect(sql).toContain(`/${BUCKET_ACEPTACIONES}/([^?#]+)`)
  })
})

describe('relleno de produccion al aplicar la migracion', () => {
  it('la prueba de entrega de 4D SOFT queda copiada en su accion: delivered 13:49:24Z', () => {
    expect(trasMigracion.acciones.find((a) => a.id === ACC_4DSOFT)).toMatchObject({
      acuse_status: 'delivered',
      acuse_status_at: '2026-09-15 13:49:24+00',
    })
    expect(trasMigracion.acciones.find((a) => a.id === ACC_PRUEBA)).toMatchObject({
      acuse_status: 'read',
      acuse_status_at: '2026-09-15 13:23:30+00',
    })
  })

  it('4D SOFT sigue vigente (sin retencion) y la prueba interna retiene hasta 2036-09-15', () => {
    expect(trasMigracion.aceptaciones.find((a) => a.id === ACE_4DSOFT)).toMatchObject({
      contrato_fin: null,
      retencion_hasta: null,
    })
    expect(trasMigracion.aceptaciones.find((a) => a.id === ACE_PRUEBA)).toMatchObject({
      contrato_fin: '2026-09-15',
      retencion_hasta: '2036-09-15',
    })
  })
})

describe('purgar_registros_bot: cada plazo en su borde', () => {
  it('devuelve los conteos de la corrida y los deja en la bitacora', async () => {
    expect(conteos).toEqual({
      acuses_copiados: 1, // ACC_VIGENTE (las de produccion ya venian copiadas)
      wa_envios_anonimizados: 2, // ENV_VIEJO + ENV_VIGENTE
      wa_message_log_anonimizados: 1,
      bot_sessions_borradas: 1,
      aceptaciones_sin_respuesta_borradas: 1,
      aceptaciones_con_respuesta_borradas: 2, // retencion ayer + rechazada vieja
      acciones_borradas: 2, // la pendiente (con su secreto) + la enviada de la retencion vencida
      objetos_encolados: 2, // pendiente.pdf + rechazo.pdf; el compartido NO
    })
    const bitacora = await filas<{ conteos: Record<string, number> }>(
      `select conteos from public.purga_registros_bot_corridas`,
    )
    expect(bitacora).toEqual([{ conteos }])
  })

  it('wa_message_log: a los 90 dias anula telefono y texto y conserva intent, tokens y latencia', async () => {
    const viejo = await uno(`select * from public.wa_message_log where id = '${LOG_VIEJO}'`)
    expect(viejo).toMatchObject({
      phone: null,
      message_preview: null,
      intent: 'registrar_gasto',
      direction: 'inbound',
      gemini_model: 'gemini-x',
      gemini_input_tokens: 120,
      gemini_output_tokens: 30,
      gemini_latency_ms: 340,
    })
    const joven = await uno(`select phone, message_preview from public.wa_message_log where id = '${LOG_JOVEN}'`)
    expect(joven).toEqual({ phone: '+573000000011', message_preview: 'taxi 12 mil' })
  })

  it('wa_envios: a los 12 meses anula telefono, texto y wamid y conserva estado y error', async () => {
    const viejo = await uno(`select * from public.wa_envios where id = '${ENV_VIEJO}'`)
    expect(viejo).toMatchObject({
      phone: null,
      preview: null,
      wa_message_id: null,
      status: 'failed',
      error_code: 131047,
      error_title: 'Re-engagement message',
      origen: 'alerta',
      intent: 'w25',
    })
    const joven = await uno(`select phone, preview, wa_message_id from public.wa_envios where id = '${ENV_JOVEN}'`)
    expect(joven).toEqual({ phone: '573000000021', preview: 'Tienes un saldo', wa_message_id: 'wamid.ficticio.joven' })
  })

  it('el wamid se anula porque lleva el telefono dentro (base64)', () => {
    // wamid real de produccion con el numero reemplazado: el prefijo es el destinatario en claro.
    const wamid = 'HBgMNTczMDAwMDAwMDAxFQIAERgSOTVBRTgyOUQ2NDQ4QzM4NEEyAA=='
    expect(Buffer.from(wamid, 'base64').toString('latin1')).toContain('573000000001')
  })

  it('bot_sessions: se borran 7 dias despues de vencer, no antes', async () => {
    const ids = (await filas<{ id: string }>(`select id from public.bot_sessions order by id`)).map((s) => s.id)
    expect(ids).toEqual([SES_JOVEN])
  })

  it('aceptaciones sin respuesta: se borran 90 dias despues de vencer, con su accion y su secreto de Vault', async () => {
    const quedan = (
      await filas<{ id: string }>(`select id from public.aceptaciones_terminos where id in ('${ACE_PEND_VIEJA}', '${ACE_EXP_JOVEN}')`)
    ).map((a) => a.id)
    expect(quedan).toEqual([ACE_EXP_JOVEN])
    expect(await filas(`select 1 from public.aceptaciones_terminos_acciones where id = '${ACC_PEND_VIEJA}'`)).toEqual([])
    expect(await filas(`select 1 from vault.secrets where id = '${SECRETO_PEND}'`)).toEqual([])
  })

  it(
    'aceptaciones respondidas: se borran el dia DESPUES de retencion_hasta, con su accion enviada',
    async (ctx) => {
      // Solo el dia en que ningun contrato_fin + 10 años cae en hoy (29 de febrero y vecinos).
      if (!bordesDeRetencionExactos) ctx.skip()
      const quedan = (
        await filas<{ id: string }>(
          `select id from public.aceptaciones_terminos where id in ('${ACE_RET_AYER}', '${ACE_RET_HOY}', '${ACE_RET_MANANA}') order by id`,
        )
      ).map((a) => a.id)
      expect(quedan).toEqual([ACE_RET_HOY, ACE_RET_MANANA])
      expect(await filas(`select 1 from public.aceptaciones_terminos_acciones where id = '${ACC_RET_AYER}'`)).toEqual([])
    },
  )

  it('sin contrato_fin la aceptacion no se purga nunca (contrato vigente)', async () => {
    expect(await uno(`select retencion_hasta from public.aceptaciones_terminos where id = '${ACE_VIGENTE}'`)).toEqual({
      retencion_hasta: null,
    })
  })

  it('una rechazada sin contrato cuenta los diez años desde la respuesta', async () => {
    const quedan = (
      await filas<{ id: string }>(`select id from public.aceptaciones_terminos where id in ('${ACE_RECH_VIEJA}', '${ACE_RECH_JOVEN}')`)
    ).map((a) => a.id)
    expect(quedan).toEqual([ACE_RECH_JOVEN])
  })

  it('la prueba de entrega sobrevive a la purga de wa_envios: se copia antes de anonimizar', async () => {
    expect(await uno(`select phone, wa_message_id, status from public.wa_envios where id = '${ENV_VIGENTE}'`)).toEqual({
      phone: null,
      wa_message_id: null,
      status: 'read',
    })
    expect(
      await uno(`select acuse_status, acuse_status_at::text, wamid from public.aceptaciones_terminos_acciones where id = '${ACC_VIGENTE}'`),
    ).toEqual({ acuse_status: 'read', acuse_status_at: '2025-08-01 10:00:05+00', wamid: 'wamid.ficticio.vigente' })
    // Y la de 4D SOFT, que no se toca.
    expect(
      await uno(`select acuse_status, acuse_status_at::text from public.aceptaciones_terminos_acciones where id = '${ACC_4DSOFT}'`),
    ).toEqual({ acuse_status: 'delivered', acuse_status_at: '2026-09-15 13:49:24+00' })
  })
})

describe('PDF de las aceptaciones purgadas', () => {
  it('se encola solo el PDF que ya ninguna aceptacion viva referencia', async () => {
    const cola = await filas<{ bucket: string; ruta: string }>(
      `select bucket, ruta from public.purga_storage_pendiente order by ruta`,
    )
    expect(cola).toEqual([
      { bucket: BUCKET_ACEPTACIONES, ruta: 'solo/pendiente.pdf' },
      { bucket: BUCKET_ACEPTACIONES, ruta: 'solo/rechazo.pdf' },
    ])
  })

  it('el cron no recibe un PDF que una aceptacion nueva volvio a usar, y lo saca de la cola', async () => {
    const r = await ensayo(`
      ${insertAceptacion('60000000-0000-4000-8000-000000000001', 'pendiente', 'solo/pendiente.pdf')}
      create temp table salida as select * from public.objetos_purga_bot_por_borrar();
      do $$ begin
        if (select array_agg(ruta order by ruta) from salida) <> array['solo/rechazo.pdf'] then
          raise exception 'devolvio %', (select array_agg(ruta) from salida);
        end if;
        if exists (select 1 from public.purga_storage_pendiente where ruta = 'solo/pendiente.pdf') then
          raise exception 'la ruta reusada sigue en la cola';
        end if;
      end $$;
    `)
    expect(r).toBe('')
  })

  it('ruta_documento_aceptacion solo reconoce URLs de este bucket', async () => {
    const r = await uno<{ firmada: string; publica: string; ajena: null; drive: null }>(`
      select public.ruta_documento_aceptacion('${url('a/b%20c.pdf')}') as firmada,
             public.ruta_documento_aceptacion('https://x.supabase.co/storage/v1/object/public/${BUCKET_ACEPTACIONES}/a.pdf') as publica,
             public.ruta_documento_aceptacion('https://x.supabase.co/storage/v1/object/sign/otro-bucket/a.pdf?token=t') as ajena,
             public.ruta_documento_aceptacion('https://drive.google.com/file/d/1/view') as drive`)
    expect(r).toEqual({ firmada: 'a/b%20c.pdf', publica: 'a.pdf', ajena: null, drive: null })
  })
})

describe('las guardas siguen bloqueando fuera de la purga', () => {
  const VENCIDA = '70000000-0000-4000-8000-000000000001'
  const vencida = insertAceptacion(VENCIDA, 'aceptado', 'x/vencida.pdf', {
    respondido_at: `now() - interval '20 years'`,
    contrato_fin: `(now() - interval '15 years')::date`,
  })
  const conGuc = `select set_config('metrik.purga_registros_bot', 'on', true);`

  it('una respondida con el plazo vencido NO se borra sin la purga', async () => {
    expect(await ensayo(`${vencida} delete from public.aceptaciones_terminos where id = '${VENCIDA}';`)).toMatch(
      /es evidencia; no se borra/,
    )
  })

  it('con la marca de la purga pero SIN el plazo vencido, tampoco', async () => {
    expect(await ensayo(`${conGuc} delete from public.aceptaciones_terminos where id = '${ACE_RET_MANANA}';`)).toMatch(
      /es evidencia; no se borra/,
    )
    expect(await ensayo(`${conGuc} delete from public.aceptaciones_terminos where id = '${ACE_VIGENTE}';`)).toMatch(
      /es evidencia; no se borra/,
    )
  })

  it('la marca de la purga y el plazo vencido juntos si abren la puerta (la fecha es el candado)', async () => {
    expect(await ensayo(`${vencida} ${conGuc} delete from public.aceptaciones_terminos where id = '${VENCIDA}';`)).toBe('')
  })

  it('en una respondida solo se puede escribir contrato_fin', async () => {
    expect(
      await ensayo(`update public.aceptaciones_terminos set empresa_nombre = 'Otra' where id = '${ACE_VIGENTE}';`),
    ).toMatch(/no se modifica \(solo contrato_fin\)/)
    expect(
      await ensayo(`update public.aceptaciones_terminos set payload_respuesta = '{"x":1}' where id = '${ACE_VIGENTE}';`),
    ).toMatch(/no se modifica/)
    expect(
      await ensayo(`
        update public.aceptaciones_terminos set contrato_fin = date '2027-03-15' where id = '${ACE_VIGENTE}';
        do $$ begin
          if (select retencion_hasta from public.aceptaciones_terminos where id = '${ACE_VIGENTE}') <> date '2037-03-15' then
            raise exception 'retencion_hasta no se recalculo';
          end if;
        end $$;`),
    ).toBe('')
  })

  it('contrato_fin no puede ser anterior a la respuesta (no se adelanta un borrado)', async () => {
    expect(
      await ensayo(`update public.aceptaciones_terminos set contrato_fin = date '2000-01-01' where id = '${ACE_VIGENTE}';`),
    ).toMatch(/anterior a la respuesta/)
  })

  it('retencion_hasta no se escribe a mano', async () => {
    expect(
      await ensayo(`update public.aceptaciones_terminos set retencion_hasta = date '2000-01-01' where id = '${ACE_VIGENTE}';`),
    ).toMatch(/can only be updated to DEFAULT/)
  })

  it('una accion enviada no se borra sin la purga, ni con la marca si su aceptacion no vencio', async () => {
    expect(
      await ensayo(`delete from public.aceptaciones_terminos_acciones where id = '${ACC_VIGENTE}';`),
    ).toMatch(/ya se envio y es evidencia/)
    expect(
      await ensayo(`${conGuc} delete from public.aceptaciones_terminos_acciones where id = '${ACC_VIGENTE}';`),
    ).toMatch(/ya se envio y es evidencia/)
  })

  it('el acuse de una accion enviada solo puede ser la copia exacta de su wa_envios', async () => {
    // ENV_4DSOFT sigue con su wamid; ACC_4DSOFT ya tiene la copia.
    expect(
      await ensayo(`update public.aceptaciones_terminos_acciones set acuse_status = 'read' where id = '${ACC_4DSOFT}';`),
    ).toMatch(/ya se envio y no se modifica/)
    expect(
      await ensayo(
        `update public.aceptaciones_terminos_acciones set acuse_status_at = '2026-09-15T13:49:25Z' where id = '${ACC_4DSOFT}';`,
      ),
    ).toMatch(/ya se envio y no se modifica/)
    // Si Meta manda el 'read' despues, la copia nueva si entra.
    expect(
      await ensayo(`
        select public.wa_aplicar_status('wamid.ficticio.4dsoft', 'read', '2026-09-15T14:00:00Z');
        update public.aceptaciones_terminos_acciones
           set acuse_status = 'read', acuse_status_at = '2026-09-15T14:00:00Z' where id = '${ACC_4DSOFT}';`),
    ).toBe('')
  })

  it('la constancia del secreto borrado no deja colar un acuse ni otra columna', async () => {
    expect(
      await ensayo(`
        insert into vault.secrets (id, secret) values ('70000000-0000-4000-8000-0000000000d1', 'x');
        ${insertAceptacion('70000000-0000-4000-8000-000000000002', 'pendiente', 'x/y.pdf')}
        insert into public.aceptaciones_terminos_acciones (id, aceptacion_id, tipo, secreto_id)
          values ('70000000-0000-4000-8000-0000000000c2', '70000000-0000-4000-8000-000000000002',
                  'enviar_credencial_valida', '70000000-0000-4000-8000-0000000000d1');
        update public.aceptaciones_terminos_acciones
           set estado = 'enviada', enviada_at = now(), wamid = 'wamid.ficticio.y', intentado_at = now()
         where id = '70000000-0000-4000-8000-0000000000c2';
        update public.aceptaciones_terminos_acciones
           set secreto_id = null, secreto_borrado_at = now(), acuse_status = 'read', acuse_status_at = now()
         where id = '70000000-0000-4000-8000-0000000000c2';`),
    ).toMatch(/ya se envio y no se modifica/)
  })
})

describe('permisos y cron', () => {
  const FUNCIONES = [
    'public.purgar_registros_bot()',
    'public.objetos_purga_bot_por_borrar()',
    'public.ruta_documento_aceptacion(text)',
  ]

  it('anon y authenticated no pueden ejecutar ninguna de las funciones nuevas', async () => {
    for (const f of FUNCIONES) {
      const r = await uno<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', '${f}', 'execute') as anon,
                has_function_privilege('authenticated', '${f}', 'execute') as authenticated`,
      )
      expect(r, f).toEqual({ anon: false, authenticated: false })
    }
  })

  it('el ACL real (pg_proc.proacl) no nombra a PUBLIC, anon ni authenticated', async () => {
    const r = await filas<{ proname: string; grantee: string }>(`
      select p.proname, case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
        from pg_proc p, aclexplode(p.proacl) a
       where p.oid in (${FUNCIONES.map((f) => `'${f}'::regprocedure`).join(', ')})
         and a.privilege_type = 'EXECUTE'
       order by 1, 2`)
    expect(r).toEqual([
      { proname: 'objetos_purga_bot_por_borrar', grantee: 'postgres' },
      { proname: 'objetos_purga_bot_por_borrar', grantee: 'service_role' },
      { proname: 'purgar_registros_bot', grantee: 'postgres' },
      { proname: 'ruta_documento_aceptacion', grantee: 'postgres' },
    ])
  })

  it('llamarla como authenticated o anon falla por permisos', async () => {
    expect(await ensayo(`set local role authenticated; select public.purgar_registros_bot();`)).toMatch(
      /permission denied/,
    )
    expect(await ensayo(`set local role anon; select public.purgar_registros_bot();`)).toMatch(/permission denied/)
  })

  it('el cron diario llama la funcion y no lleva secretos', async () => {
    const jobs = await filas<{ jobname: string; schedule: string; command: string }>(
      `select jobname, schedule, command from cron.job`,
    )
    expect(jobs).toEqual([
      { jobname: 'purgar-registros-bot', schedule: '0 8 * * *', command: 'select public.purgar_registros_bot();' },
    ])
    expect(jobs[0].command).not.toMatch(/bearer|secret|vault|http|key/i)
  })

  it('la marca de la purga no sobrevive a la funcion dentro de la misma transaccion', async () => {
    expect(
      await ensayo(`
        select public.purgar_registros_bot();
        do $$ begin
          if coalesce(current_setting('metrik.purga_registros_bot', true), '') <> '' then
            raise exception 'la marca quedo puesta';
          end if;
        end $$;`),
    ).toBe('')
  })

  it('la bitacora de corridas no tiene donde guardar un telefono', async () => {
    const cols = (
      await filas<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'purga_registros_bot_corridas' order by 1`,
      )
    ).map((c) => c.column_name)
    expect(cols).toEqual(['conteos', 'ejecutada_at', 'id'])
    expect(Object.values(conteos).every((v) => Number.isInteger(v))).toBe(true)
  })
})
