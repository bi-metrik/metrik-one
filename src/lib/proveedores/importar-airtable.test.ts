import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

import { claveDeFoto } from '@/lib/fotos/clave'
import { consultaConocidos, lit, prepararImportacion, sqlDeImportacion, type ConocidoImportacion, type FilaAirtable } from './importar-airtable'

/**
 * El importador de Airtable con un fixture SINTÉTICO (nombres, correos y números inventados): ocho
 * filas que cubren los casos de la base real sin copiar ningún dato de ella.
 */
const FILAS: FilaAirtable[] = [
  {
    id: 'recSINT001',
    creado: '2025-03-01T10:00:00.000Z',
    'Nombre proveedor': 'Hotel Brisas Inventadas',
    'Ubicación': 'Cartagena, CO',
    'Website': 'brisasinventadas.example',
    'Tipo Proveedor': ['Hotel'],
    'Notas/Observaciones': '**Cupo** limitado en temporada alta',
    'Celular/Whatsapp': '300 123 4567',
    'Correo contacto/Reserva': 'reservas@brisasinventadas.example',
    'Persona Contacto': 'Ana Ficticia',
    'Portafolio/Tarifas Vigentes': [{ filename: 'Tarifas 2025.pdf', url: 'https://dl.airtable.example/x', size: 120345, type: 'application/pdf' }],
    'Dirección/Ubicación': 'Calle Falsa 123',
    'Telefono': '(605) 555 0101',
    'Categoria/Servicio': 4,
    'Documentos/Certificaciones': [{ filename: 'RNT.pdf', url: 'https://dl.airtable.example/y', size: 999, type: 'application/pdf' }],
    'Tarifas Mayorista': false,
    'Segmentos/Perfiles': ['Familias', 'Luna de Miel'],
  },
  // Sin tipo en el snapshot: «Decameron» es hotel sin dudar. «PY» es Panamá.
  { id: 'recSINT002', 'Nombre proveedor': 'Decameron Isla Inventada', 'Ubicación': 'Panama, PY', 'Tipo Proveedor': null, 'Celular/Whatsapp': '+507 6123-4567' },
  // Sin tipo y sin nombre obvio: se infiere «lancha» pero va a revisión; correo basura.
  { id: 'recSINT003', 'Nombre proveedor': 'Lanchas El Pelícano Ficticio', 'Ubicación': 'Cartagena,CO', 'Tipo Proveedor': [], 'Correo contacto/Reserva': 'ver whatsapp' },
  {
    id: 'recSINT004',
    'Nombre proveedor': 'Mayorista Inventado Europa',
    'Ubicación': 'Madrid, ES',
    'Tipo Proveedor': ['Mayorista'],
    'Tarifas Mayorista': true,
    'Correo contacto/Reserva': 'uno@inventado.example; dos@inventado.example',
    'Portafolio/Tarifas Vigentes': [{ filename: 'Tarifario 2026-2027.pdf', size: 50000, type: 'application/pdf', url: 'https://dl.airtable.example/z' }],
  },
  { id: 'recSINT005', 'Nombre proveedor': 'Transportes Ruta Inventada', 'Ubicación': 'Cundinamarca,CO', 'Tipo Proveedor': ['Transporte terrestre'], 'Celular/Whatsapp': '3009876543.0' },
  // Mismas palabras que un hotel que el espacio ya tiene («Hotel Catalonia …»): se une con alias.
  { id: 'recSINT006', 'Nombre proveedor': 'Catalonia Puerta del Sol', 'Ubicación': 'Madrid, ES', 'Tipo Proveedor': ['Hotel'], 'Segmentos/Perfiles': ['Lujo'] },
  // Solo se parece a uno conocido: duda → revisión, NO se importa.
  { id: 'recSINT007', 'Nombre proveedor': 'Iberostar Selection Bávaro Suites', 'Ubicación': 'Punta Cana, RD', 'Tipo Proveedor': ['Hotel'] },
  // Sin nombre.
  { id: 'recSINT008', 'Nombre proveedor': '  ', 'Ubicación': 'Bogotá, CO' },
]

const CONOCIDOS: ConocidoImportacion[] = [
  { tipo: 'hotel', clave: claveDeFoto('hotel', 'Hotel Catalonia Puerta del Sol', 'Madrid'), clave_perfil: claveDeFoto('hotel', 'Hotel Catalonia Puerta del Sol', 'Madrid'), nombre: 'Hotel Catalonia Puerta del Sol', ciudad: 'Madrid' },
  { tipo: 'hotel', clave: claveDeFoto('hotel', 'Iberostar Selection Bávaro', 'Punta Cana'), clave_perfil: claveDeFoto('hotel', 'Iberostar Selection Bávaro', 'Punta Cana'), nombre: 'Iberostar Selection Bávaro', ciudad: 'Punta Cana' },
]

