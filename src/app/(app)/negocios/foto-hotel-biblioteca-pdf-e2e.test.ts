/**
 * Una sola verdad para la foto del hotel en el documento (2026-10-16), con la acción REAL del PDF
 * sobre el doble de Supabase: la de la biblioteca del espacio manda en los dos motores; la vieja
 * de la opción (`tarifa_pax.fotoHotel`) solo cuando la biblioteca no tiene una imprimible.
 */
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const motor = vi.hoisted(() => ({ llamadas: [] as unknown[], falla: false }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS, userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => ({ referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }),
    descargar: async () => ({ buffer: Buffer.from('OPCION'), mime: 'image/jpeg' }),
    borrar: async (ref: string) => { borradas.refs.push(ref) },
  }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  bytesDeCatalogo: async () => Buffer.from('BIBLIOTECA'),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/${'b'.repeat(16)}.jpg`,
  enlacesDeCatalogo: async (_ws: string, refs: string[]) => new Map(refs.map((r) => [r, 'https://firmada.example/foto.jpg'])),
  borrarDeCatalogo: async () => {},
}))
const borradas = vi.hoisted(() => ({ refs: [] as string[] }))
// @react-pdf: se guarda lo que recibe la plantilla compuesta de Trappvel.
const compuesta = vi.hoisted(() => ({ props: [] as unknown[] }))
vi.mock('@/lib/pdf/plantillas-cotizacion', async (original) => {
  const real = await original<typeof import('@/lib/pdf/plantillas-cotizacion')>()
  return {
    ...real,
    compositorDePlantilla: (slug: string) => {
      const c = real.compositorDePlantilla(slug)
      return c ? async (props: unknown) => { compuesta.props.push(props); return c(props as never) } : null
    },
  }
})
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => ({
    viaje: {
      composicion: { adultos: 2, ninos: 1, infantes: 0 },
      fechas: { inicio: '2026-11-23', fin: '2026-11-28' },
      destino: 'San Andrés',
      presentacion: null,
      nivelDetalle: 'normal',
    },
    error: null,
  }),
}))
vi.mock('@/lib/pdf/html/propuesta-html', () => ({
  pdfDePropuestaHtml: async (entrada: unknown) => {
    motor.llamadas.push(entrada)
    if (motor.falla) throw new Error('Chromium no arrancó')
    const doc = await PDFDocument.create()
    doc.addPage()
    return { pdf: Buffer.from(await doc.save()), modelo: null, html: '', medidas: { totalMs: 1, pdfBytes: 1, peticionesBloqueadas: [] } }
  },
}))

const WS = 'ws-trappvel'
const COT = 'cot-sai'
const NEG = 'neg-sai'
const LECTURA_HOTEL = {
  total: 5_000_000,
  campos: [{ label: 'Hotel', valor: 'Hotel Verde Mar' }, { label: 'Ciudad', valor: 'San Andrés' }, { label: 'Moneda', valor: 'COP' }, { label: 'Precio', valor: '5000000' }],
  moneda: 'COP', nombre: 'Hotel Verde Mar', alertas: [], leidaEn: '2026-10-16T16:00:00.000Z', porTipo: [], notasCliente: [],
}

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'
import { ponerFotoDelHotel } from './tarifa-pax-actions'

function linea(id: string, precio: number, extra: Fila): Fila {
  return {
    id, cotizacion_id: COT, descripcion: null, opcion_de: null, es_ajuste: false, cantidad: 1,
    subtotal: Math.round(precio * 0.85), descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: precio, precio_manual: true,
    unidad: null, tramos: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: true, mostrar_en_sugeridos: true,
    base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}

function sembrar(opts: { motor: boolean; anticipo?: boolean; fotoVieja?: boolean; biblioteca?: boolean; commons?: boolean }) {
  base.secuencia = 0
  compuesta.props = []
  motor.llamadas = []
  motor.falla = false
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0098', consecutivo: 'COT-2026-0098', modo: 'detallada',
      descripcion: 'San Andrés', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: null, aviso_margen_pct: null, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null, lugar_entrega: null, terminos_condiciones: null,
      tarifa_aceptada_id: null,
      documento_cliente: opts.anticipo ? { anticipo: { monto: 1_500_000, texto: 'Con esto les apartamos el hotel.' } } : null,
    }],
    items: [
      linea('h-hotel', 5_000_000, { nombre: 'Hotel Verde Mar', grupo: 'hotel: Hotel en San Andrés', orden: 1, tarifa_pax: {
        casillas: { grupo_completo: LECTURA_HOTEL },
        ...(opts.fotoVieja ? { fotoHotel: { ref: 'sbext://one-documentos/negocios/neg-sai/fotos-hotel/cot-sai/h-hotel-0123456789abcdef.jpg', proporcion: 1.2 } } : {}),
      } }),
    ],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', nombre: 'N1 26 1', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e1' }],
    lineas_negocio: [{ id: 'linea-viaje', config_extra: {} }],
    etapas_negocio: [{ id: 'e1', linea_id: 'linea-viaje', orden: 1, config_extra: {} }],
    bloque_configs: [], rubros: [], item_adicionales: [], activity_log: [], decisiones_combinacion: [],
    negocio_bloques: [], cotizacion_excepciones_margen: [], cotizacion_ranuras: [], cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba', position: 'Asesora', phone_whatsapp: '300 000 0000' }],
    workspaces: [{
      id: WS, name: 'Agencia de prueba', logo_url: null, color_primario: null, cotizacion_template_slug: 'trappvel',
      config_extra: opts.motor ? { documento_viaje: { motor: 'html' } } : {},
    }],
    empresas: [],
    fotos_catalogo: opts.biblioteca ? [{
      id: 'foto-1', workspace_id: WS, tipo: 'hotel', clave: 'hotel verde mar|san andres', nombre_clave: 'hotel verde mar', nombre: 'Hotel Verde Mar',
      ciudad: 'San Andrés', ref: 'one://fotos-catalogo/x/hotel/0123456789abcdef.jpg', origen: 'asesora', fuente_url: null, titulo_fuente: null,
      autor: null, licencia: null, foco_x: null, foco_y: null, proporcion: 1.5, revisada: true, descartadas: [], principal: true, posicion: 1, imagen_url: null,
      ...(opts.commons ? {
        origen: 'wikimedia', fuente_url: 'https://commons.wikimedia.org/wiki/File:Verde_Mar.jpg', titulo_fuente: 'File:Verde_Mar.jpg',
        autor: 'Ana Pérez', licencia: 'CC BY-SA 4.0',
      } : {}),
    }] : [],
    fiscal_profiles: [{
      workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S',
    }],
  }
}

type Resultado = { success: boolean; pdf: string; renderedVia?: string; error?: string }

async function generar(): Promise<Resultado> {
  await recalcularTotales(COT)
  const r = (await generateCotizacionPDF(COT)) as Resultado
  if (!r.success) throw new Error(r.error)
  return r
}

type ConViaje = { viaje?: { hoteles?: { hotel: string | null; foto?: { url: string; proporcion?: number | null } | null }[] } }
const hotelDeReactPdf = () => (compuesta.props[0] as ConViaje).viaje?.hoteles?.[0]
const hotelDelMotor = () => (motor.llamadas[0] as { props: ConViaje }).props.viaje?.hoteles?.[0]
const BIB = `data:image/jpeg;base64,${Buffer.from('BIBLIOTECA').toString('base64')}`
const VIEJA = `data:image/jpeg;base64,${Buffer.from('OPCION').toString('base64')}`

beforeEach(() => sembrar({ motor: false }))

describe('la foto del hotel en el documento: la biblioteca manda', () => {
  it('@react-pdf: con foto en la biblioteca imprime esa, aunque la opción tenga la vieja', async () => {
    sembrar({ motor: false, fotoVieja: true, biblioteca: true })
    await generar()
    expect(hotelDeReactPdf()?.hotel).toBe('Hotel Verde Mar')
    expect(hotelDeReactPdf()?.foto).toEqual({ url: BIB, proporcion: 1.5, credito: null })
  })

  it('@react-pdf: la de Commons viaja con su crédito (autor y licencia) para la línea «Fotografías»', async () => {
    sembrar({ motor: false, biblioteca: true, commons: true })
    await generar()
    const credito = (hotelDeReactPdf()?.foto as { credito?: string | null } | undefined)?.credito
    expect(credito).toMatch(/Ana Pérez/)
    expect(credito).toMatch(/CC BY-SA 4\.0/)
  })

  it('@react-pdf: sin foto en la biblioteca, la vieja de la opción (como antes)', async () => {
    sembrar({ motor: false, fotoVieja: true })
    await generar()
    expect(hotelDeReactPdf()?.foto).toEqual({ url: VIEJA, proporcion: 1.2 })
  })

  it('motor html: con foto en la biblioteca no viaja la vieja (el catálogo pone la de la biblioteca)', async () => {
    sembrar({ motor: true, fotoVieja: true, biblioteca: true })
    await generar()
    expect(hotelDelMotor()?.foto ?? null).toBeNull()
  })

  it('motor html: sin foto en la biblioteca, la vieja de la opción', async () => {
    sembrar({ motor: true, fotoVieja: true })
    await generar()
    expect(hotelDelMotor()?.foto).toEqual({ url: VIEJA, proporcion: 1.2 })
  })
})

describe('la foto que se pone en la tarjeta va a la biblioteca, no a la opción', () => {
  const jpeg = async () => {
    const sharp = (await import('sharp')).default
    const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 90, g: 160, b: 190 } } }).jpeg().toBuffer()
    return `data:image/jpeg;base64,${b.toString('base64')}`
  }

  it('queda en la biblioteca con la llave del hotel, se suelta la vieja de la opción y el documento la imprime', async () => {
    sembrar({ motor: false, fotoVieja: true })
    borradas.refs = []
    const r = await ponerFotoDelHotel('h-hotel', await jpeg(), 1.5, null, { autorizada: true, procedencia: 'kit de medios del hotel' })
    expect(r.success).toBe(true)
    expect(r.fotoBiblioteca?.fotos[0]).toMatchObject({ principal: true, seImprime: true, url: 'https://firmada.example/foto.jpg' })
    const filas = base.tablas.fotos_catalogo as Fila[]
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ tipo: 'hotel', clave: 'hotel verde mar|san andres', origen: 'asesora', revisada: true })
    // La opción ya no guarda foto: una sola verdad.
    const tarifa = (base.tablas.items as Fila[]).find(i => i.id === 'h-hotel')!.tarifa_pax as Record<string, unknown>
    expect(tarifa.fotoHotel).toBeUndefined()
    expect(borradas.refs).toEqual(['sbext://one-documentos/negocios/neg-sai/fotos-hotel/cot-sai/h-hotel-0123456789abcdef.jpg'])
    await generar()
    expect(hotelDeReactPdf()?.foto?.url).toBe(BIB)
  })

  it('en un espacio sin propuesta de viaje se guarda en la opción, como antes', async () => {
    sembrar({ motor: false })
    ;(base.tablas.workspaces as Fila[])[0].cotizacion_template_slug = 'termotech'
    // El doble no proyecta el embed `cotizaciones(...)`: la fila lo trae ya puesto (la foto en la opción va por negocio).
    ;(base.tablas.items as Fila[])[0].cotizaciones = { estado: 'borrador', negocio_id: NEG }
    const r = await ponerFotoDelHotel('h-hotel', await jpeg(), 1.5, null, { autorizada: true, procedencia: 'kit de medios del hotel' })
    expect(r.error).toBeUndefined()
    expect(r.success).toBe(true)
    expect(r.fotoBiblioteca).toBeUndefined()
    expect(base.tablas.fotos_catalogo).toEqual([])
    expect(((base.tablas.items as Fila[])[0].tarifa_pax as Record<string, unknown>).fotoHotel).toMatchObject({ proporcion: 1.5 })
  })
})

describe('perfiles: el alias y los planes opcionales llegan al documento', () => {
  const fotoDe = (tipo: string, clave: string, nombre: string, ciudad: string | null): Fila => ({
    id: `foto-${clave}`, workspace_id: WS, tipo, clave, nombre_clave: nombre.toLowerCase(), nombre, ciudad,
    ref: 'one://fotos-catalogo/x/hotel/0123456789abcdef.jpg', origen: 'asesora', fuente_url: null, titulo_fuente: null,
    autor: null, licencia: null, foco_x: null, foco_y: null, proporcion: 1.5, revisada: true, descartadas: [], principal: true, posicion: 1, imagen_url: null,
  })

  it('@react-pdf: «Hotel Verde Mar» es alias del perfil «Verde Mar»: imprime la foto del perfil', async () => {
    sembrar({ motor: false })
    base.tablas.fotos_catalogo = [fotoDe('hotel', 'verde mar|san andres', 'Verde Mar', 'San Andrés')]
    base.tablas.fotos_perfiles = [{ id: 'p1', workspace_id: WS, tipo: 'hotel', clave: 'verde mar|san andres', nombre: 'Verde Mar', ciudad: 'San Andrés' }]
    base.tablas.fotos_perfiles_alias = [{ id: 'a1', workspace_id: WS, perfil_id: 'p1', tipo: 'hotel', clave: 'hotel verde mar|san andres', nombre: 'Hotel Verde Mar', ciudad: 'San Andrés' }]
    await generar()
    expect(hotelDeReactPdf()?.foto).toEqual({ url: BIB, proporcion: 1.5, credito: null })
  })

  it('@react-pdf: el plan opcional con foto en su perfil la lleva; sin ella, la tarjeta de siempre', async () => {
    sembrar({ motor: false })
    ;(base.tablas.items as Fila[]).push(
      linea('o-manglar', 300_000, { nombre: 'Tour de manglares', grupo: 'tour: Tour de manglares', orden: 2, entra_al_precio: false }),
      linea('o-buceo', 400_000, { nombre: 'Buceo', grupo: 'tour: Buceo', orden: 3, entra_al_precio: false }),
    )
    base.tablas.fotos_catalogo = [fotoDe('actividad', 'tour de manglares|', 'Tour de manglares', null)]
    await generar()
    const sugeridos = (compuesta.props[0] as { sugeridos?: { nombre: string; foto?: { url: string } }[] }).sugeridos ?? []
    expect(sugeridos.map((s) => [s.nombre, s.foto?.url ?? null])).toEqual([
      ['Tour de manglares', BIB],
      ['Buceo', null],
    ])
  })
})
