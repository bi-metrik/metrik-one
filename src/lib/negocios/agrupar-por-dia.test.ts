import { describe, expect, it } from 'vitest'
import { agruparPorDia, agruparPorLlegada, diaBogotaDe, etiquetaDia } from './agrupar-por-dia'

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

  it('nombra manana, que es lo que mira una lista de citas', () => {
    expect(etiquetaDia('2026-08-22', HOY)).toBe('Mañana')
  })

  it('cruza el fin de mes hacia adelante sin inventar dias', () => {
    expect(etiquetaDia('2026-09-01', '2026-08-31')).toBe('Mañana')
  })

  it('sin fecha lo dice, y quien pregunte otra cosa puede rotularlo distinto', () => {
    expect(etiquetaDia('', HOY)).toBe('Sin fecha de llegada')
    expect(etiquetaDia('', HOY, 'Esperando la fecha')).toBe('Esperando la fecha')
  })
})

describe('agruparPorDia — el nucleo generalizado', () => {
  type F = { id: string; f: string }
  const lista: F[] = [
    { id: 'b', f: '2026-08-22T09:00' },
    { id: 'c', f: '2026-08-23T07:00' },
    { id: 'a', f: '2026-08-22T07:00' },
    { id: 'z', f: '' },
  ]
  const lectura = {
    dia: (n: F) => n.f.slice(0, 10),
    orden: (n: F) => n.f,
    etiqueta: (dia: string) => dia || 'sin dia',
  }

  it("'asc' pone el dia mas proximo arriba y ordena la hora dentro del dia", () => {
    const grupos = agruparPorDia(lista, { ...lectura, direccion: 'asc' })
    expect(grupos.map((g) => g.dia)).toEqual(['2026-08-22', '2026-08-23', ''])
    expect(grupos[0].items.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it("'desc' invierte las dos cosas — dias y orden dentro del dia", () => {
    const grupos = agruparPorDia(lista, { ...lectura, direccion: 'desc' })
    expect(grupos.map((g) => g.dia)).toEqual(['2026-08-23', '2026-08-22', ''])
    expect(grupos[1].items.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('los que no tienen dia van al final en LOS DOS sentidos', () => {
    for (const direccion of ['asc', 'desc'] as const) {
      const grupos = agruparPorDia(lista, { ...lectura, direccion })
      expect(grupos[grupos.length - 1].dia).toBe('')
    }
  })

  it('no muta la lista que recibe', () => {
    const copia = [...lista]
    agruparPorDia(lista, { ...lectura, direccion: 'asc' })
    expect(lista).toEqual(copia)
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
