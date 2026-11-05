/**
 * La foto del hotel del PAQUETE DE BLOQUEO en el documento (Mauricio, 2026-11-05: «no permite
 * agregar fotos a los hoteles de los paquetes»), con la acción REAL del PDF sobre el doble de
 * Supabase y, en el motor html, la preparación real del documento (`prepararPropuestaHtml`, sin
 * Chromium):
 *  · la foto que la tarjeta del paquete subió a la biblioteca (llave `«hotel|»`, `pedidoFotoDelPaquete`)
 *    sale en los dos motores, con su crédito en la línea de las fotografías;
 *  · si el mismo hotel ya tenía perfil en el destino (cotizado suelto), la llave sin ciudad es su alias
 *    y el documento imprime esas fotos;
 *  · la ficha fijada en la línea del paquete (`items.proveedor_id`) es la del OPERADOR: no se toma
 *    como ficha del hotel.
 */
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'
import { pedidoFotoDelPaquete } from '@/lib/cotizaciones/bloqueo-documento'
import { paqueteVacio, type PaqueteBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { claveDeFoto } from '@/lib/fotos/clave'

const motor = vi.hoisted(() => ({ llamadas: [] as unknown[], preparado: [] as { html: string; modelo: unknown }[] }))
const imagen = vi.hoisted(() => ({ porRef: new Map<string, Buffer>() }))

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
    borrar: async () => {},
  }),
}))
// Cada foto de la biblioteca con sus propios bytes (una JPEG de verdad: el motor html la reduce con sharp).
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  bytesDeCatalogo: async (_ws: string, ref: string) => imagen.porRef.get(ref) ?? null,
  enlacesDeCatalogo: async (_ws: string, refs: string[]) => new Map(refs.map((r) => [r, 'https://firmada.example/foto.jpg'])),
}))
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
      composicion: { adultos: 2, ninos: 0, infantes: 0 },
      fechas: { inicio: '2026-11-23', fin: '2026-11-28' },
      destino: 'San Andrés',
      presentacion: null,
      nivelDetalle: 'normal',
    },
    error: null,
  }),
}))
// Motor html: Chromium no corre aquí. Se arma el documento de verdad (modelo, fotos, créditos y html).
vi.mock('@/lib/pdf/html/propuesta-html', async (original) => {
  const real = await original<typeof import('@/lib/pdf/html/propuesta-html')>()
  return {
    ...real,
    pdfDePropuestaHtml: async (entrada: Parameters<typeof real.prepararPropuestaHtml>[0], opts: Parameters<typeof real.prepararPropuestaHtml>[1]) => {
      motor.llamadas.push(entrada)
      const p = await real.prepararPropuestaHtml(entrada, opts)
      motor.preparado.push({ html: p.html, modelo: p.modelo })
      const doc = await PDFDocument.create()
      doc.addPage()
      return { pdf: Buffer.from(await doc.save()), modelo: p.modelo, html: p.html, medidas: { totalMs: 1, pdfBytes: 1, peticionesBloqueadas: [] }, avisosFotos: [] }
    },
  }
})

const WS = 'ws-trappvel'
const COT = 'cot-bloqueo'
const NEG = 'neg-bloqueo'
const FICHA_OPERADOR = '11111111-2222-4333-8444-555555555555'
const REF_HOTEL = 'one://fotos-catalogo/ws-trappvel/hotel/aaaaaaaaaaaaaaaa.jpg'
const REF_OPERADOR = 'one://fotos-catalogo/ws-trappvel/hotel/bbbbbbbbbbbbbbbb.jpg'

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'

function paquete(): PaqueteBloqueo {
  const p = paqueteVacio('Aliados Travel')
  p.hotel.hotel = 'Decameron Isleño'
  p.hotel.zona = 'Centro'
  p.hotel.noches = 5
  p.hotel.habitacion = 'Estándar'
  p.hotel.planAlimentacion = 'Todo incluido'
  p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_500_000 }]
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return p
}