const porRec = (imp: ReturnType<typeof prepararImportacion>, rec: string) => imp.proveedores.find((p) => p.origenRef === rec)

describe('prepararImportacion', () => {
  const imp = prepararImportacion(FILAS, { conocidos: CONOCIDOS })

  it('normaliza la ficha: tipo, ubicación, celular E.164, correo, estrellas, etiquetas, tarifario inferido', () => {
    const h = porRec(imp, 'recSINT001')!
    expect(h).toMatchObject({
      tipoProveedor: 'hotel', espacio: 'hotel', ciudad: 'Cartagena', pais: 'CO', celular: '+573001234567', celularOriginal: '300 123 4567',
      correo: 'reservas@brisasinventadas.example', estrellas: 4, web: 'https://brisasinventadas.example', etiquetas: ['familias', 'luna de miel'],
      contacto: 'Ana Ficticia', direccion: 'Calle Falsa 123', telefono: '(605) 555 0101', tarifasMayorista: false, union: null,
    })
    expect(h.clave).toBe(claveDeFoto('hotel', 'Hotel Brisas Inventadas', 'Cartagena'))
    expect(h.tarifarios).toEqual([
      { nombreArchivo: 'Tarifas 2025.pdf', bytes: 120345, mime: 'application/pdf', desde: '2025-01-01', hasta: '2025-12-31', inferida: true, origenRef: 'recSINT001:Tarifas 2025.pdf' },
    ])
    expect(h.notas).toContain('Cupo')
    expect(h.notas).toContain('Documentos en Airtable (por subir): RNT.pdf')
    // La URL de Airtable vence: no se guarda en ninguna parte.
    expect(JSON.stringify(imp)).not.toContain('dl.airtable.example')
  })

  it('infiere el tipo del nombre solo cuando es obvio; PY es Panamá', () => {
    expect(porRec(imp, 'recSINT002')).toMatchObject({ tipoProveedor: 'hotel', pais: 'PA', celular: '+50761234567' })
    expect(imp.revision.some((r) => r.rec === 'recSINT002')).toBe(false)
    expect(porRec(imp, 'recSINT003')).toMatchObject({ tipoProveedor: 'lancha', espacio: 'actividad', correo: null })
    expect(imp.revision.filter((r) => r.rec === 'recSINT003').map((r) => r.motivo).join(' | ')).toMatch(/Sin tipo.*lancha.*\|.*Correo sin entender/)
  })

  it('mayorista: tarifas de mayorista, varios correos, vigencia de dos años, sin fotos', () => {
    expect(porRec(imp, 'recSINT004')).toMatchObject({ tipoProveedor: 'mayorista', espacio: 'proveedor', tarifasMayorista: true, correo: 'uno@inventado.example' })
    expect(porRec(imp, 'recSINT004')!.notas).toContain('Otros correos: dos@inventado.example')
    expect(porRec(imp, 'recSINT004')!.tarifarios[0]).toMatchObject({ desde: '2026-01-01', hasta: '2027-12-31', inferida: true })
    expect(porRec(imp, 'recSINT005')).toMatchObject({ tipoProveedor: 'transporte', ciudad: 'Cundinamarca', celular: '+573009876543' })
  })

  it('une con un hotel conocido de mismas palabras (con alias) y manda la duda a revisión sin importarla', () => {
    const c = porRec(imp, 'recSINT006')!
    expect(c.union).toBe('mismas palabras')
    expect(c.clave).toBe(CONOCIDOS[0].clave_perfil)
    expect(c.claveAlias).toBe(claveDeFoto('hotel', 'Catalonia Puerta del Sol', 'Madrid'))
    expect(porRec(imp, 'recSINT007')).toBeUndefined()
    const duda = imp.revision.find((r) => r.rec === 'recSINT007')!
    expect(duda.excluida).toBe(true)
    expect(duda.motivo).toContain('Iberostar Selection Bávaro')
    expect(imp.revision.find((r) => r.rec === 'recSINT008')).toMatchObject({ excluida: true, motivo: 'Sin «Nombre proveedor»' })
  })

  it('la decisión de una persona resuelve la duda; una fila repetida no entra dos veces', () => {
    const con = prepararImportacion(FILAS, { conocidos: CONOCIDOS, decisiones: { recSINT007: 'nuevo' } })
    expect(porRec(con, 'recSINT007')).toMatchObject({ union: null, claveAlias: null })
    const unir = prepararImportacion(FILAS, { conocidos: CONOCIDOS, decisiones: { recSINT007: CONOCIDOS[1].clave_perfil } })
    expect(porRec(unir, 'recSINT007')).toMatchObject({ union: 'decisión', clave: CONOCIDOS[1].clave_perfil })
    const doble = prepararImportacion([FILAS[0], { ...FILAS[0], id: 'recSINT099' }])
    expect(doble.proveedores).toHaveLength(1)
    expect(doble.revision[0]).toMatchObject({ rec: 'recSINT099', excluida: true })
  })

  it('el literal SQL dobla las comillas', () => {
    expect(lit("O'Hara")).toBe("'O''Hara'")
    expect(lit(null)).toBe('NULL')
  })
})

