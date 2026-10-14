/**
 * C5 · ACEPTAR EN LOTE, LA FRASE DE A DÓNDE VA, «COMPLETA» Y «✎ ESCRÍBELO A MANO», contra el doble
 * de igualdad de C0.
 *
 *  · V4: los 11 del caso fijo, aceptados en lote, dejan 8 servicios (3 con opciones) en el orden
 *    del viaje, con UN solo recálculo.
 *  · Ida y vuelta: lo aceptado en lote se abre, suma, imprime y se aprueba igual apagado.
 *  · N5: el lote, las decisiones nuevas y el vuelo o la actividad escritos a mano se rechazan con
 *    el interruptor apagado, sin escribir.
 *  · V4 / P12: el pantallazo de SATENA con 6 adultos y 1 niño completa el precio del niño y no
 *    crea un servicio; «No paga en este proveedor» cierra el infante.
 *  · P11: el servicio marcado Opcional llega Opcional.
 *  · V6: «Aceptar» nunca llama al modelo.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, NEG_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'
import { leerPlata, ponerInterruptor } from '../../../../test/por-pasos-lectura'
import { leer, onceDelCasoFijo, SATENA, type Pantallazo } from '../../../../test/caso-once-pantallazos'

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
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))
vi.mock('@/app/(app)/negocios/[id]/vista-negocio', () => ({ cargarVistaNegocio: async () => null }))
const captura = vi.hoisted(() => ({ activa: false, props: null as unknown }))
vi.mock('@/lib/pdf/plantillas-cotizacion', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/plantillas-cotizacion')>()
  return {
    ...real,
    compositorDePlantilla: (slug: string | null | undefined) => {
      const c = real.compositorDePlantilla(slug)
      if (!c) return null
      return async (props: Parameters<typeof c>[0]) => {
        if (captura.activa && captura.props === null) captura.props = props
        return c(props)
      }
    },
  }
})
// La lectura del pantallazo (Gemini) no corre en pruebas: devuelve la de Cayo Cangrejo en lancha privada.
vi.mock('@/lib/cotizaciones/leer-imagen-captura', async () => {
  const { onceDelCasoFijo: once } = await import('../../../../test/caso-once-pantallazos')
  return { leerImagenDeCaptura: async () => ({ ok: true, leida: structuredClone(once()[9].lectura) }) }
})
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
// Cuántos recálculos corren DE VERDAD (los diferidos dentro del lote no cuentan): V4.
const conteo = vi.hoisted(() => ({ recalculos: 0 }))
vi.mock('./cotizacion-actions', async importOriginal => {
  const real = await importOriginal<typeof import('./cotizacion-actions')>()
  return {
    ...real,
    recalcularTotales: async (id: string) => {
      const r = await real.recalcularTotales(id)
      if (!(r as { diferido?: boolean }).diferido) conteo.recalculos += 1
      return r
    },
  }
})

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { aceptarCotizacionNegocio, opcionesDeAprobacion } from './[id]/cotizacion/actions'
import { enviarPorPasos } from './por-pasos-actions'
import { escribirPrecioQueFalta } from './tarifa-pax-actions'
import { firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { decisionParaAceptar, destinoDeReglas } from '@/lib/cotizaciones/destino-por-pasos'
import { normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { tiposSinPrecio } from '@/lib/cotizaciones/precio-que-falta'
import { POST as aceptarLote } from '@/app/api/cotizaciones/[id]/aceptar-lote/route'
import { POST as aceptarUno } from '@/app/api/cotizaciones/[id]/aceptar-captura/route'
import { POST as lecturaManualRuta } from '@/app/api/cotizaciones/[id]/lectura-manual/route'

const LECTORES = { recalcularTotales, generateCotizacionPDF, opcionesDeAprobacion, aceptarCotizacionNegocio }
const tabla = (t: string) => base.tablas[t] ?? []

beforeAll(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

/** La cotización por pasos del caso, VACÍA: sin servicios ni tarifas, lista para pegar los 11. */
function sembrarVacia(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.tablas.items = []
  base.tablas.rubros = []
  base.tablas.cotizacion_itinerarios = []
  base.tablas.itinerario_opciones = []
  base.secuencia = 0
  base.registro = []
}

