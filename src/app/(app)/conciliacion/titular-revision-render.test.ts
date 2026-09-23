/**
 * El titular en «Revisar y facturar»: qué se muestra, cuándo hay una corrección que
 * mandar y qué se avisa antes de facturar con otro titular.
 *
 * V0502 es el caso de pantalla del brief: el contacto es Paula Andrea Oliveros y el
 * titular según el RUT es John Jairo Cifuentes Sabogal (79782266). La revisión tiene que
 * dejar ver las dos cosas y que la factura NO sale a nombre del contacto.
 *
 * Reglas puras de `@/lib/facturacion/titular-revision`, y el render de sus dos
 * componentes con `renderToStaticMarkup`, sin DOM (patrón de `tarjeta-retenido-render`).
 * Se quedan en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { casoFalso } from '../../../../test/cola-facturacion-doble'
import type { CasoPorFacturar } from '@/lib/actions/facturacion-actions'
import {
  avisosDeTitular,
  errorDelTitular,
  titularCambio,
  titularInicial,
  titularParaEnviar,
} from '@/lib/facturacion/titular-revision'
import { EditorTitular, ResumenTitular } from './editor-titular'

// La tarjeta importa server actions; acá solo se mide el primer render.
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import { FilaPorFacturar } from './conciliacion-client'

const V0502 = (p: Partial<CasoPorFacturar> = {}) => casoFalso({
  negocio_id: 'neg-v0502', codigo: 'V0502',
  cliente: 'JOHN JAIRO CIFUENTES SABOGAL', identificacion: '79782266',
  contacto_nombre: 'PAULA ANDREA OLIVEROS',
  titular: {
    tipo_documento: '13', numero: '79782266', dv: '1',
    nombre: ['JOHN JAIRO', 'CIFUENTES SABOGAL'], corregido: null,
  },
  tercero_siigo: '79782266',
  recibos_emitidos: [],
  ...p,
})

const pintar = (el: React.ReactElement) => renderToStaticMarkup(el)

describe('la revisión dice a nombre de quién sale, y quién es el contacto', () => {
  it('V0502: titular del RUT y contacto, cada uno en su fila', () => {
    const html = pintar(React.createElement('dl', null, React.createElement(ResumenTitular, { caso: V0502() })))
    expect(html).toContain('Titular')
    expect(html).toContain('JOHN JAIRO CIFUENTES SABOGAL')
    expect(html).toContain('CC 79782266')
    expect(html).toContain('Contacto del negocio (no es el titular)')
    expect(html).toContain('PAULA ANDREA OLIVEROS')
    expect(html).not.toContain('Titular corregido')
  })

  it('con una corrección vigente dice quién la hizo y qué dice el RUT', () => {
    const caso = V0502({
      cliente: 'PAULA ANDREA OLIVEROS', identificacion: '52100200',
      titular: {
        tipo_documento: '13', numero: '52100200', dv: '4', nombre: ['PAULA ANDREA', 'OLIVEROS'],
        corregido: {
          por: 'Diana Parra', at: '2026-09-22T15:00:00.000Z',
          rut: { identificacion: '79782266', nombre: 'JOHN JAIRO CIFUENTES SABOGAL' },
        },
      },
    })
    const html = pintar(React.createElement('dl', null, React.createElement(ResumenTitular, { caso })))
    expect(html).toContain('Titular corregido por Diana Parra')
    expect(html).toContain('El RUT dice: JOHN JAIRO CIFUENTES SABOGAL · 79782266')
    // Una nota dentro de un <dl> no puede ser un <p>.
    expect(html).not.toContain('<p')
  })
})

describe('la tarjeta, también la de un caso ya facturado, nombra al contacto aparte', () => {
  it('V0502 facturado: titular y documento, y el contacto como contacto', () => {
    const html = renderToStaticMarkup(React.createElement(FilaPorFacturar, {
      caso: V0502({ ya_facturado: true, factura_numero: 'FV-2-542' }),
      descarteAbierto: false, siigoConfigurado: true, productos: [], onCambio: () => {},
    }))
    expect(html).toContain('JOHN JAIRO CIFUENTES SABOGAL · 79782266 · contacto: PAULA ANDREA OLIVEROS')
    // Ya facturado: no se ofrece revisar, así que tampoco corregir el titular.
    expect(html).not.toContain('Revisar y facturar')
    expect(html).not.toContain('Corregir titular')
  })
})

describe('cuándo hay de verdad una corrección que mandar', () => {
  it('abrir el editor sin tocar nada NO es corregir', () => {
    const caso = V0502()
    expect(titularCambio(caso, titularInicial(caso))).toBe(false)
  })

  it('cambiar solo mayúsculas o espacios tampoco', () => {
    const caso = V0502()
    const e = { ...titularInicial(caso), nombres: ' john  jairo ' }
    expect(titularCambio(caso, e)).toBe(false)
  })

  it('otro documento sí, y viaja solo con los campos de su tipo', () => {
    const caso = V0502()
    const e = { ...titularInicial(caso), numero: '52100200', nombres: 'PAULA ANDREA', apellidos: 'OLIVEROS' }
    expect(titularCambio(caso, e)).toBe(true)
    expect(titularParaEnviar(e)).toEqual({
      tipo_documento: '13', numero: '52100200', nombres: 'PAULA ANDREA', apellidos: 'OLIVEROS',
    })
  })

  it('un documento con letras es un error, con la misma regla del servidor', () => {
    const caso = V0502()
    expect(errorDelTitular({ ...titularInicial(caso), numero: '7978A266' })).toContain('solo van dígitos')
  })
})

describe('lo que se avisa antes de facturar con otro titular', () => {
  const PAULA = (caso: CasoPorFacturar) =>
    ({ ...titularInicial(caso), numero: '52100200', nombres: 'PAULA ANDREA', apellidos: 'OLIVEROS' })

  it('otro documento es otro tercero, y el anterior no se toca', () => {
    const caso = V0502()
    const avisos = avisosDeTitular(caso, PAULA(caso))
    expect(avisos.join(' ')).toContain('CC 52100200 es otro tercero en Siigo')
    expect(avisos.join(' ')).toContain('El tercero 79782266 no se toca')
  })

  it('los recibos que ya salieron se nombran: no cambian', () => {
    const caso = V0502({ recibos_emitidos: ['RC-3-12'] })
    const avisos = avisosDeTitular(caso, PAULA(caso))
    expect(avisos.join(' ')).toContain('Ya salió RC-3-12 con el titular anterior')
  })

  it('volver a escribir lo del RUT quita la corrección, y se dice', () => {
    const caso = V0502({
      cliente: 'PAULA ANDREA OLIVEROS',
      titular: {
        tipo_documento: '13', numero: '52100200', dv: '4', nombre: ['PAULA ANDREA', 'OLIVEROS'],
        corregido: { por: 'Diana', at: '', rut: { identificacion: '79782266', nombre: 'JOHN JAIRO CIFUENTES SABOGAL' } },
      },
    })
    const e = { ...titularInicial(caso), numero: '79782266', nombres: 'JOHN JAIRO', apellidos: 'CIFUENTES SABOGAL' }
    expect(avisosDeTitular(caso, e)[0]).toBe('Queda otra vez el titular del RUT: se quita la corrección.')
  })

  it('el editor pinta los avisos y el error', () => {
    const caso = V0502({ recibos_emitidos: ['RC-3-12'] })
    const conAviso = pintar(React.createElement(EditorTitular, { caso, valor: PAULA(caso), onCambio: () => {} }))
    expect(conAviso).toContain('es otro tercero en Siigo')
    expect(conAviso).toContain('RC-3-12')
    expect(conAviso).toContain('El RUT cargado no se modifica')

    const conError = pintar(React.createElement(EditorTitular, {
      caso, valor: { ...PAULA(caso), apellidos: '' }, onCambio: () => {},
    }))
    expect(conError).toContain('Faltan los apellidos del titular')
  })

  it('un NIT muestra DV y razón social; una cédula, nombres y apellidos', () => {
    const caso = V0502()
    const nit = pintar(React.createElement(EditorTitular, {
      caso, valor: { ...titularInicial(caso), tipo_documento: '31' }, onCambio: () => {},
    }))
    expect(nit).toContain('Razón social')
    expect(nit).toContain('>DV<')
    expect(nit).not.toContain('Apellidos')

    const cc = pintar(React.createElement(EditorTitular, { caso, valor: titularInicial(caso), onCambio: () => {} }))
    expect(cc).toContain('Apellidos')
    expect(cc).not.toContain('Razón social')
  })
})
