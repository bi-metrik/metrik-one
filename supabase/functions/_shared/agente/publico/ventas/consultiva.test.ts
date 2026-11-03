import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PRODUCTOS_CONSULTIVA } from '../arnes/conjuntos-ventas'
import { bajarFoto, mensajeroChatwootApi } from '../produccion'
import type { FilaPublica, LlaveConversacion } from '../tipos'
import { MAX_SUGERENCIAS, codigosEnTexto, fotosDe, hablaDePrecio, productoParaModelo, siguientePaso, sugerirProductos, tipoDe, urlFotoPermitida } from './catalogo-ventas'
import type { ProductoVenta } from './catalogo-ventas'
import { demasiadosProductos, fotosConsultadas, fotosDelTurno, pideVerFoto } from './fotos-ventas'
import { horasDePausa } from './dominio-ventas'
import { productosDeFilas } from './produccion-ventas'
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro'
import { CLAVES_RONDA_2, CLAVES_VENTA_CONSULTIVA, TEXTOS_RONDA_2, WORKSPACE_DIMPRO, actualizacionSqlDimpro, semillaSqlDimpro } from './semilla-sql-dimpro'

/**
 * Venta consultiva de Dimpro (Mauricio, 29-oct): «no vende; fotos y no tantas opciones; preguntar el tipo y sugerir 3».
 * Catálogo INVENTADO (`PRODUCTOS_CONSULTIVA`); las URLs de fotos son de un host de ejemplo.
 */

const HOST = 'ejemplo.supabase.co'
const URL_OK = `https://${HOST}/storage/v1/object/public/ferreteria-fotos/dimpro/X1/MP-01-X1-1.jpg`
const codigos = (r: ReturnType<typeof sugerirProductos>) => ('productos' in r ? r.productos.map((p) => p.codigo) : [])
const prod = (codigo: string, titulo: string, marca: string, etiquetas: string[], precio = 100000): ProductoVenta => ({
  publicacionId: codigo, codigo, sku: codigo, titulo, nombre: titulo, marca, categoria: 'Herramientas', etiquetas, precio, ficha: [], fotos: [],
})

