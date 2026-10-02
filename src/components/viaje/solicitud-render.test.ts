/**
 * La tarjeta «Solicitud» pintada (Noor, 2026-10-02): la caja con sus textos, «lo que falta» con
 * las preguntas de la config y la pregunta del guardián primero, la franja «Lista para cotizar.»,
 * y la revisión con sugerido, conflicto y «Más datos». Datos inventados.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import FaltaParaCotizar from './falta-para-cotizar'
import RevisionSolicitud from './revision-solicitud'
import CajaSolicitud from './caja-solicitud'
import type { CampoSolicitud } from './solicitud-campo'

const FIELDS: CampoSolicitud[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos viajan?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Viajan bebés menores de 2 años?' },
  { slug: 'categoria_hotel', tipo: 'select', label: 'Hotel', nivel: 'minimo', pregunta: '¿De qué categoría prefieren el hotel?', opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }] },
  { slug: 'equipaje', tipo: 'select', label: 'Equipaje', nivel: 'deseable', pregunta: '¿Qué equipaje llevan?', opciones: [{ value: 'mano', label: 'De mano' }] },
  { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos especiales' },
]

const nada = () => {}

describe('lo que falta para cotizar', () => {
  it('solo el mínimo que falta, como pregunta, con su respuesta de un toque; la del guardián va primero', () => {
    const html = renderToStaticMarkup(React.createElement(FaltaParaCotizar, {
      fields: FIELDS,
      valores: { destino: 'LISBOA' },
      preguntasGuardian: [{ slug: 'fecha_salida', texto: 'No cargué la fecha: «en marzo» no dice el día. ¿Qué día salen?' }],
      onGuardar: nada,
      puedeAvanzar: true,
    }))
    expect(html).toContain('Para cotizar falta: 4')
    expect(html).not.toContain('¿A dónde quieren viajar?')
    expect(html.indexOf('No cargué la fecha')).toBeLessThan(html.indexOf('¿Cuántos adultos viajan?'))
    expect(html).toContain('3 estrellas')
    expect(html).toContain('>No<')
    expect(html).toContain('>Sí<')
    expect(html).toContain('>Otro<')
    expect(html).toContain('Para la cotización final: 0 de 1')
    expect(html).not.toContain('Lista para cotizar.')
  })

  it('con el mínimo completo, la franja «Lista para cotizar.» con «Pasar a cotización»', () => {
    const html = renderToStaticMarkup(React.createElement(FaltaParaCotizar, {
      fields: FIELDS,
      valores: { destino: 'LISBOA', fecha_salida: '2027-03-14', adultos: 2, infantes: 0, categoria_hotel: '4' },
      preguntasGuardian: [],
      onGuardar: nada,
      puedeAvanzar: true,
    }))
    expect(html).toContain('Lista para cotizar.')
    expect(html).toContain('Pasar a cotización')
    expect(html).not.toContain('Para cotizar falta')
  })
})

describe('la solicitud para revisar', () => {
  it('lista de lectura: sugerido con «Confirmar», conflicto en ámbar con «Usar» / «Dejar», «Más datos»', () => {
    const html = renderToStaticMarkup(React.createElement(RevisionSolicitud, {
      fields: FIELDS,
      valores: { destino: 'LISBOA', fecha_salida: '2027-03-12', adultos: 2, categoria_hotel: '4' },
      sugeridos: {
        destino: { fuente: 'web', frase: 'ir a Lisboa' },
        adultos: { fuente: 'web', frase: 'ella y el papá de 72' },
      },
      conflictos: { fecha_salida: { fuente: 'web', valor: '2027-03-14', origen: 'mensaje', en: '2026-10-02T15:00:00Z' } },
      historias: [{ texto: 'El cliente dijo:\n«ir a Lisboa»', en: null }],
      editable: true,
      onGuardar: nada,
      onConfirmar: nada,
      onConfirmarTodos: nada,
      onDejar: nada,
    }))
    expect(html).toContain('Confirmar los 2 sugeridos')
    expect(html).toContain('Sugerido')
    expect(html).toContain('Confirmar')
    expect(html).toContain('En ONE: 12 mar. El cliente dijo 14 mar en el texto pegado del 2-oct.')
    expect(html).toContain('Usar 14 mar')
    expect(html).toContain('Dejar 12 mar')
    expect(html).toContain('4 estrellas')
    // Los vacíos que no son del mínimo no se pintan: «Más datos (2)» (equipaje y requisitos).
    expect(html).toContain('Más datos (2)')
    expect(html).not.toContain('Requisitos especiales')
    expect(html).toContain('Lo que dijo el cliente')
  })
})

describe('la caja', () => {
  it('rótulo, ejemplo, «¿Quién lo escribió?», la ayuda y «Entender» inactivo sin texto', () => {
    const html = renderToStaticMarkup(React.createElement(CajaSolicitud, { onCargado: nada }))
    expect(html).toContain('Pega o escribe lo que te contó el cliente')
    expect(html).toContain('Un correo, un chat o tus notas de la llamada. Ej.: Lucía, Lisboa en marzo, 10 días, ella y el papá de 72.')
    expect(html).toContain('¿Quién lo escribió?')
    expect(html).toContain('El cliente')
    expect(html).toContain('Son mis notas')
    expect(html).toContain('Tus comentarios sobre el cliente no se guardan.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Entender<\/button>/)
  })

  it('en un negocio con datos, la caja va en una línea', () => {
    const html = renderToStaticMarkup(React.createElement(CajaSolicitud, { onCargado: nada, negocioBloqueId: 'b1', compacta: true }))
    expect(html).toContain('¿Hay algo nuevo? Pégalo aquí')
    expect(html).not.toContain('¿Quién lo escribió?')
  })
})
