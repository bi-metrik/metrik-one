import { describe, expect, it } from 'vitest'
import { segmentarNegocios } from './segmentador'

type N = { id: string; stage_actual: string; etapa_numero: number; responsable?: string }

// 3 etapas de venta (1,2,3), una de ejecución (7).
const NEGOCIOS: N[] = [
  { id: 'a', stage_actual: 'venta', etapa_numero: 1 },
  { id: 'b', stage_actual: 'venta', etapa_numero: 1 },
  { id: 'c', stage_actual: 'venta', etapa_numero: 2, responsable: 'deisy' },
  { id: 'd', stage_actual: 'venta', etapa_numero: 3 },
  { id: 'e', stage_actual: 'venta', etapa_numero: 3, responsable: 'deisy' },
  { id: 'f', stage_actual: 'ejecucion', etapa_numero: 7 },
]
// Dos cerrados. 'y' conserva el `stage_actual` que tenía al salir del proceso (venta,
// etapa 1): es el control de que una fase de stage NO lo cuenta ni lo lista.
const CERRADOS: N[] = [
  { id: 'z', stage_actual: 'cerrado', etapa_numero: 9 },
  { id: 'y', stage_actual: 'venta', etapa_numero: 1, responsable: 'deisy' },
]

const sinFiltro = (xs: N[]) => xs
const soloDeisy = (xs: N[]) => xs.filter((n) => n.responsable === 'deisy')

describe('segmentarNegocios', () => {
  it('el contador de una etapa NO cae a cero al seleccionar otra etapa (el bug)', () => {
    const todas = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', null, sinFiltro)
    const conEtapa1 = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', 1, sinFiltro)

    // Los contadores son idénticos con y sin etapa seleccionada.
    for (const num of [1, 2, 3]) {
      expect(conEtapa1.contarEtapa(num)).toBe(todas.contarEtapa(num))
    }
    expect(conEtapa1.contarEtapa(2)).toBe(1)
    expect(conEtapa1.contarEtapa(3)).toBe(2)
  })

  it('el número del chip es el largo de la lista que ese chip abre', () => {
    const base = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', null, sinFiltro)
    for (const num of [1, 2, 3]) {
      const abierta = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', num, sinFiltro)
      expect(abierta.lista.length).toBe(base.contarEtapa(num))
    }
  })

  it('la lista sí respeta la etapa seleccionada', () => {
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', 3, sinFiltro)
    expect(s.lista.map((n) => n.id)).toEqual(['d', 'e'])
  })

  it('los contadores sí reflejan los demás filtros (responsable)', () => {
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', 3, soloDeisy)
    expect(s.contarEtapa(1)).toBe(0) // ninguno de etapa 1 es de Deisy
    expect(s.contarEtapa(2)).toBe(1)
    expect(s.contarEtapa(3)).toBe(1)
    expect(s.lista.map((n) => n.id)).toEqual(['e'])
  })

  it('la fase acota: una etapa de otra fase no cuenta', () => {
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', null, sinFiltro)
    expect(s.contarEtapa(7)).toBe(0)
    expect(s.lista.length).toBe(5)
  })

  it("'cerrados' usa su propia fuente", () => {
    expect(segmentarNegocios(NEGOCIOS, CERRADOS, 'cerrados', null, sinFiltro).lista).toEqual(CERRADOS)
  })

  it("'todos' lista abiertos Y cerrados", () => {
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'todos', null, sinFiltro)
    expect(s.lista.length).toBe(NEGOCIOS.length + CERRADOS.length)
    // Los cerrados están, y están DESPUÉS de los abiertos.
    expect(s.lista.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'z', 'y'])
  })

  it("en 'todos' los filtros transversales también alcanzan a los cerrados", () => {
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'todos', null, soloDeisy)
    expect(s.lista.map((n) => n.id)).toEqual(['c', 'e', 'y'])
  })

  it("el contador de etapa en 'todos' incluye a los cerrados de esa etapa", () => {
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'todos', null, sinFiltro)
    // 'a' y 'b' abiertos + el cerrado 'y', todos en la etapa 1.
    expect(s.contarEtapa(1)).toBe(3)
    expect(segmentarNegocios(NEGOCIOS, CERRADOS, 'todos', 1, sinFiltro).lista.map((n) => n.id))
      .toEqual(['a', 'b', 'y'])
  })

  it('una fase de stage NO trae cerrados, aunque conserven ese stage_actual', () => {
    // 'y' es cerrado con stage_actual 'venta': si la fase lo listara, la pantalla diría
    // que sigue en venta y el chip de Venta contaría un caso que ya salió del proceso.
    const s = segmentarNegocios(NEGOCIOS, CERRADOS, 'venta', null, sinFiltro)
    expect(s.lista.map((n) => n.id)).not.toContain('y')
    expect(s.contarEtapa(1)).toBe(2)
  })
})