function foto(id: string, clave: string, ref: string, extra: Partial<Fila> = {}): Fila {
  return {
    id, workspace_id: WS, tipo: 'hotel', clave, nombre_clave: clave.split('|')[0], nombre: 'Decameron Isleño', ciudad: null,
    ref, origen: 'asesora', fuente_url: null, titulo_fuente: null, autor: null, licencia: null, foco_x: null, foco_y: null,
    proporcion: 1.5, revisada: true, descartadas: [], principal: true, posicion: 1, imagen_url: null,
    ...extra,
  }
}

/** La foto que puso la tarjeta del paquete: llave sin ciudad (`pedidoFotoDelPaquete`). De Commons, para ver el crédito. */
const CLAVE_PAQUETE = claveDeFoto('hotel', pedidoFotoDelPaquete(paquete())!.nombre, null)

function sembrar(opts: { motor: boolean; fotos: Fila[]; perfiles?: Fila[]; alias?: Fila[] }) {
  base.secuencia = 0
  compuesta.props = []
  motor.llamadas = []
  motor.preparado = []
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0099', consecutivo: 'COT-2026-0099', modo: 'detallada',
      descripcion: 'San Andrés en bloqueo', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: null, aviso_margen_pct: null, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null, lugar_entrega: null, terminos_condiciones: null,
      tarifa_aceptada_id: null, documento_cliente: null,
    }],
    items: [{
      id: 'pq-1', cotizacion_id: COT, descripcion: null, opcion_de: null, es_ajuste: false, cantidad: 1,
      subtotal: 5_000_000, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: 5_750_000, precio_manual: true,
      unidad: null, tramos: null, dia_relativo: null, entra_al_precio: true, mostrar_en_sugeridos: true,
      base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
      nombre: 'Paquete Decameron Isleño', grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', orden: 1,
      tarifa_pax: { bloqueo: JSON.parse(JSON.stringify(paquete())) },
      // La línea del paquete fija la ficha del OPERADOR (el doble la embebe como `ficha:fotos_perfiles`).
      proveedor_id: FICHA_OPERADOR,
    }],
    cotizacion_itinerarios: [], itinerario_opciones: [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', nombre: 'A1 26 1', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e1' }],
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
    fotos_catalogo: opts.fotos,
    // En la base la ficha del operador es tipo «proveedor»; aquí va como «hotel», el peor caso: la prueba
    // depende de que la línea del paquete no aporte fichas de hotel, no del filtro por tipo.
    fotos_perfiles: [{ id: FICHA_OPERADOR, workspace_id: WS, tipo: 'hotel', clave: 'aliados travel|', nombre: 'Aliados Travel', ciudad: null }, ...(opts.perfiles ?? [])],
    fotos_perfiles_alias: opts.alias ?? [],
    fiscal_profiles: [{
      workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S',
    }],
  }
}

async function generar() {
  await recalcularTotales(COT)
  const r = (await generateCotizacionPDF(COT)) as { success: boolean; error?: string }
  if (!r.success) throw new Error(r.error)
}

const COMMONS = { origen: 'wikimedia', autor: 'Ana Pérez', licencia: 'CC BY-SA 4.0', fuente_url: 'https://commons.wikimedia.org/wiki/File:Isleno.jpg', titulo_fuente: 'File:Isleno.jpg' }

