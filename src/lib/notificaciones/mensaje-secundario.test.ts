/** Segunda línea de la campanita a partir de `metadata.mensaje`. Datos ficticios. */
import { describe, it, expect } from 'vitest'
import { mensajeSecundario } from './mensaje-secundario'

describe('mensajeSecundario', () => {
  it('devuelve quién asignó en una asignación de responsable', () => {
    const meta = { mensaje: 'Ana Pérez te dejó como responsable (operaciones) de este negocio.', rol: 'operaciones' }
    expect(mensajeSecundario(meta, 'Te asignaron X1 26 1 · Destino')).toBe(
      'Ana Pérez te dejó como responsable (operaciones) de este negocio.',
    )
  })

  it('recorta espacios', () => {
    expect(mensajeSecundario({ mensaje: '  Hola  ' }, 'Título')).toBe('Hola')
  })

  it('sin mensaje de texto no pinta nada', () => {
    expect(mensajeSecundario({}, 'Título')).toBeNull()
    expect(mensajeSecundario(null, 'Título')).toBeNull()
    expect(mensajeSecundario(undefined, 'Título')).toBeNull()
    expect(mensajeSecundario([], 'Título')).toBeNull()
    expect(mensajeSecundario('mensaje', 'Título')).toBeNull()
    expect(mensajeSecundario({ mensaje: 42 }, 'Título')).toBeNull()
    expect(mensajeSecundario({ mensaje: '   ' }, 'Título')).toBeNull()
  })

  it('no repite el título', () => {
    expect(mensajeSecundario({ mensaje: 'Mismo texto' }, ' Mismo texto ')).toBeNull()
    expect(mensajeSecundario({ mensaje: 'Algo' }, null)).toBe('Algo')
  })
})
