/**
 * La cotización de viaje se pinta DENTRO del mismo marco que la página del negocio
 * (corrección de Mauricio a #874): ir del negocio a la cotización y volver no puede mover
 * nada del encabezado ni del panel.
 *
 * Lo que se fija, sobre el componente REAL de la página del negocio:
 *  1. El encabezado (todo lo que va antes del centro) es idéntico byte a byte en las dos
 *     pantallas, salvo la variable CSS del alto que solo la cotización necesita.
 *  2. El panel derecho es idéntico salvo la cotización resaltada.
 *  3. En la cotización el centro es el editor, no los bloques del negocio.
 *  4. R6 · sin viaje (toda otra línea) el negocio no pinta ni la línea del viaje ni las
 *     secciones del panel.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {}, replace: () => {} }),
  useParams: () => ({ id: 'neg-1' }),
  usePathname: () => '/negocios/neg-1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, info: () => {} }) }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({}))
vi.mock('@/components/activity-log', () => ({ default: () => React.createElement('div', null, 'ACTIVIDAD') }))

const { default: NegocioDetailClient } = await import('./negocio-detail-client')
type P = React.ComponentProps<typeof NegocioDetailClient>

const negocio = {
  id: 'neg-1', workspace_id: 'ws-1', codigo: 'V0012', nombre: 'MIAMI 7N', estado: 'abierto',
  stage_actual: 'venta', etapa_actual_id: 'e2', precio_aprobado: null, precio_estimado: null,
  carpeta_url: null, pausado: false, pausado_hasta: null, veces_pausado: 0, motivo_pausa: null,
  motivo_pausa_detalle: null, metadata: {}, fecha_venta: null, responsables: [],
  etapas_negocio: { nombre: 'Cotización', stage: 'venta', numero: 2 },
  lineas_negocio: { nombre: 'Viaje a medida', numero: 1 },
  contactos: { id: 'c-1', nombre: 'MAURICIO MORENO', telefono: '+57 3209219444', email: 'm@correo.co', rol: 'decisor', segmento: 'contactado' },
  empresas: null, campanas_contacto: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const viaje = {
  negocioId: 'neg-1',
  viaje: { destino: 'Providencia', fechas: { inicio: '2026-11-09', fin: '2026-11-13' }, composicion: { adultos: 2, ninos: 1, infantes: 0 } },
  iataDestino: 'PVA',
  solicitud: { destino: 'Providencia', alcance: 'Nacional', fechas: '9 al 13 nov 2026', tipoDeFechas: 'fechas fijas', pasajeros: '2 adultos, 1 niño', requisitos: null },
  perfil: { tipo: 'Leisure', conQuienViaja: 'ESPOSA E HIJO', bolsillo: 'Medio', preferencias: null, notas: null },
  cotizaciones: [
    { id: 'cot-1', codigo: 'COT-2026-0012', estado: 'borrador', valorTotal: 4180118, editadaEl: '2026-09-23T14:00:00Z' },
    { id: 'cot-2', codigo: 'COT-2026-0010', estado: 'enviada', valorTotal: 0, editadaEl: '2026-09-20T14:00:00Z' },
  ],
  puedeCrearCotizacion: true,
}

const base: P = {
  negocio,
  bloques: [],
  etapasLinea: [
    { id: 'e1', nombre: 'Solicitud', stage: 'venta', orden: 1, numero: 1 },
    { id: 'e2', nombre: 'Cotización', stage: 'venta', orden: 2, numero: 2 },
  ],
  profiles: [],
  currentUserId: 'u-1',
  currentUserEsResponsable: true,
  userRole: 'owner',
  cobros: [],
  cotizacionesNegocio: [],
  resumenFinanciero: { totalCobrado: 0, porCobrar: 0, costosEjecutados: 0 },
  ejecucionData: { presupuesto: [], gastos: [], horas: [] },
  historialData: { gastos: [], horas: [], cobros: [] },
  actividad: [],
  staffList: [],
  datosOtrasEtapas: {},
  pausaEnabled: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const pintar = (extra: Partial<P>) => renderToStaticMarkup(React.createElement(NegocioDetailClient, { ...base, ...extra }))

/** Todo lo que va antes del centro: banners, encabezado fijo, filas 3 a 5 y panel móvil. */
function encabezado(html: string, marca: string): string {
  const i = html.indexOf(marca)
  expect(i).toBeGreaterThan(0)
  return html.slice(0, html.lastIndexOf('<div', i))
}
function panel(html: string): string {
  return html.slice(html.indexOf('<aside'))
}
const sinVariable = (h: string) => h.replace(/ style="--alto-encabezado-negocio:[^"]*"/, '')
/** La fila de la cotización cot-1: resaltada en la cotización, enlace en el negocio. */
const sinResaltado = (h: string) => h.replace(/<li>(?:(?!<\/li>).)*COT-2026-0012(?:(?!<\/li>).)*<\/li>/, '<li>COT-1</li>')

describe('la cotización se pinta dentro del mismo marco del negocio', () => {
  const negocioHtml = pintar({ viaje })
  const cotizacionHtml = pintar({ viaje, centro: React.createElement('div', null, 'EDITOR'), cotActualId: 'cot-1' })

  it('el encabezado es idéntico byte a byte (todo lo que va antes del centro)', () => {
    const arriba = sinVariable(encabezado(cotizacionHtml, 'data-centro-cotizacion'))
    expect(negocioHtml.slice(0, arriba.length)).toBe(arriba)
    // Y justo ahí empieza, en el negocio, el cuerpo de bloques.
    expect(negocioHtml.slice(arriba.length).startsWith('<div class="space-y-4">')).toBe(true)
  })

  it('el panel derecho es idéntico salvo la cotización resaltada', () => {
    expect(sinResaltado(panel(cotizacionHtml))).toBe(sinResaltado(panel(negocioHtml)))
    expect(panel(cotizacionHtml)).toContain('aria-current="page"')
    expect(panel(negocioHtml)).not.toContain('aria-current="page"')
  })

  it('el encabezado dice el viaje con el IATA y el panel trae solicitud, perfil y cotizaciones', () => {
    expect(negocioHtml).toContain('Providencia · PVA · 9 al 13 nov 2026 · 2 adultos, 1 niño')
    expect(panel(negocioHtml)).toContain('Bolsillo declarado')
    expect(panel(negocioHtml)).toContain('href="/negocios/neg-1/cotizacion/cot-1"')
    expect(panel(negocioHtml)).toContain('Nueva cotización')
  })

  it('en la cotización el centro es el editor, no los bloques ni la actividad del negocio', () => {
    expect(cotizacionHtml).toContain('EDITOR')
    expect(cotizacionHtml).not.toContain('ACTIVIDAD')
    expect(negocioHtml).toContain('ACTIVIDAD')
  })

  it('R6 · sin viaje no hay línea del viaje ni secciones nuevas en el panel', () => {
    const html = pintar({})
    expect(html).not.toContain('data-encabezado-viaje')
    expect(html).not.toContain('data-panel-solicitud')
    expect(html).not.toContain('data-lista-cotizaciones')
    expect(html).not.toContain('--alto-encabezado-negocio')
    expect(pintar({ viaje: null })).toBe(html)
  })
})
