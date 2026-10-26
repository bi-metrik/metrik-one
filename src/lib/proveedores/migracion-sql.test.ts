import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de proveedores (`20261018150000`), su dry-run y su reversa, corridos de verdad en
 * Postgres en memoria (PGlite) sobre las migraciones de la biblioteca de fotos cargadas TAL CUAL.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/proveedores', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000b1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000b2'
const ANA = '00000000-0000-4000-8000-00000000a001'
const BETO = '00000000-0000-4000-8000-00000000a002'
const MIGRACION = '20261018150000_proveedores.sql'
const DRY_RUN = '2026-10-18_dry-run_proveedores.sql'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key, workspace_id uuid, is_active boolean default true);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  insert into public.workspaces values ('${WS}'), ('${OTRO_WS}');
  insert into public.staff (id, workspace_id) values ('${ANA}', '${WS}'), ('${BETO}', '${WS}');
`

const uno = async <T>(db: PGlite, q: string) => (await db.query<T>(q)).rows[0]
const existe = async (db: PGlite, nombre: string) => (await uno<{ r: string | null }>(db, `select to_regclass('${nombre}')::text as r`)).r !== null

let db: PGlite
let perfilViejo: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  for (const m of [
    '20261014221500_fotos_catalogo.sql',
    '20261016153000_fotos_catalogo_tres_por_elemento.sql',
    '20261016221500_fotos_catalogo_categoria.sql',
    '20261016233000_fotos_catalogo_autorizacion.sql',
    '20261017090000_fotos_perfiles.sql',
  ]) await db.exec(migracion(m))
  // Un hotel de antes, con su foto, y un tour.
  await db.exec(`
    insert into public.fotos_catalogo (workspace_id, tipo, clave, nombre_clave, nombre, ref, origen, revisada)
    values ('${WS}', 'hotel', 'catalonia puerta del sol|madrid', 'catalonia puerta del sol', 'Catalonia', 'one://fotos-catalogo/${WS}/hotel/${'0'.repeat(16)}.jpg', 'asesora', true);
    insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad) values ('${WS}', 'actividad', 'tour toledo|madrid', 'Tour Toledo', 'Madrid');
  `)
  perfilViejo = (await uno<{ id: string }>(db, `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad) values ('${WS}', 'hotel', 'catalonia puerta del sol|madrid', 'Catalonia Puerta del Sol', 'Madrid') returning id`)).id
}, 60_000)
afterAll(async () => db.close())

describe('migración de proveedores', () => {
  it('el dry-run lleva el cuerpo de la migración tal cual', () => {
    const cuerpo = (/EXECUTE \$mig\$([\s\S]*?)\$mig\$/.exec(sql(DRY_RUN))?.[1] ?? 'no está').trim()
    expect(cuerpo.length).toBeGreaterThan(5000)
    expect(migracion(MIGRACION).trim()).toBe(cuerpo)
  })

  it('el dry-run dice OK, ensaya las reglas y no deja nada escrito', async () => {
    // El bucket lo creó `20261014221500` (solo JPEG de 5 MB).
    const r = await db.exec(sql(DRY_RUN)).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    for (const k of ['ensayado=t', 'por_defecto=t', 'clave_fija=t', 'via=t', 'fechas=t', 'misma_persona=t', 'otra_persona=t', 'cambio_pendiente=t', 'rastro=3', 'backfill=t', 'bucket=t']) {
      expect(r).toContain(k)
    }
    expect(await existe(db, 'public.proveedor_tarifarios')).toBe(false)
    expect(await existe(db, 'public.proveedor_cuentas')).toBe(false)
    expect((await uno<{ m: string[] }>(db, `select allowed_mime_types as m from storage.buckets`)).m).toEqual(['image/jpeg'])
  })

  it('la migración: los perfiles de antes quedan con su tipo de proveedor; el código de antes sigue insertando', async () => {
    await db.exec(migracion(MIGRACION))
    const filas = (await db.query<{ tipo: string; tipo_proveedor: string; origen: string }>(`select tipo, tipo_proveedor, origen from public.fotos_perfiles order by tipo`)).rows
    expect(filas).toEqual([
      { tipo: 'actividad', tipo_proveedor: 'actividad', origen: 'cotizacion' },
      { tipo: 'hotel', tipo_proveedor: 'hotel', origen: 'cotizacion' },
    ])
    // El insert de `asegurarPerfil` (sin tipo_proveedor) sigue andando.
    const nuevo = await uno<{ tipo_proveedor: string }>(db, `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre) values ('${WS}', 'hotel', 'h10|madrid', 'H10') returning tipo_proveedor`)
    expect(nuevo.tipo_proveedor).toBe('hotel')
    // La vista de la propuesta da la misma foto.
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.fotos_catalogo_por_clave where clave_pedida = 'catalonia puerta del sol|madrid'`)).n).toBe(1)
    expect((await uno<{ m: string[] }>(db, `select allowed_mime_types as m from storage.buckets`)).m).toContain('application/pdf')
  })

  it('la ficha: llaves que no cambian, etiquetas normalizadas, celular E.164, un origen_ref por ficha', async () => {
    await expect(db.exec(`update public.fotos_perfiles set clave = 'otra|madrid' where id = '${perfilViejo}'`)).rejects.toThrow(/no cambian/)
    await expect(db.exec(`update public.fotos_perfiles set tipo = 'actividad' where id = '${perfilViejo}'`)).rejects.toThrow(/no cambian/)
    await db.exec(`update public.fotos_perfiles set etiquetas = '{familias,luna de miel}', celular = '+573001234567', estrellas = 4 where id = '${perfilViejo}'`)
    await expect(db.exec(`update public.fotos_perfiles set etiquetas = '{Familias}' where id = '${perfilViejo}'`)).rejects.toThrow(/etiquetas_normalizadas/)
    await expect(db.exec(`update public.fotos_perfiles set etiquetas = '{"luna  de miel"}' where id = '${perfilViejo}'`)).rejects.toThrow(/etiquetas_normalizadas/)
    await expect(db.exec(`update public.fotos_perfiles set celular = '3001234567' where id = '${perfilViejo}'`)).rejects.toThrow(/celular_check/)
    await expect(db.exec(`update public.fotos_perfiles set estrellas = 6 where id = '${perfilViejo}'`)).rejects.toThrow(/estrellas_check/)
    await db.exec(`insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, tipo_proveedor, origen, origen_ref) values ('${WS}', 'proveedor', 'vtc|', 'VTC', 'mayorista', 'importacion', 'recAAA')`)
    await expect(
      db.exec(`insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, tipo_proveedor, origen, origen_ref) values ('${WS}', 'proveedor', 'vtc 2|', 'VTC 2', 'mayorista', 'importacion', 'recAAA')`),
    ).rejects.toThrow(/una_por_origen_ref/)
    // Segmentar: tipo + etiqueta + ciudad de la llave.
    const r = await db.query(`select id from public.fotos_perfiles where tipo_proveedor = 'hotel' and etiquetas @> '{luna de miel}' and split_part(clave, '|', 2) = 'madrid'`)
    expect(r.rows).toHaveLength(1)
  })

  it('se compra a través de: del mismo espacio y nunca él mismo', async () => {
    const vtc = (await uno<{ id: string }>(db, `select id from public.fotos_perfiles where origen_ref = 'recAAA'`)).id
    await db.exec(`update public.fotos_perfiles set comprado_via_id = '${vtc}' where id = '${perfilViejo}'`)
    await expect(db.exec(`update public.fotos_perfiles set comprado_via_id = id where id = '${perfilViejo}'`)).rejects.toThrow(/no_es_el_mismo/)
    const otro = (await uno<{ id: string }>(db, `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre) values ('${OTRO_WS}', 'proveedor', 'x|', 'X') returning id`)).id
    await expect(db.exec(`update public.fotos_perfiles set comprado_via_id = '${otro}' where id = '${perfilViejo}'`)).rejects.toThrow(/comprado_via_fk/)
  })

  it('tarifarios: del proveedor del mismo espacio, con fechas en orden', async () => {
    await db.exec(`insert into public.proveedor_tarifarios (workspace_id, proveedor_id, nombre_archivo, vigente_desde, vigente_hasta) values ('${WS}', '${perfilViejo}', 'Tarifas 2026.pdf', '2026-01-01', '2026-12-31')`)
    await expect(
      db.exec(`insert into public.proveedor_tarifarios (workspace_id, proveedor_id, nombre_archivo) values ('${OTRO_WS}', '${perfilViejo}', 'x.pdf')`),
    ).rejects.toThrow(/proveedor_tarifarios_proveedor_fk/)
    await expect(
      db.exec(`insert into public.proveedor_tarifarios (workspace_id, proveedor_id, ref) values ('${WS}', '${perfilViejo}', 'one://fotos-catalogo/${WS}/hotel/x.jpg')`),
    ).rejects.toThrow(/ref_check/)
  })

  it('cuentas: otra persona verifica; un cambio la devuelve a pendiente y deja rastro', async () => {
    const id = (await uno<{ id: string }>(db, `insert into public.proveedor_cuentas (workspace_id, proveedor_id, banco, tipo_cuenta, numero, titular, cargada_por) values ('${WS}', '${perfilViejo}', 'Bancolombia', 'ahorros', '123-456789-00', 'Hotel SAS', '${ANA}') returning id`)).id
    await expect(db.exec(`update public.proveedor_cuentas set estado = 'verificada', verificada_por = '${ANA}', verificada_at = now() where id = '${id}'`)).rejects.toThrow(/verificacion/)
    // Ponerse de cargadora sin cambiar datos, para verificar la propia: no.
    await expect(db.exec(`update public.proveedor_cuentas set cargada_por = '${BETO}' where id = '${id}'`)).rejects.toThrow(/solo cambia/)
    await db.exec(`update public.proveedor_cuentas set estado = 'verificada', verificada_por = '${BETO}', verificada_at = now() where id = '${id}'`)
    // Cambio de cuenta (aunque el UPDATE diga «verificada»): vuelve a pendiente.
    await db.exec(`update public.proveedor_cuentas set numero = '999-000000-11', cargada_por = '${BETO}', estado = 'verificada' where id = '${id}'`)
    const c = await uno<{ estado: string; verificada_por: string | null }>(db, `select estado, verificada_por from public.proveedor_cuentas where id = '${id}'`)
    expect(c).toEqual({ estado: 'pendiente', verificada_por: null })
    await db.exec(`update public.proveedor_cuentas set retirada_por = '${ANA}', retirada_at = now() where id = '${id}'`)
    // PGlite guarda `now()` al milisegundo: dos UPDATE seguidos pueden caer en el mismo instante (en CI pasó con
    // «verificada» y «cambiada»), y el desempate alfabético por `evento` ponía «cambiada» primero. El empate se rompe por
    // el ciclo de vida de la cuenta, no por el nombre; un orden de reloj realmente invertido sigue fallando.
    const rastro = (await db.query<{ evento: string; por: string; antes: { numero?: string } | null }>(
      `select evento, por, antes from public.proveedor_cuentas_historial where cuenta_id = '${id}'
       order by created_at, array_position(array['creada', 'verificada', 'cambiada', 'retirada'], evento)`,
    )).rows
    expect(rastro.map((r) => r.evento)).toEqual(['creada', 'verificada', 'cambiada', 'retirada'])
    expect(rastro[2].antes?.numero).toBe('123-456789-00')
    expect(rastro[2].por).toBe(BETO)
  })

  it('la reversa deja los perfiles de hotel y tour con sus fotos', async () => {
    await db.exec(sql('2026-10-18_reversa_proveedores.sql'))
    expect(await existe(db, 'public.proveedor_cuentas')).toBe(false)
    expect(await existe(db, 'public.proveedor_tarifarios')).toBe(false)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.fotos_perfiles where workspace_id = '${WS}'`)).n).toBe(3)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.fotos_catalogo_por_clave`)).n).toBe(1)
    expect((await uno<{ m: string[] }>(db, `select allowed_mime_types as m from storage.buckets`)).m).toEqual(['image/jpeg'])
    // Y la migración vuelve a entrar.
    await db.exec(migracion(MIGRACION))
  })
})
