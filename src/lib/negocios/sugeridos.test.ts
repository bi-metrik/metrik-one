import { describe, expect, it } from 'vitest'
import { confirmarSugeridoEnData, soltarSugeridosEditados, sugeridosDe } from './sugeridos'
import { sanearDataDelNavegador } from './data-escribible'

const marca = (frase: string) => ({ fuente: 'whatsapp' as const, entrega_id: 'e1', frase, en: '2026-09-28T10:00:00Z' })
const guardada = {
  destino: 'PUNTA CANA',
  adultos: 2,
  _sugeridos: { destino: marca('Punta Cana'), adultos: marca('dos personas') },
}

describe('la marca de sugerido', () => {
  it('se conserva si la persona guarda sin cambiar el valor (ni por mayúsculas)', () => {
    const nueva = { ...guardada, destino: 'Punta Cana ' }
    expect(sugeridosDe(soltarSugeridosEditados(guardada, nueva))).toEqual(guardada._sugeridos)
  })

  it('se quita del campo que la persona cambió, y solo de ese', () => {
    const r = soltarSugeridosEditados(guardada, { ...guardada, adultos: 3 })
    expect(Object.keys(sugeridosDe(r))).toEqual(['destino'])
    expect(r.adultos).toBe(3)
  })

  it('sin marcas que quedar, la clave desaparece', () => {
    const r = soltarSugeridosEditados(guardada, { ...guardada, adultos: 3, destino: 'MADRID' })
    expect(r).not.toHaveProperty('_sugeridos')
  })

  it('confirmar quita la marca y deja el valor', () => {
    const r = confirmarSugeridoEnData(guardada, 'destino')
    expect(r.destino).toBe('PUNTA CANA')
    expect(Object.keys(sugeridosDe(r))).toEqual(['adultos'])
    expect(confirmarSugeridoEnData(r, 'adultos')).not.toHaveProperty('_sugeridos')
  })

  it('el navegador no la puede escribir ni borrar: es espacio del servidor', () => {
    const entrante = { destino: 'PUNTA CANA', adultos: 2, _sugeridos: {} }
    const r = sanearDataDelNavegador({
      entrante, guardada, tipo: 'datos', modo: 'reemplazo', workspaceId: 'w',
      configExtra: { fields: [{ slug: 'destino', tipo: 'texto' }, { slug: 'adultos', tipo: 'numero' }] },
    })
    expect(r._sugeridos).toEqual(guardada._sugeridos)
  })
})
