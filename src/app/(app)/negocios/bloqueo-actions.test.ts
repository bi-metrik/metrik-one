/**
 * Las acciones del paquete de bloqueo, contra un doble de Supabase que PERSISTE: se afirma lo que quedó
 * escrito en `items`, no lo que la acción dice haber hecho. La lectura del modelo es un doble que
 * devuelve los fixtures de los pantallazos de Aliados (sin llaves, sin red).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import aliadosHotel from '@/lib/cotizaciones/__fixtures__/bloqueo/aliados-hotel.json'
import aliadosVuelos from '@/lib/cotizaciones/__fixtures__/bloqueo/aliados-vuelos.json'
import { hotelDesdeLectura, vueloDesdeLectura } from '@/lib/cotizaciones/bloqueo-extraccion'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let estadoDeLaCotizacion = 'borrador'
let porPasosEncendido = true
let recalculos = 0
const imagenesGuardadas: string[] = []

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-1', userId: 'p-1', error: null }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => { recalculos += 1 } }))
vi.mock('@/lib/cotizaciones/por-pasos-datos', () => ({
  exigirPorPasos: async () => (porPasosEncendido ? { ok: true, estado: {} } : { ok: false, error: 'La cotización por pasos no está encendida' }),
}))
vi.mock('@/lib/modulos/exigir-modulo', () => ({ exigirModulo: async () => ({ ok: true }), MENSAJE_MODULO_NO_ACTIVO: 'x', REQUISITO: { clarity: 'clarity' } }))
vi.mock('@/lib/cotizaciones/imagen-captura', () => ({
  guardarImagenDeCaptura: async (a: { dataUrl: string; lectura: { huellaImagen?: string } }) => {
    if (!a.lectura.huellaImagen) return null
    imagenesGuardadas.push(a.dataUrl)
    return `sbext://ws-1/capturas/${a.lectura.huellaImagen}.png`
  },
}))
vi.mock('@/lib/cotizaciones/bloqueo-leer', () => ({
  leerPantallazoDeBloqueo: async (cual: 'hotel' | 'vuelo') => {
    if (cual === 'hotel') {
      const h = hotelDesdeLectura(aliadosHotel)
      return h.ok ? { ok: true, cual, hotel: h.hotel, incluye: h.incluye, huella: 'h1' } : { ok: false, mensaje: h.motivo }
    }
    const v = vueloDesdeLectura(aliadosVuelos)
    return v.ok ? { ok: true, cual, vuelo: v.vuelo, huella: 'v1' } : { ok: false, mensaje: v.motivo }
  },
}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  crearRanuraConOpcion: async (cot: string, tipo: string) => {
    tablas.items.push({ id: `item-${tablas.items.length + 1}`, cotizacion_id: cot, grupo: 'paquete de bloqueo: Paquete de bloqueo en Cartagena', es_ajuste: false, subtotal: 0, tarifa_pax: null, tipo })
    return { success: true, itemId: `item-${tablas.items.length}`, grupo: 'x', etiqueta: null }
  },
  agregarOpcionARanura: async (cot: string, grupo: string) => {
    tablas.items.push({ id: `item-${tablas.items.length + 1}`, cotizacion_id: cot, grupo, es_ajuste: false, subtotal: 0, tarifa_pax: null })
    return { success: true, itemId: `item-${tablas.items.length}`, grupo }
  },
}))

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' = 'select'
  let payload: Fila = {}
  let embebe = false
  const aplica = (f: Fila) => filtros.every(([c, v]) => f[c] === v)
  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload))
      return { data: filas, error: null }
    }
    return {
      data: filas.map(f => ({ ...structuredClone(f), ...(embebe ? { cotizaciones: { estado: estadoDeLaCotizacion, negocio_id: 'neg-1' } } : {}) })),
      error: null,
    }
  }
  const api = {
    select(cols?: string) { embebe = typeof cols === 'string' && cols.includes('cotizaciones('); return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    eq(c: string, v: unknown) { filtros.push([c, v]); return api },
    async maybeSingle() { const r = ejecutar(); return { data: (r.data as Fila[])[0] ?? null, error: null } },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej) },
  }
  return api
}

const { crearPaqueteBloqueo, guardarPaqueteBloqueo, leerPantallazoBloqueo } = await import('./bloqueo-actions')
const { leerTarifaPax } = await import('@/lib/cotizaciones/tarifa-pasajero')
const { leerPaqueteBloqueo } = await import('@/lib/cotizaciones/bloqueo-paquete')

const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en Cartagena'
const item = (id = 'item-1') => (tablas.items ?? []).find(f => f.id === id) as Fila

beforeEach(() => {
  estadoDeLaCotizacion = 'borrador'
  porPasosEncendido = true
  recalculos = 0
  imagenesGuardadas.length = 0
  tablas = {
    cotizaciones: [{ id: 'cot-1', negocio_id: 'neg-1' }],
    negocio_bloques: [{ negocio_id: 'neg-1', modalidad_viaje: 'bloqueo', operador_bloqueo: 'Aliados Travel' }],
    items: [{ id: 'item-1', cotizacion_id: 'cot-1', grupo: GRUPO, es_ajuste: false, subtotal: 0, margen_porcentaje: null, tarifa_pax: null }],
    profiles: [{ id: 'p-1', full_name: 'Tatiana' }],
  }
})

async function paqueteLeido() {
  const h = await leerPantallazoBloqueo('cot-1', 'hotel', 'data:image/png;base64,AAAA')
  const v = await leerPantallazoBloqueo('cot-1', 'vuelo', 'data:image/png;base64,BBBB')
  if (!h.ok || h.cual !== 'hotel' || !v.ok || v.cual !== 'vuelo') throw new Error('lectura')
  return {
    version: 1, operador: null, hotel: h.hotel, incluye: h.incluye, vuelo: v.vuelo, salidaManual: null,
    distribucion: { habitaciones: { doble: 2, sencilla: 1, triple: 3 }, ninos: 2 }, imagenes: { hotel: null, vuelo: null },
  }
}

describe('guardar el paquete de bloqueo', () => {
  it('escribe el costo calculado en el servidor, el paquete, la descripción y la comisión incluida (margen 0)', async () => {
    const paquete = await paqueteLeido()
    const r = await guardarPaqueteBloqueo('item-1', {
      paquete,
      imagenes: { hotel: { dataUrl: 'data:image/png;base64,AAAA', huella: 'h1' }, vuelo: { dataUrl: 'data:image/png;base64,BBBB', huella: 'v1' } },
      comision: 'incluida',
    })
    expect(r.success).toBe(true)
    const esperado = 4 * 1668902 + 2548649 + 9 * 1649915 + 2 * 1365104
    expect(item().subtotal).toBe(esperado)
    expect(item().cantidad).toBe(1)
    expect(item().margen_porcentaje).toBe(0)
    expect(item().nombre).toBe('HOTEL CARTAGENA DUBAI')
    const t = leerTarifaPax(item().tarifa_pax)
    expect(t.tipoTarifa).toMatchObject({ tipo: 'publica', origen: 'persona', por: 'Tatiana' })
    const guardado = leerPaqueteBloqueo(t.bloqueo)
    expect(guardado?.operador).toBe('Aliados Travel')
    expect(guardado?.imagenes).toEqual({ hotel: 'sbext://ws-1/capturas/h1.png', vuelo: 'sbext://ws-1/capturas/v1.png' })
    expect(String(item().descripcion)).toContain('INCLUYE: TIQUETE AÉREO')
    expect(recalculos).toBe(1)
  })

  it('el costo que manda el navegador no cuenta: se recalcula con el paquete', async () => {
    const paquete = { ...(await paqueteLeido()), costo: 1, total: 1 }
    await guardarPaqueteBloqueo('item-1', { paquete, comision: 'por_incluir' })
    expect(item().subtotal).toBeGreaterThan(1000000)
    // Por incluir = Neta: hereda el margen de la cotización.
    expect(item().margen_porcentaje).toBeNull()
    expect(leerTarifaPax(item().tarifa_pax).tipoTarifa?.tipo).toBe('neta')
  })

  it('sin comisión en la llamada, el margen no se toca', async () => {
    tablas.items[0].margen_porcentaje = 12
    await guardarPaqueteBloqueo('item-1', { paquete: await paqueteLeido() })
    expect(item().margen_porcentaje).toBe(12)
  })

  it('sin precio de lo distribuido: guarda el paquete con costo 0 y dice qué falta', async () => {
    const paquete = await paqueteLeido()
    paquete.distribucion = { habitaciones: { cuadruple: 1 } as never, ninos: 0 }
    const r = await guardarPaqueteBloqueo('item-1', { paquete })
    expect(r.success && r.costo).toBeNull()
    expect(r.success && r.falta[0]).toMatch(/cuádruple/)
    expect(item().subtotal).toBe(0)
  })

  it('una imagen sin la huella de su lectura no se guarda', async () => {
    await guardarPaqueteBloqueo('item-1', { paquete: await paqueteLeido(), imagenes: { hotel: { dataUrl: 'data:image/png;base64,ZZZ', huella: null } } })
    expect(imagenesGuardadas).toEqual([])
    expect(leerPaqueteBloqueo(leerTarifaPax(item().tarifa_pax).bloqueo)?.imagenes.hotel).toBeNull()
  })

  it('conserva lo demás de tarifa_pax (llaves que no son del paquete)', async () => {
    tablas.items[0].tarifa_pax = { fotoHotel: { ref: 'sbext://ws-1/f.png', por: 'x', en: '2026-10-27' } }
    await guardarPaqueteBloqueo('item-1', { paquete: await paqueteLeido() })
    expect(leerTarifaPax(item().tarifa_pax).fotoHotel?.ref).toBe('sbext://ws-1/f.png')
  })

  it.each([
    ['la cotización ya no es borrador', () => { estadoDeLaCotizacion = 'enviada' }, /ya no se edita/],
    ['la forma por pasos está apagada', () => { porPasosEncendido = false }, /por pasos/],
    ['el viaje no es Bloqueo', () => { tablas.negocio_bloques[0].modalidad_viaje = 'a_medida' }, /no está marcado como Bloqueo/],
    ['la línea no es de la ranura del paquete', () => { tablas.items[0].grupo = 'hotel' }, /no es un paquete/],
  ])('rechaza sin escribir si %s', async (_n, preparar, error) => {
    const paquete = await paqueteLeido()
    preparar()
    const r = await guardarPaqueteBloqueo('item-1', { paquete, comision: 'incluida' })
    expect(r.success).toBe(false)
    expect(!r.success && r.error).toMatch(error)
    expect(item().subtotal).toBe(0)
    expect(item().tarifa_pax).toBeNull()
  })
})

describe('leer un pantallazo del paquete', () => {
  it('en un viaje A medida no llama al modelo', async () => {
    tablas.negocio_bloques[0].modalidad_viaje = 'a_medida'
    const r = await leerPantallazoBloqueo('cot-1', 'hotel', 'data:image/png;base64,AAAA')
    expect(r.ok).toBe(false)
  })
  it('una casilla desconocida se rechaza', async () => {
    expect((await leerPantallazoBloqueo('cot-1', 'otra' as never, 'data:image/png;base64,AAAA')).ok).toBe(false)
  })
})

describe('«+ Paquete»', () => {
  it('con la ranura ya creada, agrega una opción hermana en ella', async () => {
    const r = await crearPaqueteBloqueo('cot-1')
    expect(r).toEqual({ success: true, itemId: 'item-2' })
    expect(item('item-2').grupo).toBe(GRUPO)
  })
  it('sin ranura, la crea con el tipo paquete', async () => {
    tablas.items = []
    const r = await crearPaqueteBloqueo('cot-1')
    expect(r.success).toBe(true)
    expect(tablas.items[0].tipo).toBe('paquete')
  })
  it('en un viaje A medida no crea nada', async () => {
    tablas.negocio_bloques = []
    tablas.items = []
    expect((await crearPaqueteBloqueo('cot-1')).success).toBe(false)
    expect(tablas.items).toEqual([])
  })
})
