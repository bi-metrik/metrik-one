/**
 * Las fotos del hotel en el PDF de «Revisar y enviar» (reunión con Trappvel del 2026-10-22, punto
 * 3: los hoteles salían sin foto). La acción REAL del PDF con el motor html y el HTML REAL de
 * la propuesta (`prepararPropuestaHtml`, sin Chromium), sobre el doble de Supabase. Datos ficticios.
 *
 * Lo que fallaba, reproducido:
 *  · la foto subida en la tarjeta de una línea con su FICHA fijada (`items.proveedor_id`, la que
 *    trae «Usar tarifa de proveedor») se guarda con la llave de la ficha; el PDF la buscaba por el
 *    nombre y la ciudad leídos, y si la llave de la ficha era otra, no la encontraba;
 *  · el motor html pedía la foto con la ciudad del CAPÍTULO, no la del hotel: una alternativa de
 *    otra zona en el mismo capítulo («Playa del Carmen» dentro de «Cancún») salía sin foto.
 *
 * Hasta 3 fotos por hotel, con 1, 2 y 3, en las tres tarifas.
 */
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const captura = vi.hoisted(() => ({ html: '' as string, catalogo: null as unknown, pdfHecho: false }))
const jpegs = vi.hoisted(() => new Map<string, Buffer>())

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS, userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  bytesDeCatalogo: async (_ws: string, ref: string) => jpegs.get(ref) ?? null,
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({ isPdfRenderConfigured: () => false, renderViaService: async () => { throw new Error('no') } }))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => ({
    viaje: { composicion: { adultos: 2, ninos: 0, infantes: 0 }, fechas: { inicio: '2026-12-10', fin: '2026-12-15' }, destino: 'Cancún', presentacion: null, nivelDetalle: 'normal' },
    error: null,
  }),
}))
// El HTML de verdad (fotos incluidas); solo Chromium queda fuera.
vi.mock('@/lib/pdf/html/propuesta-html', async (original) => {
  const real = await original<typeof import('@/lib/pdf/html/propuesta-html')>()
  return {
    ...real,
    pdfDePropuestaHtml: async (entrada: Parameters<typeof real.prepararPropuestaHtml>[0], opts: Parameters<typeof real.prepararPropuestaHtml>[1]) => {
      captura.catalogo = opts.catalogo ?? null
      const { html } = await real.prepararPropuestaHtml(entrada, opts)
      captura.html = html
      if (process.env.VOLCAR_HTML_PROPUESTA) (await import('node:fs')).writeFileSync(process.env.VOLCAR_HTML_PROPUESTA, html)
      // Para las capturas del PR: con `PDF_FOTOS_SALIDA` y `CHROMIUM_EJECUTABLE`, el PDF de verdad.
      if (process.env.PDF_FOTOS_SALIDA && !captura.pdfHecho) {
        captura.pdfHecho = true
        const { pdf } = await real.pdfDePropuestaHtml(entrada, opts)
        ;(await import('node:fs')).writeFileSync(process.env.PDF_FOTOS_SALIDA, pdf)
      }
      const doc = await PDFDocument.create()
      doc.addPage()
      return { pdf: Buffer.from(await doc.save()), modelo: null, html, medidas: { totalMs: 1, pdfBytes: 1, peticionesBloqueadas: [] } }
    },
  }
})

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'

const WS = 'ws-agencia'
const COT = 'cot-fotos'
const NEG = 'neg-fotos'

/** Una lectura de hotel ficticia. */
const lectura = (hotel: string, ciudad: string) => ({
  total: 3_000_000,
  campos: [{ label: 'Hotel', valor: hotel }, { label: 'Ciudad', valor: ciudad }, { label: 'Check-in', valor: '2026-12-10' }, { label: 'Check-out', valor: '2026-12-15' }, { label: 'Moneda', valor: 'COP' }],
  identidad: { hotel, ciudad, check_in: '2026-12-10', check_out: '2026-12-15' },
  moneda: 'COP', nombre: hotel, alertas: [], leidaEn: '2026-10-22T16:00:00.000Z', porTipo: [], notasCliente: [],
})

function hotel(id: string, nombre: string, ciudad: string, orden: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre, descripcion: null, grupo: 'hotel: Hotel en Cancún', opcion_de: null, es_ajuste: false, orden,
    cantidad: 1, subtotal: 2_000_000 + orden * 500_000, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: 0, precio_manual: false,
    unidad: null, tramos: null, tarifa_pax: { casillas: { grupo_completo: lectura(nombre, ciudad) } }, dia_relativo: null, entra_al_precio: true,
    mostrar_en_sugeridos: true, base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}

