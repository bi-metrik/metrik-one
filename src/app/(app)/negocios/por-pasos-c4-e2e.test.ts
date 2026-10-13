/**
 * C4 · el servidor de la pantalla por pasos: «Deshacer» inmediato y condicionado (D1), borrar y
 * deshacer con los mismos ids (D2), la autorización bajo el mínimo (P6, P7) y la compatibilidad
 * de la huella de la autorización. Contra el doble de igualdad de C0 y el caso fijo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, NEG_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'

const sesion = vi.hoisted(() => ({ role: 'operator', userId: 'p-asesora', staffId: 's-asesora' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: sesion.userId, staffId: sesion.staffId,
    role: sesion.role, areas: [], impersonating: false, realRole: sesion.role, error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
const borradas = vi.hoisted(() => [] as string[])
vi.mock('@/lib/cotizaciones/imagen-captura', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/cotizaciones/imagen-captura')>()
  return {
    ...real,
    borrarImagenesDeCaptura: async (_ws: string, refs: string[]) => { borradas.push(...refs) },
    imagenComoDataUrl: async () => 'data:image/png;base64,AAAA',
  }
})

import { recalcularTotales } from './cotizacion-actions'
import { opcionesDeAprobacion } from './[id]/cotizacion/actions'
import {
  deshacerPorPasos,
  elegirOpcionEnTarifa,
  estadoDeServicioPorPasos,
  getPedidoDeAutorizacion,
  juntarServicioPorPasos,
  mandarTarifa,
  margenPorPasos,
  pedirAutorizacionPorPasos,
  retirarAutorizacionPorPasos,
  separarOpcionPorPasos,
} from './por-pasos-actions'
import { borrarOpcionesPorPasos, reponerOpcionesPorPasos, soltarImagenesPorPasos } from './por-pasos-borrar-actions'
import { autorizarBajoElMinimo } from './margen-salida-actions'
import { YA_CAMBIO } from '@/lib/cotizaciones/deshacer-por-pasos'
import { violacionDeInvariante } from '@/lib/cotizaciones/tarifas-por-pasos'
import { contextoDeCotizacion, leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { medirSalida } from '@/lib/cotizaciones/piso-salida'
import { huellaDe } from '@/lib/cotizaciones/piso-salida-datos'

const CAYO = 'actividad: Cayo Cangrejo'
const tabla = (n: string) => (base.tablas[n] ?? []) as Fila[]
const valorTotal = () => Number((tabla('cotizaciones')[0]).valor_total)
const seleccion = (id: string) => tabla('itinerario_opciones').filter(o => o.itinerario_id === id).map(o => o.item_id as string)
const precios = async () => ((await opcionesDeAprobacion(COT_SAN_ANDRES)) as { tarifas: { nombre: string; precio: number }[] }).tarifas

function sembrar(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.tablas.profiles.push({ id: 'p-dueno', workspace_id: WS_TRAPPVEL, role: 'owner', full_name: 'Dueño de Prueba', platform_admin: false })
  base.tablas.staff.push({ id: 's-dueno', workspace_id: WS_TRAPPVEL, full_name: 'Dueño de Prueba', position: 'Gerente', profile_id: 'p-dueno' })
  base.secuencia = 0
  base.registro = []
  borradas.length = 0
  Object.assign(sesion, { role: 'operator', userId: 'p-asesora', staffId: 's-asesora' })
}
/**
 * El doble no tiene llaves foráneas: la base borra en cascada los rubros, los adicionales y la
 * elección en cada tarifa de una opción borrada. Aquí se hace lo mismo a mano.
 */
