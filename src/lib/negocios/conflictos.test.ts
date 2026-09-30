import { describe, expect, it } from 'vitest'
import {
  CLAVE_CONFLICTOS,
  conflictosDe,
  descartarConflictoEnData,
  soltarConflictosEditados,
  textoConflicto,
  type MarcaConflicto,
} from './sugeridos'
import { sanearDataDelNavegador } from './data-escribible'
import * as edge from '../../../supabase/functions/_shared/wa-carga-reglas'

const marca: MarcaConflicto = { fuente: 'whatsapp', entrega_id: 'e2', valor: '2026-11-20', frase: 'el 20 de noviembre', en: '2026-09-30T15:00:00Z', origen: 'audio' }
const guardada = { fecha_salida: '2026-11-15', _conflictos: { fecha_salida: marca } }

describe('el conflicto que deja la bandeja en un negocio existente', () => {
  it('la clave es la misma que escribe la edge function', () => {
    expect(CLAVE_CONFLICTOS).toBe(edge.CLAVE_CONFLICTOS)
    const escrito = edge.cargarEnExistente(
      { fecha_salida: '2026-11-15' },
      [{ slug: 'fecha_salida', tipo: 'fecha' }],
      { fecha_salida: { valor: '2026-11-20', frase: 'el 20 de noviembre' } },
      { entrega_id: 'e2', en: marca.en!, origenDe: () => 'audio' },
    ).data
    expect(conflictosDe(escrito)).toEqual({ fecha_salida: marca })
  })

  it('si la persona cambia el valor al guardar, el conflicto se da por resuelto', () => {
    const nueva = soltarConflictosEditados(guardada, { ...guardada, fecha_salida: '2026-11-20' })
    expect(nueva._conflictos).toBeUndefined()
    expect(nueva.fecha_salida).toBe('2026-11-20')
  })

  it('si guarda sin tocar ese campo, el conflicto sigue', () => {
    const nueva = soltarConflictosEditados(guardada, { ...guardada, adultos: 2 })
    expect(nueva._conflictos).toEqual(guardada._conflictos)
  })

  it('«Dejar el actual» quita el conflicto y no toca el valor', () => {
    const nueva = descartarConflictoEnData(guardada, 'fecha_salida')
    expect(nueva).toEqual({ fecha_salida: '2026-11-15' })
    expect(descartarConflictoEnData(guardada, 'otro')).toBe(guardada)
  })

  it('el navegador no puede escribir ni borrar la marca', () => {
    const d = sanearDataDelNavegador({
      entrante: { fecha_salida: '2026-11-15', _conflictos: {} },
      guardada,
      tipo: 'datos',
      configExtra: { fields: [{ slug: 'fecha_salida', tipo: 'fecha' }] },
      workspaceId: 'ws',
      modo: 'reemplazo',
    })
    expect(d._conflictos).toEqual(guardada._conflictos)
  })

  it('el texto del aviso: qué dijo, dónde y cuándo (día de Bogotá)', () => {
    expect(textoConflicto('20 nov', marca)).toBe('El cliente dijo 20 nov en el audio del 30-sep')
    expect(textoConflicto('3', { ...marca, origen: 'mensaje', en: '2026-10-01T02:00:00Z' })).toBe('El cliente dijo 3 en el mensaje del 30-sep')
  })
})
