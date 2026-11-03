import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fichaValida, huellaDe } from '../../reglamento'
import { CONFIG_POR_DEFECTO } from '../../config'
import { HERRAMIENTAS_VENTAS, sistemaPublico } from '../prompt'
import { leerConfigPublico } from '../config'
import { PRODUCTOS_PRUEBA } from '../arnes/conjuntos-ventas'
import { buscarProductos, fichaDe, numeroDeCodigo, productoParaModelo, productoPorCodigo, tablaFlete, totalPedido, zonaFlete } from './catalogo-ventas'
import { productosDeFilas } from './produccion-ventas'
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro'
import { semillaSqlDimpro } from './semilla-sql-dimpro'
import { PGlite } from '@electric-sql/pglite'

const reglamento = async () => ({ id: 'r', version: 1, huella: await huellaDe(REGLAMENTO_DIMPRO), fichas: REGLAMENTO_DIMPRO })

describe('catálogo de ventas', () => {
  it('busca por código, por SKU y por texto libre', () => {
    expect(numeroDeCodigo('quiero el mp 02')).toBe(2)
    expect(buscarProductos(PRODUCTOS_PRUEBA, { codigo: 'MP-2' }).map((p) => p.codigo)).toEqual(['MP-02'])
    expect(buscarProductos(PRODUCTOS_PRUEBA, { buscar: 'ej-tal650' }).map((p) => p.codigo)).toEqual(['MP-01'])
    expect(buscarProductos(PRODUCTOS_PRUEBA, { buscar: '¿tienen taladros?' }).map((p) => p.codigo)).toEqual(['MP-01'])
    expect(buscarProductos(PRODUCTOS_PRUEBA, { buscar: 'bomba 1 HP' }).map((p) => p.codigo)).toEqual(['MP-02'])
    expect(buscarProductos(PRODUCTOS_PRUEBA, { buscar: 'pulidora' })).toEqual([])
    // Un código que no existe no cae en una búsqueda aproximada.
    expect(buscarProductos(PRODUCTOS_PRUEBA, { codigo: 'MP-99' })).toEqual([])
    expect(productoPorCodigo(PRODUCTOS_PRUEBA, 'taladro')).toBeNull()
    expect(productoPorCodigo(PRODUCTOS_PRUEBA, 'MP-01')?.precio).toBe(250000)
  })

  it('la ficha se parte en verificado y del fabricante; lo incompleto no entra', () => {
    expect(fichaDe([{ etiqueta: 'Potencia', valor: '650 W', verificado: true }, { etiqueta: 'Peso', valor: '' }, { etiqueta: 'Rpm', valor: 3000, verificado: 'si' }]))
      .toEqual([{ etiqueta: 'Potencia', valor: '650 W', verificado: true }, { etiqueta: 'Rpm', valor: '3000', verificado: false }])
    const m = productoParaModelo(PRODUCTOS_PRUEBA[0])
    expect(m.precio).toBe('$250.000')
    expect(m.especificaciones_verificadas).toEqual(['Potencia: 650 W'])
    expect(m.segun_catalogo_del_fabricante).toEqual(['Velocidad: 3000 rpm'])
  })

  it('las filas del select: solo con producto y precio, ordenadas por código', () => {
    const ps = productosDeFilas([
      { id: 'b', codigo: 'MP-10', titulo: 'B', precio: '120000', etiquetas: [], producto: { sku: 'S2', nombre: 'B', ficha: [] } },
      { id: 'a', codigo: 'MP-2', titulo: 'A', precio: 50000, etiquetas: ['x'], producto: [{ sku: 'S1', nombre: 'A', ficha: [] }] },
      { id: 'c', codigo: 'MP-3', titulo: 'C', precio: null, producto: { sku: 'S3', nombre: 'C' } },
    ])
    expect(ps.map((p) => [p.codigo, p.precio])).toEqual([['MP-2', 50000], ['MP-10', 120000]])
  })

  it('tabla de flete del reglamento y total armado por el código', async () => {
    const t = tablaFlete(await reglamento())
    expect(zonaFlete(t, 'Bogotá')?.flete).toBe(15000)
    expect(zonaFlete(t, 'recoger')?.ruta).toBe('recoge')
    expect(zonaFlete(t, 'Medellín')).toBeNull()
    expect(totalPedido(250000, 2, 15000)).toBe(515000)
    expect(tablaFlete({ id: 'x', version: 1, huella: 'h', fichas: [] }).zonas).toEqual([])
  })
})

describe('configuración y reglamento de Dimpro', () => {
  it('dominio ventas solo con el valor literal', () => {
    expect(leerConfigPublico({ chatwoot: { dominio: 'ventas' } }).dominio).toBe('ventas')
    expect(leerConfigPublico({ chatwoot: { dominio: 'VENTAS' } }).dominio).toBe('experiencias')
    expect(leerConfigPublico({}).dominio).toBe('experiencias')
  })

  it('fichas válidas; el prompt de ventas no trae catálogo, flete ni respuestas fijas', async () => {
    expect(REGLAMENTO_DIMPRO.map(fichaValida).every(Boolean)).toBe(true)
    const sis = sistemaPublico(await reglamento(), CONFIG_POR_DEFECTO, { herramientas: HERRAMIENTAS_VENTAS })
    expect(sis).toContain('acción compra')
    expect(sis).toContain('por Messenger, en')
    expect(sis).not.toContain('ver_funciones')
    expect(sis).not.toContain('15000')
    expect(sis).not.toContain('Este es tu link de pago')
  })

  it('el SQL de configuración: se niega sin un link https de términos; con el publicado deja dimpro en ventas, Messenger, apagado y sin pisar lo demás', async () => {
    const sql = readFileSync(join(process.cwd(), 'sql/dimpro/2026-10-29_config-asistente-ventas.sql'), 'utf8')
    const db = new PGlite()
    await db.exec(`create table public.workspaces (id uuid primary key, slug text, config_extra jsonb);
      insert into public.workspaces values ('67f7af44-b5ac-4d5c-aa9e-44954368447c', 'dimpro', '{"bot_conversacional": {"activo": true, "chatwoot": {"rafaga_ms": 3000}}, "otra": 1}');`)
    await expect(db.exec(sql.replace("'https://dimpro.com.co/terminos/'", "'<sin link>'"))).rejects.toThrow(/términos/)
    await db.exec(sql)
    const r = await db.query<{ c: Record<string, unknown> }>(`select config_extra as c from public.workspaces`)
    const c = r.rows[0].c as { otra: number; bot_conversacional: Record<string, unknown> }
    expect(c.otra).toBe(1)
    expect(c.bot_conversacional.activo).toBe(true)
    const cfg = leerConfigPublico(c.bot_conversacional)
    expect(cfg).toMatchObject({ activo: false, dominio: 'ventas', cuentaId: 189134, rafagaMs: 3000, terminosUrl: 'https://dimpro.com.co/terminos/', inboxes: [{ id: 151556, canal: 'otro', anuncio7Dias: false }] })
    await db.close()
  }, 30_000)

  it('la semilla SQL es exactamente la salida del generador y solo corre en dimpro', () => {
    const archivo = readFileSync(join(process.cwd(), 'sql/dimpro/2026-10-29_reglamento-asistente-ventas-ENSAYO.sql'), 'utf8')
    expect(archivo.trimEnd()).toBe(semillaSqlDimpro().trimEnd())
    expect(archivo).toContain("where id = v_ws and slug = 'dimpro'")
  })
})