type HotelDoc = { hotel: string | null; ciudad: string | null; foto?: { url: string; proporcion?: number | null; credito?: string | null } | null }
const hotelDeReactPdf = () => ((compuesta.props[0] as { viaje?: { hoteles?: HotelDoc[] } }).viaje?.hoteles ?? [])[0]
type OpcionHotel = { hotel: string; foto: { url: string } | null }
const opcionesDelMotor = () => ((motor.preparado[0]?.modelo as { hoteles?: { ciudad: string; opciones: OpcionHotel[] }[] } | undefined)?.hoteles ?? []).flatMap((c) => c.opciones)
const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`

let jpegHotel: Buffer
let jpegOperador: Buffer
beforeEach(async () => {
  const sharp = (await import('sharp')).default
  jpegHotel = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 150, b: 190 } } }).jpeg().toBuffer()
  jpegOperador = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer()
  imagen.porRef = new Map([[REF_HOTEL, jpegHotel], [REF_OPERADOR, jpegOperador]])
})

describe('la foto del hotel del paquete de bloqueo en el documento', () => {
  it('la llave de la tarjeta del paquete es la del hotel sin ciudad', () => {
    expect(CLAVE_PAQUETE).toBe('decameron isleno|')
  })

  it('@react-pdf: imprime la foto que subió la tarjeta del paquete, con su crédito', async () => {
    sembrar({ motor: false, fotos: [foto('f-1', CLAVE_PAQUETE, REF_HOTEL, COMMONS)] })
    await generar()
    const h = hotelDeReactPdf()
    expect(h?.hotel).toBe('Decameron Isleño')
    // V6: la ciudad del hotel del paquete sigue vacía (la zona no es la ciudad).
    expect(h?.ciudad).toBeNull()
    expect(h?.foto?.url).toBe(dataUrl(jpegHotel))
    expect(h?.foto?.credito).toMatch(/Ana Pérez.*CC BY-SA 4\.0/)
  })

  it('motor html: la foto sale en la tarjeta del hotel y el crédito en la línea de las fotografías', async () => {
    sembrar({ motor: true, fotos: [foto('f-1', CLAVE_PAQUETE, REF_HOTEL, COMMONS)] })
    await generar()
    const [opcion] = opcionesDelMotor()
    expect(opcion?.hotel).toBe('Decameron Isleño')
    expect(opcion?.foto?.url).toBe(dataUrl(jpegHotel))
    expect(motor.preparado[0].html).toContain('Ana Pérez')
    expect(motor.preparado[0].html).toContain('CC BY-SA 4.0')
  })

  it('el mismo hotel con perfil en el destino (cotizado suelto): la llave sin ciudad es su alias y sale su foto', async () => {
    const perfil = { id: 'perfil-isleno', workspace_id: WS, tipo: 'hotel', clave: 'decameron isleno|san andres', nombre: 'Decameron Isleño', ciudad: 'San Andrés' }
    const alias = { id: 'alias-1', workspace_id: WS, perfil_id: 'perfil-isleno', tipo: 'hotel', clave: CLAVE_PAQUETE, nombre: 'Decameron Isleño', ciudad: null }
    for (const conMotor of [false, true]) {
      sembrar({ motor: conMotor, fotos: [foto('f-1', 'decameron isleno|san andres', REF_HOTEL, { ciudad: 'San Andrés' })], perfiles: [perfil], alias: [alias] })
      await generar()
      if (conMotor) expect(opcionesDelMotor()[0]?.foto?.url).toBe(dataUrl(jpegHotel))
      else expect(hotelDeReactPdf()?.foto?.url).toBe(dataUrl(jpegHotel))
    }
  })

  it('la ficha del OPERADOR fijada en la línea del paquete no se toma como la del hotel', async () => {
    for (const conMotor of [false, true]) {
      // Solo la ficha del operador tiene foto: el hotel del paquete sale sin foto (el degradado).
      sembrar({ motor: conMotor, fotos: [foto('f-op', 'aliados travel|', REF_OPERADOR)] })
      await generar()
      if (conMotor) expect(opcionesDelMotor()[0]?.foto ?? null).toBeNull()
      else expect(hotelDeReactPdf()?.foto ?? null).toBeNull()
      // Con las dos, la del hotel.
      sembrar({ motor: conMotor, fotos: [foto('f-op', 'aliados travel|', REF_OPERADOR), foto('f-1', CLAVE_PAQUETE, REF_HOTEL)] })
      await generar()
      if (conMotor) expect(opcionesDelMotor()[0]?.foto?.url).toBe(dataUrl(jpegHotel))
      else expect(hotelDeReactPdf()?.foto?.url).toBe(dataUrl(jpegHotel))
    }
  })
})
