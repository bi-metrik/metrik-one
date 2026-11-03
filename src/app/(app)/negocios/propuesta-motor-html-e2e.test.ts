/**
 * El motor `html` de la propuesta dentro de la acción del PDF (PR 2, 2026-10-14), con la acción
 * REAL sobre el doble de Supabase de los vuelos de punta a punta. Chromium no corre aquí: el
 * motor se sustituye por un doble que guarda lo que recibe (o que falla, para el respaldo).
 *
 * Criterios:
 *  · apagado (sin `documento_viaje.motor`), el motor ni se llama y la respuesta no trae claves nuevas;
 *  · encendido, el modelo recibe los traslados (el pendiente del PR 1), el anticipo que asignó la
 *    asesora y su WhatsApp;
 *  · si el motor falla, sale el PDF de @react-pdf con un aviso: el cliente nunca se queda sin PDF;
 *  · generar con anticipo no registra pagos ni mueve la etapa del negocio (riesgo N4 de Hana).
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
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
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

describe('motor html de la propuesta en la acción del PDF', () => {
  it('apagado: el motor no se llama y la respuesta es la de siempre', async () => {
    const r = await generar()
    expect(motor.llamadas).toHaveLength(0)
    expect(r.renderedVia).toBe('react-pdf')
    expect('avisoFormato' in r).toBe(false)
  })

  it('encendido: imprime con Chromium y el modelo recibe traslados, anticipo y el WhatsApp de la asesora', async () => {
    sembrar({ motor: true, anticipo: true })
    const r = await generar()
    expect(r.renderedVia).toBe('chromium')
    expect(r.avisoFormato).toBeNull()
    expect(motor.llamadas).toHaveLength(1)
    const entrada = motor.llamadas[0] as EntradaModeloPropuesta
    expect(entrada.servicios?.map(s => [s.tipo, s.fecha])).toEqual([['traslado', '23 nov 2026']])
    expect(entrada.anticipo).toEqual({ monto: 1_500_000, texto: 'Con esto les apartamos el hotel.' })
    expect(entrada.asesora).toEqual({ nombre: 'Asesora de prueba', whatsapp: '573000000000' })
    // Sin planes opcionales, la lista va vacía (y alineada con `sugeridos`).
    expect(entrada.lugaresDeOpcionales).toEqual([])
    // El PDF es el del motor (una hoja en blanco del doble), no el de @react-pdf.
    const doc = await PDFDocument.load(Buffer.from(r.pdf, 'base64'))
    expect(doc.getPageCount()).toBe(1)
  })

  it('encendido: el contacto del negocio llega al modelo, con su empresa, y la propuesta lo nombra (2026-10-27)', async () => {
    sembrar({ motor: true })
    Object.assign(base.tablas.negocios[0], { contacto_id: 'c-1', empresa_id: 'e-1' })
    base.tablas.contactos = [{ id: 'c-1', workspace_id: WS, nombre: 'ANDRÉS DE LA TORRE' }]
    base.tablas.empresas = [{ id: 'e-1', workspace_id: WS, nombre: 'ANDRÉS DE LA TORRE', tipo_persona: 'natural', numero_documento: null, contacto_nombre: null, contacto_email: null, regimen_tributario: null, gran_contribuyente: false, agente_retenedor: false }]
    await generar()
    const entrada = motor.llamadas[0] as EntradaModeloPropuesta
    expect(entrada.cliente).toEqual({ contacto: 'ANDRÉS DE LA TORRE', empresa: 'ANDRÉS DE LA TORRE', tipoPersona: 'natural' })
    const m = modeloDePropuesta(entrada)
    expect(m.portada.destinatario).toEqual({ nombre: 'Andrés de la Torre', empresa: null })
    expect(htmlDePropuesta(m, { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'A' })).toContain('<b>Cotizada para</b>Andrés de la Torre')
  })

  it('encendido: sin contacto en el negocio, el modelo no tiene destinatario (la empresa de relleno no cuenta)', async () => {
    sembrar({ motor: true })
    await generar()
    const entrada = motor.llamadas[0] as EntradaModeloPropuesta
    expect(entrada.cliente).toEqual({ contacto: null, empresa: null, tipoPersona: null })
    expect(modeloDePropuesta(entrada).portada.destinatario).toBeNull()
  })

  it('encendido: cada plan opcional llega con su día, en el orden de los sugeridos', async () => {
    sembrar({ motor: true })
    ;(base.tablas.items as Fila[]).push(
      linea('a-opcional', 300_000, { nombre: 'Tour Johnny Cay', grupo: 'actividad: Tour en San Andrés', orden: 3, dia_relativo: 3, entra_al_precio: false, mostrar_en_sugeridos: true }),
    )
    await generar()
    const entrada = motor.llamadas[0] as EntradaModeloPropuesta
    expect(entrada.props.sugeridos?.map(s => s.nombre)).toHaveLength(1)
    expect(entrada.lugaresDeOpcionales).toEqual([{ ciudad: null, fecha: '25 nov 2026' }])
  })

  it('prueba del #1229 · la actividad de una tarifa llega al documento con su nombre y lo que incluye, sin MAYÚSCULAS', async () => {
    sembrar({ motor: true })
    const lectura = { origen: 'tarifario', leidaEn: 'L1', moneda: 'COP', total: 190_000, nombre: 'Playa Ficticia con almuerzo', descripcion: 'Incluye: almuerzo típico y transporte en lancha.', notasCliente: ['Incluye: almuerzo típico y transporte en lancha.'], campos: [{ label: 'Actividad', valor: 'Playa Ficticia con almuerzo' }] }
    ;(base.tablas.items as Fila[]).push(
      linea('a-playa', 300_000, { nombre: 'PLAYA FICTICIA CON ALMUERZO', descripcion: 'INCLUYE: ALMUERZO TÍPICO Y TRANSPORTE EN LANCHA.', grupo: 'actividad: Actividad en San Andrés', orden: 3, dia_relativo: 2, tarifa_pax: { casillas: { grupo_completo: lectura } } }),
    )
    await generar()
    const entrada = motor.llamadas[0] as EntradaModeloPropuesta
    const enElDia = entrada.props.dias?.flatMap(d => d.items).find(i => i.nombre === 'Playa Ficticia con almuerzo')
    expect(enElDia?.descripcion).toBe('Incluye: almuerzo típico y transporte en lancha.')
  })

  describe('brief del 2026-10-22, punto 1 · una actividad con día sale UNA vez en el día a día', () => {
    /** La lectura de una actividad como la deja «Usar tarifa de proveedor» (datos ficticios). */
    const deTarifa = (nombre: string) => ({
      origen: 'tarifario', leidaEn: `L-${nombre}`, moneda: 'COP', total: 190_000, nombre,
      descripcion: 'Incluye: almuerzo.', notasCliente: ['Incluye: almuerzo.'],
      campos: [{ label: 'Proveedor', valor: 'Operador Ficticio' }, { label: 'Actividad', valor: nombre }, { label: 'Ciudad', valor: 'San Andrés' }, { label: 'Fecha', valor: '2026-11-24' }],
    })
    /** Lo que el cliente lee: el día a día del modelo y el resumen de la portada. */
    async function documento() {
      await generar()
      const entrada = motor.llamadas[0] as EntradaModeloPropuesta
      const m = modeloDePropuesta(entrada)
      const html = htmlDePropuesta(m, { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de prueba' })
      const texto = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      const eventos = (fecha: string) => m.dias.find(d => d.fecha === fecha)?.eventos ?? []
      return { m, texto, eventos }
    }

    it('la actividad creada desde la tarifa: un evento el 24-nov y «1 visita» en la portada', async () => {
      sembrar({ motor: true })
      ;(base.tablas.items as Fila[]).push(
        linea('a-playa', 300_000, { nombre: 'Playa Ficticia con almuerzo', descripcion: 'Incluye: almuerzo.', grupo: 'actividad: Actividad en San Andrés', orden: 3, dia_relativo: 2, tarifa_pax: { casillas: { grupo_completo: deTarifa('Playa Ficticia con almuerzo') } } }),
      )
      const { texto, eventos } = await documento()
      expect(eventos('2026-11-24').filter(e => e.tipo === 'actividad').map(e => e.texto)).toEqual(['Playa Ficticia con almuerzo · San Andrés'])
      expect(texto).toContain('1 visita')
      expect(texto).not.toContain('2 visitas')
      // El traslado con día (sembrado el 23-nov) tampoco se cuenta otra vez como visita.
      expect(eventos('2026-11-23').map(e => e.tipo)).toEqual(['traslado'])
    })

    it('dos actividades distintas el mismo día: dos eventos y «2 visitas»', async () => {
      sembrar({ motor: true })
      ;(base.tablas.items as Fila[]).push(
        linea('a-playa', 300_000, { nombre: 'Playa Ficticia con almuerzo', grupo: 'actividad: Actividad en San Andrés', orden: 3, dia_relativo: 2, tarifa_pax: { casillas: { grupo_completo: deTarifa('Playa Ficticia con almuerzo') } } }),
        linea('a-buceo', 200_000, { nombre: 'Buceo Ficticio', grupo: 'actividad: Buceo en San Andrés', orden: 4, dia_relativo: 2, tarifa_pax: { casillas: { grupo_completo: deTarifa('Buceo Ficticio') } } }),
      )
      const { texto, eventos } = await documento()
      expect(eventos('2026-11-24').filter(e => e.tipo === 'actividad')).toHaveLength(2)
      expect(texto).toContain('2 visitas')
    })

    it('por pantallazo y escrita a mano tampoco se duplican', async () => {
      sembrar({ motor: true })
      const pantallazo = { ...deTarifa('Tour Ficticio en Lancha'), origen: undefined }
      ;(base.tablas.items as Fila[]).push(
        linea('a-pantallazo', 300_000, { nombre: 'TOUR FICTICIO EN LANCHA', grupo: 'actividad: Actividad en San Andrés', orden: 3, dia_relativo: 2, tarifa_pax: { casillas: { grupo_completo: pantallazo } } }),
        linea('a-mano', 100_000, { nombre: 'CENA FICTICIA', grupo: 'actividad: Cena en San Andrés', orden: 4, dia_relativo: 3 }),
      )
      const { texto, eventos } = await documento()
      expect(eventos('2026-11-24').filter(e => e.tipo === 'actividad')).toHaveLength(1)
      expect(eventos('2026-11-25').filter(e => e.tipo === 'actividad')).toHaveLength(1)
      expect(texto).toContain('2 visitas')
    })

    it('un hotel con día asignado (no es un servicio) sigue saliendo en su día', async () => {
      sembrar({ motor: true })
      ;(base.tablas.items as Fila[])[0].dia_relativo = 2
      const { eventos } = await documento()
      expect(eventos('2026-11-24').map(e => e.texto)).toContain('HOTEL VERDE MAR · SAN ANDRÉS')
    })
  })

  it('si el motor falla, sale el PDF de @react-pdf con un aviso', async () => {
    sembrar({ motor: true })
    motor.falla = true
    const r = await generar()
    expect(motor.llamadas).toHaveLength(1)
    expect(r.renderedVia).toBe('react-pdf')
    expect(r.avisoFormato).toContain('formato anterior')
    expect(r.pdf.length).toBeGreaterThan(1000)
  })

  it('con anticipo asignado, generar no registra pagos ni mueve la etapa del negocio', async () => {
    sembrar({ motor: true, anticipo: true })
    await generar()
    expect(base.tablas.cobros).toEqual([])
    expect((base.tablas.negocios[0] as Fila).etapa_actual_id).toBe('e1')
  })
})