describe('sugerencias: una pregunta de uso y máximo 3', () => {
  it('categoría amplia sin uso: no devuelve productos, pide preguntar con los tipos que hay', () => {
    const r = sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'quiero un taladro' })
    expect(r.tipo).toBe('preguntar')
    if (r.tipo !== 'preguntar') return
    expect(r.coincidencias).toBe(6)
    expect(r.tipos).toEqual(expect.arrayContaining(['Taladro percutor inalámbrico', 'Taladro', 'Taladro magnético', 'Rotomartillo']))
  })

  it('categoría con de mano y magnéticos: la pregunta parte por el tipo (una sola), y dice cuáles son especializados', () => {
    const r = sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro' })
    if (r.tipo !== 'preguntar') throw new Error(r.tipo)
    expect(r.pregunta).toBe('¿Lo buscas de mano o magnético, para perforar estructura metálica?')
    expect((r.pregunta!.match(/\?/g) ?? []).length).toBe(1)
    expect(r.especializados).toEqual(expect.arrayContaining([{ tipo: 'Taladro magnético', para: expect.stringContaining('estructura metálica') }, { tipo: 'Rotomartillo', para: expect.stringContaining('concreto') }]))
    // Sin especializados en lo que coincide, no hay pregunta hecha: el modelo pregunta el material.
    const sinMagneticos = PRODUCTOS_CONSULTIVA.filter((p) => !/magnético|Rotomartillo/.test(p.titulo))
    const r2 = sugerirProductos([...sinMagneticos, { ...sinMagneticos[0], codigo: 'MP-21', titulo: 'Taladro percutor MarcaEjemplo 18V' }, { ...sinMagneticos[0], codigo: 'MP-22', titulo: 'Taladro de cable MarcaEjemplo 600 W' }], { buscar: 'taladro' })
    expect(r2).toMatchObject({ tipo: 'preguntar', pregunta: null })
  })

  it('«metal, de cable»: ni magnéticos (no pidió estructura) ni rotomartillos (son para concreto) ni relleno', () => {
    // Messenger 29-oct: sugirió el de mano y dos magnéticos de $2,3 M. Ahora solo el de mano.
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso: 'metal, de cable' }))).toEqual(['MP-12'])
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso: 'metal, de cable, de mano' }))).toEqual(['MP-12'])
    // Si habla de estructura, vigas o broca anular, los magnéticos sí.
    for (const uso of ['estructura metálica', 'perforar vigas', 'con broca anular', 'acero grueso']) {
      expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso })).every((c) => ['MP-13', 'MP-14', 'MP-15'].includes(c))).toBe(true)
    }
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro magnético', uso: 'metal' }))).toEqual(['MP-13', 'MP-14', 'MP-15'])
    // Para madera: el de mano y el inalámbrico (no nombran otro material); el rotomartillo no.
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso: 'madera' }))).not.toContain('MP-16')
  })

  it('el catálogo real de Dimpro (fixture de títulos y etiquetas): «metal, de cable» = solo el MP-38; el soporte nunca de relleno', () => {
    const real = [
      prod('MP-15', 'Rotomartillo Dongcheng DZC05-26B SDS-Plus 26 mm reversible', 'Dongcheng', ['rotomartillo', 'taladro percutor', 'concreto', 'demolición']),
      prod('MP-17', 'Taladro percutor inalámbrico Dongcheng DCJZ2050i 20V 50 Nm con batería 2.0Ah', 'Dongcheng', []),
      prod('MP-18', 'Rotomartillo SDS-Plus Uyustools 26 mm 1050W 4,5 J', 'Uyustools', ['rotomartillo', 'taladro percutor', 'perforar concreto', 'obra']),
      prod('MP-30', 'Soporte para taladro Ferton ST6109 de 510 mm con base de hierro fundido', 'Ferton', ['soporte para taladro', 'carpintería', 'taller']),
      prod('MP-38', 'Taladro Ferton TLJ513 de 13 mm 550 W, 0 a 2.800 rpm', 'Ferton', []),
      prod('MP-44', 'Taladro magnético Ferton de 40 mm 1200W con mandril y broca anular', 'Ferton', ['taladro magnético', 'broca anular', 'metalmecánica', 'estructuras metálicas']),
      prod('MP-45', 'Taladro magnético Ferton TLM828 de 28 mm velocidad variable 110V', 'Ferton', ['taladro magnético', 'metalmecánica', 'estructuras metálicas']),
      prod('MP-46', 'Taladro magnético Ferton TLM930 de 28 mm 110 V con mandril', 'Ferton', ['taladro magnético', 'metalmecánica']),
      prod('MP-51', 'Taladro magnético Ferton TLM925 110V 300 rpm con mandril', 'Ferton', ['taladro magnético', 'metalmecánica']),
    ]
    expect(codigos(sugerirProductos(real, { buscar: 'taladro', uso: 'metal, de cable' }))).toEqual(['MP-38'])
    // Mauricio 30-oct: el rotomartillo solo si habla de concreto u obra (para la casa lo sugería).
    expect(codigos(sugerirProductos(real, { buscar: 'taladro', uso: 'de mano' }))).toEqual(['MP-17', 'MP-38'])
    expect(codigos(sugerirProductos(real, { buscar: 'taladro', uso: 'hogar' }))).toEqual(['MP-17', 'MP-38'])
    expect(codigos(sugerirProductos(real, { buscar: 'taladro', uso: 'concreto' }))).toEqual(['MP-15', 'MP-18'])
    expect(codigos(sugerirProductos(real, { buscar: 'taladro', uso: 'estructura metálica' }))[0]).toBe('MP-44')
    const p = sugerirProductos(real, { buscar: 'taladro' })
    expect(p).toMatchObject({ tipo: 'preguntar', pregunta: '¿Lo buscas de mano o magnético, para perforar estructura metálica?', accesorios: ['Soporte para taladro'] })
  })

  it('con uso: «de cable» saca lo inalámbrico; dos por tipo salvo el tipo que nombró entero', () => {
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso: 'inalámbrico' }))).toEqual(['MP-11'])
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso: 'concreto' }))[0]).toBe('MP-16')
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro magnético', uso: 'estructura' }))).toEqual(['MP-13', 'MP-14', 'MP-15'])
    for (const uso of ['hogar', 'obra', 'metal', 'madera', 'xyz']) {
      expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'taladro', uso })).length).toBeLessThanOrEqual(MAX_SUGERENCIAS)
    }
  })

  it('pocos resultados salen directo; código exacto, ese; código que no existe, nada', () => {
    expect(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'pulidora' })).toMatchObject({ tipo: 'sugerir', coincidencias: 1 })
    expect(codigos(sugerirProductos(PRODUCTOS_CONSULTIVA, { codigo: 'mp 13' }))).toEqual(['MP-13'])
    expect(sugerirProductos(PRODUCTOS_CONSULTIVA, { codigo: 'MP-99' })).toEqual({ tipo: 'codigo', productos: [] })
    expect(sugerirProductos(PRODUCTOS_CONSULTIVA, { buscar: 'MP-99' })).toEqual({ tipo: 'codigo', productos: [] })
  })

  it('el tipo es el título hasta la marca', () => {
    expect(tipoDe(PRODUCTOS_CONSULTIVA[2])).toBe('Taladro magnético')
    expect(tipoDe({ ...PRODUCTOS_CONSULTIVA[0], titulo: 'Torquímetro de 1/2" de 250 lb-pie', marca: null })).toBe('Torquímetro de 1/2"')
  })

  it('la guarda del texto: más de 3 códigos no sale', () => {
    expect(codigosEnTexto('MP-13, mp 14, MP14 y MP-015')).toEqual(['MP-13', 'MP-14', 'MP-15'])
    expect(demasiadosProductos('MP-13, MP-14 y MP-15')).toEqual([])
    expect(demasiadosProductos('MP-13, MP-14, MP-15 y MP-16')[0]).toMatch(/nombraste 4 productos/)
  })

  it('el modelo sabe si hay foto, nunca la URL', () => {
    const m = productoParaModelo(PRODUCTOS_CONSULTIVA[0])
    expect(m.tiene_foto).toBe(true)
    expect(JSON.stringify(m)).not.toContain('http')
    expect(productoParaModelo(PRODUCTOS_CONSULTIVA[1]).tiene_foto).toBe(false)
  })
})

