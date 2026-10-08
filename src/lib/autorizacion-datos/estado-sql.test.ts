import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de la autorización por link, corrida de verdad (PGlite): la regla de vigencia vive
 * en `autorizacion_datos_estado` y la usan el gate, el bloque y el bot. Lo que se prueba aquí es
 * lo que el gate decide.
 */

const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/20261008230000_autorizacion_datos_enlace.sql'), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const C1 = '00000000-0000-4000-8000-0000000000c1'
const C2 = '00000000-0000-4000-8000-0000000000c2'
const CX = '00000000-0000-4000-8000-0000000000c9'
const TOKEN = 'a'.repeat(43)
const TOKEN2 = 'b'.repeat(43)

const ESQUEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key);
  create table public.negocios (id uuid primary key);
  create table public.contactos (id uuid primary key, workspace_id uuid, nombre text, email text, custom_data jsonb default '{}'::jsonb);
  insert into public.workspaces values ('${WS}'), ('${WS2}');
  insert into public.contactos values
    ('${C1}', '${WS}', 'MAURICIO MORENO', 'm@x.co', '{}'),
    ('${C2}', '${WS}', 'ANA', null, '{"autorizacion_datos": true, "autorizacion_datos_fecha": "2026-10-01T00:00:00Z"}'),
    ('${CX}', '${WS2}', 'OTRO', null, '{}');
