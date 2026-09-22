import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * `emails_cliente_negocio(uuid[])`, el archivo del repo ejecutado de verdad.
 *
 * Lo que esta migración promete es que el panel de recibos resuelva el destinatario con la
 * MISMA regla que el aviso, sin copiarla. Una copia de la precedencia en TypeScript pasaría
 * cualquier prueba con dobles y se desincronizaría en silencio seis meses después —que es
 * exactamente cómo nació el defecto que esto corrige—, así que aquí se levanta Postgres en
 * memoria (PGlite) y se aplican LOS ARCHIVOS: primero `20260828000001` (la fuente única, ya
 * en producción) y encima el de este PR.
 *
 * Se replican de producción los privilegios por defecto del esquema (toda función nace
 * ejecutable por `anon` y `authenticated`). Sin eso, la prueba de permisos pasaría aunque
 * faltara el `revoke`, que es el gotcha #185 de este repo.
 *
 * MEDIDO CONTRA PRODUCCIÓN el 2026-09-22, sobre los 410 cobros pendientes de SOENA: el panel
 * leía `contactos.email` y decía "al cliente no se le avisa: no hay correo" en 119 casos,
 * FALSO en 112 de ellos.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const FUENTE = '20260828000001_email_cliente_negocio_prioriza_rut.sql'
const LOTE = '20260922000001_emails_cliente_negocio_por_lote.sql'

const RUT_CONFIG = '00000000-0000-4000-8000-000000000a01'
const RUT_2_CONFIG = '00000000-0000-4000-8000-000000000a02'
const OTRO_CONFIG = '00000000-0000-4000-8000-000000000a03'
/** Contacto sin correo, RUT con correo: el caso de V0502. */
const SOLO_RUT = '00000000-0000-4000-8000-000000000b01'
/** Sin RUT: el contacto es el respaldo. */
const SOLO_CONTACTO = '00000000-0000-4000-8000-000000000b02'
/** Los dos: gana el del RUT, que es el titular del vehículo. */
const AMBOS = '00000000-0000-4000-8000-000000000b03'
/** Ninguno de los dos: no hay a dónde avisar. */
const NINGUNO = '00000000-0000-4000-8000-000000000b04'
/** Un id que no existe en `negocios`. */
const AJENO = '00000000-0000-4000-8000-000000000b99'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como en produccion: el EXECUTE de anon y authenticated llega por el default del esquema.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create table public.contactos (id uuid primary key, email text);
  create table public.negocios  (id uuid primary key, contacto_id uuid references public.contactos(id));
  create table public.bloque_configs (id uuid primary key, slug text);
  create table public.negocio_bloques (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid,
    bloque_config_id uuid,
    data jsonb
  );

  insert into public.bloque_configs (id, slug) values
    ('${RUT_CONFIG}', 'rut'),
    ('${RUT_2_CONFIG}', 'rut_solicitante_2'),
    ('${OTRO_CONFIG}', 'factura_venta_vehiculo');

  insert into public.contactos (id, email) values
    ('${SOLO_RUT}', null),
    ('${SOLO_CONTACTO}', 'paula@contacto.co'),
    ('${AMBOS}', 'quien.vendio@contacto.co'),
    ('${NINGUNO}', null);

  insert into public.negocios (id, contacto_id) values
    ('${SOLO_RUT}', '${SOLO_RUT}'),
    ('${SOLO_CONTACTO}', '${SOLO_CONTACTO}'),
    ('${AMBOS}', '${AMBOS}'),
    ('${NINGUNO}', '${NINGUNO}');

  insert into public.negocio_bloques (negocio_id, bloque_config_id, data) values
    -- Con espacios y mayúsculas: la fuente normaliza, y el lote no puede deshacerlo.
    ('${SOLO_RUT}', '${RUT_CONFIG}', '{"campos":{"email":{"value":"  JohnCifuentes@hotmail.com "}}}'),
    ('${AMBOS}', '${RUT_CONFIG}', '{"campos":{"email":{"value":"titular@rut.co"}}}'),
    -- Un bloque que NO es de RUT no aporta destinatario.
    ('${NINGUNO}', '${OTRO_CONFIG}', '{"campos":{"email":{"value":"taller@ajeno.co"}}}');