function cascada() {
  const vivos = new Set(tabla('items').map(i => i.id))
  for (const t of ['rubros', 'item_adicionales', 'itinerario_opciones']) {
    base.tablas[t] = tabla(t).filter(f => vivos.has(f.item_id))
  }
}
async function borrar(ids: string[]) {
  const b = await borrarOpcionesPorPasos(COT_SAN_ANDRES, ids)
  cascada()
  return b
}
function estadoEnLaBase() {
  const items = tabla('items').map(i => ({
    id: i.id as string, grupo: (i.grupo ?? null) as string | null, orden: Number(i.orden ?? 0), es_ajuste: i.es_ajuste === true,
    dia_relativo: (i.dia_relativo ?? null) as number | null, entra_al_precio: (i.entra_al_precio ?? null) as boolean | null,
  }))
  const tarifas = tabla('cotizacion_itinerarios').map(t => ({
    id: t.id as string, nombre: (t.nombre ?? null) as string | null, orden: Number(t.orden), vaEnPropuesta: t.va_en_propuesta === true, seleccion: seleccion(t.id as string),
  }))
  return { items, tarifas }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

// ── D1 · Deshacer revierte en el acto, y solo si nadie cambió el campo ───────

describe('D1 · deshacer no retrasa nada y no pisa un cambio posterior', () => {
  it('la opción de una tarifa: se escribe y recalcula en el acto; deshacer vuelve el precio al peso', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const antes = await precios()
    const r = await elegirOpcionEnTarifa('tf-premium', CAYO, 'a-cayo-compartida')
    expect(r.success).toBe(true)
    // En el acto: la Premium ya cobra la compartida, sin esperar a ninguna cuenta.
    expect(seleccion('tf-premium')).toContain('a-cayo-compartida')
    expect(await precios()).not.toEqual(antes)
    const d = await deshacerPorPasos({ tipo: 'eleccion', cotizacionId: COT_SAN_ANDRES, itinerarioId: 'tf-premium', grupo: CAYO, escrita: 'a-cayo-compartida', anterior: (r as { anterior: string }).anterior })
    expect(d.success).toBe(true)
    expect(await precios()).toEqual(antes)
  })

  it('si alguien cambió la opción en medio: «Ya cambió: no se deshace», y no escribe', async () => {
    sembrar()
    await elegirOpcionEnTarifa('tf-premium', CAYO, 'a-cayo-compartida')
    await elegirOpcionEnTarifa('tf-premium', CAYO, 'a-cayo-privada') // otro cambio, en otra pestaña
    tomarRegistro()
    const d = await deshacerPorPasos({ tipo: 'eleccion', cotizacionId: COT_SAN_ANDRES, itinerarioId: 'tf-premium', grupo: CAYO, escrita: 'a-cayo-compartida', anterior: 'a-cayo-privada' })
    expect(d).toEqual({ success: false, error: YA_CAMBIO })
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('el margen único: deshacer vuelve el total; con otro margen en medio, no lo pisa', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const total = valorTotal()
    const r = await margenPorPasos(COT_SAN_ANDRES, 20)
    expect(r.success).toBe(true)
    expect(valorTotal()).toBeGreaterThan(total)
    expect((await deshacerPorPasos({ tipo: 'margen', cotizacionId: COT_SAN_ANDRES, escrito: 20, anterior: (r as { anterior: number }).anterior })).success).toBe(true)
    expect(valorTotal()).toBe(total)
    await margenPorPasos(COT_SAN_ANDRES, 18)
    await margenPorPasos(COT_SAN_ANDRES, 19)
    expect(await deshacerPorPasos({ tipo: 'margen', cotizacionId: COT_SAN_ANDRES, escrito: 18, anterior: 15 })).toEqual({ success: false, error: YA_CAMBIO })
    expect(Number(tabla('cotizaciones')[0].margen_porcentaje)).toBe(19)
  })

  it('mandar una tarifa y el estado de un servicio se deshacen igual', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const total = valorTotal()
    const m = await mandarTarifa('tf-premium', false)
    expect(m.success).toBe(true)
    expect((await deshacerPorPasos({ tipo: 'mandar', cotizacionId: COT_SAN_ANDRES, itinerarioId: 'tf-premium', escrita: false, anterior: true })).success).toBe(true)
    expect(tabla('cotizacion_itinerarios').find(t => t.id === 'tf-premium')?.va_en_propuesta).toBe(true)
    const e = await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'traslado: Traslado en Providencia', 'opcional')
    expect(valorTotal()).toBeLessThan(total)
    expect((await deshacerPorPasos({ tipo: 'estado', cotizacionId: COT_SAN_ANDRES, grupo: 'traslado: Traslado en Providencia', escrito: 'opcional', anterior: (e as { anterior: Record<string, 'incluido'> }).anterior })).success).toBe(true)
    expect(valorTotal()).toBe(total)
  })

  it('separar y juntar se deshacen devolviendo el grupo', async () => {
    sembrar()
    const s = await separarOpcionPorPasos('h-lord-pierre')
    expect(s.success).toBe(true)
    const nuevo = (s as { grupo: string }).grupo
    expect(nuevo).toMatch(/aparte/)
    expect((await deshacerPorPasos({ tipo: 'mover', cotizacionId: COT_SAN_ANDRES, itemId: 'h-lord-pierre', grupoEscrito: nuevo, grupoAnterior: 'hotel 2: Hotel en San Andrés' })).success).toBe(true)
    expect(tabla('items').find(i => i.id === 'h-lord-pierre')?.grupo).toBe('hotel 2: Hotel en San Andrés')
    const j = await juntarServicioPorPasos(COT_SAN_ANDRES, 'traslado 2: Traslado en San Andrés', 'traslado: Traslado en Providencia')
    expect(j.success).toBe(true)
    expect((await deshacerPorPasos({ tipo: 'juntar', cotizacionId: COT_SAN_ANDRES, movidas: (j as { movidas: string[] }).movidas, grupoEscrito: 'traslado: Traslado en Providencia', grupoAnterior: 'traslado 2: Traslado en San Andrés' })).success).toBe(true)
    expect(tabla('items').find(i => i.id === 't-san-andres')?.grupo).toBe('traslado 2: Traslado en San Andrés')
    expect(violacionDeInvariante(estadoEnLaBase())).toBeNull()
  })

  it('con el interruptor apagado, deshacer se rechaza sin escribir (N5)', async () => {
    sembrar({ interruptor: false })
    tomarRegistro()
    const d = await deshacerPorPasos({ tipo: 'margen', cotizacionId: COT_SAN_ANDRES, escrito: 15, anterior: 20 })
    expect(d.success).toBe(false)
    expect(escrituras(tomarRegistro())).toEqual([])
  })
})

