/**
 * Un descuento sobre el total a UNA sola tarifa (2026-10-29), de punta a punta: el recálculo REAL
 * escribe el total y la acción REAL del PDF arma el documento de Trappvel (@react-pdf) sobre el
 * doble de Supabase. Mismo montaje que `reglas-margen-pdf-e2e.test.ts`. Datos ficticios.
 *
 *  · Cada tarifa lleva SOLO sus descuentos (los de todas y los suyos), con su descripción.
 *  · Las líneas de cada tarifa menos sus descuentos dan su precio, al peso.
 *  · El total de la cotización (la Recomendada) no se mueve por el descuento de la Premium.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'
import { textoDelPDF } from '@/lib/pdf/texto-del-pdf'
import { POLITICA_REGLAS_POR_DEFECTO, reglasAJsonb } from '@/lib/cotizaciones/reglas-margen'
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS, userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({ isPdfRenderConfigured: () => false, renderViaService: async () => { throw new Error('no') } }))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => ({
    viaje: { composicion: { adultos: 2, ninos: 0, infantes: 0 }, fechas: { inicio: '2026-12-10', fin: '2026-12-15' }, destino: 'San Andrés', presentacion: null, nivelDetalle: 'normal' },
    error: null,
  }),
}))

// Las props que recibe la plantilla de Trappvel (la primera de cada PDF: el compositor renderiza
// varias veces por dentro).
const captura = vi.hoisted(() => ({ props: null as unknown }))
vi.mock('@/lib/pdf/plantillas-cotizacion', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/plantillas-cotizacion')>()
  return {
    ...real,
    compositorDePlantilla: (slug: string | null | undefined) => {
      const c = real.compositorDePlantilla(slug)
      if (!c) return null
      return async (props: Parameters<typeof c>[0]) => {
        if (captura.props === null) captura.props = props
        return c(props)
      }
    },
  }
})

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'

const WS = 'ws-agencia'
const COT = 'cot-reglas-tarifa'
const NEG = 'neg-reglas'

const lecturaVuelo = { total: 1, moneda: 'COP', campos: [{ label: 'Origen', valor: 'BOG' }, { label: 'Destino', valor: 'ADZ' }] }

function linea(id: string, nombre: string, grupo: string, costo: number, orden: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre, descripcion: null, grupo, opcion_de: null, es_ajuste: false, orden,
    cantidad: 1, subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: 0, precio_manual: false,
    unidad: null, tramos: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: true,
    mostrar_en_sugeridos: true, base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}

const reglas = (conPremium: boolean) => reglasAJsonb({
  politica: POLITICA_REGLAS_POR_DEFECTO,
  puntosExtra: 5,
  descuentos: [
    { id: 'b', descripcion: 'Cliente recurrente', pct: 10 },
    ...(conPremium ? [{ id: 'p', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'it-pre' }] : []),
  ],
})

function sembrar(conPremium: boolean) {
  const conTarifas = true
  base.secuencia = 0
  const items = [
    linea('v', 'Vuelo Bogotá San Andrés', 'vuelo', 600_000, 1, { tarifa_pax: { casillas: { grupo_completo: lecturaVuelo } } }),
    linea('h1', 'Hotel Ficticio Arena', 'hotel', 850_000, 2, { tarifa_pax: { descuentoCliente: { motivo: 'Reserva esta semana', tipo: 'pct', valor: 3 } } }),
    ...(conTarifas ? [linea('h2', 'Hotel Ficticio Coral', 'hotel', 1_275_000, 3)] : []),
    linea('p', 'Paseo ficticio en lancha', 'actividad', 300_001, 4),
  ]
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null, codigo: 'COT-2026-0300', consecutivo: 'COT-2026-0300', modo: 'detallada',
      descripcion: 'San Andrés', estado: 'borrador', valor_total: 0, costo_total: 0, margen_porcentaje: 15, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, piso_margen_pct: 12, aviso_margen_pct: 12,
      fecha_envio: null, fecha_validez: null, condiciones_pago: null, notas: null, lugar_entrega: null, terminos_condiciones: null, tarifa_aceptada_id: null, documento_cliente: null,
      reglas_margen: reglas(conPremium),
    }],
    items,
    cotizacion_itinerarios: conTarifas
      ? [
          { id: 'it-rec', workspace_id: WS, cotizacion_id: COT, nombre: 'Recomendada', orden: 1, va_en_propuesta: true, es_principal: false },
          { id: 'it-pre', workspace_id: WS, cotizacion_id: COT, nombre: 'Premium', orden: 2, va_en_propuesta: true, es_principal: false },
        ]
      : [],
    itinerario_opciones: conTarifas ? [{ itinerario_id: 'it-rec', item_id: 'h1' }, { itinerario_id: 'it-pre', item_id: 'h2' }] : [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', nombre: 'S1 26 1', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e2' }],
    // Como Trappvel: el mínimo se exige en la SALIDA (gate `margen_sobre_piso`), así que una tarifa
    // bajo el mínimo sigue en la propuesta y el PDF sale como borrador.
    lineas_negocio: [{ id: 'linea-viaje', config_extra: { margen: { convencion: 'sobre_venta', default_pct: 15, piso_pct: 12, aviso_pct: 12 } } }],
    etapas_negocio: [{ id: 'e2', linea_id: 'linea-viaje', orden: 2, config_extra: { gates: ['margen_sobre_piso'] } }],
    bloque_configs: [], rubros: [], item_adicionales: [], activity_log: [], decisiones_combinacion: [], negocio_bloques: [],
    cotizacion_excepciones_margen: [], cotizacion_ranuras: [], cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba', position: 'Asesora', phone_whatsapp: '300 000 0000' }],
    workspaces: [{ id: WS, name: 'Agencia de prueba', logo_url: null, color_primario: null, cotizacion_template_slug: 'trappvel', config_extra: {} }],
    empresas: [],
    fiscal_profiles: [{ workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: false, is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true, nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S' }],
    fotos_perfiles: [], fotos_perfiles_alias: [], fotos_catalogo: [],
  } as Record<string, Fila[]>
}

async function generar(conPremium: boolean) {
  sembrar(conPremium)
  await recalcularTotales(COT)
  captura.props = null
  const r = (await generateCotizacionPDF(COT, { vistaPrevia: true })) as { success: boolean; error?: string; pdf?: string }
  if (!r.success) throw new Error(r.error)
  return { props: captura.props as CotizacionPDFProps, texto: textoDelPDF(Buffer.from(r.pdf!, 'base64')) }
}

type LineaDoc = { precio_venta: number; cantidad: number; valorAdicionales?: number; nombre: string; nota?: string | null }
const totalDe = (l: LineaDoc) => Math.round(l.precio_venta * l.cantidad) + (l.valorAdicionales ?? 0)

describe('un descuento solo a la Premium', () => {
  let sin: Awaited<ReturnType<typeof generar>>
  let con: Awaited<ReturnType<typeof generar>>
  let totalSin = 0
  let totalCon = 0
  beforeAll(async () => {
    sin = await generar(false)
    totalSin = Number((base.tablas.cotizaciones as Fila[])[0].valor_total)
    con = await generar(true)
    totalCon = Number((base.tablas.cotizaciones as Fila[])[0].valor_total)
  }, 60_000)

  const bloque = (r: typeof sin, nombre: string) => r.props.itinerarios!.find(b => b.nombre === nombre)!

  it('cada tarifa lleva solo sus descuentos, con su descripción', () => {
    expect(bloque(con, 'Recomendada').descuentos?.map(d => d.descripcion)).toEqual(['Cliente recurrente'])
    expect(bloque(con, 'Premium').descuentos?.map(d => d.descripcion)).toEqual(['Cliente recurrente', 'Suba a Premium'])
    expect(con.texto).toContain('Suba a Premium')
  })

  it('las líneas de cada tarifa menos sus descuentos dan su precio, al peso', () => {
    for (const b of con.props.itinerarios!) {
      const suma = (b.items as LineaDoc[]).reduce((a, l) => a + totalDe(l), 0)
      const desc = (b.descuentos ?? []).reduce((a, d) => a + d.valor, 0)
      expect(suma - desc).toBe(b.precio)
    }
  })

  it('baja solo la Premium; la Recomendada y el total de la cotización no se mueven', () => {
    expect(bloque(con, 'Recomendada').precio).toBe(bloque(sin, 'Recomendada').precio)
    const subtotalPre = (bloque(con, 'Premium').items as LineaDoc[]).reduce((a, l) => a + totalDe(l), 0)
    expect(bloque(sin, 'Premium').precio - bloque(con, 'Premium').precio).toBe(Math.round(subtotalPre * 0.05))
    expect(totalCon).toBe(totalSin)
    expect(con.props.cotizacion.valor_total).toBe(bloque(con, 'Recomendada').precio)
    expect(con.props.descuentosTotal).toEqual(bloque(con, 'Recomendada').descuentos)
  })
})