describe('preguntas primero (Mauricio, 30-oct): cable o inalámbrico, presupuesto, y uno o dos', () => {
  const real = [
    prod('MP-15', 'Rotomartillo Dongcheng DZC05-26B SDS-Plus 26 mm reversible', 'Dongcheng', ['rotomartillo', 'concreto'], 344900),
    prod('MP-17', 'Taladro percutor inalámbrico Dongcheng DCJZ2050i 20V 50 Nm con batería 2.0Ah', 'Dongcheng', [], 324900),
    prod('MP-38', 'Taladro Ferton TLJ513 de 13 mm 550 W, 0 a 2.800 rpm', 'Ferton', [], 124900),
  ]
  const candidatos = (uso: string) => {
    const r = sugerirProductos(real, { buscar: 'taladro', uso })
    if (r.tipo !== 'sugerir') throw new Error(r.tipo)
    return r.candidatos ?? []
  }
  const cods = (p: ReturnType<typeof siguientePaso>) => (p.tipo === 'recomendar' ? p.productos.map((x) => x.codigo) : [])

  it('«para la casa, económico»: primero cable o inalámbrico, con desde cuánto arranca cada uno; nada de productos', () => {
    const p = siguientePaso(candidatos('hogar, económico'), 'taladro hogar, económico', {})
    expect(p).toMatchObject({ tipo: 'preguntar', falta: 'energia', desde: { cable: 124900, inalambrico: 324900 } })
  })

  it('después, si habló de precio, el presupuesto; con el tope, el que cabe', () => {
    const c = candidatos('hogar, económico')
    // Con cable solo queda el MP-38: no hay nada que separar, se recomienda.
    expect(cods(siguientePaso(c, 'hogar, económico', { energia: 'cable' }))).toEqual(['MP-38'])
    // Le da igual: el presupuesto, que es lo que separa.
    expect(siguientePaso(c, 'hogar, económico', { energia: 'cualquiera' })).toMatchObject({ tipo: 'preguntar', falta: 'presupuesto' })
    expect(cods(siguientePaso(c, 'hogar, económico', { energia: 'cualquiera', presupuesto: 200000 }))).toEqual(['MP-38'])
    // Sin tope y económico: el más barato primero, dos como mucho.
    expect(cods(siguientePaso(c, 'hogar, económico', { energia: 'cualquiera', presupuesto: 0 }))).toEqual(['MP-38', 'MP-17'])
  })

  it('nada cabe en el tope: el más cercano, con la diferencia (para explicar por qué vale la pena)', () => {
    const p = siguientePaso(candidatos('hogar'), 'hogar', { energia: 'inalambrico', presupuesto: 200000 })
    expect(p).toMatchObject({ tipo: 'recomendar', fueraDePresupuesto: { tope: 200000, diferencia: 124900 } })
    expect(cods(p)).toEqual(['MP-17'])
  })

  it('una pregunta ya hecha en el tramo no se repite: se sigue sin la respuesta', () => {
    const c = candidatos('hogar, económico')
    expect(siguientePaso(c, 'hogar, económico', {}, ['energia'])).toMatchObject({ tipo: 'preguntar', falta: 'presupuesto' })
    expect(siguientePaso(c, 'hogar, económico', {}, ['energia', 'presupuesto']).tipo).toBe('recomendar')
  })

  it('el uso con «inalámbrico» ya contesta la primera; para la casa el rotomartillo no sale', () => {
    expect(candidatos('hogar').map((p) => p.codigo)).not.toContain('MP-15')
    expect(cods(siguientePaso(candidatos('hogar, inalámbrico'), 'hogar, inalámbrico', {}))).toEqual(['MP-17'])
    expect(hablaDePrecio('algo barato')).toBe(true)
    expect(hablaDePrecio('para metal')).toBe(false)
  })
})

