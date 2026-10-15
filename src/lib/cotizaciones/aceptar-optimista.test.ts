import { describe, expect, it } from 'vitest'

import { onceDelCasoFijo } from '../../../test/caso-once-pantallazos'
import { aplicarEvento, esProvisional, filaProvisional, provisionalesVigentes, textoDeReversion } from './aceptar-optimista'

const buceo = onceDelCasoFijo()[10]

describe('la fila provisional de un servicio nuevo', () => {
  it('se nombra con la frase de la bandeja y va al final; con el grupo ocupado, numerada', () => {
    const f = filaProvisional({ capturaId: 'c1', tipo: 'actividad', lectura: buceo.lectura, nombreServicio: 'Actividad en San Andrés', filas: [{ grupo: 'hotel: Hotel en San Andrés', orden: 4 }] })
    expect(f).toMatchObject({ id: 'provisional:c1', provisional: true, grupo: 'actividad: Actividad en San Andrés', orden: 5, entra_al_precio: true, rubros: [] })
    expect(esProvisional(f.id)).toBe(true)
    const g = filaProvisional({ capturaId: 'c2', tipo: 'actividad', lectura: buceo.lectura, nombreServicio: 'Actividad en San Andrés', filas: [{ grupo: 'actividad: Actividad en San Andrés', orden: 1 }, { grupo: 'actividad 2: Actividad en San Andrés', orden: 2 }] })
    expect(g.grupo).toBe('actividad 3: Actividad en San Andrés')
  })
})

describe('los eventos de la bandeja', () => {
  it('inicio → aceptada → la página la trae: se va; inicio → revertir: se va y lo dice', () => {
    let r = aplicarEvento([], { tipo: 'inicio', capturaId: 'c1', tipoRanura: 'actividad', lectura: buceo.lectura, nombreServicio: 'Actividad en San Andrés' }, [])
    expect(r.provisionales).toHaveLength(1)
    r = aplicarEvento(r.provisionales, { tipo: 'aceptada', capturaId: 'c1', itemId: 'i-1' }, [])
    expect(r.provisionales[0].itemId).toBe('i-1')
    expect(provisionalesVigentes(r.provisionales, new Set())).toHaveLength(1)
    expect(provisionalesVigentes(r.provisionales, new Set(['i-1']))).toHaveLength(0)

    r = aplicarEvento([], { tipo: 'inicio', capturaId: 'c2', tipoRanura: 'actividad', lectura: buceo.lectura, nombreServicio: 'Actividad en San Andrés' }, [])
    const fallo = aplicarEvento(r.provisionales, { tipo: 'revertir', capturaId: 'c2', mensaje: 'No llegó a ONE.', avisar: true }, [])
    expect(fallo).toEqual({ provisionales: [], aviso: 'Actividad en San Andrés no se guardó: No llegó a ONE. Sigue en la bandeja.' })
    // Quedó esperando una decisión (R8, «sobra»): se quita sin aviso de error.
    expect(aplicarEvento(r.provisionales, { tipo: 'revertir', capturaId: 'c2', mensaje: null, avisar: false }, [])).toEqual({ provisionales: [], aviso: null })
  })

  it('textoDeReversion', () => {
    expect(textoDeReversion('Hotel en Providencia', null)).toBe('Hotel en Providencia no se guardó. Sigue en la bandeja.')
    expect(textoDeReversion('Hotel en Providencia', 'Sin red')).toBe('Hotel en Providencia no se guardó: Sin red. Sigue en la bandeja.')
  })
})
