import { describe, expect, it } from 'vitest'
import { viajeEnOrden } from './por-pasos-vista'
import { bloquesPorRanura, definicionDeTipo, formaDesdeGrupo, tipoDeDefinicion, TIPOS_RANURA } from './ranuras-cotizacion'
import { NOMBRE_TIPO_BLOQUE } from './opcion-viaje'

// Prueba en producción del 2026-10-28: la ranura del paquete de bloqueo quedó bien guardada
// (`cotizacion_ranuras.tipo = 'paquete'`) pero «El viaje, en orden» la pintó con el chip «OTRO» en
// «Otros servicios». El tipo se leía del primer sinónimo («paquete de bloqueo»), no del slug.
// Datos FICTICIOS.
const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en Ciudad Inventada'

describe('el tipo del paquete de bloqueo', () => {
  it('cada tipo se lee de su propia definición, el paquete incluido', () => {
    for (const tipo of TIPOS_RANURA) expect(tipoDeDefinicion(definicionDeTipo(tipo))).toBe(tipo)
  })

  it('el grupo del paquete es una ranura de tipo paquete', () => {
    expect(formaDesdeGrupo(GRUPO)).toEqual({ tipo: 'paquete', numero: null, nombre: 'Paquete de bloqueo en Ciudad Inventada' })
  })

  it('en el editor es un bloque «Paquete», no una línea suelta', () => {
    const [b] = bloquesPorRanura([{ id: 'p1', grupo: GRUPO }] as never)
    expect(b.tipo).toBe('paquete')
    expect(NOMBRE_TIPO_BLOQUE[b.tipo!]).toBe('Paquete')
  })

  it('en «El viaje, en orden» va primero, en su propia sección, y no en «Otros servicios»', () => {
    const lineas = [
      { id: 'o1', grupo: 'otro: Asistencia médica', nombre: 'Opción 1', orden: 1 },
      { id: 'p1', grupo: GRUPO, nombre: 'Opción 1', orden: 2 },
    ]
    const tramos = viajeEnOrden(lineas as never, { destino: 'Ciudad Inventada', fechaInicio: '2027-02-01' })
    expect(tramos.map(t => t.titulo)).toEqual(['Paquete de bloqueo', 'Otros servicios'])
    expect(tramos[0].servicios.map(s => s.tipo)).toEqual(['paquete'])
    expect(tramos[1].servicios.map(s => s.tipo)).toEqual(['otro'])
  })
})
