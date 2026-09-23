/**
 * «Corregir el reparto»: una línea con plata y sin negocio no cuenta y no se guarda.
 *
 * Soena, 2026-09-23: el buscador de cada línea llamaba al de Valida, que en un workspace
 * sin ese módulo responde `ok:false`; el modal lo convertía en lista vacía y el campo
 * quedaba mudo. Al guardar, la línea sin negocio se descartaba en silencio, el total la
 * contaba igual («Sin asignar $0») y el toast decía «Reparto actualizado» sin cambiar nada.
 *
 * Una prueba pura de `cuentasReparto` no fija que el JSX obedezca: pintar `sinAsignar` de
 * otra fuente o dejar el botón con la condición vieja sigue verde allá. Mismo patrón que
 * `recibo-enlace-render.test.ts`: `renderToStaticMarkup` sin DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }))
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  redistribuirReferencia: async () => ({ ok: true }),
  buscarNegociosParaReparto: async () => ({ ok: true, negocios: [] }),
}))

import { BotonGuardarReparto, FilaLinea, ResumenReparto } from './redistribuir-modal'
import { cuentasReparto } from '@/lib/cobros/reparto-en-pantalla'

const MOTIVO = 'el comercial partió la referencia equivocada'
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const lineaSinNegocio = {
  key: 'n1', negocioId: '', negocioCodigo: null, negocioNombre: null,
  monto: 400_000, porDevolver: false, facturado: false,
}

const cuentasConHueco = cuentasReparto({
  pagoOriginal: 1_000_000,
  lineas: [
    { negocioId: 'n-1', monto: 600_000, porDevolver: false },
    { negocioId: '', monto: 400_000, porDevolver: false },
  ],
  motivo: MOTIVO,
})

describe('la línea con plata y sin negocio', () => {
  it('no cuenta en lo asignado: el resumen dice que faltan $400.000, no $0', () => {
    const html = texto(renderToStaticMarkup(React.createElement(ResumenReparto, {
      pagoOriginal: 1_000_000, cuentas: cuentasConHueco,
    })))

    expect(html).toMatch(/Asignado a negocios \$\s?600\.000/)
    expect(html).toMatch(/Sin asignar \$\s?400\.000/)
    expect(html).toContain('no cuenta como asignada')
  })

  it('bloquea el botón de guardar', () => {
    const html = renderToStaticMarkup(React.createElement(BotonGuardarReparto, {
      cuentas: cuentasConHueco, isPending: false, onGuardar: () => {},
    }))
    expect(html).toMatch(/<button[^>]* disabled=""/)
  })

  it('la fila se marca: «Escoge el negocio»', () => {
    const html = texto(renderToStaticMarkup(React.createElement(FilaLinea, {
      linea: lineaSinNegocio, onCambiar: () => {}, onEliminar: () => {}, deshabilitado: false,
    })))
    expect(html).toContain('Escoge el negocio')
  })

  it('con todas las líneas con negocio y cuadradas, el botón queda habilitado', () => {
    const cuentas = cuentasReparto({
      pagoOriginal: 1_000_000,
      lineas: [
        { negocioId: 'n-1', monto: 600_000, porDevolver: false },
        { negocioId: 'n-2', monto: 400_000, porDevolver: false },
      ],
      motivo: MOTIVO,
    })
    const html = renderToStaticMarkup(React.createElement(BotonGuardarReparto, {
      cuentas, isPending: false, onGuardar: () => {},
    }))
    expect(html).not.toMatch(/<button[^>]* disabled=""/)

    const fila = texto(renderToStaticMarkup(React.createElement(FilaLinea, {
      linea: { ...lineaSinNegocio, negocioId: 'n-2', negocioCodigo: 'V0477', negocioNombre: 'Cliente' },
      onCambiar: () => {}, onEliminar: () => {}, deshabilitado: false,
    })))
    expect(fila).not.toContain('Escoge el negocio')
  })
})
