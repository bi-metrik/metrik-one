import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { datosDePropuesta } from '../../nucleo'
import { pidioTrasTope, esTituloDelSi } from '../cola'
import type { TrazaPublica } from '../tipos'
import { partirSugerencias, planDeEnvios, separarCierre } from './partir-ventas'
import type { FotoDelTurno } from './fotos-ventas'
import { direccionNoEscrita, piezasDireccion } from './direccion-ventas'
import { complementosDe, fichaComplementos, mapaComplementos } from './complementos-ventas'
import type { ProductoVenta } from './catalogo-ventas'
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro'
import { CLAVES_RONDA_3, TEXTOS_RONDA_3, WORKSPACE_DIMPRO, actualizacionSqlDimpro, complementosSqlDimpro, semillaSqlDimpro } from './semilla-sql-dimpro'

/** Ronda 3 del asistente de ventas de Dimpro (Mauricio, Messenger, 30-oct). Datos inventados salvo el texto del bot. */

// El mensaje real del 30-oct (08:26), un solo párrafo.
const REAL = 'Para la casa te sugiero estos: MP-38 Taladro Ferton TLJ513 de 13 mm, 550 W, $124.900. Es de mano y sirve para uso general. MP-17 Taladro percutor inalámbrico Dongcheng 20V 50 Nm, $324.900. Es inalámbrico, con batería de 2.0Ah y cargador. MP-15 Rotomartillo Dongcheng SDS-Plus 26 mm, $344.900. Es para perforar concreto, más pesado que un taladro de casa. ¿Qué vas a perforar en casa: madera, pared o metal?'
const foto = (codigo: string): FotoDelTurno => ({ codigo, url: `https://x/${codigo}.jpg`, texto: `${codigo} · nombre largo` })
const forma = (es: ReturnType<typeof planDeEnvios>) => es.map((e) => (e.tipo === 'texto' ? `T:${e.texto.slice(0, 12)}` : `F:${e.foto.codigo}${e.pie ? '+pie' : ''}`))

describe('partir la respuesta por producto', () => {
  it('el párrafo real: entrada, un bloque por producto en su orden, la pregunta aparte', () => {
    const p = partirSugerencias(REAL)!
    expect(p.entrada).toBe('Para la casa te sugiero estos:')
    expect(p.productos.map((x) => x.codigo)).toEqual(['MP-38', 'MP-17', 'MP-15'])
    expect(p.productos[0].texto).toBe('MP-38 Taladro Ferton TLJ513 de 13 mm, 550 W, $124.900. Es de mano y sirve para uso general.')
    expect(p.productos[2].texto).toBe('MP-15 Rotomartillo Dongcheng SDS-Plus 26 mm, $344.900. Es para perforar concreto, más pesado que un taladro de casa.')
    expect(p.cierre).toBe('¿Qué vas a perforar en casa: madera, pared o metal?')
    // Nada se pierde: lo partido vuelve a ser el texto.
    expect([p.entrada, ...p.productos.map((x) => x.texto), p.cierre].join(' ')).toBe(REAL)
  })

  it('una línea por producto, con viñetas o numeración', () => {
    for (const v of ['', '- ', '• ', '1. ', '* ']) {
      const t = `Te sirven estos:\n${v}MP-13 Magnético 28 mm, $1.900.000.\n${v.replace('1', '2')}MP-14 Magnético 40 mm, $2.300.000.\n¿Cuál te sirve más?`
      const p = partirSugerencias(t)!
      expect(p.productos.map((x) => x.texto)).toEqual(['MP-13 Magnético 28 mm, $1.900.000.', 'MP-14 Magnético 40 mm, $2.300.000.'])
      expect(p.cierre).toBe('¿Cuál te sirve más?')
    }
  })

  it('no se deja partir cuando el texto mezcla productos', () => {
    expect(partirSugerencias('El MP-17 es mejor que el MP-38 para la casa.')).toBeNull()
    expect(partirSugerencias('Te sirven el MP-13 y el MP-14. ¿Cuál?')).toBeNull()
    expect(partirSugerencias('MP-13 es de 28 mm. MP-14 es más grande que el MP-13.')).toBeNull()
    expect(partirSugerencias('Hola, ¿qué buscas?')).toBeNull()
  })

  it('un solo producto: todo el texto es suyo, menos la pregunta', () => {
    expect(partirSugerencias('Claro, aquí está el MP-13.')).toEqual({ entrada: null, productos: [{ codigo: 'MP-13', texto: 'Claro, aquí está el MP-13.' }], cierre: null })
    expect(partirSugerencias('El MP-13 vale $1.900.000. ¿Te sirve?')!.cierre).toBe('¿Te sirve?')
    // La pregunta con código se queda en el texto.
    expect(partirSugerencias('Tengo el MP-13 a $1.900.000. ¿Te sirve el MP-13?')!.cierre).toBeNull()
    expect(separarCierre('Sin pregunta.')).toEqual({ cuerpo: 'Sin pregunta.', cierre: null })
  })
})