function foto(clave: string, nombre: string, ciudad: string, posicion: number): Fila {
  const ref = `one://fotos-catalogo/${WS}/hotel/${clave.replace(/[^a-z]/g, '').slice(0, 10)}${posicion}`.padEnd(60, '0')
  return {
    id: `foto-${clave}-${posicion}`, workspace_id: WS, tipo: 'hotel', clave, nombre_clave: nombre.toLowerCase(), nombre, ciudad, ref,
    origen: 'asesora', fuente_url: null, titulo_fuente: null, autor: null, licencia: null, foco_x: null, foco_y: null, proporcion: 1.5,
    revisada: true, descartadas: [], principal: posicion === 1, posicion, orden: posicion, imagen_url: null, categoria: null,
  }
}

beforeAll(async () => {
  const sharp = (await import('sharp')).default
  // Cada foto con su color, para contarlas en el HTML.
  const colores = [[200, 60, 60], [60, 160, 90], [60, 90, 200], [190, 160, 40], [120, 60, 170], [40, 170, 170]]
  base.secuencia = 0
  const fotos = [
    // Hotel 1 (Económica): ficha fijada con OTRA llave (la ciudad de la ficha se corrigió después). 3 fotos.
    ...[1, 2, 3].map(p => foto('coral azul|zona hotelera', 'Coral Azul', 'Zona Hotelera', p)),
    // Hotel 2 (Recomendada): por su nombre y su ciudad, en el capítulo de la principal. 2 fotos.
    ...[1, 2].map(p => foto('hotel brisa blanca|cancun', 'Hotel Brisa Blanca', 'Cancún', p)),
    // Hotel 3 (Premium): de otra zona, cae en el capítulo de Cancún por la fecha. 1 foto.
    foto('hotel palma real|playa del carmen', 'Hotel Palma Real', 'Playa del Carmen', 1),
  ]
  for (const [i, f] of fotos.entries()) {
    const [r, g, b] = colores[i % colores.length]
    jpegs.set(f.ref as string, await sharp({ create: { width: 60 + i, height: 40, channels: 3, background: { r, g, b } } }).jpeg().toBuffer())
  }
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null, codigo: 'COT-2026-0200', consecutivo: 'COT-2026-0200', modo: 'detallada',
      descripcion: 'Cancún', estado: 'borrador', valor_total: 0, costo_total: 0, margen_porcentaje: 15, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, piso_margen_pct: null, aviso_margen_pct: null,
      fecha_envio: null, fecha_validez: null, condiciones_pago: null, notas: null, lugar_entrega: null, terminos_condiciones: null, tarifa_aceptada_id: null, documento_cliente: null,
    }],
    items: [
      hotel('h-coral', 'Hotel Coral Azul', 'Cancún', 1, { proveedor_id: 'ficha-coral' }),
      hotel('h-brisa', 'Hotel Brisa Blanca', 'Cancún', 2),
      hotel('h-palma', 'Hotel Palma Real', 'Playa del Carmen', 3),
    ],
    cotizacion_itinerarios: [
      { id: 'it-eco', workspace_id: WS, cotizacion_id: COT, nombre: 'Económica', orden: 1, va_en_propuesta: true, es_principal: false },
      { id: 'it-rec', workspace_id: WS, cotizacion_id: COT, nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: false },
      { id: 'it-pre', workspace_id: WS, cotizacion_id: COT, nombre: 'Premium', orden: 3, va_en_propuesta: true, es_principal: false },
    ],
    itinerario_opciones: [
      { itinerario_id: 'it-eco', item_id: 'h-coral' }, { itinerario_id: 'it-rec', item_id: 'h-brisa' }, { itinerario_id: 'it-pre', item_id: 'h-palma' },
    ],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', nombre: 'C1 26 1', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e2' }],
    lineas_negocio: [{ id: 'linea-viaje', config_extra: {} }],
    etapas_negocio: [{ id: 'e2', linea_id: 'linea-viaje', orden: 2, config_extra: {} }],
    bloque_configs: [], rubros: [], item_adicionales: [], activity_log: [], decisiones_combinacion: [], negocio_bloques: [],
    cotizacion_excepciones_margen: [], cotizacion_ranuras: [], cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba', position: 'Asesora', phone_whatsapp: '300 000 0000' }],
    workspaces: [{ id: WS, name: 'Agencia de prueba', logo_url: null, color_primario: null, cotizacion_template_slug: 'trappvel', config_extra: { documento_viaje: { motor: 'html' } } }],
    empresas: [],
    fiscal_profiles: [{ workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true, is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true, nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S' }],
    fotos_perfiles: [{ id: 'ficha-coral', workspace_id: WS, tipo: 'hotel', clave: 'coral azul|zona hotelera', nombre: 'Coral Azul', ciudad: 'Cancún' }],
    fotos_perfiles_alias: [],
    fotos_catalogo: fotos,
  } as Record<string, Fila[]>
  await recalcularTotales(COT)
  const r = (await generateCotizacionPDF(COT, { vistaPrevia: true })) as { success: boolean; error?: string }
  if (!r.success) throw new Error(r.error)
}, 60_000)