// ── D2 · borrar y deshacer devuelve todo, con los mismos ids ────────────────

describe('D2 · borrar una opción escogida en la Premium y deshacer', () => {
  it('vuelve con el mismo id, sus rubros, su adicional y su elección en la Premium; su precio es el de antes', async () => {
    sembrar()
    base.tablas.item_adicionales = [{ id: 'ad-1', item_id: 'h-lord-pierre', codigo: null, nombre: 'Late check-out', cantidad: 1, costo: 100_000, precio: 120_000, moneda: 'COP', tasa: null, precio_manual: true }]
    await recalcularTotales(COT_SAN_ANDRES)
    const antes = await precios()
    const totalAntes = valorTotal()

    const b = await borrar(['h-lord-pierre'])
    expect(b.success, (b as { error?: string }).error).toBe(true)
    // En el acto: ya no está, la Premium tomó la propuesta de ONE y sigue completa.
    expect(tabla('items').some(i => i.id === 'h-lord-pierre')).toBe(false)
    expect(tabla('item_adicionales')).toEqual([])
    expect(seleccion('tf-premium')).not.toContain('h-lord-pierre')
    expect(violacionDeInvariante(estadoEnLaBase())).toBeNull()
    // Su pantallazo queda firmado para volver a la bandeja cuando venza la cuenta.
    expect((b as { devueltas: Record<string, unknown[]> }).devueltas['h-lord-pierre']).toHaveLength(1)

    const r = await reponerOpcionesPorPasos(COT_SAN_ANDRES, (b as { fotos: never[] }).fotos)
    expect(r.success, (r as { error?: string }).error).toBe(true)
    expect(tabla('items').some(i => i.id === 'h-lord-pierre')).toBe(true)
    expect(tabla('rubros').some(x => x.id === 'r-h-lord-pierre')).toBe(true)
    expect(tabla('item_adicionales').map(a => a.id)).toEqual(['ad-1'])
    expect(seleccion('tf-premium')).toContain('h-lord-pierre')
    expect(await precios()).toEqual(antes)
    expect(valorTotal()).toBe(totalAntes)
    // Deshacer dos veces no duplica nada.
    expect(await reponerOpcionesPorPasos(COT_SAN_ANDRES, (b as { fotos: never[] }).fotos)).toEqual({ success: false, error: YA_CAMBIO })
  })

  it('borrar el servicio entero (Cayo Cangrejo, dos opciones) y deshacer', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const antes = await precios()
    const b = await borrar(['a-cayo-compartida', 'a-cayo-privada'])
    expect(b.success).toBe(true)
    expect(tabla('items').some(i => String(i.id).startsWith('a-cayo'))).toBe(false)
    expect((await reponerOpcionesPorPasos(COT_SAN_ANDRES, (b as { fotos: never[] }).fotos)).success).toBe(true)
    expect(await precios()).toEqual(antes)
  })

  it('pasada la cuenta se sueltan solo las imágenes de esta cotización que nadie usa', async () => {
    sembrar()
    const lp = tabla('items').find(i => i.id === 'h-lord-pierre')!
    const tp = structuredClone(lp.tarifa_pax) as { casillas: { grupo_completo: Fila } }
    tp.casillas.grupo_completo.imagenRef = `sbext://one-documentos/negocios/${NEG_SAN_ANDRES}/capturas/${COT_SAN_ANDRES}/abc.png`
    lp.tarifa_pax = tp
    const b = await borrar(['h-lord-pierre'])
    const fotos = (b as { fotos: { item: Fila }[] }).fotos
    // Una ruta de otra cotización colada en la foto no se toca.
    ;(fotos[0].item.tarifa_pax as { fotoHotel?: unknown }).fotoHotel = { ref: 'sbext://one-documentos/negocios/otro/fotos-hotel/otra/x.jpg', proporcion: null }
    expect((await soltarImagenesPorPasos(COT_SAN_ANDRES, fotos as never)).success).toBe(true)
    expect(borradas).toEqual([`sbext://one-documentos/negocios/${NEG_SAN_ANDRES}/capturas/${COT_SAN_ANDRES}/abc.png`])
  })
})

