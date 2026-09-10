import { describe, expect, it } from 'vitest'
import { contarCoincidenciasFuera } from './coincidencias-fuera'
import { segmentarNegocios } from './segmentador'

/**
 * Réplica mínima de una fila de `/negocios`: lo que el segmentador mira
 * (`stage_actual`, `etapa_numero`) más los campos que tocan los filtros que el
 * aviso SÍ respeta (término y responsable).
 */
type N = {
  id: string
  codigo: string
  stage_actual: string | null
  etapa_numero: number | null
  responsable: string
}

// SOENA, tal como está en producción: el cerrado conserva el stage que tenía al salir.
const ABIERTOS: N[] = [
  { id: 'a1', codigo: 'V0500', stage_actual: 'cobro', etapa_numero: 12, responsable: 'ana' },
  { id: 'a2', codigo: 'V0501', stage_actual: 'cobro', etapa_numero: 13, responsable: 'beto' },
  { id: 'a3', codigo: 'V1200', stage_actual: 'venta', etapa_numero: 3, responsable: 'ana' },
]
const CERRADOS: N[] = [
  { id: 'c1', codigo: 'V0419', stage_actual: 'cobro', etapa_numero: 13, responsable: 'ana' },
  { id: 'c2', codigo: 'V0300', stage_actual: 'venta', etapa_numero: 2, responsable: 'beto' },
]

const UNIVERSO = [...ABIERTOS, ...CERRADOS]

/** Los filtros transversales de la pantalla, reducidos a los dos que aquí importan. */
const transversales = (term: string, responsable = 'todos') => (xs: N[]) =>
  xs.filter(
    (n) =>
      (!term || n.codigo.toLowerCase().includes(term)) &&
      (responsable === 'todos' || n.responsable === responsable),
  )

/** Lo que la pantalla arma: la lista de la pestaña + el número del aviso. */
function pantalla(
  fase: string,
  etapaNum: number | null,
  term: string,
  responsable = 'todos',
  cerradosVisibles: N[] = CERRADOS,
) {
  const aplicar = transversales(term, responsable)
  const lista = segmentarNegocios(ABIERTOS, cerradosVisibles, fase, etapaNum, aplicar).lista
  return { lista, fuera: contarCoincidenciasFuera(UNIVERSO, lista, aplicar) }
}

describe('contarCoincidenciasFuera', () => {
  // El caso que motivó el frente: QA del #610 con V0419 en soena.
  it('término que coincide con un cerrado y chip de fase puesto: lista vacía, aviso con 1', () => {
    const { lista, fuera } = pantalla('cobro', null, 'v0419')
    expect(lista).toEqual([])
    expect(fuera).toBe(1)
  })

  it('la coincidencia contada es exactamente la que la pestaña dejó fuera', () => {
    // Control: con la misma búsqueda, "Todos" SÍ la muestra. Si el aviso dijera 1 y
    // el destino no la trajera, mandaría al usuario a otra pantalla vacía.
    const { lista } = pantalla('todos', null, 'v0419')
    expect(lista.map((n) => n.codigo)).toEqual(['V0419'])
  })

  it('en la pestaña que sí la muestra el aviso vale 0 y no se pinta', () => {
    expect(pantalla('todos', null, 'v0419').fuera).toBe(0)
    expect(pantalla('cerrados', null, 'v0419').fuera).toBe(0)
  })

  it('cuenta también lo que esconde el filtro de ETAPA, no solo el de fase', () => {
    // 'V05' toca a1 (etapa 12) y a2 (etapa 13). Parado en la etapa 12 se ve uno y
    // el otro queda fuera, dentro de la MISMA fase.
    const { lista, fuera } = pantalla('cobro', 12, 'v05')
    expect(lista.map((n) => n.codigo)).toEqual(['V0500'])
    expect(fuera).toBe(1)
  })

  it('cuenta lo que esconde el filtro de MOTIVO de cierre', () => {
    // Dentro de Cerrados, con el motivo recortando la lista a c2, el otro cerrado
    // sigue existiendo y el aviso tiene que decirlo.
    const { lista, fuera } = pantalla('cerrados', null, 'v0', 'todos', [CERRADOS[1]])
    expect(lista.map((n) => n.codigo)).toEqual(['V0300'])
    expect(fuera).toBe(3) // a1, a2 (abiertos) y c1 (el cerrado que el motivo descartó)
  })

  it('los filtros transversales SÍ recortan el aviso: no delata lo que el usuario excluyó', () => {
    // Filtrando por 'beto', el V0419 de 'ana' no debe aparecer en el aviso.
    expect(pantalla('cobro', null, 'v0419', 'beto').fuera).toBe(0)
    // Y el control que hace válida la prueba: sin ese filtro sí aparece.
    expect(pantalla('cobro', null, 'v0419', 'todos').fuera).toBe(1)
  })

  it('un id que llega por dos ramas del universo se cuenta una sola vez', () => {
    const duplicado = [...UNIVERSO, CERRADOS[0]]
    expect(contarCoincidenciasFuera(duplicado, [], transversales('v0419'))).toBe(1)
  })

  it('sin término, el aviso lo apaga la pantalla; aquí el universo entero queda fuera', () => {
    // La compuerta `term.length > 0` vive en el cliente a propósito: este módulo
    // responde "cuántas hay fuera", no "cuándo avisar".
    expect(contarCoincidenciasFuera(UNIVERSO, [], (xs) => xs)).toBe(UNIVERSO.length)
  })
})
