/**
 * EL VUELO DEL GDS QUE NO DICE SI EL PRECIO ES DE TODOS O DE UNO (Trappvel, 2026-11-06), por la
 * ruta real de la bandeja y contra el doble de igualdad.
 *
 * Tatiana pegó la pantalla del GDS (BOG–CTG / CTG–BOG, «COP 4,666,438», sin pasajeros) y salió RX2
 * «Sube una captura que lo incluya». Ahora la ruta devuelve la pregunta con UNA lectura firmada por
 * respuesta, llamando al lector UNA sola vez; la elegida se acepta como cualquier lectura y su costo
 * es el que dijo la persona (por persona = por los 8 viajeros del caso, nunca por 1). Con un solo
 * pasajero no se pregunta.
 *
 * El lector (el modelo) se reemplaza por la lectura cruda: nada de esto llama a un modelo.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, tomarRegistro, escrituras } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES } from '../../../../test/caso-san-andres'
import { tablasPorPasos } from '../../../../test/caso-por-pasos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  const { WS_TRAPPVEL } = await import('../../../../test/caso-san-andres')
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

/** La pantalla del GDS como la devuelve el lector: ida y regreso, el total y nada de a cuántos. */
const VUELO_GDS = {
  veredicto: 'detalle_unico',
  observacion: 'Itinerario BOG-CTG / CTG-BOG con su precio',
  campos: {
    aerolinea: { value: 'AVIANCA', confidence: 0.95 },
    origen: { value: 'BOG', confidence: 0.95 },
    destino: { value: 'CTG', confidence: 0.95 },
    fecha_salida: { value: '2026-11-23', confidence: 0.95 },
    fecha_regreso: { value: '2026-11-28', confidence: 0.95 },
    numero_vuelo: { value: 'AV9590', confidence: 0.95 },
    escalas: { value: '0', confidence: 0.95 },
    pax: { value: null, confidence: 0 },
    moneda: { value: 'COP', confidence: 0.95 },
    precio_total: { value: '4666438', confidence: 0.95 },
    base_precio: { value: null, confidence: 0 },
  },
  desglose: [],
}
const lector = vi.hoisted(() => ({ llamadas: 0 }))
vi.mock('@/lib/ai/extraer-ranura', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/ai/extraer-ranura')>()
  return {
    ...real,
    extraerRanuraDesdeImagen: async () => {
      lector.llamadas += 1
      return { data: structuredClone(VUELO_GDS) }
    },
  }
})
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))