describe('fotos: lista blanca y cuáles salen', () => {
  it('solo https, el host del proyecto y el bucket ferreteria-fotos', () => {
    expect(urlFotoPermitida(URL_OK, HOST)).toBe(true)
    expect(urlFotoPermitida(URL_OK, null)).toBe(false)
    expect(urlFotoPermitida(URL_OK.replace('https:', 'http:'), HOST)).toBe(false)
    expect(urlFotoPermitida(URL_OK.replace(HOST, 'otro.supabase.co'), HOST)).toBe(false)
    expect(urlFotoPermitida(URL_OK.replace('ferreteria-fotos', 'soportes'), HOST)).toBe(false)
    expect(urlFotoPermitida(`https://${HOST}/storage/v1/object/public/ferreteria-fotos/../soportes/x.jpg`, HOST)).toBe(false)
    expect(urlFotoPermitida(`https://u:p@${HOST}/storage/v1/object/public/ferreteria-fotos/x.jpg`, HOST)).toBe(false)
    expect(fotosDe([URL_OK, 'https://evil.example/x.jpg', 7, null], HOST)).toEqual([URL_OK])
  })

  it('las filas del catálogo traen las fotos filtradas', () => {
    const ps = productosDeFilas([{ id: 'a', codigo: 'MP-1', titulo: 'A', precio: 1000, producto: { sku: 'S', nombre: 'A', ficha: [], fotos: [URL_OK, 'https://evil.example/x.jpg'] } }], HOST)
    expect(ps[0].fotos).toEqual([URL_OK])
    expect(productosDeFilas([{ id: 'a', codigo: 'MP-1', titulo: 'A', precio: 1000, producto: { sku: 'S', nombre: 'A', fotos: [URL_OK] } }])[0].fotos).toEqual([])
  })

  const leido = (cods: string[]) => [{ nombre: 'ver_catalogo', args: {}, ok: true, datos: { productos: cods.map((codigo) => ({ codigo })) }, ms: 1 }]
  const fila = (fotos: Array<{ codigo: string; ok: boolean }>) => ({ traza: { tipo: 'modelo', fotos } }) as unknown as FilaPublica

  it('una foto por producto nombrado y leído en el turno, en orden, máximo 3', () => {
    const f = fotosDelTurno({ texto: 'MP-14, MP-13, MP-12, MP-11 y MP-15', herramientas: leido(['MP-11', 'MP-12', 'MP-13', 'MP-14']), catalogo: PRODUCTOS_CONSULTIVA, filas: [], pedido: 'taladro' })
    // MP-12 no tiene foto; MP-15 no se leyó en el turno; tope de 3.
    expect(f.map((x) => x.codigo)).toEqual(['MP-14', 'MP-13', 'MP-11'])
    expect(f[0].texto).toBe('MP-14 · Taladro magnético MarcaEjemplo de 40 mm 1200W')
    expect(fotosDelTurno({ texto: 'MP-13', herramientas: [], catalogo: PRODUCTOS_CONSULTIVA, filas: [], pedido: '' })).toEqual([])
  })

  it('no repite la foto en la conversación, salvo que el cliente pida verla', () => {
    const filas = [fila([{ codigo: 'MP-13', ok: true }, { codigo: 'MP-14', ok: false }])]
    const base = { texto: 'MP-13 y MP-14', herramientas: leido(['MP-13', 'MP-14']), catalogo: PRODUCTOS_CONSULTIVA, filas }
    expect(fotosDelTurno({ ...base, pedido: '¿y qué capacidad tiene?' }).map((x) => x.codigo)).toEqual(['MP-14'])
    expect(fotosDelTurno({ ...base, pedido: 'muéstrame la foto' }).map((x) => x.codigo)).toEqual(['MP-13', 'MP-14'])
    expect(pideVerFoto('¿cómo se ve?')).toBe(true)
    expect(pideVerFoto('Tienes foto?')).toBe(true)
    expect(pideVerFoto('¿cuánto vale?')).toBe(false)
  })
})

