/**
 * C6 · «INCLUYE» ARMADO POR ONE Y LA LISTA ÚNICA, contra el doble de igualdad de C0 y el caso
 * fijo de San Andrés.
 *
 *  · D6: con la marca `documento_cliente.incluye_origen = 'one'`, el PDF arma «Incluye» con lo que
 *    se cobra en la Recomendada (sin IA), conserva las líneas propias de la asesora, no toca
 *    Opcionales ni cargos en destino, e imprime LO MISMO con el interruptor apagado (la marca va en
 *    el dato). Sin la marca, el PDF de siempre.
 *  · V1: quitar el vuelo de SATENA lo saca de «Incluye».
 *  · Guardar y redactar con la forma por pasos escriben la marca; apagada, se rechaza.
 *  · D8: «Impide enviar» tiene exactamente lo que el servidor rechaza al enviar, en el mismo orden.
 */
import { describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, NEG_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'
import { leerPlata, ponerInterruptor } from '../../../../test/por-pasos-lectura'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
const sesion = vi.hoisted(() => ({ role: 'operator', userId: 'p-asesora', staffId: 's-asesora' }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => ({
      supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: sesion.userId, staffId: sesion.staffId,
      role: sesion.role, areas: [], impersonating: false, realRole: sesion.role, error: null,
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
// El redactor (Gemini) no corre en pruebas: devuelve un texto fijo con su propio «incluye».
vi.mock('@/lib/ai/redactar-documento-cliente', () => ({
  redactarTextoCliente: async () => ({
    texto: { titular: 'San Andrés y Providencia en familia', intro: 'Cinco noches entre dos islas.', incluye: ['Lo que escribió el modelo'], antes_de_viajar: ['Lleva bloqueador'] },
    modelo: 'modelo-de-prueba',
  }),
}))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
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

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { aceptarCotizacionNegocio, opcionesDeAprobacion } from './[id]/cotizacion/actions'
import { enviarPorPasos, estadoDeServicioPorPasos } from './por-pasos-actions'
import { guardarDocumentoCliente, redactarDocumentoCliente } from './documento-cliente-actions'
import { getSalidaDeCotizacion } from './margen-salida-actions'
import { listaUnica, type EntradaDeLista } from '@/lib/cotizaciones/lista-unica'
import { lineasDesactualizadas, motivoParaNoEnviar } from '@/lib/cotizaciones/captura-desactualizada'
import { opcionesSinPrecio } from '@/lib/cotizaciones/precio-que-falta'
import { itemsDelItinerario, itemsQueAportanAlTotal } from '@/lib/cotizaciones/itinerarios'
import { paquetesIncompletos } from '@/lib/cotizaciones/bloqueo-incompleto'
import { paqueteVacio } from '@/lib/cotizaciones/bloqueo-paquete'

const LECTORES = { recalcularTotales, generateCotizacionPDF, opcionesDeAprobacion, aceptarCotizacionNegocio }
const tabla = (t: string) => base.tablas[t] ?? []
const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }

function sembrar(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.secuencia = 0
  base.registro = []
  sesion.role = 'operator'
}

/** Un texto revisado, como lo deja «Guardar texto revisado». */
function textoRevisado(extra: Fila = {}): Fila {
  return {
    titular: 'San Andrés y Providencia en familia', intro: 'Cinco noches entre dos islas.',
    incluye: ['Lo que escribió el modelo'], antes_de_viajar: ['Lleva bloqueador'],
    origen: 'ia', modelo: 'modelo-de-prueba', redactado_en: '2026-10-12T14:00:00.000Z', fuente_hash: null,
    revisado_por: 's-asesora', revisado_por_nombre: 'Asesora de Prueba', revisado_en: '2026-10-12T14:10:00.000Z',
    ...extra,
  }
}

async function incluyeDelPdf(): Promise<string[] | undefined> {
  captura.activa = true
  captura.props = null
  const r = await generateCotizacionPDF(COT_SAN_ANDRES) as { success: boolean; error?: string }
  captura.activa = false
  expect(r.success, r.error).toBe(true)
  return (captura.props as { viaje?: { incluye?: string[] } } | null)?.viaje?.incluye
}

describe('C6 · D6 · «Incluye» armado por ONE', () => {
  it('sin la marca, «Incluye» es el texto guardado, como siempre', async () => {
    sembrar()
    ;(tabla('cotizaciones')[0] as Fila).documento_cliente = textoRevisado()
    await recalcularTotales(COT_SAN_ANDRES)
    expect(await incluyeDelPdf()).toEqual(['Lo que escribió el modelo'])
  })

  it('con la marca, lo arma ONE con lo que se cobra en la Recomendada y deja debajo las líneas propias', async () => {
    sembrar()
    ;(tabla('cotizaciones')[0] as Fila).documento_cliente = textoRevisado({ incluye: ['Tarjeta de turismo de San Andrés'], incluye_origen: 'one' })
    await recalcularTotales(COT_SAN_ANDRES)
    const incluye = (await incluyeDelPdf())!
    // La Recomendada: los dos vuelos, Posada Enilda, Verde Mar, los dos traslados, Cayo Cangrejo compartida y el buceo.
    expect(incluye.some(r => /Tiquetes aéreos .*San Andrés.* con Avianca/.test(r))).toBe(true)
    expect(incluye.some(r => /SATENA/.test(r))).toBe(true)
    expect(incluye.some(r => /Posada Enilda/.test(r))).toBe(true)
    expect(incluye.some(r => /Verde Mar/.test(r))).toBe(true)
    // Lo que no se cobra en la Recomendada no está: Lord Pierre, Agua Dulce, la lancha privada.
    expect(incluye.some(r => /Lord Pierre|Agua Dulce|PRIVADA/i.test(r))).toBe(false)
    // Sin cifras, y la línea propia al final.
    expect(incluye.some(r => /\$\s?\d/.test(r))).toBe(false)
    expect(incluye.at(-1)).toBe('Tarjeta de turismo de San Andrés')
    expect(incluye).not.toContain('Lo que escribió el modelo')
  })

  it('la marca va en el dato: con el interruptor apagado el PDF imprime lo mismo (ida y vuelta)', async () => {
    sembrar()
    ;(tabla('cotizaciones')[0] as Fila).documento_cliente = textoRevisado({ incluye: [], incluye_origen: 'one' })
    await recalcularTotales(COT_SAN_ANDRES)
    const despues = structuredClone(base.tablas)
    const args = { cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-premium' }
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
    try {
      base.tablas = structuredClone(despues)
      ponerInterruptor(true)
      const encendido = await leerPlata(LECTORES, captura, args)
      base.tablas = structuredClone(despues)
      ponerInterruptor(false)
      const apagado = await leerPlata(LECTORES, captura, args)
      expect(apagado).toEqual(encendido)
      expect(((encendido.pdf as { props: { viaje: { incluye: string[] } } }).props.viaje.incluye).length).toBeGreaterThan(3)
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)

  it('V1 · el vuelo de SATENA que no va sale de «Incluye»; un traslado Opcional tampoco está', async () => {
    sembrar()
    ;(tabla('cotizaciones')[0] as Fila).documento_cliente = textoRevisado({ incluye: [], incluye_origen: 'one' })
    await recalcularTotales(COT_SAN_ANDRES)
    expect((await incluyeDelPdf())!.some(r => /SATENA/.test(r))).toBe(true)
    expect((await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'vuelo 2: Vuelo San Andrés ⇄ Providencia', 'no')).success).toBe(true)
    expect((await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'traslado: Traslado en Providencia', 'opcional')).success).toBe(true)
    const incluye = (await incluyeDelPdf())!
    expect(incluye.some(r => /SATENA/.test(r))).toBe(false)
    expect(incluye.some(r => /PROVIDENCIA/i.test(r) && /Traslado/.test(r))).toBe(false)
  })

  it('guardar y redactar con la forma por pasos escriben la marca; la lista del modelo no se guarda', async () => {
    sembrar()
    const g = await guardarDocumentoCliente(COT_SAN_ANDRES, { titular: 'T', intro: null, incluye: ['Tarjeta de turismo'], antes_de_viajar: [] }, undefined, { porPasos: true })
    expect(g.success, (g as { error?: string }).error).toBe(true)
    expect((tabla('cotizaciones')[0] as Fila).documento_cliente).toMatchObject({ incluye: ['Tarjeta de turismo'], incluye_origen: 'one' })
    const r = await redactarDocumentoCliente(COT_SAN_ANDRES, { reemplazarRevisado: true, porPasos: true })
    expect(r.success, (r as { error?: string }).error).toBe(true)
    expect((tabla('cotizaciones')[0] as Fila).documento_cliente).toMatchObject({ incluye: [], incluye_origen: 'one', revisado_en: null })
  })

  it('una vez marcada, guardar con la pantalla de siempre no quita la marca', async () => {
    sembrar()
    await guardarDocumentoCliente(COT_SAN_ANDRES, { titular: 'T', intro: null, incluye: [], antes_de_viajar: [] }, undefined, { porPasos: true })
    ponerInterruptor(false)
    const g = await guardarDocumentoCliente(COT_SAN_ANDRES, { titular: 'Otro', intro: null, incluye: ['Una propia'], antes_de_viajar: [] })
    expect(g.success).toBe(true)
    expect((tabla('cotizaciones')[0] as Fila).documento_cliente).toMatchObject({ titular: 'Otro', incluye_origen: 'one' })
  })

  it('N5 · con el interruptor apagado, o la pieza `incluye_por_one` apagada, no se marca nada', async () => {
    for (const o of [{ interruptor: false }, { piezasApagadas: ['incluye_por_one'] }] as OpcionesPorPasos[]) {
      sembrar(o)
      tomarRegistro()
      const g = await guardarDocumentoCliente(COT_SAN_ANDRES, { titular: 'T', intro: null, incluye: [], antes_de_viajar: [] }, undefined, { porPasos: true })
      expect(g.success, JSON.stringify(o)).toBe(false)
      expect(escrituras(tomarRegistro())).toEqual([])
    }
  })
})

describe('C6 · N10 · la paginación aguanta «Incluye» armado por ONE', () => {
  /** El documento del caso fijo, con la marca y el nivel de detalle pedido, compuesto de verdad. */
  async function informe(nivel: 'normal' | 'muy_detallada', conMarca: boolean) {
    sembrar()
    ;(tabla('cotizaciones')[0] as Fila).documento_cliente = textoRevisado(conMarca ? { incluye: ['Tarjeta de turismo de San Andrés'], incluye_origen: 'one' } : {})
    for (const b of tabla('negocio_bloques')) {
      const d = b.data as Fila | undefined
      if (d && 'nivel_detalle' in d) d.nivel_detalle = nivel
    }
    await recalcularTotales(COT_SAN_ANDRES)
    captura.activa = true
    captura.props = null
    await generateCotizacionPDF(COT_SAN_ANDRES)
    captura.activa = false
    const props = captura.props as Parameters<typeof import('@/lib/pdf/cotizacion-trappvel-paginacion').componerCotizacionTrappvel>[0]
    expect(props.viaje?.incluye?.length ?? 0).toBeGreaterThan(conMarca ? 7 : 0)
    const { componerCotizacionTrappvel } = await import('@/lib/pdf/cotizacion-trappvel-paginacion')
    return (await componerCotizacionTrappvel(props)).informe
  }

  for (const nivel of ['normal', 'muy_detallada'] as const) {
    it(`nivel ${nivel}: la última hoja trabaja (una sola hoja, o el 35 % o más), sin achicar letra`, async () => {
      const i = await informe(nivel, true)
      expect(i.despues.hojas === 1 || i.despues.ocupacionUltima >= 0.35, JSON.stringify(i)).toBe(true)
      expect(i.descartado).toBe(false)
    }, 120_000)
  }
})

// ── D8 · la lista única contra el servidor ──────────────────────────────────

/** La lista, con las MISMAS funciones que usa la pantalla, sobre lo que hay en el doble. */
async function listaDelEstado() {
  const items = tabla('items') as unknown as (Fila & { id: string })[]
  const tarifas = tabla('cotizacion_itinerarios').map(t => ({
    id: t.id as string, nombre: (t.nombre ?? null) as string | null, orden: Number(t.orden ?? 0), vaEnPropuesta: t.va_en_propuesta === true,
    seleccion: tabla('itinerario_opciones').filter(o => o.itinerario_id === t.id).map(o => o.item_id as string),
  }))
  const vanAlCliente = tarifas.filter(t => t.vaEnPropuesta)
  const ids = new Set(vanAlCliente.length > 0
    ? vanAlCliente.flatMap(t => itemsDelItinerario(items as never, t.seleccion))
    : itemsQueAportanAlTotal(items as never))
  const desact = lineasDesactualizadas(items.map(i => ({ id: i.id, nombre: (i.nombre ?? null) as string | null, grupo: (i.grupo ?? null) as string | null, es_ajuste: i.es_ajuste === true, tarifa_pax: i.tarifa_pax })), VIAJE)
  const motivoCapturas = motivoParaNoEnviar(desact)
  const entrada: EntradaDeLista = {
    sinPrecio: opcionesSinPrecio(items as never, ids, VIAJE),
    paquetes: paquetesIncompletos(items, vanAlCliente.length > 0 ? ids : null, VIAJE),
    capturas: motivoCapturas ? { motivo: motivoCapturas, itemId: desact[0]?.itemId ?? null } : null,
    tarifas,
    salida: await getSalidaDeCotizacion(COT_SAN_ANDRES) as never,
    pantallazosPorAceptar: 0, texto: 'ok', noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
  }
  return listaUnica(entrada)
}

/** ¿Lo que la lista dice que impide enviar es lo que el servidor rechaza? */
async function comparar() {
  const lista = await listaDelEstado()
  const r = await enviarPorPasos(COT_SAN_ANDRES)
  return { lista, r: r as { success: boolean; error?: string } }
}

describe('C6 · D8 · «Impide enviar» es exactamente lo que rechaza el servidor', () => {
  it('el caso fijo: nada impide enviar, y se envía', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const { lista, r } = await comparar()
    expect(lista.impide).toEqual([])
    expect(r.success, r.error).toBe(true)
  })

  it('P12 · SATENA sin el precio del niño', async () => {
    sembrar()
    const v = tabla('items').find(i => i.id === 'v-satena') as Fila
    const tp = structuredClone(v.tarifa_pax) as Fila
    const casillas = tp.casillas as { grupo_completo: Fila }
    casillas.grupo_completo = {
      ...casillas.grupo_completo, total: 2_682_000, aPagarAgencia: null,
      porTipo: [{ tipo: 'adulto', cantidad: 6, subtotal: 2_682_000 }],
      ocupacion: { adultos: 6, ninos: 1, infantes: 1, total: null }, ocupacionDelItem: false,
      identidad: {}, notasCliente: [], alertas: [], descripcion: '', paraComposicion: VIAJE,
    }
    delete tp.confirmada
    tp.composicion = VIAJE
    v.tarifa_pax = tp
    await recalcularTotales(COT_SAN_ANDRES)
    const { lista, r } = await comparar()
    expect(r.success).toBe(false)
    expect(lista.impide.map(x => x.clave)[0]).toBe('precio-por-pasajero')
    expect(lista.impide[0].texto).toBe(r.error)
    expect(lista.impide[0].ir).toEqual({ a: 'opcion', itemId: 'v-satena' })
  })

  it('viaje en bloqueo (QA 2026-10-29): un paquete sin costo en la propuesta dice «Falta el costo del paquete», no margen', async () => {
    sembrar()
    const items = tabla('items')
    const molde = items.find(i => i.id === 'h-lord-pierre')!
    items.push({
      ...structuredClone(molde), id: 'pq-1', nombre: 'OPCIÓN 1', grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés',
      subtotal: 0, precio_venta: 0, precio_manual: false, margen_porcentaje: null, tarifa_pax: null, tramos: null, opcion_de: null,
    })
    for (const t of tabla('cotizacion_itinerarios')) tabla('itinerario_opciones').push({ itinerario_id: t.id, item_id: 'pq-1' })
    await recalcularTotales(COT_SAN_ANDRES)
    const { lista, r } = await comparar()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/^Falta el costo del paquete/)
    expect(lista.impide[0]).toMatchObject({ clave: 'paquete-incompleto', texto: r.error, ir: { a: 'opcion', itemId: 'pq-1' } })
  })

  it('la Recomendada que no va en la propuesta', async () => {
    sembrar()
    ;(tabla('cotizacion_itinerarios').find(t => t.id === 'tf-recomendada') as Fila).va_en_propuesta = false
    await recalcularTotales(COT_SAN_ANDRES)
    const { lista, r } = await comparar()
    expect(r.success).toBe(false)
    expect(lista.impide[0]).toMatchObject({ clave: 'recomendada', texto: r.error, ir: { a: 'tarifas' } })
  })

  it('la Premium bajo el mínimo, sin autorizar', async () => {
    sembrar()
    const lord = tabla('items').find(i => i.id === 'h-lord-pierre')!
    lord.precio_manual = true
    lord.precio_venta = 4_000_000
    await recalcularTotales(COT_SAN_ANDRES)
    const { lista, r } = await comparar()
    expect(r.success).toBe(false)
    expect(lista.impide).toHaveLength(1)
    expect(lista.impide[0].clave).toBe('margen')
    // El servidor dice el mensaje de la salida; la lista, la misma regla con la cifra.
    expect(r.error).toMatch(/mínimo/i)
  })

  it('un aviso que no bloquea nunca sale en rojo', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const l = listaUnica({
      sinPrecio: [], capturas: null, tarifas: [], salida: null,
      pantallazosPorAceptar: 2, texto: 'viejo', noVan: [{ itemId: 'v-satena', nombre: 'Vuelo San Andrés ⇄ Providencia' }],
      faltaDia: 'Una actividad incluida no tiene día.', margenBajoAviso: 'Margen bajo el aviso.', recargo: 'Falta el recargo.', viaje: 'Faltan las fechas.', ivaSinCalcular: 'IVA sin calcular.',
    })
    expect(l.impide).toEqual([])
    expect(l.revisar.map(x => x.texto)).toEqual([
      '2 pantallazos sin aceptar: no están en el precio.',
      'El texto se escribió con otros servicios: revisa el párrafo marcado.',
      'Vuelo San Andrés ⇄ Providencia no va: el cliente no lo verá ni lo paga.',
      'Una actividad incluida no tiene día.', 'Margen bajo el aviso.', 'Falta el recargo.', 'Faltan las fechas.', 'IVA sin calcular.',
    ])
  })
})

// ── Bloqueo de solo paquetes (Vera sobre el #1326) ───────────────────────────
describe('bloqueo de solo paquetes: el PDF lee la Solicitud igual que «Enviar»', () => {
  /** Un paquete completo salvo la edad del niño (que trae la Solicitud), para el viaje 6 + 1 + 1. */
  function soloPaquete(edadesMenores: string | null) {
    sembrar()
    const muestra = tabla('items')[0] as Fila
    const p = paqueteVacio('Operador de prueba')
    p.hotel.hotel = 'Hotel de Prueba'
    p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 1_000_000 }]
    p.hotel.nino = { precio: 600_000, edadMin: 2, edadMax: 11 }
    p.hotel.infante = { precio: 0 }
    p.distribucion = { habitaciones: { doble: 3 }, ninos: 1, infantes: 1, edadesNinos: [] }
    base.tablas.items = [{
      ...muestra, id: 'pq-1', nombre: 'HOTEL DE PRUEBA', grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés',
      opcion_de: null, es_ajuste: false, orden: 1, cantidad: 1, subtotal: 6_600_000, precio_venta: 7_764_706,
      tarifa_pax: { bloqueo: p }, dia_relativo: null, entra_al_precio: true,
    }]
    base.tablas.rubros = []
    base.tablas.cotizacion_itinerarios = []
    base.tablas.itinerario_opciones = []
    const nb = tabla('negocio_bloques')[0] as Fila
    nb.edades_menores = edadesMenores
    nb.data = { ...(nb.data as Fila), edades_menores: edadesMenores }
  }
  const pdfDe = async () => await generateCotizacionPDF(COT_SAN_ANDRES, { porPasos: true }) as { success: boolean; borrador?: boolean; aviso?: string | null; error?: string }

  it('con la edad en la Solicitud, ni «Enviar» ni el PDF piden la edad del niño', async () => {
    soloPaquete('8 años')
    await recalcularTotales(COT_SAN_ANDRES)
    const r = await enviarPorPasos(COT_SAN_ANDRES) as { success: boolean; error?: string }
    expect(r.error ?? '').not.toMatch(/edad|Paquete/)
    const pdf = await pdfDe()
    expect(pdf.success, pdf.error).toBe(true)
    expect(pdf.aviso ?? '').not.toMatch(/edad|paquete incompleto/i)
    // Mismo veredicto: si «Enviar» dejó pasar, el PDF no es borrador; si frenó por otra cosa, lo dice igual.
    expect(pdf.borrador === true).toBe(r.success !== true)
  })

  it('sin la edad en la Solicitud, los dos frenan por la edad del niño', async () => {
    soloPaquete(null)
    await recalcularTotales(COT_SAN_ANDRES)
    const r = await enviarPorPasos(COT_SAN_ANDRES) as { success: boolean; error?: string }
    expect(r.error).toBe('Paquete «Hotel de Prueba» incompleto: Falta la edad de un niño.')
    const pdf = await pdfDe()
    expect(pdf.borrador).toBe(true)
    expect(pdf.aviso).toContain('Falta la edad de un niño.')
  })

  it('el infante de la Solicitud también cuenta en el PDF', async () => {
    soloPaquete('8 años')
    const pq = tabla('items')[0] as Fila
    const b = (pq.tarifa_pax as { bloqueo: ReturnType<typeof paqueteVacio> }).bloqueo
    b.hotel.infante = null
    b.distribucion.infantes = 0
    await recalcularTotales(COT_SAN_ANDRES)
    const r = await enviarPorPasos(COT_SAN_ANDRES) as { success: boolean; error?: string }
    expect(r.error).toMatch(/infante/)
    const pdf = await pdfDe()
    expect(pdf.borrador).toBe(true)
    expect(pdf.aviso).toContain(r.error!)
  })
})
