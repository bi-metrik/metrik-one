/**
 * Reunión con Trappvel del 2026-10-22, con las ACCIONES reales sobre el doble de Supabase:
 *  · punto 4: sin autorización de datos del cliente se ARMA la cotización (la tarjeta guarda), pero
 *    «Enviar» y «Aprobar» no la dejan salir; con la autorización, sale;
 *  · punto 1: «Pública» en la tarjeta guarda el tipo y deja el margen de la opción en 0 (el cliente
 *    paga el precio público); «Neta» lo devuelve a heredar el de la cotización.
 * Datos ficticios.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS, userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
// El PDF: un borrador no se guarda; uno limpio se guarda en el almacenamiento externo (doble).
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
const autorizado = vi.hoisted(() => ({ si: false }))
vi.mock('@/lib/autorizacion-datos/servidor', () => ({
  estadoDelContacto: async () => ({
    estado: { existe: true, vigente: { generales: autorizado.si, menores: autorizado.si }, requiere_reaceptar: false, pendiente: null, manual_sin_evidencia: null },
    error: null,
  }),
}))

import { enviarCotizacion } from './cotizacion-actions'
import { aceptarCotizacionNegocio } from './[id]/cotizacion/actions'
import { ajustarOpcion } from './tarifa-pax-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { PDFDocument } from 'pdf-lib'
import { MENSAJE_ENVIO_PENDIENTE } from '@/lib/autorizacion-datos/mensajes'

const WS = 'ws-agencia'
const COT = 'cot-1'
const NEG = 'neg-1'

function sembrar() {
  base.secuencia = 0
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null, codigo: 'COT-2026-0101', consecutivo: 'COT-2026-0101',
      modo: 'detallada', estado: 'borrador', valor_total: 0, costo_total: 0, margen_porcentaje: 15, margen_default_pct: 15,
      convencion_margen: 'sobre_venta', descuento_porcentaje: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: 5, aviso_margen_pct: 8, tarifa_aceptada_id: null,
    }],
    items: [{
      id: 'traslado', cotizacion_id: COT, nombre: 'Traslado aeropuerto - hotel', grupo: 'traslado: Aeropuerto - hotel', orden: 1,
      opcion_de: null, es_ajuste: false, cantidad: 1, subtotal: 502_000, descuento_porcentaje: 0, margen_porcentaje: null,
      precio_venta: 590_588, precio_manual: false, tarifa_pax: { casillas: {} }, dia_relativo: null, entra_al_precio: true,
    }],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', contacto_id: 'c-1', nombre: 'N1 26 1', precio_aprobado: null, etapa_actual_id: 'e2' }],
    lineas_negocio: [{ id: 'linea-viaje', config_extra: {} }],
    // El gate ya movido a Cotización (el SQL de configuración del PR).
    etapas_negocio: [
      { id: 'e1', linea_id: 'linea-viaje', numero: 1, orden: 1, config_extra: { gates: [] } },
      { id: 'e2', linea_id: 'linea-viaje', numero: 2, orden: 2, config_extra: { gates: ['margen_sobre_piso', 'autorizacion_datos'] } },
    ],
    negocio_bloques: [], rubros: [], item_adicionales: [], activity_log: [], cotizacion_itinerarios: [], itinerario_opciones: [],
    cotizacion_excepciones_margen: [], cotizacion_ranuras: [], decisiones_combinacion: [], bloque_configs: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba' }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba' }],
    workspaces: [{ id: WS, name: 'Agencia de prueba', cotizacion_template_slug: 'trappvel', config_extra: {} }],
  } as Record<string, Fila[]>
}

const item = () => (base.tablas.items as Fila[]).find(i => i.id === 'traslado')!
const cot = () => (base.tablas.cotizaciones as Fila[])[0]

beforeEach(() => {
  sembrar()
  autorizado.si = false
})

describe('punto 4 · se arma sin la autorización, no se envía', () => {
  it('la tarjeta guarda (armar), «Enviar» no deja salir y lo dice; autorizado, sale', async () => {
    const armar = await ajustarOpcion('traslado', { tipoTarifa: 'publica' })
    expect(armar.success).toBe(true)

    const r = await enviarCotizacion(COT)
    expect(r).toEqual({ success: false, error: MENSAJE_ENVIO_PENDIENTE })
    expect(cot().estado).toBe('borrador')

    autorizado.si = true
    const ok = await enviarCotizacion(COT)
    expect(ok.error).toBeUndefined()
    expect(cot().estado).toBe('enviada')
  })

  it('«Aprobar» desde borrador tampoco la deja salir sin la autorización', async () => {
    const r = await aceptarCotizacionNegocio(COT, NEG)
    expect(r).toEqual({ success: false, error: MENSAJE_ENVIO_PENDIENTE })
    expect(cot().estado).toBe('borrador')
  })
})

describe('punto 1 · «Pública» y «Neta» en la tarjeta', () => {
  it('Pública: queda el tipo, el margen de la opción en 0 y el precio al cliente es el público', async () => {
    const r = await ajustarOpcion('traslado', { tipoTarifa: 'publica' })
    expect(r.success).toBe(true)
    expect(item().margen_porcentaje).toBe(0)
    expect((item().tarifa_pax as { tipoTarifa?: { tipo: string; origen: string } }).tipoTarifa).toMatchObject({ tipo: 'publica', origen: 'persona' })
    expect(item().precio_venta).toBe(502_000)
  })

  it('Neta: vuelve a heredar el 15 % de la cotización', async () => {
    await ajustarOpcion('traslado', { tipoTarifa: 'publica' })
    const r = await ajustarOpcion('traslado', { tipoTarifa: 'neta' })
    expect(r.success).toBe(true)
    expect(item().margen_porcentaje).toBeNull()
    expect((item().tarifa_pax as { tipoTarifa?: { tipo: string } }).tipoTarifa?.tipo).toBe('neta')
    expect(item().precio_venta).toBe(590_588)
  })
})

describe('prueba real del 2026-10-29 · Neta con margen sano y la autorización pendiente', () => {
  type ResultadoPDF = { success: boolean; pdf: string; filename: string; borrador?: boolean; aviso?: string | null }
  const marca = async (r: ResultadoPDF) => (await PDFDocument.load(Buffer.from(r.pdf, 'base64'))).getTitle()

  it('«Enviar» frena por la autorización, y el PDF sale con la marca de borrador que dice por qué', async () => {
    // Neta: hereda el 15 % de la cotización, sobre el mínimo (5 %). Solo falta la autorización.
    await ajustarOpcion('traslado', { tipoTarifa: 'neta' })
    expect((await enviarCotizacion(COT)).error).toBe(MENSAJE_ENVIO_PENDIENTE)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.success).toBe(true)
    expect(pdf.borrador).toBe(true)
    expect(pdf.filename).toMatch(/BORRADOR\.pdf$/)
    expect(await marca(pdf)).toBe('BORRADOR · falta la autorización de datos · no enviar')
    expect(pdf.aviso).toContain(MENSAJE_ENVIO_PENDIENTE)
  })

  it('con la autorización firmada, el mismo PDF sale limpio', async () => {
    await ajustarOpcion('traslado', { tipoTarifa: 'neta' })
    autorizado.si = true
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.success).toBe(true)
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.filename).not.toMatch(/BORRADOR/)
  })
})
