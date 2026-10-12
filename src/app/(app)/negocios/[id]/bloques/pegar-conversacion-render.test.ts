/**
 * «Pegar conversación» en pantalla: el botón aparece solo en un bloque de solicitud (campos con `nivel`) que se puede
 * editar, y el resumen dice qué llenó, qué quedó en conflicto, lo de otro viaje y lo que falta para cotizar.
 * Primer render (`renderToStaticMarkup`, sin DOM): el cuadro abierto y la llamada al servidor se prueban aparte.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('../../negocio-v2-actions', () => ({
  actualizarBloqueData: async () => ({ error: null }),
  marcarBloqueCompleto: async () => ({ error: null }),
  consultarRetornoDeCorreccion: async () => ({ aviso: null, etapa: null }),
  confirmarSugerido: async () => ({ error: null }),
  descartarConflicto: async () => ({ error: null }),
}))
vi.mock('@/lib/actions/documento-actions', () => ({
  extraerCampoDesdeImagen: async () => ({ ok: true }),
  subirImagenClipboard: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/epayco-actions', () => ({ consultarEpayco: async () => ({ success: false }) }))
vi.mock('@/lib/negocios/pegar-conversacion-servidor', () => ({ pegarConversacion: async () => ({ error: 'no' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))

import BloqueDatos, { type DatosField } from './BloqueDatos'
import { ResumenPegado } from './pegar-conversacion'

const SOLICITUD: DatosField[] = [
  { slug: 'destino', label: 'Destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde viajan?' },
  { slug: 'adultos', label: 'Adultos', tipo: 'numero', nivel: 'minimo', pregunta: '¿Cuántos adultos viajan?' },
]
const OTRO: DatosField[] = [{ slug: 'referencia_pago', label: 'Referencia', tipo: 'texto' }]

const render = (fields: DatosField[], modo: 'editable' | 'visible' = 'editable') =>
  renderToStaticMarkup(React.createElement(BloqueDatos, { negocioBloqueId: 'nb1', instancia: null, modo, fields }))

describe('el botón', () => {
  it('aparece en el bloque de la solicitud que se puede editar', () => {
    expect(render(SOLICITUD)).toContain('Pegar conversación')
  })
  it('no aparece en otro bloque ni en solo lectura', () => {
    expect(render(OTRO)).not.toContain('Pegar conversación')
    expect(render(SOLICITUD, 'visible')).not.toContain('Pegar conversación')
  })
})

describe('el resumen', () => {
  it('dice lo llenado, el conflicto, lo de otro viaje y lo que falta', () => {
    const html = renderToStaticMarkup(React.createElement(ResumenPegado, {
      r: {
        llenados: ['Destino: PUNTA CANA', 'Fecha de regreso: 20 feb (calculado)'],
        reemplazados: [],
        conflictos: ['Adultos: tiene 3, el chat dice 2'],
        quitados: [],
        dudas: [],
        otros: ['Viaje a Europa en mayo de la mamá y la tía'],
        faltaMinimo: ['¿Qué categoría de hotel?'],
        hayMinimo: true,
        mensajes: 7,
        recortado: false,
      },
    }))
    expect(html).toContain('Leí 7 mensajes.')
    expect(html).toContain('Llené 2 campos')
    expect(html).toContain('En conflicto (no cambié lo que ya estaba)')
    expect(html).toContain('· Adultos: tiene 3, el chat dice 2')
    expect(html).toContain('En el chat hay más, que no es de este viaje (no lo llené)')
    expect(html).toContain('Para el mínimo de cotizar falta')
  })
  it('sin nada nuevo lo dice, y con el mínimo completo también', () => {
    const html = renderToStaticMarkup(React.createElement(ResumenPegado, {
      r: { llenados: [], reemplazados: [], conflictos: [], quitados: [], dudas: [], otros: [], faltaMinimo: [], hayMinimo: true, mensajes: 3, recortado: false },
    }))
    expect(html).toContain('No encontré datos nuevos de este viaje en la conversación.')
    expect(html).toContain('Ya está el mínimo para cotizar.')
  })
})
