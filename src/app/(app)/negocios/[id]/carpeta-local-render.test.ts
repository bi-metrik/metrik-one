/**
 * El campo de la carpeta del cerebro y el formulario del modal del gate, en su primer
 * render. Se prueba con `renderToStaticMarkup` (vitest corre en `node`, sin DOM): alcanza
 * para lo que se afirma, que es qué se ofrece y a quién.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// Los componentes importan la server action; aquí solo se mide el primer render.
vi.mock('../negocio-v2-actions', () => ({
  actualizarCarpetaLocalNegocio: async () => ({ error: null, carpeta: null }),
}))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))

import { CarpetaLocalEditor, CarpetaLocalGateForm } from './carpeta-local'

const editor = (inicial: string | null, puedeEditar: boolean) =>
  renderToStaticMarkup(
    React.createElement(CarpetaLocalEditor, { negocioId: 'n-1', inicial, puedeEditar }),
  )

describe('CarpetaLocalEditor', () => {
  it('muestra la carpeta guardada y, con permiso, el lápiz para editarla', () => {
    const html = editor('proyectos/soena/ve/', true)
    expect(html).toContain('proyectos/soena/ve/')
    expect(html).toContain('Editar carpeta del cerebro')
  })

  it('sin permiso la muestra, pero no ofrece editarla', () => {
    const html = editor('proyectos/soena/ve/', false)
    expect(html).toContain('proyectos/soena/ve/')
    expect(html).not.toContain('Editar carpeta del cerebro')
  })

  it('vacía y con permiso invita a agregarla', () => {
    const html = editor(null, true)
    expect(html).toContain('Agregar carpeta del cerebro')
  })

  it('vacía y sin permiso lo dice, sin botón', () => {
    const html = editor(null, false)
    expect(html).toContain('Sin carpeta del cerebro')
    expect(html).not.toContain('Agregar carpeta del cerebro')
    expect(html).not.toContain('<button')
  })
})

describe('CarpetaLocalGateForm', () => {
  const form = (errorServidor: string | null) =>
    renderToStaticMarkup(
      React.createElement(CarpetaLocalGateForm, {
        pendiente: false,
        errorServidor,
        onVolver: () => {},
        onGuardar: () => {},
      }),
    )

  it('ofrece escribir la carpeta y avanzar, no solo volver', () => {
    const html = form(null)
    expect(html).toContain('Carpeta del cerebro')
    expect(html).toContain('placeholder="proyectos/cliente/proyecto/"')
    expect(html).toContain('Guardar y avanzar')
    expect(html).toContain('Volver')
  })

  it('muestra el motivo cuando el servidor no la guardó', () => {
    const html = form('Tu rol o área no permite editar la carpeta del cerebro de este negocio')
    expect(html).toContain('Tu rol o área no permite editar la carpeta del cerebro de este negocio')
  })
})
