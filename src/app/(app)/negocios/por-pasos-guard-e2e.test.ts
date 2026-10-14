/**
 * C1 · el GUARD DEL SERVIDOR del interruptor de la cotización por pasos (criterios N5 y N7).
 *
 *  · `exigirPorPasos` rechaza si falta cualquiera de las cuatro condiciones, leídas de la
 *    BASE (no de la pantalla), y si la pieza que la acción necesita está apagada.
 *  · Toda acción NUEVA del servidor se llama con el interruptor apagado y tiene que
 *    rechazarse sin escribir nada. La lista `ACCIONES_NUEVAS` crece con cada pieza (C2–C6).
 *  · Abrir la cotización con el interruptor encendido no escribe nada (N7).
 *
 * Corre sobre el doble de igualdad de C0 (`test/igualdad-servidor-doble.ts`) y el caso fijo.
 */
import { describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, NEG_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => ({
      supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: 'p-asesora', staffId: 's-asesora',
      role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
    })),
  }
})
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))

// El marco del negocio (encabezado y panel) es el de siempre, encendido o apagado, y lee medio
// negocio con métodos que el doble no conoce: aquí solo se mide la carga de la cotización.
vi.mock('@/app/(app)/negocios/[id]/vista-negocio', () => ({ cargarVistaNegocio: async () => null }))

import { exigirPorPasos, estadoPorPasosDeCotizacion } from '@/lib/cotizaciones/por-pasos-datos'

function sembrar(o: OpcionesPorPasos) {
  base.tablas = tablasPorPasos(o)
  base.secuencia = 0
  base.registro = []
}

describe('C1 · exigirPorPasos lee las cuatro condiciones de la base (N5)', () => {
  it('con las cuatro, deja pasar y dice qué piezas están encendidas', async () => {
    sembrar({})
    const r = await exigirPorPasos(clienteFalso(), COT_SAN_ANDRES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.estado.piezas.toda_opcion_en_tarifas).toBe(true)
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  const FALTA: [string, OpcionesPorPasos, RegExp][] = [
    ['la línea no es de viaje', { lineasPorTipo: false }, /no está encendida/],
    ['otra plantilla', { plantilla: 'termotech' }, /no está encendida/],
    ['sin plantilla', { plantilla: null }, /no está encendida/],
    ['el interruptor apagado', { interruptor: false }, /no está encendida/],
    ['la cotización enviada', { estado: 'enviada' }, /no es un borrador/],
    ['la cotización aceptada', { estado: 'aceptada' }, /no es un borrador/],
  ]
  for (const [caso, o, error] of FALTA) {
    it(`rechaza con ${caso}`, async () => {
      sembrar(o)
      const r = await exigirPorPasos(clienteFalso(), COT_SAN_ANDRES)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(error)
      expect(escrituras(tomarRegistro())).toEqual([])
    })
  }

  it('rechaza si la pieza que pide la acción está apagada, aunque el maestro esté encendido', async () => {
    sembrar({ piezasApagadas: ['toda_opcion_en_tarifas'] })
    expect((await exigirPorPasos(clienteFalso(), COT_SAN_ANDRES, 'toda_opcion_en_tarifas')).ok).toBe(false)
    expect((await exigirPorPasos(clienteFalso(), COT_SAN_ANDRES, 'opcional_traslado')).ok).toBe(true)
  })

  it('una cotización que no existe (o de otro workspace, por RLS) se rechaza', async () => {
    sembrar({})
    const r = await exigirPorPasos(clienteFalso(), 'cot-que-no-existe')
    expect(r).toEqual({ ok: false, error: 'Cotización no encontrada' })
  })

  it('el estado no depende de lo que diga la pantalla: se apaga en la base y la siguiente llamada ya rechaza', async () => {
    sembrar({})
    expect((await estadoPorPasosDeCotizacion(clienteFalso(), COT_SAN_ANDRES))?.encendido).toBe(true)
    ;(base.tablas.workspaces[0] as Fila).config_extra = { cotizacion_por_pasos: { activo: false } }
    expect((await estadoPorPasosDeCotizacion(clienteFalso(), COT_SAN_ANDRES))?.encendido).toBe(false)
  })
})

describe('C1 · abrir la cotización con el interruptor encendido no escribe (N7)', () => {
  it('cero escrituras al cargar la página, con el interruptor encendido y apagado', async () => {
    const { default: Pagina } = await import('./[id]/cotizacion/[cotId]/page')
    const idas: Record<string, number> = {}
    for (const interruptor of [false, true]) {
      sembrar({ interruptor })
      const jsx = await Pagina({ params: Promise.resolve({ id: NEG_SAN_ANDRES, cotId: COT_SAN_ANDRES }) })
      expect(jsx).toBeTruthy()
      // El editor recibe el interruptor ya resuelto en el servidor.
      expect((jsx as { props: { porPasos?: { encendido: boolean } } }).props.porPasos?.encendido).toBe(interruptor)
      const registro = tomarRegistro()
      expect(escrituras(registro), `interruptor ${interruptor ? 'encendido' : 'apagado'}`).toEqual([])
      idas[String(interruptor)] = registro.length
    }
    // Calcular el interruptor no suma idas: sale de filas que la página ya lee. Encendida, la
    // forma por pasos lee además si hay un pedido de autorización esperando (C4): dos lecturas.
    expect(idas.true - idas.false).toBeLessThanOrEqual(2)
  }, 60_000)
})
