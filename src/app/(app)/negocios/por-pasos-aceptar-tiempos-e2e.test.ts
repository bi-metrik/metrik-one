/**
 * V1 · V2 · V4 · V5 (verificación D de Vera, 2026-10-14): cuánto tarda «Aceptar» en el
 * SERVIDOR, uno y en lote, con el interruptor apagado y encendido, sobre el caso fijo.
 *
 * Vera midió en `trappvel-pruebas`: `Server-Timing aceptar` 2,0–2,4 s para uno, y el lote de 8 a
 * 9 en 7,7–9,2 s. Aquí no hay red: el doble de igualdad cuenta las IDAS a la base y
 * `latencia-doble.ts` le pone a cada una la latencia de Vercel a Supabase. Las que van en
 * paralelo se solapan, así que el tiempo de pared cuenta las idas EN SERIE, que son lo que
 * espera la asesora.
 *
 * Lo que fija esta prueba (y el PR de H2 reporta antes y después):
 *  · con el interruptor APAGADO, aceptar uno hace las mismas idas que en C0 (34): la condición de
 *    Mauricio;
 *  · ENCENDIDO, aceptar uno y aceptar en lote no pasan de su techo de idas en serie.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, tomarRegistro } from '../../../../test/igualdad-servidor-doble'
import { ponerLatencia } from '../../../../test/latencia-doble'
import { COT_SAN_ANDRES } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'
import { onceDelCasoFijo } from '../../../../test/caso-once-pantallazos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  const { conLatencia: lat } = await import('../../../../test/latencia-doble')
  const { clienteFalso: cf } = await import('../../../../test/igualdad-servidor-doble')
  const { WS_TRAPPVEL: ws } = await import('../../../../test/caso-san-andres')
  return {
    getWorkspace: memoDeRuta(async () => ({
      supabase: lat(cf()), workspaceId: ws, userId: 'p-asesora', staffId: 's-asesora',
      role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
    })),
  }
})
vi.mock('@/lib/supabase/server', async () => {
  const { conLatencia: lat } = await import('../../../../test/latencia-doble')
  const { clienteFalso: cf } = await import('../../../../test/igualdad-servidor-doble')
  return { createServiceClient: () => lat(cf()), createClient: async () => lat(cf()) }
})
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => ({ referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }),
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/app/(app)/negocios/[id]/vista-negocio', () => ({ cargarVistaNegocio: async () => null }))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))

import { recalcularTotales } from './cotizacion-actions'
import { firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { lecturaManual } from '@/lib/cotizaciones/ingreso-manual'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'
import { POST as aceptarUno } from '@/app/api/cotizaciones/[id]/aceptar-captura/route'
import { POST as aceptarLote } from '@/app/api/cotizaciones/[id]/aceptar-lote/route'

/** La latencia de una ida de Vercel a Supabase (ms). */
const LATENCIA = 25