describe('fotos ya consultadas y la pausa larga (lo que el estado le dice al modelo)', () => {
  const t = (iso: string, x: Partial<FilaPublica>) => ({ created_at: iso, direccion: 'saliente', turno_id: 't', traza: null, ...x }) as unknown as FilaPublica
  const leyo = (productos: Array<{ codigo: string; tiene_foto: boolean }>) => ({ tipo: 'modelo', herramientas: [{ nombre: 'ver_catalogo', ok: true, args: {}, datos: { productos }, ms: 1 }] })

  it('«¿tienes foto?» sin volver a llamar ver_catalogo: la del producto leído antes sale; la que no hay, no', () => {
    const filas = [
      t('2026-10-29T23:54:24Z', { direccion: 'entrante', traza: leyo([{ codigo: 'MP-13', tiene_foto: true }, { codigo: 'MP-12', tiene_foto: false }]) as never }),
      t('2026-10-29T23:54:40Z', { traza: { tipo: 'modelo', fotos: [{ codigo: 'MP-13', ok: true }] } as never }),
    ]
    const base = { herramientas: [], catalogo: PRODUCTOS_CONSULTIVA, filas, pedido: 'Tienes foto?' }
    expect(fotosDelTurno({ ...base, texto: 'Claro, aquí está el MP-13.' }).map((x) => x.codigo)).toEqual(['MP-13'])
    expect(fotosDelTurno({ ...base, texto: 'Del MP-12 no tengo foto por ahora.' })).toEqual([])
    // Un código que nadie leyó en la conversación sigue sin foto.
    expect(fotosDelTurno({ ...base, texto: 'Mira el MP-14.' })).toEqual([])
    expect(fotosConsultadas(filas)).toEqual([{ codigo: 'MP-13', tieneFoto: true, enviada: true }, { codigo: 'MP-12', tieneFoto: false, enviada: false }])
  })

  it('las horas entre lo anterior y el mensaje que espera respuesta', () => {
    const filas = [
      t('2026-10-29T22:04:39Z', { direccion: 'entrante' }), t('2026-10-29T22:04:45Z', {}),
      t('2026-10-29T23:53:52Z', { direccion: 'entrante', turno_id: null }),
    ]
    expect(horasDePausa(filas)).toBeCloseTo(1.82, 1)
    expect(horasDePausa(filas.slice(2))).toBeNull()
    expect(horasDePausa(filas.slice(0, 2))).toBeNull()
  })
})