// ── El SQL, corrido de verdad sobre la migración ─────────────────────────────

const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const WS = '00000000-0000-4000-8000-0000000000c1'

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.workspaces (id uuid primary key, slug text);
    create table public.staff (id uuid primary key, workspace_id uuid, is_active boolean default true);
    create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    insert into public.workspaces values ('${WS}', 'agencia-sintetica');
  `)
  for (const m of [
    '20261014221500_fotos_catalogo.sql',
    '20261016153000_fotos_catalogo_tres_por_elemento.sql',
    '20261016221500_fotos_catalogo_categoria.sql',
    '20261016233000_fotos_catalogo_autorizacion.sql',
    '20261017090000_fotos_perfiles.sql',
    '20261018150000_proveedores.sql',
  ]) await db.exec(migracion(m))
  // El hotel que el espacio ya tenía (de una cotización), con un contacto escrito a mano.
  await db.exec(`insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad, contacto_nombre) values ('${WS}', 'hotel', '${CONOCIDOS[0].clave}', 'Hotel Catalonia Puerta del Sol', 'Madrid', 'Escrito a mano')`)
}, 60_000)
afterAll(async () => db.close())

describe('sqlDeImportacion', () => {
  it('crea, une sin pisar, guarda el alias y los tarifarios; correrlo dos veces deja lo mismo', async () => {
    const imp = prepararImportacion(FILAS, { conocidos: CONOCIDOS })
    const sql = sqlDeImportacion(imp, 'agencia-sintetica')
    expect(sql).toContain('[NO SE IMPORTA] recSINT007')
    await db.exec(sql)
    const contar = async () => ({
      perfiles: (await db.query<{ n: number }>('select count(*)::int as n from public.fotos_perfiles')).rows[0].n,
      alias: (await db.query<{ n: number }>('select count(*)::int as n from public.fotos_perfiles_alias')).rows[0].n,
      tarifarios: (await db.query<{ n: number }>('select count(*)::int as n from public.proveedor_tarifarios')).rows[0].n,
    })
    // 1 de antes + 5 nuevas (001-005); la 006 se une; 007 y 008 no entran.
    expect(await contar()).toEqual({ perfiles: 6, alias: 1, tarifarios: 2 })
    const catalonia = (await db.query<{ contacto_nombre: string; origen: string; origen_ref: string; etiquetas: string[] }>(`select contacto_nombre, origen, origen_ref, etiquetas from public.fotos_perfiles where clave = '${CONOCIDOS[0].clave}'`)).rows[0]
    expect(catalonia).toEqual({ contacto_nombre: 'Escrito a mano', origen: 'cotizacion', origen_ref: 'recSINT006', etiquetas: ['lujo'] })
    const brisas = (await db.query<{ tipo_proveedor: string; origen: string; vigencia_inferida: boolean; hasta: string }>(
      `select p.tipo_proveedor, p.origen, t.vigencia_inferida, t.vigente_hasta::text as hasta from public.fotos_perfiles p join public.proveedor_tarifarios t on t.proveedor_id = p.id where p.origen_ref = 'recSINT001'`,
    )).rows[0]
    expect(brisas).toEqual({ tipo_proveedor: 'hotel', origen: 'importacion', vigencia_inferida: true, hasta: '2025-12-31' })
    await db.exec(sql)
    expect(await contar()).toEqual({ perfiles: 6, alias: 1, tarifarios: 2 })
  })

  it('un nombre con la etiqueta del bloque no corta el SQL', async () => {
    const imp = prepararImportacion([{ id: 'recSINT050', 'Nombre proveedor': "Hotel $importar$ O'Raro", 'Ubicación': 'Cali, CO' }])
    const sql = sqlDeImportacion(imp, WS)
    expect(sql).toContain('DO $importar1$')
    await db.exec(sql)
    expect((await db.query(`select 1 from public.fotos_perfiles where origen_ref = 'recSINT050'`)).rows).toHaveLength(1)
  })

  it('la consulta de conocidos corre y devuelve lo que el importador entiende', async () => {
    const r = await db.query<{ coalesce: ConocidoImportacion[] }>(consultaConocidos('agencia-sintetica'))
    const conocidos = r.rows[0].coalesce
    expect(conocidos.find((c) => c.origen_ref === 'recSINT001')?.tipo).toBe('hotel')
    // Reimportar con lo conocido: todo lo importado se une por origen_ref. La 007 (cuyo parecido,
    // el Iberostar, no está en esta base) sería la única nueva.
    const otra = prepararImportacion(FILAS, { conocidos })
    expect(otra.proveedores.filter((p) => p.union !== 'origen_ref').map((p) => [p.origenRef, p.union])).toEqual([['recSINT007', null]])
  })
})