`

const CASILLAS = JSON.stringify([
  { clave: 'generales', texto: 'Autorizo' },
  { clave: 'sensibles', texto: 'Sensibles' },
  { clave: 'menores', texto: 'Menores' },
])

let db: PGlite

async function publicar(mayor: number, menor: number, publicado = 'now()') {
  const r = await db.query<{ id: string }>(
    `insert into public.autorizacion_datos_textos (workspace_id, version, mayor, menor, titulo, cuerpo_md, casillas, publicado_at)
     values ($1, $2, $3, $4, 'Autorización', 'Hola [NOMBRE_CLIENTE]', $5::jsonb, ${publicado}) returning id`,
    [WS, `v${mayor}.${menor}`, mayor, menor, CASILLAS],
  )
  return r.rows[0].id
}

async function enlace(contacto: string, token: string, dias = 60) {
  const r = await db.query<{ e: { ok: boolean; creado: boolean; token: string; enlace_id: string } }>(
    `select public.autorizacion_datos_enlace($1, $2, $3, null, null, $4) as e`, [WS, contacto, token, dias])
  return r.rows[0].e
}

async function aceptar(enlaceId: string, textoId: string, mayor: number, casillas: Record<string, boolean | null>) {
  await db.query(
    `update public.autorizacion_datos_enlaces set aceptado_at = now(), medio = 'correo', texto_id = $2,
       texto_version = 'v' || $3::int || '.0', texto_mayor = $3::int, texto_menor = 0, texto_sha256 = repeat('f', 64), casillas = $4::jsonb
     where id = $1`, [enlaceId, textoId, mayor, JSON.stringify(casillas)])
}

type Estado = {
  existe: boolean
  vigente: Record<string, boolean>
  requiere_reaceptar: boolean
  texto: { mayor: number } | null
  pendiente: { token: string } | null
  manual_sin_evidencia: { fecha: string | null } | null
}

async function estado(contacto: string, ws = WS): Promise<Estado> {
  const r = await db.query<{ e: Estado }>(`select public.autorizacion_datos_estado($1, $2) as e`, [ws, contacto])
  return r.rows[0].e
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIG)
}, 30_000)
afterEach(async () => { await db.close() })

describe('autorizacion_datos_estado', () => {
  it('sin texto publicado no hay nada vigente', async () => {
    const e = await estado(C1)
    expect(e.existe).toBe(true)
    expect(e.texto).toBeNull()
    expect(e.vigente.generales).toBe(false)
  })

  it('aceptar la general la deja vigente, y cada casilla va por separado', async () => {
    const t = await publicar(1, 0)
    const en = await enlace(C1, TOKEN)
    expect((await estado(C1)).pendiente?.token).toBe(TOKEN)
    await aceptar(en.enlace_id, t, 1, { generales: true, sensibles: false, menores: true, ofertas: null })
    const e = await estado(C1)
    expect(e.vigente).toEqual({ generales: true, sensibles: false, menores: true, ofertas: false })
    expect(e.pendiente).toBeNull()
  })

  it('cliente recurrente: una versión MENOR nueva no vuelve a pedirla; una MAYOR sí', async () => {
    const t1 = await publicar(1, 0, "now() - interval '2 days'")
    const en = await enlace(C1, TOKEN)
    await aceptar(en.enlace_id, t1, 1, { generales: true })
    await publicar(1, 1)
    expect((await estado(C1)).vigente.generales).toBe(true)
    await publicar(2, 0)
    const e = await estado(C1)
    expect(e.vigente.generales).toBe(false)
    expect(e.requiere_reaceptar).toBe(true)
  })

  it('una versión con fecha futura todavía no rige', async () => {
    const t1 = await publicar(1, 0)
    const en = await enlace(C1, TOKEN)
    await aceptar(en.enlace_id, t1, 1, { generales: true })
    await publicar(2, 0, "now() + interval '3 days'")
    expect((await estado(C1)).vigente.generales).toBe(true)
  })

  it('la marca manual vieja se ve pero NO cuenta', async () => {
    await publicar(1, 0)
    const e = await estado(C2)
    expect(e.manual_sin_evidencia).toEqual({ fecha: '2026-10-01T00:00:00Z' })
    expect(e.vigente.generales).toBe(false)
  })

  it('revocar la general tumba todo; revocar sensibles deja la general', async () => {
    const t = await publicar(1, 0)
    const en = await enlace(C1, TOKEN)
    await aceptar(en.enlace_id, t, 1, { generales: true, sensibles: true, menores: true })
    await db.query(`update public.autorizacion_datos_enlaces set revocadas = '{"sensibles": {"at": "x"}}' where id = $1`, [en.enlace_id])
    expect((await estado(C1)).vigente).toEqual({ generales: true, sensibles: false, menores: true, ofertas: false })
    await db.query(`update public.autorizacion_datos_enlaces set revocadas = '{"generales": {"at": "x"}}' where id = $1`, [en.enlace_id])
    expect((await estado(C1)).vigente).toEqual({ generales: false, sensibles: false, menores: false, ofertas: false })
  })

  it('el contacto de otro workspace no existe para este', async () => {
    expect((await estado(CX)).existe).toBe(false)
  })
})

describe('autorizacion_datos_enlace', () => {
  it('reusa el pendiente vigente y crea uno nuevo si venció o si vence mañana', async () => {
    const a = await enlace(C1, TOKEN)
    expect(a).toMatchObject({ ok: true, creado: true, token: TOKEN })
    const b = await enlace(C1, TOKEN2)
    expect(b).toMatchObject({ creado: false, token: TOKEN })
    await db.query(`update public.autorizacion_datos_enlaces set expira_at = now() + interval '2 hours'`)
    const c = await enlace(C1, TOKEN2)
    expect(c).toMatchObject({ creado: true, token: TOKEN2 })
  })

  it('no crea enlace para un contacto de otro workspace', async () => {
    const r = await enlace(CX, TOKEN)
    expect(r.ok).toBe(false)
  })

  it('rechaza un token con forma inválida', async () => {
    await expect(enlace(C1, '../x')).rejects.toThrow()
  })
})

describe('guardas de evidencia', () => {
  it('un texto publicado no se edita y su huella la calcula la base', async () => {
    const t = await publicar(1, 0)
    const r = await db.query<{ h: string }>(`select plantilla_sha256 as h from public.autorizacion_datos_textos where id = $1`, [t])
    expect(r.rows[0].h).toMatch(/^[0-9a-f]{64}$/)
    await expect(db.query(`update public.autorizacion_datos_textos set titulo = 'otro' where id = $1`, [t])).rejects.toThrow(/no se edita/)
  })

  it('una aceptación no se modifica, salvo la revocatoria', async () => {
    const t = await publicar(1, 0)
    const en = await enlace(C1, TOKEN)
    await aceptar(en.enlace_id, t, 1, { generales: true })
    await expect(db.query(`update public.autorizacion_datos_enlaces set casillas = '{"generales": true, "menores": true}' where id = $1`, [en.enlace_id])).rejects.toThrow(/evidencia/)
    await db.query(`update public.autorizacion_datos_enlaces set revocadas = '{"menores": {"at": "x"}}' where id = $1`, [en.enlace_id])
  })

  it('no se acepta sin la casilla general', async () => {
    const t = await publicar(1, 0)
    const en = await enlace(C1, TOKEN)
    await expect(aceptar(en.enlace_id, t, 1, { generales: false, sensibles: true })).rejects.toThrow()
  })

  it('la vía evidencia exige archivo y quién la registró, y cuenta como vigente', async () => {
    const t = await publicar(1, 0)
    const base = `insert into public.autorizacion_datos_enlaces (workspace_id, contacto_id, token, expira_at, via, aceptado_at, medio,
      texto_id, texto_version, texto_mayor, texto_menor, texto_sha256, casillas, evidencia_ref, registrado_por)
      values ($1, $2, $3, now(), 'evidencia', '2026-10-01', 'papel', $4, 'v1.0', 1, 0, repeat('e', 64), '{"generales": true}', $5, $6)`
    await db.exec(`insert into public.staff values ('00000000-0000-4000-8000-0000000000f1')`)
    await expect(db.query(base, [WS, C1, TOKEN, t, null, '00000000-0000-4000-8000-0000000000f1'])).rejects.toThrow()
    await db.query(base, [WS, C1, TOKEN, t, 'one://ve-documentos/x.pdf', '00000000-0000-4000-8000-0000000000f1'])
    const e = await estado(C1)
    expect(e.vigente.generales).toBe(true)
  })

  it('el texto tiene que traer la casilla general', async () => {
    await expect(db.query(
      `insert into public.autorizacion_datos_textos (workspace_id, version, mayor, titulo, cuerpo_md, casillas) values ($1, 'x', 1, 't', 'c', '[{"clave":"sensibles","texto":"s"}]')`, [WS],
    )).rejects.toThrow()
  })
})
