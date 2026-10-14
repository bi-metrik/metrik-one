/**
 * Lo que pinta el estado de la autorización, en el viaje y en el directorio.
 *
 * Render a propósito: la regla de `vista.ts` puede estar bien y el JSX pintar otra cosa. Se fija
 * que lo no autorizado es ROJO (token `alerta`, no el ámbar de antes) con la consecuencia del
 * alcance, que lo aprobado sigue verde, y que sin permiso no salen los botones.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { EstadoAutorizacion, type AccionesAutorizacion } from './estado-autorizacion'
import { armarVista } from '@/lib/autorizacion-datos/vista'
import { leerEstado } from '@/lib/autorizacion-datos/estado'

const base = {
  existe: true,
  contacto: { nombre: 'CLIENTE INVENTADO', email: 'cliente@correo-inventado.co' },
  texto: { id: 't', version: 'v1.1', mayor: 1, menor: 1 },
  vigente: { generales: false, sensibles: false, menores: false, ofertas: false },
}
const acciones: AccionesAutorizacion = { copiar: () => {}, enviarCorreo: () => {}, pendiente: false }

const pintar = (estado: Record<string, unknown>, alcance: 'viaje' | 'contacto', conAcciones = true) =>
  renderToStaticMarkup(React.createElement(EstadoAutorizacion, {
    vista: armarVista(leerEstado(estado), null),
    alcance,
    acciones: conAcciones ? acciones : null,
  }))

describe('EstadoAutorizacion', () => {
  it('no autorizada en el viaje: rojo, motivo, consecuencia y los dos botones', () => {
    const html = pintar(base, 'viaje')
    expect(html).toContain('border-alerta/30')
    expect(html).toContain('text-alerta')
    expect(html).not.toContain('#FFFBEB')
    expect(html).not.toContain('#92400E')
    expect(html).toContain('CLIENTE INVENTADO no ha autorizado el tratamiento de sus datos.')
    expect(html).toContain('Sin esta autorización el viaje no pasa a Cotización.')
    expect(html).toContain('Copiar link')
    expect(html).toContain('Enviar por correo')
  })

  it('no autorizada en el directorio: la consecuencia habla de los viajes del cliente', () => {
    const html = pintar({ ...base, requiere_reaceptar: true }, 'contacto')
    expect(html).toContain('hay una versión nueva que pide volver a autorizar')
    expect(html).toContain('Sin esta autorización los viajes de este cliente no pasan a Cotización.')
  })

  it('sin permiso para pedir: el estado se ve, los botones no', () => {
    const html = pintar(base, 'contacto', false)
    expect(html).toContain('text-alerta')
    expect(html).not.toContain('Copiar link')
    expect(html).not.toContain('Enviar por correo')
  })

  it('aprobada: verde con versión, sin consecuencia ni botones', () => {
    const html = pintar({
      ...base,
      vigente: { ...base.vigente, generales: true, sensibles: true },
      aceptacion: { enlace_id: 'e', aceptado_at: '2026-10-09T15:00:00Z', version: 'v1.1', mayor: 1, menor: 1, medio: 'correo', casillas: { generales: true, sensibles: true }, revocadas: {}, via: 'link' },
    }, 'contacto')
    expect(html).toContain('text-acento')
    expect(html).toContain('Aprobada por el titular el ')
    expect(html).toContain('Versión v1.1')
    expect(html).not.toContain('alerta')
    expect(html).not.toContain('no pasan a Cotización')
    expect(html).not.toContain('Copiar link')
  })
})
