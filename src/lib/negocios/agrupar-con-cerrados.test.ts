import { describe, expect, it } from 'vitest'
import { agruparApartandoCerrados, GRUPO_CERRADOS } from './agrupar-con-cerrados'
import { agruparPorLlegada } from './agrupar-por-dia'

type N = { id: string; etapa_cambiada_at: string | null; cerrado?: boolean }

const HOY = '2026-09-10'
const esCerrado = (n: N) => n.cerrado === true

// Dos abiertos que llegaron hoy y uno ayer; dos cerrados, uno de ellos también "de hoy".
const LISTA: N[] = [
  { id: 'a', etapa_cambiada_at: '2026-09-10T14:00:00Z' },
  { id: 'b', etapa_cambiada_at: '2026-09-09T14:00:00Z' },
  { id: 'z', etapa_cambiada_at: '2026-09-10T15:00:00Z', cerrado: true },
  { id: 'c', etapa_cambiada_at: '2026-09-10T16:00:00Z' },
  { id: 'y', etapa_cambiada_at: '2026-03-06T12:00:00Z', cerrado: true },
]

const agrupar = (xs: N[]) => agruparApartandoCerrados(xs, esCerrado, (ab) => agruparPorLlegada(ab, HOY))

describe('agruparApartandoCerrados', () => {
  it('ningún cerrado cae en un grupo de día, ni siquiera el que "llegó hoy"', () => {
    const grupos = agrupar(LISTA)
    const porDia = grupos.filter((g) => g.dia !== GRUPO_CERRADOS)
    expect(porDia.flatMap((g) => g.items).map((n) => n.id)).toEqual(['c', 'a', 'b'])
    // 'z' cambió de etapa hoy: con el criterio ingenuo encabezaría "Hoy".
    expect(porDia.flatMap((g) => g.items).map((n) => n.id)).not.toContain('z')
  })

  it('los cerrados van juntos, en el ÚLTIMO grupo y rotulados', () => {
    const grupos = agrupar(LISTA)
    const ultimo = grupos[grupos.length - 1]
    expect(ultimo.dia).toBe(GRUPO_CERRADOS)
    expect(ultimo.etiqueta).toBe('Cerrados')
    expect(ultimo.items.map((n) => n.id)).toEqual(['z', 'y'])
  })

  it('no se pierde ni se repite una sola fila (es lo que baja al Excel)', () => {
    const ids = agrupar(LISTA).flatMap((g) => g.items).map((n) => n.id)
    expect(ids.length).toBe(LISTA.length)
    expect(new Set(ids).size).toBe(LISTA.length)
  })

  it('sin cerrados no agrega ningún grupo', () => {
    const abiertos = LISTA.filter((n) => !n.cerrado)
    const grupos = agrupar(abiertos)
    expect(grupos.some((g) => g.dia === GRUPO_CERRADOS)).toBe(false)
    expect(grupos.flatMap((g) => g.items).map((n) => n.id)).toEqual(['c', 'a', 'b'])
  })

  it('solo cerrados: un único grupo, el de cerrados', () => {
    const grupos = agrupar(LISTA.filter((n) => n.cerrado))
    expect(grupos.map((g) => g.dia)).toEqual([GRUPO_CERRADOS])
  })
})