`

let db: PGlite

const emails = async (ids: string[]) => {
  const r = await db.query<{ negocio_id: string; email: string | null }>(
    'select negocio_id, email from public.emails_cliente_negocio($1)',
    [ids],
  )
  return Object.fromEntries(r.rows.map(f => [f.negocio_id, f.email]))
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(FUENTE))
  await db.exec(leer(LOTE))
})

afterAll(async () => { await db.close() })

describe('emails_cliente_negocio(uuid[]) — la precedencia sigue viviendo en un solo sitio', () => {
  it('devuelve el correo del RUT cuando el contacto no lo tiene: el caso de V0502', async () => {
    const r = await emails([SOLO_RUT])
    expect(r[SOLO_RUT]).toBe('johncifuentes@hotmail.com')
  })

  it('el RUT gana sobre el contacto: el titular es el dueño de la plata', async () => {
    const r = await emails([AMBOS])
    expect(r[AMBOS]).toBe('titular@rut.co')
  })

  it('sin RUT cae al contacto: es el último recurso, no el primero', async () => {
    const r = await emails([SOLO_CONTACTO])
    expect(r[SOLO_CONTACTO]).toBe('paula@contacto.co')
  })

  it('un negocio sin correo en ninguna parte devuelve fila con null, no desaparece', async () => {
    // Que la fila exista importa: el panel distingue "no hay a dónde avisar" de "no pregunté".
    const r = await emails([NINGUNO])
    expect(Object.keys(r)).toContain(NINGUNO)
    expect(r[NINGUNO]).toBeNull()
  })

  it('un id que no existe no rompe el lote entero', async () => {
    const r = await emails([AJENO, SOLO_RUT])
    expect(r[AJENO]).toBeNull()
    expect(r[SOLO_RUT]).toBe('johncifuentes@hotmail.com')
  })

  it('un lote vacío o nulo devuelve cero filas, sin error', async () => {
    expect(Object.keys(await emails([]))).toHaveLength(0)
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.emails_cliente_negocio(null)')
    expect(r.rows[0].n).toBe(0)
  })

  it('NO la puede ejecutar el cliente con sesión: la llama el servidor', async () => {
    // Devuelve correos de cualquier negocio sin filtrar por workspace (es `security
    // definer`): el filtro por inquilino lo pone quien llama.
    const r = await db.query<{ rol: string; puede: boolean }>(`
      select rol, has_function_privilege(rol, 'public.emails_cliente_negocio(uuid[])', 'execute') as puede
      from unnest(array['anon','authenticated','service_role']) as rol
    `)
    expect(Object.fromEntries(r.rows.map(f => [f.rol, f.puede]))).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    })
  })
})

/**
 * El mecanismo, no el síntoma.
 *
 * Las pruebas de arriba pasarían igual si el lote hubiera COPIADO la regla de precedencia en
 * vez de llamar a `email_cliente_negocio`, y esa copia es justo lo que hay que impedir. Aquí
 * se reemplaza la fuente por un sello: si el lote la delega, devuelve el sello; si la copió,
 * sigue devolviendo correos.
 */
describe('emails_cliente_negocio(uuid[]) — delega, no reimplementa', () => {
  it('cambiar la fuente cambia lo que devuelve el lote', async () => {
    await db.exec(`
      create or replace function public.email_cliente_negocio(p_negocio_id uuid)
      returns text language sql stable as $f$ select 'sello@delegado.co'::text $f$;
    `)
    const r = await emails([SOLO_RUT, SOLO_CONTACTO, NINGUNO])

    expect(r).toEqual({
      [SOLO_RUT]: 'sello@delegado.co',
      [SOLO_CONTACTO]: 'sello@delegado.co',
      [NINGUNO]: 'sello@delegado.co',
    })
  })
})