describe('el plan de envíos', () => {
  it('varios con fotos y uno sin foto en medio: texto→foto por producto, sin pie; la pregunta al final', () => {
    expect(forma(planDeEnvios(REAL, [foto('MP-17'), foto('MP-15')]))).toEqual([
      'T:Para la casa', 'T:MP-38 Taladr', 'T:MP-17 Taladr', 'F:MP-17', 'T:MP-15 Rotoma', 'F:MP-15', 'T:¿Qué vas a p',
    ])
  })

  it('el modelo no respeta el formato: el texto entero y las fotos con su pie (como antes)', () => {
    expect(forma(planDeEnvios('El MP-17 es mejor que el MP-15 para la casa.', [foto('MP-17'), foto('MP-15')]))).toEqual(['T:El MP-17 es ', 'F:MP-17+pie', 'F:MP-15+pie'])
  })

  it('un solo producto: su texto, su foto y la pregunta', () => {
    expect(forma(planDeEnvios('El MP-13 vale $1.900.000. ¿Te sirve?', [foto('MP-13')]))).toEqual(['T:El MP-13 val', 'F:MP-13', 'T:¿Te sirve?'])
    // Sin foto, un solo mensaje igual al del modelo.
    expect(planDeEnvios('El MP-12 vale $125.000. ¿Te sirve?', [])).toEqual([{ tipo: 'texto', texto: 'El MP-12 vale $125.000. ¿Te sirve?' }])
  })

  it('varios sin fotos: un solo mensaje, un producto por línea', () => {
    expect(planDeEnvios(REAL, [])).toEqual([{ tipo: 'texto', texto: [
      'Para la casa te sugiero estos:',
      'MP-38 Taladro Ferton TLJ513 de 13 mm, 550 W, $124.900. Es de mano y sirve para uso general.',
      'MP-17 Taladro percutor inalámbrico Dongcheng 20V 50 Nm, $324.900. Es inalámbrico, con batería de 2.0Ah y cargador.',
      'MP-15 Rotomartillo Dongcheng SDS-Plus 26 mm, $344.900. Es para perforar concreto, más pesado que un taladro de casa.',
      '¿Qué vas a perforar en casa: madera, pared o metal?',
    ].join('\n') }])
  })
})