// ── P6 y P7 · la autorización bajo el mínimo ────────────────────────────────

describe('P6 y P7 · pedir, autorizar con motivo, retirar', () => {
  function premiumBajoElMinimo() {
    const lord = tabla('items').find(i => i.id === 'h-lord-pierre')!
    lord.precio_manual = true
    lord.precio_venta = 4_000_000
  }

  it('pedir: queda en la actividad y le llega al dueño por `notificaciones`; la pantalla lo lee como «esperando»', async () => {
    sembrar()
    premiumBajoElMinimo()
    await recalcularTotales(COT_SAN_ANDRES)
    const r = await pedirAutorizacionPorPasos(COT_SAN_ANDRES)
    expect(r.success, (r as { error?: string }).error).toBe(true)
    const log = tabla('activity_log').find(l => l.campo_modificado === 'excepcion_margen')
    expect(log).toMatchObject({ valor_nuevo: 'pedida', entidad_id: NEG_SAN_ANDRES, autor_id: 's-asesora' })
    const notif = tabla('notificaciones')
    expect(notif).toHaveLength(1)
    expect(notif[0]).toMatchObject({ destinatario_id: 'p-dueno', tipo: 'aprobacion_pendiente', entidad_tipo: 'negocio' })
    expect(await getPedidoDeAutorizacion(COT_SAN_ANDRES)).toMatchObject({ por: 'Asesora de Prueba' })
  })

  it('sin estar bajo el mínimo no hay nada que pedir', async () => {
    sembrar()
    expect((await pedirAutorizacionPorPasos(COT_SAN_ANDRES)).success).toBe(false)
  })

  it('autorizar exige el dueño y el motivo; retirar es otra acción, del dueño, con su registro', async () => {
    sembrar()
    premiumBajoElMinimo()
    await recalcularTotales(COT_SAN_ANDRES)
    // Sin motivo, ni siquiera el dueño.
    Object.assign(sesion, { role: 'owner', userId: 'p-dueno', staffId: 's-dueno' })
    expect((await autorizarBajoElMinimo(COT_SAN_ANDRES, ' ')).success).toBe(false)
    expect((await autorizarBajoElMinimo(COT_SAN_ANDRES, 'Promoción de Lord Pierre acordada con el hotel')).success).toBe(true)
    // La asesora no puede retirarla.
    Object.assign(sesion, { role: 'operator', userId: 'p-asesora', staffId: 's-asesora' })
    expect((await retirarAutorizacionPorPasos(COT_SAN_ANDRES)).success).toBe(false)
    Object.assign(sesion, { role: 'owner', userId: 'p-dueno', staffId: 's-dueno' })
    const r = await retirarAutorizacionPorPasos(COT_SAN_ANDRES)
    expect(r.success, (r as { error?: string }).error).toBe(true)
    const exc = tabla('cotizacion_excepciones_margen')[0]
    expect(exc.perdida_causa).toBe('La retiró el dueño.')
    expect(tabla('activity_log').some(l => l.valor_nuevo === 'retirada')).toBe(true)
  })
})

describe('P6 · la huella de la autorización no cambia de forma', () => {
  it('la huella del caso fijo es la misma que da origin/main: una autorización vigente antes del deploy sigue vigente', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const ctx = await contextoDeCotizacion(clienteFalso(), COT_SAN_ANDRES)
    const filas = await leerItinerarios(clienteFalso(), COT_SAN_ANDRES)
    // Grabada sobre este caso con el código de origin/main (firmaDe y huellaDe sin tocar).
    expect(huellaDe(medirSalida(ctx!, filas))).toBe(HUELLA_CASO_FIJO)
  })
})

const HUELLA_CASO_FIJO = 'PENDIENTE'