beforeAll(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

function sembrar(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.secuencia = 0
  base.registro = []
}

/** El traslado nuevo de C0 (`idasDeAceptarUno`): un servicio que entra sobre el caso fijo armado. */
function cuerpoUno(porPasos: boolean) {
  const r = lecturaManual({
    ranura: ranuraPorSlug('traslado_detalle')!,
    entrada: {
      tipo: 'traslado',
      datos: {
        ruta: 'Hotel - muelle de Providencia', fecha: '2026-11-24', adultos: 6, ninos: 1, infantes: 1, cobro: 'por_persona',
        precio: 'por_trayecto', neto: 25_000, netoNino: 25_000, netoInfante: 0, idaYRegreso: true,
        fuente: 'Proveedor de prueba',
      },
    },
    leidaEn: '2026-10-12T14:30:00.000Z',
    hoy: '2026-10-12',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  const lecturaJson = JSON.stringify(r.lectura)
  return {
    tipo: 'traslado', lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, 'traslado', lecturaJson)!,
    pistas: { lugar: 'Providencia', origen: null, destino: null }, decision: 'auto', destinoId: null,
    imagen: null, correcciones: null, idAceptacion: null,
    ...(porPasos ? { porPasos: true } : {}),
  }
}

export interface Medida {
  idas: number
  ms: number
  serverTiming: string
}

async function medirUno(interruptor: boolean): Promise<Medida> {
  sembrar({ interruptor })
  ponerLatencia(0)
  await recalcularTotales(COT_SAN_ANDRES)
  tomarRegistro()
  ponerLatencia(LATENCIA)
  const t0 = performance.now()
  const res = await aceptarUno(
    new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-captura`, { method: 'POST', body: JSON.stringify(cuerpoUno(interruptor)) }),
    { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
  )
  const ms = performance.now() - t0
  ponerLatencia(0)
  const json = await res.json() as { ok: boolean; mensaje?: string }
  expect(json.ok, json.mensaje).toBe(true)
  if (process.env.LISTAR_IDAS) console.info(base.registro.map((i, n) => `${n + 1} ${i.op} ${i.tabla} ${JSON.stringify(i.filtros)}`).join('\n'))
  return { idas: tomarRegistro().length, ms: Math.round(ms), serverTiming: res.headers.get('Server-Timing') ?? '' }
}

async function medirLote(): Promise<Medida> {
  sembrar()
  base.tablas.items = []
  base.tablas.rubros = []
  base.tablas.cotizacion_itinerarios = []
  base.tablas.itinerario_opciones = []
  const filas = onceDelCasoFijo().map(p => {
    const lecturaJson = JSON.stringify(p.lectura)
    const hermana = p.id === 'cap-caso-10'
    return {
      id: p.id,
      borrador: {
        tipo: p.tipo, lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, p.tipo, lecturaJson)!, pistas: p.pistas,
        decision: hermana ? 'hermana' : 'auto', destinoId: null, imagen: null, correcciones: null, idAceptacion: p.id,
      },
      ...(hermana ? { destinoCaptura: 'cap-caso-09' } : {}),
    }
  })
  tomarRegistro()
  ponerLatencia(LATENCIA)
  const t0 = performance.now()
  const res = await aceptarLote(
    new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-lote`, { method: 'POST', body: JSON.stringify({ filas }) }),
    { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
  )
  const ms = performance.now() - t0
  ponerLatencia(0)
  const json = await res.json() as { ok: boolean; mensaje?: string; resultados: { resultado: { ok: boolean } }[] }
  expect(json.ok, json.mensaje).toBe(true)
  expect(json.resultados.every(r => r.resultado.ok)).toBe(true)
  return { idas: tomarRegistro().length, ms: Math.round(ms), serverTiming: res.headers.get('Server-Timing') ?? '' }
}

describe(`V1/V2/V4 · aceptar en el servidor, con ${LATENCIA} ms por ida`, () => {
  it('mide uno (apagado y encendido) y el lote de 11', async () => {
    const apagado = await medirUno(false)
    const encendido = await medirUno(true)
    const lote = await medirLote()
    console.info(`[tiempos-aceptar] ${JSON.stringify({ latenciaMs: LATENCIA, apagado, encendido, lote }, null, 1)}`)
    // La condición de Mauricio: apagado, las idas de C0.
    expect(apagado.idas).toBe(34)
    // Encendido, antes de H2: 66 idas y 1.703 ms (todas en serie). Después: 50 idas, ≈ 35 en serie.
    expect(encendido.idas).toBeLessThanOrEqual(50)
    // El lote de 11, antes de H2: 286 idas. El techo de C0 (fixture) sigue siendo 286.
    expect(lote.idas).toBeLessThanOrEqual(285)
    // El tiempo de pared es indicativo (la máquina de CI puede ir cargada): con 25 ms por ida, uno
    // encendido no pasa de 45 idas en serie.
    expect(encendido.ms).toBeLessThan(45 * LATENCIA)
  }, 120_000)
})
