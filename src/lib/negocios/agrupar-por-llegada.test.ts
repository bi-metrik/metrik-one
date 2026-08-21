import { describe, expect, it } from 'vitest'
import { agruparPorLlegada, diaBogotaDe, etiquetaDia } from './agrupar-por-llegada'

const HOY = '2026-08-21'

type N = { id: string; etapa_cambiada_at: string | null }

describe('diaBogotaDe', () => {
  it('proyecta el instante a Bogota, no a UTC', () => {
    // 21-ago 23:30 Bogota = 22-ago 04:30 UTC. Agrupar por la fecha cruda lo
    // mandaria a "manana"; es justo el caso que rompe la lista al final del dia.
    expect(diaBogotaDe('2026-08-22T04:30:00Z')).toBe('2026-08-21')
  })

  it('el filo del dia cae del lado correcto', () => {
    expect(diaBogotaDe('2026-08-22T04:59:59Z')).toBe('2026-08-21')
    expect(diaBogotaDe('2026-08-22T05:00:00Z')).toBe('2026-08-22')
  })

  it('sin fecha o con basura devuelve cadena vacia', () => {
    expect(diaBogotaDe(null)).toBe('')
    expect(diaBogotaDe(undefined)).toBe('')
    expect(diaBogotaDe('no soy una fecha')).toBe('')
  })
})

describe('etiquetaDia', () => {
  it('nombra hoy y ayer', () => {
    expect(etiquetaDia('2026-08-21', HOY)).toBe('Hoy')
    expect(etiquetaDia('2026-08-20', HOY)).toBe('Ayer')
  })

  it('cruza el fin de mes sin inventar dias', () => {
    expect(etiquetaDia('2026-07-31', '2026-08-01')).toBe('Ayer')
  })

  it('el resto lleva dia de la semana, y ano solo si no es el corriente', () => {
    expect(etiquetaDia('2026-08-19', HOY)).toBe('Mié 19 ago')
    expect(etiquetaDia('2025-12-30', HOY)).toBe('Mar 30 dic 2025')
  })

  it('sin fecha lo dice', () => {
    expect(etiquetaDia('', HOY)).toBe('Sin fecha de llegada')
  })
})

describe('agruparPorLlegada', () => {
  const lista: N[] = [
    { id: 'viejo', etapa_cambiada_at: '2026-08-19T15:00:00Z' },
    { id: 'hoy-temprano', etapa_cambiada_at: '2026-08-21T13:00:00Z' },
    { id: 'sin-fecha', etapa_cambiada_at: null },
    { id: 'hoy-tarde', etapa_cambiada_at: '2026-08-21T22:00:00Z' },
    { id: 'ayer', etapa_cambiada_at: '2026-08-20T18:00:00Z' },
  ]

  it('ordena los grupos del mas reciente al mas viejo y deja los sin fecha al final', () => {
    const grupos = agruparPorLlegada(lista, HOY)
    expect(grupos.map((g) => g.etiqueta)).toEqual([
      'Hoy',
      'Ayer',
      'Mié 19 ago',
      'Sin fecha de llegada',
    ])
  })

  it('dentro de un dia, lo ultimo que llego va primero', () => {
    const [hoy] = agruparPorLlegada(lista, HOY)
    expect(hoy.items.map((n) => n.id)).toEqual(['hoy-tarde', 'hoy-temprano'])
  })

  it('no pierde ni duplica negocios', () => {
    const grupos = agruparPorLlegada(lista, HOY)
    const ids = grupos.flatMap((g) => g.items.map((n) => n.id))
    expect(ids.sort()).toEqual(lista.map((n) => n.id).sort())
  })

  it('una lista vacia no produce grupos', () => {
    expect(agruparPorLlegada([], HOY)).toEqual([])
  })

  it('no muta la lista que recibe', () => {
    const original = [...lista]
    agruparPorLlegada(lista, HOY)
    expect(lista).toEqual(original)
  })
})
