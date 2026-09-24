/**
 * La tarjeta de datos clave pinta lo que el servidor resolvió, sin esconder nada.
 *
 * Prueba de RENDER a propósito: el defecto que la tarjeta cierra es que un dato que falta
 * no se veía. Un «Sin definir» que el JSX olvidara pintar, o una contradicción que no
 * saliera en rojo, pasarían todas las pruebas de `datos-clave.ts` y `cruces.ts`.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import PanelDatosClave from './panel-datos-clave'
import type { VistaDatosClave } from '@/lib/negocios/datos-clave'
import type { LecturaFuente, ResultadoVoto } from '@/lib/negocios/votos'

const fuente = (f: Partial<LecturaFuente>): LecturaFuente => ({
  clave: 'k', etiqueta: 'X', bloque_slug: 'rut', field: 'x', persona: null, valor: '1',
  verificada: false, editada_por: null, dv_invalido: false, archivo: null, alimenta_generacion: false,
  estado: 'coincide', ...f,
})

// V0142 medido: la casilla 26 del RUT mal leída.
const V0142: ResultadoVoto = {
  slug: 'documento_titular',
  label: 'Documento del titular',
  estado: 'dudosa',
  valor: '1022424269',
  bloquea: true,
  niega_generacion: true,
  mensaje: 'Documento del titular: lectura dudosa en RUT (casilla 26) (1022424289). Factura y Certificado UPME dicen 1022424269.',
  fuentes: [
    fuente({ clave: '0:rut.numero_identificacion', etiqueta: 'RUT (casilla 26)', valor: '1022424289', estado: 'dudosa', archivo: 'https://drive.google.com/file/d/abc/view' }),
    fuente({ clave: '2:factura', etiqueta: 'Factura', valor: '1022424269' }),
    fuente({ clave: '3:cert', etiqueta: 'Certificado UPME', valor: '1022424269' }),
  ],
}
const V0286: ResultadoVoto = {
  ...V0142,
  estado: 'acuerdo',
  valor: '3556837',
  bloquea: false,
  niega_generacion: false,
  mensaje: null,
  fuentes: [
    fuente({ etiqueta: 'RUT (casilla 26)', valor: '3556837' }),
    fuente({ etiqueta: 'Factura', valor: '3556837' }),
    fuente({ etiqueta: 'Certificado UPME', valor: '3556837' }),
  ],
}

const VISTA: VistaDatosClave = {
  titulo: 'Datos clave',
  campos: [
    { label: 'Servicio', valor: { estado: 'sin_definir' }, detalle: [] },
    { label: 'Titularidad', valor: { estado: 'ok', texto: 'Único', nota: null }, detalle: ['ALVARADO BARRUETO LADY MARLENE'] },
    { label: 'Tarifa UPME', valor: { estado: 'ok', texto: '$701.812', nota: 'cotizada' }, detalle: [] },
    { label: 'Cita DIAN', valor: { estado: 'no_aplica' }, detalle: [] },
  ],
  contradicciones: [
    { slug: 'factura', mensaje: 'La factura trae 2 compradores y la titularidad dice «Un solo solicitante».', bloquea: false },
    { slug: 'certificado', mensaje: 'El certificado UPME trae 1 solicitante y la titularidad dice «Copropiedad».', bloquea: true },
  ],
}

const html = (v: VistaDatosClave | null) => renderToStaticMarkup(React.createElement(PanelDatosClave, { vista: v }))

describe('PanelDatosClave', () => {
  it('pinta el valor, su nota, el detalle, «Sin definir» y «No aplica»', () => {
    const h = html(VISTA)
    expect(h).toContain('Único')
    expect(h).toContain('ALVARADO BARRUETO LADY MARLENE')
    expect(h).toContain('$701.812')
    expect(h).toContain('(cotizada)')
    expect(h).toContain('Sin definir')
    expect(h).toContain('No aplica')
    expect(h).toMatch(/amber[^"]*"[^>]*>\s*Sin definir/)
  })

  it('las contradicciones van en rojo y dicen cuándo frenan el avance', () => {
    const h = html(VISTA)
    expect(h).toContain('La factura trae 2 compradores y la titularidad dice «Un solo solicitante».')
    expect(h).toMatch(/bg-red-50/)
    expect(h.match(/Frena el avance en esta etapa/g)).toHaveLength(1)
  })

  it('la lectura dudosa va en rojo, con su PDF, lo que frena y el valor de la mayoría', () => {
    const h = renderToStaticMarkup(React.createElement(PanelDatosClave, {
      vista: { ...VISTA, contradicciones: [], lecturas: [V0142] },
      corregirLectura: async () => ({ success: true }),
    }))
    expect(h).toContain('lectura dudosa en RUT (casilla 26) (1022424289)')
    expect(h).toContain('Lectura dudosa')
    expect(h).toContain('Ver PDF')
    expect(h).toContain('https://drive.google.com/file/d/abc/view')
    expect(h).toContain('Corregir a 1022424269')
    expect(h).toContain('No se generan documentos para la DIAN')
    expect(h).toContain('Frena el avance en esta etapa')
  })

  it('sin la acción de corregir no ofrece el botón', () => {
    const h = html({ ...VISTA, contradicciones: [], lecturas: [V0142] })
    expect(h).toContain('Lectura dudosa')
    expect(h).not.toContain('Corregir a')
  })

  it('un voto en acuerdo no avisa: dice en qué documentos coincide', () => {
    const h = html({ ...VISTA, contradicciones: [], lecturas: [V0286] })
    expect(h).not.toMatch(/bg-red-50/)
    expect(h).toContain('Documento del titular: 3556837')
    expect(h).toContain('coincide en RUT (casilla 26), Factura y Certificado UPME')
  })

  it('los reprocesos cerrados se ven, y la tarjeta aparece aunque sea lo único', () => {
    const h = html({
      titulo: 'Datos clave', campos: [], contradicciones: [],
      reprocesos: [{ ciclo: 1, tipo: 'certificacion_upme', activo: false, abierto_at: 'x', cerrado_at: 'y', texto: 'Reproceso 1 · Certificación UPME · cerrado 22-sep' }],
    })
    expect(h).toContain('Reproceso 1 · Certificación UPME · cerrado 22-sep')
  })

  it('sin configuración ni contradicciones no pinta nada', () => {
    expect(html(null)).toBe('')
    expect(html({ titulo: 'x', campos: [], contradicciones: [] })).toBe('')
  })
})
