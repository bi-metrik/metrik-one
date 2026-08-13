import { describe, it, expect } from 'vitest'
import { confirmacionAvance, formatearSaldo } from './confirmacion-avance'

const CFG = {
  confirmar_al_avanzar: {
    titulo: 'Vas a pasar este caso a recaudo',
    cuerpo: 'De aquí en adelante lo maneja el área financiera.',
    detalle_con_saldo: 'El sistema dice que faltan {saldo} del honorario.',
    confirmar: 'Sí, pasarlo',
    cancelar: 'Cancelar',
  },
}

describe('confirmacionAvance', () => {
  it('sin la clave en la etapa destino, no pregunta nada', () => {
    expect(confirmacionAvance({}, 100000)).toBeNull()
    expect(confirmacionAvance(null, 100000)).toBeNull()
    expect(confirmacionAvance(undefined, 100000)).toBeNull()
  })

  it('arma el diálogo y sustituye el saldo dentro del texto', () => {
    const c = confirmacionAvance(CFG, 318750)!
    expect(c.titulo).toBe('Vas a pasar este caso a recaudo')
    expect(c.parrafos[0]).toBe('De aquí en adelante lo maneja el área financiera.')
    expect(c.parrafos[1]).toContain('318.750')
    expect(c.confirmar).toBe('Sí, pasarlo')
  })

  /**
   * Una nota que dice "faltan $0" enseña a cerrar el diálogo sin leerlo, y la
   * siguiente (la que sí trae plata) se cierra igual.
   */
  it('sin faltante NO pinta el párrafo de la cifra, pero sí pregunta', () => {
    for (const sinFaltante of [0, null, -5000, Number.NaN]) {
      const c = confirmacionAvance(CFG, sinFaltante as number | null)!
      expect(c).not.toBeNull()
      expect(c.parrafos).toHaveLength(1)
    }
  })

  it('sin título o sin cuerpo no produce un diálogo vacío', () => {
    expect(confirmacionAvance({ confirmar_al_avanzar: { titulo: 'Solo título' } }, 1000)).toBeNull()
    expect(confirmacionAvance({ confirmar_al_avanzar: { cuerpo: 'Solo cuerpo' } }, 1000)).toBeNull()
    expect(confirmacionAvance({ confirmar_al_avanzar: { titulo: '  ', cuerpo: '  ' } }, 1000)).toBeNull()
  })

  it('los botones tienen texto por defecto si la config no los declara', () => {
    const c = confirmacionAvance({ confirmar_al_avanzar: { titulo: 'T', cuerpo: 'C' } }, null)!
    expect(c.confirmar).toBe('Sí, pasar el caso')
    expect(c.cancelar).toBe('Cancelar')
  })

  it('un valor que no es objeto se ignora en vez de romper', () => {
    expect(confirmacionAvance({ confirmar_al_avanzar: 'sí' }, 1000)).toBeNull()
    expect(confirmacionAvance({ confirmar_al_avanzar: 42 }, 1000)).toBeNull()
  })
})

describe('formatearSaldo', () => {
  it('formatea en pesos colombianos sin decimales', () => {
    expect(formatearSaldo(318750)).toContain('318.750')
    expect(formatearSaldo(318750.4)).toContain('318.750')
  })
})