type Foto = { src: string; extras?: { src: string }[] }
type Catalogo = { hotel: (hotel: string, ciudad: string | null) => Foto | null }
const dataUrl = (ref: string) => `data:image/jpeg;base64,${jpegs.get(ref)!.toString('base64')}`
const refDe = (clave: string, posicion: number) => (base.tablas.fotos_catalogo as Fila[]).find(f => f.clave === clave && f.posicion === posicion)!.ref as string

describe('las fotos de los hoteles de las tres tarifas llegan al PDF', () => {
  it('el catálogo del documento encuentra las de los tres hoteles, con 3, 2 y 1 fotos', () => {
    const c = captura.catalogo as Catalogo
    expect(c).toBeTruthy()
    // La Económica: por la FICHA fijada en la línea, aunque su llave no sea la del nombre leído.
    const coral = c.hotel('Hotel Coral Azul', 'Cancún')!
    expect(coral.src).toBe(dataUrl(refDe('coral azul|zona hotelera', 1)))
    expect(coral.extras?.map(e => e.src)).toEqual([dataUrl(refDe('coral azul|zona hotelera', 2)), dataUrl(refDe('coral azul|zona hotelera', 3))])
    // La Recomendada: por su nombre y su ciudad.
    const brisa = c.hotel('Hotel Brisa Blanca', 'Cancún')!
    expect([brisa.src, ...(brisa.extras ?? []).map(e => e.src)]).toEqual([dataUrl(refDe('hotel brisa blanca|cancun', 1)), dataUrl(refDe('hotel brisa blanca|cancun', 2))])
    // La Premium: el motor pregunta con la ciudad del capítulo (Cancún) y la foto está con la suya.
    const palma = c.hotel('Hotel Palma Real', 'Cancún')!
    expect(palma.src).toBe(dataUrl(refDe('hotel palma real|playa del carmen', 1)))
    expect(palma.extras ?? []).toEqual([])
  })

  it('el HTML del documento las imprime: 3 (principal + 2), 2 (principal + 1) y 1, sin recuadro vacío', () => {
    const recuadros = captura.html.match(/class="img[^"]*"/g) ?? []
    expect(recuadros.filter(c => c.includes('sinfoto'))).toEqual([])
    expect(recuadros).toContain('class="img mosaico n2"')
    expect(recuadros).toContain('class="img mosaico n1"')
    // Las extras: 2 del primero y 1 del segundo.
    expect(captura.html.split('class="mx"').length - 1).toBe(3)
  })
})

/**
 * Punto 6 del brief: el gerente de la agencia pidió poder sumar un ingreso adicional interno, que no
 * se le muestre al cliente.
 * No hay un «% extra sobre el total» aparte: lo que existe es el margen de la cotización (se reparte
 * dentro del precio de cada línea que lo hereda) y el descuento comercial. Se verifica que el margen
 * no aparezca en nada que vea el cliente: ni en el texto del documento ni en las props del PDF.
 */
describe('punto 6 · el margen interno no sale al cliente', () => {
  it('con el margen de la cotización en 17,5 %, el documento no dice margen, ni porcentaje, ni la cifra', async () => {
    const cotizacion = (base.tablas.cotizaciones as Fila[])[0]
    cotizacion.margen_porcentaje = 17.5
    await recalcularTotales(COT)
    const r = (await generateCotizacionPDF(COT, { vistaPrevia: true })) as { success: boolean; error?: string }
    expect(r.success).toBe(true)
    const texto = captura.html
      .replace(/data:[^)"']+/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
    expect(texto).not.toMatch(/margen|utilidad|comisi[oó]n|\bfee\b|recargo/i)
    expect(texto).not.toMatch(/%/)
    expect(texto).not.toMatch(/17[,.]5/)
    // El precio que sí ve: el del hotel con el 17,5 % adentro, como un solo número.
    const brisa = (base.tablas.items as Fila[]).find(i => i.id === 'h-brisa')!
    expect(brisa.precio_venta).toBe(Math.round(3_000_000 / (1 - 0.175)))
  }, 60_000)
})