function borrador(p: Pantallazo, decision: string = 'auto', destinoId: string | null = null) {
  const lecturaJson = JSON.stringify(p.lectura)
  return {
    tipo: p.tipo, lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, p.tipo, lecturaJson)!,
    pistas: p.pistas, decision, destinoId, imagen: null, correcciones: null, idAceptacion: p.id,
  }
}

async function postLote(filas: unknown[]) {
  const res = await aceptarLote(
    new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-lote`, { method: 'POST', body: JSON.stringify({ filas }) }),
    { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
  )
  return (await res.json()) as { ok: boolean; codigo?: string; mensaje?: string; resultados?: { id: string; resultado: { ok: boolean; itemId?: string; como?: string; mensaje?: string } }[]; tarifas?: string | null }
}

/**
 * Las 11 filas como las manda la bandeja: la frase de las reglas viaja como `auto` (el servidor
 * decide contra la cotización de ESE momento), y la lancha privada, que la asesora tocó como
 * «Otra opción de: Cayo Cangrejo», apunta a la lancha compartida del MISMO lote.
 */
function filasDelLote(pantallazos: Pantallazo[], estado: Record<string, 'opcional'> = {}) {
  return pantallazos.map(p => {
    const d = decisionParaAceptar(destinoDeReglas({ tipo: p.tipo, lectura: p.lectura, pistas: p.pistas, lineas: [], grupoViaje: { adultos: 6, ninos: 1, infantes: 1 } }))
    if (p.id === 'cap-caso-10') return { id: p.id, borrador: borrador(p, 'hermana'), destinoCaptura: 'cap-caso-09' }
    return { id: p.id, borrador: borrador(p, d.decision, d.destinoId), ...(estado[p.id] ? { estado: estado[p.id] } : {}) }
  })
}

const servicios = () => {
  const porGrupo = new Map<string, string[]>()
  for (const i of tabla('items')) {
    if (i.es_ajuste === true) continue
    const g = normalizarGrupo(i.grupo as string)!
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), i.id as string])
  }
  return porGrupo
}

describe('C5 · V4 · «Aceptar los 11» en lote', () => {
  it('deja 8 servicios, 3 con opciones, en el orden del viaje, con UN solo recálculo', async () => {
    sembrarVacia()
    conteo.recalculos = 0
    tomarRegistro()
    const r = await postLote(filasDelLote(onceDelCasoFijo()))
    expect(r.ok, r.mensaje).toBe(true)
    for (const x of r.resultados!) expect(x.resultado.ok, `${x.id}: ${x.resultado.mensaje}`).toBe(true)
    expect(conteo.recalculos).toBe(1)

    const s = servicios()
    expect(s.size).toBe(8)
    // Las tres con opciones: hotel de Providencia, hotel de San Andrés y Cayo Cangrejo.
    const de = (id: string) => r.resultados!.find(x => x.id === id)!.resultado.itemId!
    const conOpciones = [...s.values()].filter(ids => ids.length > 1).map(ids => [...ids].sort()).sort()
    expect(conOpciones).toEqual([
      [de('cap-caso-03'), de('cap-caso-04')].sort(),
      [de('cap-caso-05'), de('cap-caso-06')].sort(),
      [de('cap-caso-09'), de('cap-caso-10')].sort(),
    ].sort())
    // SATENA es servicio nuevo, nunca opción de Avianca; el traslado de San Andrés, nunca opción del de Providencia.
    expect([...s.keys()].filter(g => g.startsWith('vuelo'))).toHaveLength(2)
    expect([...s.keys()].filter(g => g.startsWith('traslado'))).toHaveLength(2)
    // El buceo nunca es opción del kayak ni de Cayo Cangrejo.
    const buceo = r.resultados!.find(x => x.id === 'cap-caso-11')!.resultado.itemId!
    expect(s.get(normalizarGrupo(tabla('items').find(i => i.id === buceo)!.grupo as string)!)).toEqual([buceo])

    // Las tarifas que propone ONE: la Recomendada lleva la primera pegada de cada servicio.
    const rec = tabla('cotizacion_itinerarios').find(t => t.nombre === 'Recomendada')!
    const enRec = new Set(tabla('itinerario_opciones').filter(o => o.itinerario_id === rec.id).map(o => o.item_id))
    const primera = (id: string) => r.resultados!.find(x => x.id === id)!.resultado.itemId!
    for (const id of ['cap-caso-03', 'cap-caso-05', 'cap-caso-09']) expect(enRec.has(primera(id)), id).toBe(true)
    for (const id of ['cap-caso-04', 'cap-caso-06', 'cap-caso-10']) expect(enRec.has(primera(id)), id).toBe(false)
    expect(rec.va_en_propuesta).toBe(true)
  }, 60_000)

  it('ida y vuelta: lo aceptado en lote suma, imprime y se aprueba igual con el interruptor apagado', async () => {
    sembrarVacia()
    await postLote(filasDelLote(onceDelCasoFijo()))
    const despues = structuredClone(base.tablas)
    const premium = tabla('cotizacion_itinerarios').find(t => t.nombre === 'Premium')?.id as string
    const args = { cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: premium }
    // El reloj fijo: la aprobación escribe fechas.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
    try {
      base.tablas = structuredClone(despues)
      ponerInterruptor(true)
      const encendido = await leerPlata(LECTORES, captura, args)
      base.tablas = structuredClone(despues)
      ponerInterruptor(false)
      const apagado = await leerPlata(LECTORES, captura, args)
      expect(apagado).toEqual(encendido)
      expect((encendido.aprobacion as { resultado: { success: boolean } }).resultado.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)

  it('si una falla, las demás quedan, la que falla vuelve con su causa, y el recálculo sigue siendo uno', async () => {
    sembrarVacia()
    conteo.recalculos = 0
    const filas = filasDelLote(onceDelCasoFijo().slice(0, 3))
    filas[1] = { ...filas[1], borrador: { ...filas[1].borrador, firma: 'vencida' } }
    const r = await postLote(filas)
    expect(r.ok).toBe(true)
    expect(r.resultados!.map(x => x.resultado.ok)).toEqual([true, false, true])
    expect(r.resultados![1].resultado.mensaje).toMatch(/Vuelve a pegarla/)
    expect(conteo.recalculos).toBe(1)
  }, 60_000)

  it('un reintento del mismo lote no duplica nada (idempotencia por captura)', async () => {
    sembrarVacia()
    const filas = filasDelLote(onceDelCasoFijo())
    await postLote(filas)
    const antes = tabla('items').length
    const r = await postLote(filas)
    expect(r.ok).toBe(true)
    expect(tabla('items').length).toBe(antes)
  }, 60_000)
})

describe('C5 · N5 · con el interruptor apagado no entra nada nuevo', () => {
  it('el lote se rechaza sin escribir', async () => {
    sembrarVacia({ interruptor: false })
    tomarRegistro()
    const r = await postLote(filasDelLote(onceDelCasoFijo().slice(0, 2)))
    expect(r.ok).toBe(false)
    expect(r.codigo).toBe('POR_PASOS')
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('las decisiones nuevas («nueva», «hermana», «completa») no pasan por la ruta de siempre', async () => {
    sembrarVacia()
    const [p] = onceDelCasoFijo()
    for (const decision of ['nueva', 'hermana', 'completa']) {
      const res = await aceptarUno(
        new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-captura`, { method: 'POST', body: JSON.stringify(borrador(p, decision)) }),
        { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
      )
      expect(res.status, decision).toBe(400)
    }
    expect(tabla('items')).toEqual([])
  })

  it('el vuelo y la actividad escritos a mano solo existen con la forma por pasos', async () => {
    const post = (cuerpo: unknown) => lecturaManualRuta(
      new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/lectura-manual`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
    )
    sembrarVacia()
    const sinMarca = await post({ tipo: 'vuelo', datos: SATENA.datos })
    expect(sinMarca.status).toBe(400)
    sembrarVacia({ interruptor: false })
    const apagado = await (await post({ tipo: 'vuelo', datos: SATENA.datos, porPasos: true })).json() as { ok: boolean; codigo: string }
    expect(apagado).toMatchObject({ ok: false, codigo: 'POR_PASOS' })
    sembrarVacia()
    const ok = await (await post({ tipo: 'vuelo', datos: SATENA.datos, porPasos: true })).json() as { ok: boolean; lectura: { origen: string } }
    expect(ok.ok).toBe(true)
    expect(ok.lectura.origen).toBe('manual')
  })
})

describe('C5 · V4 · el pantallazo que COMPLETA el precio del niño', () => {
  /** SATENA escrita a mano con solo el precio del adulto: le falta el del niño y el del infante. */
  async function satenaSoloAdulto(): Promise<string> {
    sembrarVacia()
    const sat: Pantallazo = { id: 'cap-satena-1', tipo: 'vuelo', lectura: leer({ ...SATENA, datos: { ...SATENA.datos, netoNino: null, netoInfante: null } }), pistas: { lugar: null, origen: 'San Andrés', destino: 'Providencia' } }
    const r = await postLote([{ id: sat.id, borrador: borrador(sat) }])
    const itemId = r.resultados![0].resultado.itemId!
    const linea = tabla('items').find(i => i.id === itemId)!
    expect(tiposSinPrecio({ grupo: linea.grupo as string, tarifa_pax: linea.tarifa_pax }, { adultos: 6, ninos: 1, infantes: 1 })).toEqual(['nino', 'infante'])
    return itemId
  }

  it('la bandeja lo reconoce («Completa SATENA: precio del niño») y al aceptar no crea un servicio', async () => {
    const itemId = await satenaSoloAdulto()
    const completa: Pantallazo = {
      id: 'cap-satena-nino', tipo: 'vuelo',
      lectura: leer({ ...SATENA, datos: { ...SATENA.datos, adultos: 6, ninos: 1, infantes: 0, netoNino: 447_000, netoInfante: null } }),
      pistas: { lugar: null, origen: 'San Andrés', destino: 'Providencia' },
    }
    const lineas = tabla('items') as unknown as Parameters<typeof destinoDeReglas>[0]['lineas']
    const d = destinoDeReglas({ tipo: 'vuelo', lectura: completa.lectura, pistas: completa.pistas, lineas, grupoViaje: { adultos: 6, ninos: 1, infantes: 1 } })
    expect(d).toMatchObject({ como: 'completa', itemId, tipos: ['nino'], precios: { nino: 447_000 } })
    expect(d.razon).toMatch(/trae el precio del niño que faltaba/)

    const antes = tabla('items').length
    const { decision, destinoId } = decisionParaAceptar(d)
    const r = await postLote([{ id: completa.id, borrador: borrador(completa, decision, destinoId) }])
    expect(r.resultados![0].resultado).toMatchObject({ ok: true, itemId, como: 'completa' })
    expect(tabla('items').length).toBe(antes)
    const linea = tabla('items').find(i => i.id === itemId)!
    const tp = linea.tarifa_pax as { costosAMano: Record<string, { unitario: number; desde?: string }> }
    expect(tp.costosAMano.nino).toMatchObject({ unitario: 447_000, desde: 'pantallazo' })
    // Queda el infante: «No paga en este proveedor», y ya se puede enviar por el precio.
    expect(tiposSinPrecio({ grupo: linea.grupo as string, tarifa_pax: linea.tarifa_pax }, { adultos: 6, ninos: 1, infantes: 1 })).toEqual(['infante'])
    const bloqueado = await enviarPorPasos(COT_SAN_ANDRES)
    expect((bloqueado as { error?: string }).error ?? '').toMatch(/infante/)
    expect((await escribirPrecioQueFalta(itemId, 'infante', 0)).success).toBe(true)
    const r2 = await enviarPorPasos(COT_SAN_ANDRES)
    expect((r2 as { error?: string }).error ?? '').not.toMatch(/precio por pasajero/)
  }, 60_000)

  it('si ya no le falta el precio, «completa» no escribe nada y lo dice', async () => {
    const itemId = await satenaSoloAdulto()
    await escribirPrecioQueFalta(itemId, 'nino', 400_000)
    const completa: Pantallazo = {
      id: 'cap-satena-nino', tipo: 'vuelo',
      lectura: leer({ ...SATENA, datos: { ...SATENA.datos, ninos: 1, infantes: 0, netoNino: 447_000, netoInfante: null } }),
      pistas: { lugar: null, origen: null, destino: null },
    }
    const r = await postLote([{ id: completa.id, borrador: borrador(completa, 'completa', itemId) }])
    expect(r.resultados![0].resultado).toMatchObject({ ok: false })
    expect(r.resultados![0].resultado.mensaje).toMatch(/ya no le falta/)
  }, 60_000)
})

describe('H1 · V4 con la lectura REAL: el pantallazo de solo adultos fija 6/0/0 en la línea', () => {
  /**
   * El pantallazo de SATENA que trae solo «Adulto · 6» (verificación D de Vera): la lectura guarda
   * su propia composición, no la del viaje. Es la forma que tenía la base en `trappvel-pruebas`.
   */
  async function satenaDePantallazo(): Promise<string> {
    sembrarVacia()
    const lectura = leer({ ...SATENA, datos: { ...SATENA.datos, adultos: 6, ninos: 0, infantes: 0, netoAdulto: 470_314, netoNino: null, netoInfante: null } })
    delete (lectura as { origen?: string }).origen
    const sat: Pantallazo = { id: 'cap-satena-real', tipo: 'vuelo', lectura, pistas: { lugar: null, origen: 'San Andrés', destino: 'Providencia' } }
    const r = await postLote([{ id: sat.id, borrador: borrador(sat) }])
    const itemId = r.resultados![0].resultado.itemId!
    const tp = tabla('items').find(i => i.id === itemId)!.tarifa_pax as { composicion: unknown }
    expect(tp.composicion).toEqual({ adultos: 6, ninos: 0, infantes: 0 })
    return itemId
  }

  it('le falta el precio del niño y del infante, y Enviar se rechaza', async () => {
    const itemId = await satenaDePantallazo()
    const linea = tabla('items').find(i => i.id === itemId)!
    expect(tiposSinPrecio({ grupo: linea.grupo as string, tarifa_pax: linea.tarifa_pax }, { adultos: 6, ninos: 1, infantes: 1 })).toEqual(['nino', 'infante'])
    const r = await enviarPorPasos(COT_SAN_ANDRES)
    expect((r as { error?: string }).error ?? '').toMatch(/niño e infante/)
  }, 60_000)

  it('«Completa SATENA: precio del niño» deja el costo de los 6 adultos MÁS el niño', async () => {
    const itemId = await satenaDePantallazo()
    const nino = leer({ ...SATENA, datos: { ...SATENA.datos, adultos: 6, ninos: 1, infantes: 0, netoAdulto: 470_314, netoNino: 470_312, netoInfante: null } })
    delete (nino as { origen?: string }).origen
    const completa: Pantallazo = { id: 'cap-satena-real-nino', tipo: 'vuelo', lectura: nino, pistas: { lugar: null, origen: 'San Andrés', destino: 'Providencia' } }
    const lineas = tabla('items') as unknown as Parameters<typeof destinoDeReglas>[0]['lineas']
    const d = destinoDeReglas({ tipo: 'vuelo', lectura: completa.lectura, pistas: completa.pistas, lineas, grupoViaje: { adultos: 6, ninos: 1, infantes: 1 } })
    expect(d).toMatchObject({ como: 'completa', itemId, tipos: ['nino'] })
    const { decision, destinoId } = decisionParaAceptar(d)
    const r = await postLote([{ id: completa.id, borrador: borrador(completa, decision, destinoId) }])
    expect(r.resultados![0].resultado).toMatchObject({ ok: true, itemId, como: 'completa' })
    const ei = await escribirPrecioQueFalta(itemId, 'infante', 0); expect(ei.error ?? 'ok').toBe('ok')
    const linea = tabla('items').find(i => i.id === itemId)!
    const tp = linea.tarifa_pax as { confirmada: { costos: { tipo: string; cantidad: number; totalCOP: number }[]; costoTotalCOP: number } }
    expect(tp.confirmada.costos.map(c => [c.tipo, c.cantidad])).toEqual([['adulto', 6], ['nino', 1], ['infante', 1]])
    expect(tp.confirmada.costoTotalCOP).toBe(2_821_884 + 470_312)
    const r2 = await enviarPorPasos(COT_SAN_ANDRES)
    expect((r2 as { error?: string }).error ?? '').not.toMatch(/precio por pasajero/)
  }, 60_000)
})

describe('C5 · P11 · «Opcional» al aceptar', () => {
  it('la actividad marcada «Es opcional» llega Opcional: no suma y se ofrece aparte', async () => {
    sembrarVacia()
    const once = onceDelCasoFijo({ buceoOpcional: true })
    const r = await postLote(filasDelLote(once, { 'cap-caso-11': 'opcional' }))
    const buceo = tabla('items').find(i => i.id === r.resultados!.find(x => x.id === 'cap-caso-11')!.resultado.itemId)!
    expect(buceo.entra_al_precio).toBe(false)
    expect(buceo.mostrar_en_sugeridos).toBe(true)
    // Los demás, Incluidos como siempre.
    const cayo = tabla('items').find(i => i.id === r.resultados!.find(x => x.id === 'cap-caso-09')!.resultado.itemId)!
    expect(cayo.entra_al_precio).not.toBe(false)
  }, 60_000)

  it('un hotel no puede llegar Opcional (vuelo y hotel van o no van)', async () => {
    sembrarVacia()
    const once = onceDelCasoFijo().slice(2, 3)
    const r = await postLote(filasDelLote(once, { 'cap-caso-03': 'opcional' }))
    const h = tabla('items').find(i => i.id === r.resultados![0].resultado.itemId)!
    expect(h.entra_al_precio).not.toBe(false)
  }, 60_000)
})

describe('C5 · V6 · «Aceptar» nunca llama al modelo', () => {
  it('aceptar en lote no hace ninguna llamada de red', async () => {
    sembrarVacia()
    const red = vi.fn(async () => { throw new Error('Aceptar no puede llamar a la red') })
    vi.stubGlobal('fetch', red)
    try {
      const r = await postLote(filasDelLote(onceDelCasoFijo().slice(0, 4)))
      expect(r.ok).toBe(true)
      expect(red).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  }, 60_000)
})

describe('C5 · V6 · la decisión del modelo corre en la LECTURA', () => {
  const IMAGEN = 'data:image/png;base64,iVBORw0KGgo='
  async function leerPorRuta(cuerpo: Record<string, unknown>) {
    const { POST } = await import('@/app/api/cotizaciones/[id]/leer-captura/route')
    const res = await POST(
      new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/leer-captura`, { method: 'POST', body: JSON.stringify({ tipo: 'actividad', dataUrl: IMAGEN, ...cuerpo }) }),
      { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
    )
    return (await res.json()) as { ok: boolean; modelo?: unknown }
  }
  const SERVICIOS = [{ id: 'a-cayo-compartida', tipo: 'actividad', servicio: 'Cayo Cangrejo', nombre: 'CAYO CANGREJO · LANCHA COMPARTIDA', detalle: '' }]

  it('sin la marca de la forma por pasos, la lectura es la de siempre: no pregunta al modelo', async () => {
    sembrarVacia({ caso: { configWorkspace: {} } })
    const red = vi.fn(async () => { throw new Error('no debe llamar') })
    vi.stubGlobal('fetch', red)
    try {
      const r = await leerPorRuta({})
      expect(r.ok).toBe(true)
      expect('modelo' in r).toBe(false)
      expect(red).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('con la pieza `modelo_destino` apagada (lo de hoy) tampoco pregunta (M4)', async () => {
    sembrarVacia({ piezasApagadas: ['modelo_destino'] })
    const red = vi.fn(async () => { throw new Error('no debe llamar') })
    vi.stubGlobal('fetch', red)
    try {
      const r = await leerPorRuta({ porPasos: true, servicios: SERVICIOS })
      expect(r.ok).toBe(true)
      expect('modelo' in r).toBe(false)
      expect(red).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('con la pieza encendida: el modelo caído deja `modelo: null`; a tiempo, su decisión', async () => {
    sembrarVacia()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    try {
      expect(await leerPorRuta({ porPasos: true, servicios: SERVICIOS })).toMatchObject({ ok: true, modelo: null })
    } finally {
      vi.unstubAllGlobals()
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ como: 'hermana', servicio: 'a-cayo-compartida', duda: false, razon: 'La misma excursión en otra lancha' }) }] } }],
    }))))
    try {
      expect(await leerPorRuta({ porPasos: true, servicios: SERVICIOS })).toMatchObject({
        ok: true, modelo: { como: 'hermana', itemId: 'a-cayo-compartida', razon: 'La misma excursión en otra lancha', duda: false },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// Para que el tipo `Fila` no quede sin uso si se recorta el archivo.
export type _Fila = Fila