describe('envío de la foto a Chatwoot (multipart, fetch simulado)', () => {
  const llave: LlaveConversacion = { workspaceId: 'w', cuentaId: 189134, conversacionId: 55 }
  type Pedido = { url: string; init?: RequestInit }
  const imagen = (bytes = 10, cabeceras: Record<string, string> = {}) =>
    new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes), ...cabeceras } })
  const simulado = (respuestas: Array<Response | Error>) => {
    const pedidos: Pedido[] = []
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      pedidos.push({ url: String(url), init })
      const r = respuestas.shift()
      if (!r) throw new Error('sin respuesta simulada')
      if (r instanceof Error) throw r
      return r
    }) as typeof fetch
    return { f, pedidos }
  }

  it('baja del bucket, sube por multipart con attachments[] y el pie; devuelve el id', async () => {
    const s = simulado([imagen(1234), new Response(JSON.stringify({ id: 991 }), { status: 200 })])
    const m = mensajeroChatwootApi({ apiUrl: 'https://app.chatwoot.com', token: 'tok', fetch: s.f, hostFotos: HOST })
    const r = await m.publicarFoto(llave, { url: URL_OK, texto: 'MP-01 · Taladro' })
    expect(r).toEqual({ ok: true, id: 991 })
    expect(s.pedidos[0].url).toBe(URL_OK)
    expect(s.pedidos[0].init?.redirect).toBe('error')
    const subida = s.pedidos[1]
    expect(subida.url).toBe('https://app.chatwoot.com/api/v1/accounts/189134/conversations/55/messages')
    expect(subida.init?.method).toBe('POST')
    const h = subida.init?.headers as Record<string, string>
    expect(h.api_access_token).toBe('tok')
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('content-type')
    const fd = subida.init?.body as FormData
    expect(fd).toBeInstanceOf(FormData)
    expect(fd.get('content')).toBe('MP-01 · Taladro')
    expect(fd.get('message_type')).toBe('outgoing')
    expect(fd.get('private')).toBe('false')
    const archivo = fd.get('attachments[]') as File
    expect(archivo.size).toBe(1234)
    expect(archivo.type).toBe('image/jpeg')
    expect(archivo.name).toBe('MP-01-X1-1.jpg')
  })

  it('una URL fuera de la lista blanca no se pide; sin host permitido, ninguna', async () => {
    const s = simulado([])
    const m = mensajeroChatwootApi({ apiUrl: 'https://app.chatwoot.com', token: 'tok', fetch: s.f, hostFotos: HOST })
    expect(await m.publicarFoto(llave, { url: 'https://evil.example/x.jpg', texto: 'x' })).toMatchObject({ ok: false, incierto: false })
    const sinHost = mensajeroChatwootApi({ apiUrl: 'https://app.chatwoot.com', token: 'tok', fetch: s.f })
    expect(await sinHost.publicarFoto(llave, { url: URL_OK, texto: 'x' })).toMatchObject({ ok: false, incierto: false })
    expect(s.pedidos).toEqual([])
  })

  it('descarga fallida, que no es imagen o muy grande: no sube nada y no es incierto', async () => {
    const casos: Array<[Response | Error, RegExp]> = [
      [new Response('no', { status: 404 }), /http 404/],
      [new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), /no es una imagen/],
      [imagen(10, { 'content-length': String(6 * 1024 * 1024) }), /pesa/],
      [new Error('timeout'), /descarga/],
    ]
    for (const [resp, motivo] of casos) {
      const s = simulado([resp])
      const m = mensajeroChatwootApi({ apiUrl: 'https://app.chatwoot.com', token: 'tok', fetch: s.f, hostFotos: HOST })
      const r = await m.publicarFoto(llave, { url: URL_OK, texto: 'x' })
      expect(r).toMatchObject({ ok: false, incierto: false })
      if (!r.ok) expect(r.motivo).toMatch(motivo)
      expect(s.pedidos.length).toBe(1)
    }
  })

  it('el tope de tamaño se cumple aunque el servidor no diga el largo', async () => {
    const grande = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close() } }), { status: 200, headers: { 'content-type': 'image/png' } })
    const r = await bajarFoto(URL_OK, { hostPermitido: HOST, fetch: (async () => grande) as typeof fetch, maxBytes: 1000 })
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.motivo).toMatch(/tope/)
  })

  it('Chatwoot rechaza (4xx) o se cae (5xx / red): 4xx no es incierto; 5xx y red sí', async () => {
    for (const [resp, incierto] of [[new Response('bad', { status: 422 }), false], [new Response('x', { status: 502 }), true], [new Error('corte'), true]] as Array<[Response | Error, boolean]>) {
      const s = simulado([imagen(), resp])
      const m = mensajeroChatwootApi({ apiUrl: 'https://app.chatwoot.com', token: 'tok', fetch: s.f, hostFotos: HOST })
      expect(await m.publicarFoto(llave, { url: URL_OK, texto: 'x' })).toMatchObject({ ok: false, incierto })
    }
  })
})

