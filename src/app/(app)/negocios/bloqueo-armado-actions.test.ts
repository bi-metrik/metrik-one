/**
 * `pegarEnBloqueo` contra un doble de Supabase que PERSISTE (SAN ANDRÉS, 2026-11-03): se afirma lo que
 * quedó en `items` después de pegar el vuelo y los tres hoteles en la bandeja principal. La lectura del
 * modelo es una cola de lecturas sintéticas con las cifras reales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { INCLUYE, ISLA_BONITA, KORAY, SOL_CARIBE, VUELO_AV, VUELO_OTRO } from '@/lib/cotizaciones/__fixtures__/bloqueo/san-andres-1103'
import type { LecturaBloqueo } from '@/lib/cotizaciones/bloqueo-leer'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
const cola: LecturaBloqueo[] = []

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-1', userId: 'p-1', error: null }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => {} }))
vi.mock('@/lib/cotizaciones/por-pasos-cierre', () => ({ cerrarAccionPorPasos: async () => ({ success: true, valorTotal: null }) }))
vi.mock('@/lib/cotizaciones/por-pasos-datos', () => ({ exigirPorPasos: async () => ({ ok: true, estado: {} }) }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({ exigirModulo: async () => ({ ok: true }), MENSAJE_MODULO_NO_ACTIVO: 'x', REQUISITO: { clarity: 'clarity' } }))
vi.mock('@/lib/cotizaciones/imagen-captura', () => ({
  guardarImagenDeCaptura: async (a: { lectura: { huellaImagen?: string } }) => (a.lectura.huellaImagen ? `sbext://ws-1/capturas/${a.lectura.huellaImagen}.png` : null),
}))
vi.mock('@/lib/cotizaciones/bloqueo-leer', () => ({
  leerPantallazoDeBloqueo: async () => cola.shift() ?? { ok: false, mensaje: 'sin lectura' },
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({ viaje: { composicion: { adultos: 3, ninos: 0, infantes: 0 } }, edadesMenores: null, error: null }),
}))
vi.mock('@/app/(app)/negocios/ranura-actions', async () => {
  const { grupoDeRanura } = await import('@/lib/cotizaciones/ranuras-cotizacion')
  let ranuras = 0
  const nueva = (cot: string, grupo: string) => {
    const id = `item-${tablas.items.length + 1}`
    tablas.items.push({ id, cotizacion_id: cot, grupo, es_ajuste: false, subtotal: 0, margen_porcentaje: null, tarifa_pax: null, nombre: 'Opción' })
    return id
  }
  return {
    crearRanuraConOpcion: async (cot: string) => {
      ranuras += 1
      const grupo = grupoDeRanura({ tipo: 'paquete', numero: ranuras >= 2 ? ranuras : null, nombre: 'Paquete de bloqueo en San Andrés' })
      return { success: true, itemId: nueva(cot, grupo), grupo, etiqueta: null }
    },
    agregarOpcionARanura: async (cot: string, grupo: string) => ({ success: true, itemId: nueva(cot, grupo), grupo }),
    __reiniciar: () => { ranuras = 0 },
  }
})

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' = 'select'
  let payload: Fila = {}
  let embebe = false
  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(f => filtros.every(([c, v]) => f[c] === v))
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload))
      return { data: filas, error: null }
    }
    return { data: filas.map(f => ({ ...structuredClone(f), ...(embebe ? { cotizaciones: { estado: 'borrador', negocio_id: 'neg-1' } } : {}) })), error: null }
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

const { pegarEnBloqueo } = await import('./bloqueo-actions')
const ranuras = (await import('@/app/(app)/negocios/ranura-actions')) as unknown as { __reiniciar: () => void }
const { leerTarifaPax } = await import('@/lib/cotizaciones/tarifa-pasajero')
const { leerPaqueteBloqueo } = await import('@/lib/cotizaciones/bloqueo-paquete')
const { formaDesdeGrupo } = await import('@/lib/cotizaciones/ranuras-cotizacion')

const vuelo = (v: typeof VUELO_AV, huella: string): LecturaBloqueo => ({ ok: true, cual: 'vuelo', vuelo: v, huella })
const hotel = (h: typeof KORAY, huella: string): LecturaBloqueo => ({ ok: true, cual: 'hotel', hotel: h, incluye: INCLUYE, operador: 'ATN', huella })

beforeEach(() => {
  ranuras.__reiniciar()
  tablas = {
    cotizaciones: [{ id: 'cot-1', negocio_id: 'neg-1' }],
    negocio_bloques: [{ negocio_id: 'neg-1', modalidad_viaje: 'bloqueo', operador_bloqueo: 'ATN' }],
    items: [],
    profiles: [{ id: 'p-1', full_name: 'Tatiana' }],
  }
})

async function pegar(...lecturas: LecturaBloqueo[]) {
  const out = []
  for (const l of lecturas) {
    cola.push(l)
    out.push(await pegarEnBloqueo('cot-1', 'data:image/png;base64,AAAA'))
  }
  return out
}

const paquetes = () => tablas.items.map(i => ({
  numero: formaDesdeGrupo(i.grupo as string)?.numero ?? 1,
  nombre: i.nombre,
  subtotal: i.subtotal,
  margen: i.margen_porcentaje,
  paquete: leerPaqueteBloqueo(leerTarifaPax(i.tarifa_pax).bloqueo),
  tipo: leerTarifaPax(i.tarifa_pax).tipoTarifa?.tipo ?? null,
}))

describe('pegarEnBloqueo · SAN ANDRÉS, 3 adultos', () => {
  it('vuelo + 3 hoteles → 1 paquete con 3 opciones de hotel, 1 vuelo, Triple y costo = precio × 3', async () => {
    const r = await pegar(vuelo(VUELO_AV, 'v1'), hotel(KORAY, 'h1'), hotel(ISLA_BONITA, 'h2'), hotel(SOL_CARIBE, 'h3'))
    expect(r.every(x => x.success)).toBe(true)
    const ps = paquetes()
    expect(ps).toHaveLength(3)
    expect(new Set(tablas.items.map(i => i.grupo)).size).toBe(1)
    expect(ps.map(p => p.nombre)).toEqual(['KORAY HOTEL', 'HOTEL ISLA BONITA', 'HOTEL SOL CARIBE SAN ANDRES'])
    expect(ps.map(p => p.subtotal)).toEqual([7_323_615, 6_884_589, 9_332_151])
    for (const p of ps) {
      expect(p.paquete!.vuelo!.tramos.map(t => t.numeroVuelo)).toEqual(['9376', '9803'])
      expect(p.paquete!.distribucion.habitaciones).toEqual({ triple: 1 })
    }
    // El vuelo guardó su imagen en la opción 1; cada hotel la suya.
    expect(ps.map(p => p.paquete!.imagenes.hotel)).toEqual(['sbext://ws-1/capturas/h1.png', 'sbext://ws-1/capturas/h2.png', 'sbext://ws-1/capturas/h3.png'])
    // Sin decidir Pública / Neta: el default de siempre (no se toca).
    expect(ps.map(p => p.tipo)).toEqual([null, null, null])
  })

  it('con el paquete en Pública (el precio ya trae la comisión), las opciones nuevas también: precio al cliente = total, sin margen encima', async () => {
    await pegar(vuelo(VUELO_AV, 'v1'), hotel(KORAY, 'h1'))
    // La asesora marca «Pública» (comisión 15 %) en la primera opción.
    const t = leerTarifaPax(tablas.items[0].tarifa_pax)
    tablas.items[0].tarifa_pax = { ...t, tipoTarifa: { tipo: 'publica', origen: 'persona', por: 'Tatiana', en: '2026-11-03T20:00:00Z', comisionPct: 15 } }
    tablas.items[0].margen_porcentaje = 0
    await pegar(hotel(ISLA_BONITA, 'h2'), hotel(SOL_CARIBE, 'h3'))
    const ps = paquetes()
    expect(ps.map(p => p.tipo)).toEqual(['publica', 'publica', 'publica'])
    expect(ps.map(p => p.margen)).toEqual([0, 0, 0])
    expect(ps.map(p => p.subtotal)).toEqual([7_323_615, 6_884_589, 9_332_151])
    expect(leerTarifaPax(tablas.items[2].tarifa_pax).tipoTarifa).toMatchObject({ comisionPct: 15 })
  })

  it('un segundo vuelo abre el paquete 2 con sus propios hoteles', async () => {
    const r = await pegar(vuelo(VUELO_AV, 'v1'), hotel(KORAY, 'h1'), vuelo(VUELO_OTRO, 'v2'), hotel(SOL_CARIBE, 'h3'), hotel(ISLA_BONITA, 'h2'))
    expect(r.map(x => x.success && x.accion)).toEqual(['nuevo_paquete', 'actualizar', 'nuevo_paquete', 'actualizar', 'nueva_opcion'])
    const ps = paquetes()
    expect(ps.map(p => [p.numero, p.paquete!.hotel.hotel, p.paquete!.vuelo!.tramos[0].numeroVuelo])).toEqual([
      [1, 'Koray Hotel', '9376'],
      [2, 'Hotel Sol Caribe San Andres', '9370'],
      [2, 'Hotel Isla Bonita', '9370'],
    ])
  })

  it('lo que no es hotel ni vuelo vuelve a la lectura de siempre («Otro servicio»)', async () => {
    const [r] = await pegar({ ok: false, mensaje: 'No se reconoce', elegir: true })
    expect(r).toMatchObject({ success: false, otroServicio: true })
    expect(tablas.items).toHaveLength(0)
  })

  it('en un viaje A medida no escribe nada', async () => {
    tablas.negocio_bloques = [{ negocio_id: 'neg-1', modalidad_viaje: 'a_medida' }]
    const [r] = await pegar(hotel(KORAY, 'h1'))
    expect(r.success).toBe(false)
    expect(tablas.items).toHaveLength(0)
  })
})