describe('la dirección del pedido', () => {
  const CLIENTE = 'Ana Pérez\n3001234567\nCl 31 B bis # 98 12\nSanta Lucía, Kennedy.\nCerca a la iglesia Santa Lucía.'
  it('lo que el modelo agrega (Bogotá, barrio, cerca, la) y las abreviaturas no cuentan en contra', () => {
    expect(direccionNoEscrita('Cl 31 B bis # 98 12, Bogota', CLIENTE)).toEqual([])
    expect(direccionNoEscrita('Calle 31B bis No. 98-12, barrio Santa Lucía, Kennedy, cerca a la iglesia Santa Lucía, Bogotá', CLIENTE)).toEqual([])
    expect(direccionNoEscrita('Carrera 7 # 45-10 apartamento 301, Bogotá D.C.', 'Cra 7 # 45-10 apto 301')).toEqual([])
  })
  it('lo que el cliente no escribió sí cuenta: otro número, otra letra, otro barrio, «por confirmar»', () => {
    expect(direccionNoEscrita('Cl 31 B bis # 98 13', CLIENTE)).toEqual(['13'])
    expect(direccionNoEscrita('Cl 31 C bis # 98 12', CLIENTE)).toEqual(['31c'])
    expect(direccionNoEscrita('Cl 31 B bis # 98 12, barrio Castilla', CLIENTE)).toEqual(['castilla'])
    expect(direccionNoEscrita('Cl 31 B bis # 98 12, Bogotá (barrio y referencia por confirmar)', CLIENTE)).toEqual(['confirmar'])
    expect(direccionNoEscrita('Barrio Santa Lucía', CLIENTE)).toEqual(['(sin número de calle o carrera)'])
    // Lo dicho ANTES de autorizar no está en `tras`.
    expect(direccionNoEscrita('Cl 31 B bis # 98 12', 'Ana Pérez 3001234567')).not.toEqual([])
  })
  it('las piezas: «24 A» es «24a»', () => {
    expect(piezasDireccion('Cl 24 A bis # 100 71')).toEqual({ palabras: ['calle', 'bis'], numeros: ['24a', '100', '71'] })
  })
})

