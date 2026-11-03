/**
 * La pastilla «Completo / Pendiente» de la cabecera de los bloques de autorización de datos, ficha
 * del cliente y servicios del viaje, con el estado que deriva la ficha del negocio de la MISMA regla
 * del gate. Se pinta el componente real de la página.
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

import { leerEstado } from '@/lib/autorizacion-datos/estado'
import { estadoAutorizacion, estadoFicha, estadoServicios } from '@/lib/negocios/estado-bloques-derivado'
import type { ServicioDelNegocio } from '@/lib/viaje/servicios-viaje-datos'

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


/**
 * Lo que la ficha del negocio arma con el estado derivado: la instancia trae el veredicto del gate
 * (`getNegocioDetalleCompleto` → `derivarEstadosDeBloques`) y la cabecera lo pinta.
 */
function bloque(id: string, nombre: string, tipo: string, configExtra: Record<string, unknown>, estado: string) {
  return {
    id: `bc-${id}`, etapa_id: 'e1', workspace_id: 'ws-1', bloque_definition_id: `def-${tipo}`, estado: 'editable', orden: 1,
    es_gate: false, nombre, slug: id,
    bloque_definitions: { id: `def-${tipo}`, tipo, nombre, is_visualization: false, can_be_gate: false },
    instancia: { id: `nb-${id}`, negocio_id: 'neg-1', bloque_config_id: `bc-${id}`, estado, data: {} },
    config_extra: configExtra, items: [],
  }
}

const base: P = {
  negocio,
  bloques: [],
  etapasLinea: [{ id: 'e1', nombre: 'Solicitud', stage: 'venta', orden: 1, numero: 1 }],
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

const pintar = (bloques: unknown[]) => renderToStaticMarkup(React.createElement(NegocioDetailClient, { ...base, bloques } as P))

/** La pastilla de la cabecera del bloque `nombre`: «Completo» o «Pendiente». */
function pastilla(html: string, nombre: string): string | null {
  const i = html.indexOf(`>${nombre}</span>`)
  if (i < 0) return null
  return /(Completo|Pendiente)<\/span>/.exec(html.slice(i))?.[1] ?? null
}

const autorizada = { existe: true, vigente: { generales: true, sensibles: false, menores: false, ofertas: false } }
const CAMPOS = [{ slug: 'nombre', label: 'Nombre', tipo: 'texto' as const, required: true }, { slug: 'telefono', label: 'Tel', tipo: 'telefono' as const, required: true }]
const contacto = { nombre: 'Cliente de prueba', email: null, telefono: '3000000000', rol: null, segmento: null, custom_data: {} }
const servicioListo: ServicioDelNegocio = {
  id: 'sv', tipo: 'hotel', nombre: 'Hotel', proveedor_nombre: null, localizador: null, estado: 'reservado', fecha_servicio: null,
  fecha_limite_pago: null, costo_cotizado: 1, valor_por_pagar: null, voucher_ref: null, confirmacion_ref: 'one://c', orden: 0,
  origen: 'cotizacion', gastos: [{ monto: 1, soporte_url: 'one://s', medio_pago: 'tc', titular_medio: 'empresa' }], aprobaciones: [],
}

describe('la cabecera de autorización, ficha y servicios dice lo mismo que el gate (barrido 2026-10-22)', () => {
  it('autorización firmada: «Completo» (el caso de Mauricio); sin firmar o revocada: «Pendiente»', () => {
    const si = estadoAutorizacion(leerEstado(autorizada), false)
    expect(pastilla(pintar([bloque('aut', 'Autorización de tratamiento de datos', 'contacto', { variante: 'autorizacion' }, si)]), 'Autorización de tratamiento de datos')).toBe('Completo')
    const no = estadoAutorizacion(leerEstado({ existe: true, vigente: {}, requiere_reaceptar: true }), false)
    expect(pastilla(pintar([bloque('aut', 'Autorización de tratamiento de datos', 'contacto', { variante: 'autorizacion' }, no)]), 'Autorización de tratamiento de datos')).toBe('Pendiente')
  })

  it('ficha del cliente: «Completo» con los obligatorios llenos; «Pendiente» si falta uno', () => {
    const ce = { variante: 'campos', campos: CAMPOS }
    expect(pastilla(pintar([bloque('ficha', 'Ficha del cliente', 'contacto', ce, estadoFicha(CAMPOS, contacto))]), 'Ficha del cliente')).toBe('Completo')
    expect(pastilla(pintar([bloque('ficha', 'Ficha del cliente', 'contacto', ce, estadoFicha(CAMPOS, { ...contacto, telefono: null }))]), 'Ficha del cliente')).toBe('Pendiente')
  })

  it('servicios del viaje: «Completo» con todo listo; «Pendiente» sin servicios', () => {
    expect(pastilla(pintar([bloque('sv', 'Servicios del viaje', 'servicios', {}, estadoServicios([servicioListo], true))]), 'Servicios del viaje')).toBe('Completo')
    expect(pastilla(pintar([bloque('sv', 'Servicios del viaje', 'servicios', {}, estadoServicios([], true))]), 'Servicios del viaje')).toBe('Pendiente')
  })
})
