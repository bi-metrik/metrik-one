import { describe, it, expect } from 'vitest'
import { camposVisibles, camposActivos, etiquetaValor, type CampoFiltro } from './campos'

const campo = (over: Partial<CampoFiltro>): CampoFiltro => ({
  clave: 'x',
  etiqueta: 'X',
  valor: 'todos',
  porDefecto: 'todos',
  etiquetaTodos: 'Todos',
  opciones: [{ value: 'a', label: 'A' }],
  onChange: () => {},
  ...over,
})

describe('camposVisibles', () => {
  it('deja fuera los campos sin opciones', () => {
    const campos = [campo({ clave: 'con' }), campo({ clave: 'sin', opciones: [] })]
    expect(camposVisibles(campos).map((c) => c.clave)).toEqual(['con'])
  })
})

describe('camposActivos', () => {
  it('un campo en su valor por defecto no está activo', () => {
    expect(camposActivos([campo({})])).toEqual([])
  })

  it('reconoce el default propio de cada campo', () => {
    // Seccional usa 'todas' y los demás 'todos': comparar contra un literal fijo
    // marcaría seccional como activa siempre.
    const campos = [
      campo({ clave: 'seccional', valor: 'todas', porDefecto: 'todas' }),
      campo({ clave: 'origen', valor: 'meta', porDefecto: 'todos' }),
    ]
    expect(camposActivos(campos).map((c) => c.clave)).toEqual(['origen'])
  })

  it('un valor que ya no está entre las opciones sigue contando como activo', () => {
    // Enlace guardado con un responsable que salió del equipo: el filtro recorta
    // la lista de verdad, así que tiene que verse para poder quitarlo.
    const c = campo({ valor: 'fantasma' })
    expect(camposActivos([c])).toHaveLength(1)
  })

  it('un campo activo pero sin opciones no se cuenta (no se dibuja)', () => {
    expect(camposActivos([campo({ valor: 'a', opciones: [] })])).toEqual([])
  })

  it('conserva el orden en que se declararon los campos', () => {
    const campos = [
      campo({ clave: 'uno', valor: 'a' }),
      campo({ clave: 'dos' }),
      campo({ clave: 'tres', valor: 'a' }),
    ]
    expect(camposActivos(campos).map((c) => c.clave)).toEqual(['uno', 'tres'])
  })
})

describe('etiquetaValor', () => {
  it('usa la etiqueta de la opción elegida', () => {
    expect(etiquetaValor(campo({ valor: 'a' }))).toBe('A')
  })

  it('cae al valor crudo cuando la opción ya no existe', () => {
    expect(etiquetaValor(campo({ valor: 'fantasma' }))).toBe('fantasma')
  })
})
