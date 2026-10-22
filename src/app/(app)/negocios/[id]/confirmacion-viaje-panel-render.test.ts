/**
 * La hoja «El cliente confirmó» renderizada con una cotización SIN tarifas (una sola opción por
 * componente: el editor no arma tarifas porque «saldrían idénticas»).
 *
 * Defecto del 2026-10-22 en Trappvel: sin filas en `cotizacion_itinerarios` la hoja decía «no
 * tiene tarifas con precio», el total quedaba en $0 y el botón se apagaba en «Escoge la tarifa»:
 * el viaje no se podía confirmar nunca. Ahora la vista trae una tarifa única con el total de la
 * cotización (`itinerarioId: null`) y la hoja la deja escogida.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { TarifaConfirmable, VistaConfirmacion } from '@/lib/viaje/confirmacion-datos'
import { REGLA_POR_DEFECTO, pesos, sumarDiasCivil } from '@/lib/viaje/plan-pagos'
import { todayBogotaISO } from '@/lib/dates/bogota'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, message: () => {} } }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
// Las acciones arrastran el servidor; la hoja solo necesita sus referencias.
vi.mock('../confirmacion-viaje-actions', () => ({
  aplicarPrerreservaSiVencio: async () => ({ ok: true }),
  confirmarClienteViaje: async () => ({ ok: true }),
  decidirAprobacionPlan: async () => ({ ok: true }),
  marcarConfirmacionEnviada: async () => ({ ok: true }),
  pedirAprobacionPlan: async () => ({ ok: true }),
}))

const { HojaConfirmacion } = await import('./confirmacion-viaje-panel')

const HOY = todayBogotaISO()

function vista(tarifas: TarifaConfirmable[], extra: Partial<VistaConfirmacion> = {}): VistaConfirmacion {
  return {
    negocioId: 'neg-1',
    workspaceId: 'ws-1',
    cliente: { nombre: 'Carolina Prueba', correo: null, telefono: '3001234567', contactoId: 'c-1' },
    viaje: { destino: 'Cusco', fechaSalida: sumarDiasCivil(HOY, 60), fechaRegreso: sumarDiasCivil(HOY, 65), composicion: null },
    regla: REGLA_POR_DEFECTO,
    cotizacion: { id: 'cot-1', consecutivo: 'COT-2026-0099', estado: 'enviada', tarifaAceptadaId: null },
    tarifas,
    errorTarifas: null,
    plan: null,
    versiones: [],
    aprobacion: null,
    confirmacion: null,
    titular: null,
    prerreserva: null,
    estado: { confirmado: false, planVigente: false, anticipoConSoporte: false },
    gates: [],
    gateMensajes: {},
    etapaConfirmacion: null,
    etapaActual: null,
    antesDeConfirmacion: false,
    enConfirmacion: true,
    terminosBase: null,
    agencia: 'Trappvel',
    comercial: 'Daniela',
    hayPago: false,
    aprobadores: [],
    prerreservaVencida: false,
    ...extra,
  }
}

function render(v: VistaConfirmacion): string {
  return renderToStaticMarkup(React.createElement(HojaConfirmacion, { vista: v, onCerrar: () => {}, onConfirmado: () => {} }))
}

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Los botones «Confirmar y enviar…» / motivo de apagado (el pie de la hoja). */
function botonPrincipal(html: string): { texto: string; apagado: boolean } {
  const m = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].find((b) => /Confirmar y enviar|Escoge la tarifa|Faltan|Sobran|Fuera de la regla|Hay una cuota/.test(b[2]))
  if (!m) throw new Error('no se encontró el botón de confirmar')
  return { texto: m[2], apagado: /\sdisabled=""/.test(m[1]) }
}

const TOTAL = 4_050_000

describe('cotización sin tarifas, con total', () => {
  const html = render(vista([{ itinerarioId: null, nombre: 'Total de la cotización', esRecomendada: false, precio: TOTAL, motivo: null }]))

  it('no muestra el mensaje rojo y ofrece la tarifa única escogida con el total', () => {
    expect(texto(html)).not.toContain('no tiene total ni tarifas con precio')
    expect(texto(html)).toContain('Total de la cotización')
    expect(html).toMatch(/<input type="radio" name="tarifa" checked=""/)
  })

  it('el total del pie es el de la cotización y el botón queda encendido', () => {
    expect(texto(html)).toContain(pesos(TOTAL))
    const b = botonPrincipal(html)
    expect(b.texto).toBe('Confirmar y enviar a Carolina')
    expect(b.apagado).toBe(false)
  })

  it('el mensaje al cliente no nombra la tarifa única', () => {
    expect(texto(html)).not.toMatch(/Tarifa:\*? Total de la cotización/)
  })
})

describe('cotización sin tarifas y sin total', () => {
  const html = render(vista([]))

  it('muestra el mensaje rojo y el botón apagado en «Escoge la tarifa»', () => {
    expect(texto(html)).toContain('Esta cotización no tiene total ni tarifas con precio')
    const b = botonPrincipal(html)
    expect(b.texto).toBe('Escoge la tarifa')
    expect(b.apagado).toBe(true)
  })
})

describe('cotización con tarifas: como antes', () => {
  it('preselecciona la Recomendada y confirma por su precio', () => {
    const html = render(vista([
      { itinerarioId: 'it-eco', nombre: 'Económica', esRecomendada: false, precio: 3_750_000, motivo: null },
      { itinerarioId: 'it-rec', nombre: 'Recomendada', esRecomendada: true, precio: TOTAL, motivo: null },
    ]))
    expect(texto(html)).toContain(`Recomendada · Recomendada ${pesos(TOTAL)}`)
    expect(botonPrincipal(html).apagado).toBe(false)
    const marcadas = [...html.matchAll(/<label[^>]*>(?:(?!<\/label>).)*name="tarifa" checked=""(?:(?!<\/label>).)*<\/label>/g)].map((m) => texto(m[0]))
    expect(marcadas).toEqual([`Recomendada · Recomendada ${pesos(TOTAL)}`])
  })
})