describe('SQL de la venta consultiva (PGlite)', () => {
  let db: PGlite
  const leer = (a: string) => readFileSync(join(process.cwd(), a), 'utf8')
  const versiones = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.bot_reglamentos where workspace_id = '${WORKSPACE_DIMPRO}'`)).rows[0].n

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.workspaces (id uuid primary key, slug text, config_extra jsonb);
      insert into public.workspaces values ('${WORKSPACE_DIMPRO}', 'dimpro', '{}'), ('00000000-0000-4000-8000-0000000000c1', 'otro', '{}');
    `)
    await db.exec(leer('supabase/migrations/20261006213100_wa_conversacion.sql'))
    await db.exec(leer('supabase/migrations/20261006213200_bot_reglamento_y_uso.sql'))
    // El estado de producción ANTES del cambio: la semilla con las fichas viejas (sin inv.tres, alc.producto de antes).
    const antes = REGLAMENTO_DIMPRO.filter((f) => f.clave !== 'inv.tres').map((f) => (f.clave === 'alc.producto' ? { ...f, hacer: 'búscalo con ver_catalogo (texto viejo)' } : f))
    await db.exec(semillaSqlDimpro(antes))
  }, 30_000)
  afterAll(async () => { await db.close() })

  it('el archivo es la salida del generador', () => {
    expect(leer('sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql').trimEnd()).toBe(actualizacionSqlDimpro().trimEnd())
  })

  it('pone al día las fichas, publica una versión nueva y la segunda corrida no publica otra', async () => {
    expect(await versiones()).toBe(1)
    const sql = leer('sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql')
    await db.exec(sql)
    expect(await versiones()).toBe(2)
    const r = await db.query<{ fichas: Array<{ clave: string; hacer: string }> }>(`select fichas from public.bot_reglamentos where workspace_id = '${WORKSPACE_DIMPRO}' order by version desc limit 1`)
    const pub = new Map(r.rows[0].fichas.map((f) => [f.clave, f.hacer]))
    for (const c of CLAVES_VENTA_CONSULTIVA) expect(pub.get(c)).toBe(REGLAMENTO_DIMPRO.find((f) => f.clave === c)!.hacer)
    expect(pub.size).toBe(REGLAMENTO_DIMPRO.length)
    await db.exec(sql)
    expect(await versiones()).toBe(2)
  })

  it('se niega a correr en otro workspace', async () => {
    const sql = leer('sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql').replace(`'${WORKSPACE_DIMPRO}'`, `'00000000-0000-4000-8000-0000000000c1'`)
    await expect(db.exec(sql)).rejects.toThrow(/solo del workspace dimpro/)
  })
})