describe('los datos de proponer', () => {
  it('objeto pasa; texto con un objeto JSON se lee; texto roto o vacío dice qué corregir', () => {
    expect(datosDePropuesta({ producto: 'MP-38' })).toEqual({ ok: true, datos: { producto: 'MP-38' } })
    expect(datosDePropuesta('{"producto":"MP-38"}')).toEqual({ ok: true, datos: { producto: 'MP-38' } })
    // El de la conversación 3 (comillas simples mezcladas).
    const roto = datosDePropuesta("{\"cantidad\":1,\"celular\":\"3001234567\",\"direccion\":\"Cl 1 # 2-3','entrega':'bogota'}")
    expect(roto.ok).toBe(false)
    if (!roto.ok) expect(roto.error).toMatch(/no es un objeto JSON válido/)
    expect(datosDePropuesta(undefined).ok).toBe(false)
    expect(datosDePropuesta([1]).ok).toBe(false)
  })
  it('tras el tope, la nota lleva lo último que se intentó proponer', () => {
    const t = { herramientas: [{ nombre: 'proponer', ok: false, args: { datos: { producto: 'MP-01', direccion: 'Cl 1 # 2-3' } }, error: 'No cuadra', ms: 1 }] } as unknown as TrazaPublica
    expect(pidioTrasTope(t)).toMatch(/no logré armar el pedido.*MP-01.*Cl 1 # 2-3.*No cuadra/)
    expect(pidioTrasTope({} as TrazaPublica)).toMatch(/no logró responder/)
  })
  it('el título del botón escrito', () => {
    expect(esTituloDelSi('  sí, ENVIAR link!', 'Sí, enviar link')).toBe(true)
    expect(esTituloDelSi('sí, enviar link ya', 'Sí, enviar link')).toBe(false)
  })
})

describe('venta cruzada: el mapa', () => {
  const p = (codigo: string): ProductoVenta => ({ publicacionId: codigo, codigo, sku: codigo, titulo: codigo, nombre: codigo, marca: null, categoria: null, etiquetas: [], precio: 1000, ficha: [], fotos: [] })
  const catalogo = [p('MP-38'), p('MP-30'), p('MP-40')]
  const mapa = mapaComplementos({ fichas: [fichaComplementos({ 'MP-38': [{ codigo: 'MP-99', razon: 'no publicado' }, { codigo: 'mp 30', razon: 'soporte' }, { codigo: 'MP-38', razon: 'él mismo' }, { codigo: 'MP-40', razon: 'caja' }, { codigo: 'MP-30', razon: 'repetido' }], 'X': [{ codigo: 'MP-1', razon: 'x' }] }, 'prueba')] })
  it('en orden, solo los publicados, sin él mismo ni repetidos, hasta 2', () => {
    expect(complementosDe(mapa, 'MP-38', catalogo).map((c) => [c.producto.codigo, c.razon])).toEqual([['MP-30', 'soporte'], ['MP-40', 'caja']])
    expect(complementosDe(mapa, 'MP-38', catalogo, 1).length).toBe(1)
    expect(complementosDe(mapa, 'MP-17', catalogo)).toEqual([])
    expect(mapaComplementos({ fichas: [] }).size).toBe(0)
  })
  it('el generador rechaza un mapa con entradas sin razón', () => {
    expect(() => complementosSqlDimpro({ 'MP-38': [{ codigo: 'MP-30', razon: '' }] }, 'x')).toThrow(/sin código o sin razón/)
    expect(complementosSqlDimpro({ 'MP-38': [{ codigo: 'MP-30', razon: 'soporte' }] }, 'x')).toMatch(/ventas\.complementos/)
  })
})

describe('SQL de la ronda 3 y del mapa (PGlite)', () => {
  let db: PGlite
  const ARCHIVO = 'sql/dimpro/2026-10-30_reglamento-ventas-ronda3.sql'
  const leer = (a: string) => readFileSync(join(process.cwd(), a), 'utf8')
  const versiones = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.bot_reglamentos where workspace_id = '${WORKSPACE_DIMPRO}'`)).rows[0].n
  const publicada = async () => new Map((await db.query<{ fichas: Array<{ clave: string; hacer: string; valores?: unknown }> }>(`select fichas from public.bot_reglamentos where workspace_id = '${WORKSPACE_DIMPRO}' order by version desc limit 1`)).rows[0].fichas.map((f) => [f.clave, f]))

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.workspaces (id uuid primary key, slug text, config_extra jsonb);
      insert into public.workspaces values ('${WORKSPACE_DIMPRO}', 'dimpro', '{}');
    `)
    await db.exec(leer('supabase/migrations/20261006213100_wa_conversacion.sql'))
    await db.exec(leer('supabase/migrations/20261006213200_bot_reglamento_y_uso.sql'))
    // Producción hoy (ronda 2 publicada): sin alc.complemento ni ventas.complementos.
    const antes = REGLAMENTO_DIMPRO.filter((f) => !['alc.complemento', 'ventas.complementos'].includes(f.clave))
      .map((f) => (CLAVES_RONDA_3.includes(f.clave) ? { ...f, hacer: `texto de la ronda 2 (${f.clave})` } : f))
    await db.exec(semillaSqlDimpro(antes))
  }, 30_000)
  afterAll(async () => { await db.close() })

  it('el archivo es la salida del generador', () => {
    expect(leer(ARCHIVO).trimEnd()).toBe(actualizacionSqlDimpro(CLAVES_RONDA_3, REGLAMENTO_DIMPRO, TEXTOS_RONDA_3).trimEnd())
  })

  it('publica una versión con las fichas de la ronda; la segunda corrida no; el mapa se carga aparte y la ronda no lo pisa', async () => {
    expect(await versiones()).toBe(1)
    await db.exec(leer(ARCHIVO))
    expect(await versiones()).toBe(2)
    const pub = await publicada()
    for (const c of CLAVES_RONDA_3) expect(pub.get(c)?.hacer).toBe(REGLAMENTO_DIMPRO.find((f) => f.clave === c)!.hacer)
    expect(pub.has('ventas.complementos')).toBe(false)
    await db.exec(leer(ARCHIVO))
    expect(await versiones()).toBe(2)
    // El mapa de ejemplo, por SQL de datos (sin redeploy).
    await db.exec(complementosSqlDimpro({ 'MP-38': [{ codigo: 'MP-30', razon: 'para usarlo fijo en el taller' }] }, 'mapa de ejemplo'))
    expect(await versiones()).toBe(3)
    expect((await publicada()).get('ventas.complementos')?.valores).toEqual({ mapa: { 'MP-38': [{ codigo: 'MP-30', razon: 'para usarlo fijo en el taller' }] } })
    await db.exec(leer(ARCHIVO))
    expect(await versiones()).toBe(3)
    expect((await publicada()).get('ventas.complementos')).toBeTruthy()
  })
})
