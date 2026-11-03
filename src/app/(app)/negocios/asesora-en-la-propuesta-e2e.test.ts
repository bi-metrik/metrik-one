/**
 * Brief del 2026-10-29, punto 5 · la cotización lleva el nombre, el cargo, el correo y el celular
 * de su asesora: la responsable comercial del negocio o, sin ella, quien genera. Antes, el pie y la
 * firma eran los configurados del espacio (la línea del dueño) en todas las cotizaciones.
 * Datos inventados.
 */
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'
import { modeloDePropuesta, type EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { htmlDePropuesta } from '@/lib/pdf/html/trappvel/plantilla'

const motor = vi.hoisted(() => ({ llamadas: [] as unknown[], falla: false }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS, userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    ...clienteFalso(),
    // El correo de cada asesora vive en Auth (datos inventados).
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: CORREOS[id] ?? null } }, error: null }) } },
  }),
  createClient: async () => clienteFalso(),
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

const CORREOS: Record<string, string> = { 'p-resp': 'responsable@agencia.test', 'p-asesora': 'asesora@agencia.test' }
const WS = 'ws-trappvel'
const COT = 'cot-sai'
const NEG = 'neg-sai'

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'

function linea(id: string, precio: number, extra: Fila): Fila {
  return {
    id, cotizacion_id: COT, descripcion: null, opcion_de: null, es_ajuste: false, cantidad: 1,
    subtotal: Math.round(precio * 0.85), descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: precio, precio_manual: true,
    unidad: null, tramos: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: true, mostrar_en_sugeridos: true,
    base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}

function sembrar(opts: { motor: boolean; anticipo?: boolean }) {
  base.secuencia = 0
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
      linea('h-hotel', 5_000_000, { nombre: 'HOTEL VERDE MAR · SAN ANDRÉS', grupo: 'hotel: Hotel en San Andrés', orden: 1 }),
      linea('t-traslado', 400_000, { nombre: 'AEROPUERTO - HOTEL', grupo: 'traslado: Traslado en San Andrés', orden: 2, dia_relativo: 1 }),
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
    fiscal_profiles: [{
      workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S',
    }],
  }
}

type Resultado = { success: boolean; pdf: string; renderedVia?: string; avisoFormato?: string | null; error?: string }

async function generar(): Promise<Resultado> {
  await recalcularTotales(COT)
  const r = (await generateCotizacionPDF(COT)) as Resultado
  if (!r.success) throw new Error(r.error)
  return r
}

beforeEach(() => sembrar({ motor: false }))


const PIE_CONFIGURADO = 'www.agencia.test · contacto@agencia.test · 300 000 0000 · Bogotá'
const FIRMA_CONFIGURADA = { nombre: 'Dueño de la Agencia', cargo: 'Director', contacto: 'contacto@agencia.test' }

function conConfig() {
  sembrar({ motor: true })
  ;(base.tablas.workspaces[0] as Fila).config_extra = { documento_viaje: { motor: 'html', pie: PIE_CONFIGURADO, firma: FIRMA_CONFIGURADA } }
  ;(base.tablas.staff as Fila[])[0].profile_id = 'p-asesora'
  ;(base.tablas.staff as Fila[]).push({ id: 's-resp', full_name: 'Responsable Ficticia', position: 'Asesora de viajes', phone_whatsapp: '+573000000001', profile_id: 'p-resp' })
}

async function documento() {
  await generar()
  const entrada = motor.llamadas[0] as EntradaModeloPropuesta
  const m = modeloDePropuesta(entrada)
  return { entrada, m, html: htmlDePropuesta(m, { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de prueba' }) }
}

describe('punto 5 · los datos de la asesora en la cotización', () => {
  it('la responsable del negocio: su nombre, cargo, correo y celular en el pie y en la firma', async () => {
    conConfig()
    ;(base.tablas.negocios[0] as Fila).responsable_id = 's-resp'
    const { m, html, entrada } = await documento()
    expect(m.formal.pie).toBe('Responsable Ficticia · Asesora de viajes · responsable@agencia.test · 300 000 0001 · www.agencia.test')
    expect(m.formal.firma).toEqual({ nombre: 'Responsable Ficticia', cargo: 'Asesora de viajes', contacto: 'responsable@agencia.test · 300 000 0001' })
    expect(html).not.toContain('Dueño de la Agencia')
    // El botón de apartar abre el WhatsApp de la misma asesora.
    expect(entrada.asesora).toEqual({ nombre: 'Responsable Ficticia', whatsapp: '573000000001' })
  })

  it('sin responsable en el negocio, quien genera', async () => {
    conConfig()
    const { m } = await documento()
    expect(m.formal.pie).toBe('Asesora de prueba · Asesora · asesora@agencia.test · 300 000 0000 · www.agencia.test')
  })

  it('lo que falta en la ficha no se inventa: sin correo ni celular, va el nombre y el cargo', async () => {
    conConfig()
    ;(base.tablas.negocios[0] as Fila).responsable_id = 's-resp'
    Object.assign((base.tablas.staff as Fila[])[1], { phone_whatsapp: null, profile_id: null })
    const { m } = await documento()
    expect(m.formal.firma).toEqual({ nombre: 'Responsable Ficticia', cargo: 'Asesora de viajes', contacto: null })
    expect(m.formal.pie).toBe('Responsable Ficticia · Asesora de viajes · www.agencia.test')
  })

  it('una responsable sin ficha de staff: el pie y la firma configurados, como antes', async () => {
    conConfig()
    ;(base.tablas.negocios[0] as Fila).responsable_id = 's-no-existe'
    const { m } = await documento()
    expect(m.formal.pie).toBe(PIE_CONFIGURADO)
    expect(m.formal.firma).toEqual(FIRMA_CONFIGURADA)
  })
})
