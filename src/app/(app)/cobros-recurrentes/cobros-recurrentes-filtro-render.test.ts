/**
 * Lo que la pantalla de cuentas de cobro pinta al abrir.
 *
 * Pedido de Mauricio (2026-09-14): por defecto la tabla muestra SOLO las cuentas
 * `enviada`; pendientes de aprobacion, pagadas y anuladas se buscan con el filtro de
 * estado, que conserva la opcion "Todos".
 *
 * Es prueba de render porque lo que se fija es un hecho de pantalla: que filas salen en
 * el primer render y que dicen los contadores. `renderToStaticMarkup` corre en el entorno
 * `node` de vitest, sin DOM, y alcanza para el primer render.
 *
 * La tercera prueba fija la decision que acompaña al cambio: los contadores miran el año,
 * no el filtro de estado. Si miraran la lista filtrada, "Pendientes aprobación" diria 0
 * justo cuando hay cuentas esperando que el owner las apruebe.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/cobros-recurrentes',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import CobrosRecurrentesClient from './cobros-recurrentes-client'

const ANIO = new Date().getFullYear()

function cuenta(numero: string, estado: string, monto = 1_000_000) {
  return {
    id: `id-${numero}`,
    numero,
    anio: ANIO,
    mes: 8,
    monto_total: monto,
    estado,
    fecha_emision: `${ANIO}-08-13`,
    fecha_vencimiento: `${ANIO}-08-15`,
    pdf_drive_url: null,
    email_destinatarios: null,
    email_enviado_at: null,
    pagado_at: null,
    conciliado_at: null,
    empresa_id_pagador: 'emp-1',
    cobros_ids: [],
    empresas: { id: 'emp-1', nombre: 'Empresa Prueba', razon_social: null, codigo: 'E1' },
  }
}

const CUENTAS = [
  cuenta('CC-ENVIADA-1', 'enviada'),
  cuenta('CC-ENVIADA-2', 'enviada'),
  cuenta('CC-PENDIENTE-1', 'emitida_pendiente_aprobacion'),
  cuenta('CC-PENDIENTE-2', 'emitida_pendiente_aprobacion'),
  cuenta('CC-PENDIENTE-3', 'emitida_pendiente_aprobacion'),
  cuenta('CC-PAGADA-1', 'pagada', 750_000),
  cuenta('CC-ANULADA-1', 'anulada'),
]

const props = { cuentas: CUENTAS, cobros: [], role: 'owner' }
const pintar = () => renderToStaticMarkup(React.createElement(CobrosRecurrentesClient, props))

/** El numero que pinta la tarjeta cuyo rotulo es `rotulo`. */
function contador(html: string, rotulo: string): string | null {
  const m = html.match(new RegExp(`${rotulo}</div><div[^>]*>([^<]+)</div>`))
  return m ? m[1] : null
}

describe('la pantalla de cuentas de cobro al abrir', () => {
  it('muestra en la tabla solo las cuentas enviadas', () => {
    const html = pintar()
    expect(html).toContain('CC-ENVIADA-1')
    expect(html).toContain('CC-ENVIADA-2')
    expect(html).not.toContain('CC-PENDIENTE-1')
    expect(html).not.toContain('CC-PAGADA-1')
    expect(html).not.toContain('CC-ANULADA-1')
  })

  it('deja el filtro de estado en Enviada y conserva la opción de ver todos', () => {
    const html = pintar()
    expect(html).toMatch(/<option value="enviada" selected="">Enviada<\/option>/)
    expect(html).toContain('<option value="todos">Todos los estados</option>')
    expect(html).toContain('<option value="emitida_pendiente_aprobacion">')
    expect(html).toContain('<option value="pagada">')
    expect(html).toContain('<option value="anulada">')
  })

  it('cuenta las cuentas del año aunque la tabla no las muestre', () => {
    const html = pintar()
    expect(contador(html, 'Pendientes aprobación')).toBe('3')
    expect(contador(html, 'Enviadas')).toBe('2')
    expect(contador(html, 'Pagadas/Conciliadas')).toBe('1')
    expect(contador(html, 'Total cobrado')).toBe('$750.000')
  })
})