import { POST as aceptarCaptura } from '@/app/api/cotizaciones/[id]/aceptar-captura/route'
import { POST as leerCapturaRuta } from '@/app/api/cotizaciones/[id]/leer-captura/route'
import type { EleccionDeBase } from '@/lib/cotizaciones/proceso-captura'
import { leerTarifaPax, type LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'

const tabla = (t: string) => base.tablas[t] ?? []
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const ruta = (accion: string, cuerpo: unknown) => new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/${accion}`, { method: 'POST', body: JSON.stringify(cuerpo) })
const params = { params: Promise.resolve({ id: COT_SAN_ANDRES }) }
const PRECIO = 4_666_438

beforeAll(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

function sembrar(composicion?: { adultos: number; ninos: number; infantes: number }) {
  base.tablas = tablasPorPasos()
  base.tablas.items = []
  base.tablas.rubros = []
  base.tablas.cotizacion_itinerarios = []
  base.tablas.itinerario_opciones = []
  base.tablas.cotizacion_ranuras = []
  base.secuencia = 0
  base.registro = []
  lector.llamadas = 0
  if (composicion) {
    for (const b of tabla('negocio_bloques')) {
      Object.assign(b, composicion)
      b.data = { ...(b.data as Record<string, unknown>), ...composicion }
    }
  }
}

type Lectura = { ok: boolean; codigo?: string; mensaje?: string; lectura?: LecturaCasilla; lecturaJson?: string; firma?: string; eleccionBase?: EleccionDeBase }

async function leer(): Promise<Lectura> {
  return (await (await leerCapturaRuta(ruta('leer-captura', { tipo: 'vuelo', dataUrl: PNG }), params)).json()) as Lectura
}

async function aceptar(lecturaJson: string, firma: string): Promise<string> {
  const cuerpo = { tipo: 'vuelo', lecturaJson, firma, pistas: { lugar: null, origen: 'BOG', destino: 'CTG' }, decision: 'auto', destinoId: null, imagen: null, correcciones: null, idAceptacion: 'cap-gds' }
  const r = (await (await aceptarCaptura(ruta('aceptar-captura', cuerpo), params)).json()) as { ok: boolean; mensaje?: string; itemId?: string }
  expect(r.ok, r.mensaje).toBe(true)
  return r.itemId!
}

/** Lo que quedó guardado en la opción: la lectura de la captura en su casilla. */
const casillaDe = (itemId: string) => leerTarifaPax(tabla('items').find(i => i.id === itemId)?.tarifa_pax).casillas!.grupo_completo!

describe('vuelo del GDS sin «por persona» ni «total»', () => {
  it('la ruta pregunta, con una lectura firmada por respuesta, y el lector se llamó UNA vez', async () => {
    sembrar()
    tomarRegistro()
    const r = await leer()
    expect(lector.llamadas).toBe(1)
    expect(r).toMatchObject({ ok: false, codigo: 'RX2' })
    expect(r.eleccionBase!.pregunta).toBe('¿Ese precio es de todos los pasajeros o de uno solo?')
    expect(r.eleccionBase!.opciones.map(o => [o.valor, o.etiqueta])).toEqual([['total', 'Es el total'], ['por_pax', 'Es por persona']])
    const [total, porPax] = r.eleccionBase!.opciones
    expect(total.lectura.total).toBe(PRECIO)
    // Los 8 viajeros del caso (6 adultos, 1 niño, 1 infante): nunca por 1.
    expect(porPax.lectura.total).toBe(PRECIO * 8)
    for (const o of r.eleccionBase!.opciones) {
      expect(o.firma).toMatch(/^\d+\.[0-9a-f]{64}$/)
      expect(JSON.parse(o.lecturaJson)).toMatchObject({ basePrecioOrigen: 'elegido' })
    }
    // Preguntar no escribe nada.
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('«Es por persona» se acepta con su firma y la opción queda por los 8, sin volver a leer', async () => {
    sembrar()
    const r = await leer()
    const porPax = r.eleccionBase!.opciones.find(o => o.valor === 'por_pax')!
    const itemId = await aceptar(porPax.lecturaJson, porPax.firma)
    expect(lector.llamadas).toBe(1)
    const casilla = casillaDe(itemId)
    expect(casilla.total).toBe(PRECIO * 8)
    expect(casilla.basePrecioOrigen).toBe('elegido')
    expect(casilla.campos).toContainEqual({ label: 'El precio mostrado es', valor: 'por_pax' })
  })

  it('«Es el total» queda en el precio tal cual', async () => {
    sembrar()
    const r = await leer()
    const total = r.eleccionBase!.opciones.find(o => o.valor === 'total')!
    const itemId = await aceptar(total.lecturaJson, total.firma)
    expect(casillaDe(itemId).total).toBe(PRECIO)
    expect(casillaDe(itemId).campos).toContainEqual({ label: 'El precio mostrado es', valor: 'total' })
  })

  it('una lectura de la pregunta alterada en el navegador no entra', async () => {
    sembrar()
    const r = await leer()
    const total = r.eleccionBase!.opciones.find(o => o.valor === 'total')!
    const porPax = r.eleccionBase!.opciones.find(o => o.valor === 'por_pax')!
    const cuerpo = { tipo: 'vuelo', lecturaJson: porPax.lecturaJson, firma: total.firma, pistas: { lugar: null, origen: null, destino: null }, decision: 'auto' }
    const res = (await (await aceptarCaptura(ruta('aceptar-captura', cuerpo), params)).json()) as { ok: boolean; codigo?: string }
    expect(res).toMatchObject({ ok: false, codigo: 'FIRMA' })
  })

  it('con UN pasajero no pregunta: entra como total, sin aviso', async () => {
    sembrar({ adultos: 1, ninos: 0, infantes: 0 })
    const r = await leer()
    expect(lector.llamadas).toBe(1)
    expect(r.ok, r.mensaje).toBe(true)
    expect(r.eleccionBase).toBeUndefined()
    expect(r.lectura!.total).toBe(PRECIO)
    expect(r.lectura!.basePrecioOrigen).toBe('un_pasajero')
    expect(r.lectura!.alertas.join(' ')).not.toMatch(/por persona o de todas/)
  })
})
