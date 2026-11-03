/**
 * H7-2 / N7-2 (QA de punta a punta del 2026-10-29, viaje 07): con menores en el viaje y la casilla
 * de menores sin marcar, la franja decía «Falta la autorización de datos del cliente» (el bloque
 * mostraba «Aprobada por el titular») y mandaba al bloque de E1, que en Cotización y Seguimiento no
 * se ve. Ahora dice que faltan los menores y ella misma copia un link nuevo o lo manda por correo.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, message: () => {} }) }))
vi.mock('./autorizacion-negocio-actions', () => ({
  linkAutorizacionDelNegocio: async () => ({ url: 'https://x.test/a', error: null }),
  correoAutorizacionDelNegocio: async () => ({ enviadoA: 'a@b.test', error: null }),
}))

const { AvisoAutorizacionPendiente } = await import('./aviso-autorizacion-pendiente')
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('la franja de la autorización pendiente', () => {
  it('N7-2 · con los menores pendientes lo dice así, no «del cliente»', () => {
    const t = texto(renderToStaticMarkup(React.createElement(AvisoAutorizacionPendiente, { falta: 'menores', negocioId: 'neg-1', puedePedir: true })))
    expect(t).toContain('Falta la autorización de los menores del viaje')
    expect(t).not.toContain('Falta la autorización de datos del cliente')
    expect(t).toContain('casilla de los menores')
  })

  it('H7-2 · ofrece copiar un link nuevo y enviarlo por correo, sin depender del bloque de Solicitud', () => {
    const t = texto(renderToStaticMarkup(React.createElement(AvisoAutorizacionPendiente, { falta: 'menores', negocioId: 'neg-1', puedePedir: true })))
    expect(t).toContain('Copiar link nuevo')
    expect(t).toContain('Enviar por correo')
    expect(t).not.toContain('bloque «Autorización de datos»')
  })

  it('sin permiso (solo lectura) no ofrece los botones', () => {
    const t = texto(renderToStaticMarkup(React.createElement(AvisoAutorizacionPendiente, { falta: 'generales', negocioId: 'neg-1', puedePedir: false })))
    expect(t).toContain('Falta la autorización de datos del cliente')
    expect(t).not.toContain('Copiar link nuevo')
  })
})