describe('SQL de la ronda 2 (PGlite): solo las fichas que cambiaron, publica una vez', () => {
  let db: PGlite
  const ARCHIVO = 'sql/dimpro/2026-10-29_reglamento-ventas-ronda2.sql'
  const leer = (a: string) => readFileSync(join(process.cwd(), a), 'utf8')
  const versiones = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.bot_reglamentos where workspace_id = '${WORKSPACE_DIMPRO}'`)).rows[0].n

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.workspaces (id uuid primary key, slug text, config_extra jsonb);
      insert into public.workspaces values ('${WORKSPACE_DIMPRO}', 'dimpro', '{}');
    `)
    await db.exec(leer('supabase/migrations/20261006213100_wa_conversacion.sql'))
    await db.exec(leer('supabase/migrations/20261006213200_bot_reglamento_y_uso.sql'))
    // Producción hoy (v2 publicada): sin alc.saludo ni alc.foto, y alc.producto con el texto de la venta consultiva.
    const antes = REGLAMENTO_DIMPRO.filter((f) => !['alc.saludo', 'alc.foto'].includes(f.clave))
      .map((f) => (f.clave === 'alc.producto' ? { ...f, hacer: 'texto de la venta consultiva (v2)' } : f))
    await db.exec(semillaSqlDimpro(antes))
  }, 30_000)
  afterAll(async () => { await db.close() })

  it('el archivo es la salida del generador', () => {
    expect(leer(ARCHIVO).trimEnd()).toBe(actualizacionSqlDimpro(CLAVES_RONDA_2, REGLAMENTO_DIMPRO, TEXTOS_RONDA_2).trimEnd())
  })

  it('inserta alc.saludo y alc.foto, reescribe las cambiadas, publica una versión; la segunda corrida no publica', async () => {
    const otra = (await db.query<{ hacer: string }>(`select hacer from public.bot_parametros where workspace_id = '${WORKSPACE_DIMPRO}' and clave = 'pol.garantia'`)).rows[0].hacer
    expect(await versiones()).toBe(1)
    await db.exec(leer(ARCHIVO))
    expect(await versiones()).toBe(2)
    const r = await db.query<{ fichas: Array<{ clave: string; hacer: string }> }>(`select fichas from public.bot_reglamentos where workspace_id = '${WORKSPACE_DIMPRO}' order by version desc limit 1`)
    const pub = new Map(r.rows[0].fichas.map((f) => [f.clave, f.hacer]))
    for (const c of CLAVES_RONDA_2) expect(pub.get(c)).toBe(REGLAMENTO_DIMPRO.find((f) => f.clave === c)!.hacer)
    expect(pub.size).toBe(REGLAMENTO_DIMPRO.length)
    // Lo que no es de la ronda (los textos legales) no se toca.
    expect(pub.get('pol.garantia')).toBe(otra)
    await db.exec(leer(ARCHIVO))
    expect(await versiones()).toBe(2)
  })
})
