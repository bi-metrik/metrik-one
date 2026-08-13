import { describe, it, expect } from 'vitest'
import {
  faltaHonorarioConfirmado,
  lineaExigeHonorarioConfirmado,
  motivoNoPuedeCobrar,
  type EstadoHonorario,
} from './honorario-confirmado'

/**
 * Los casos vienen MEDIDOS de produccion el 2026-08-12/13, no inventados. Es lo
 * unico que hace util a este archivo: si alguien cambia el criterio a "exigir la
 * marca de aprobacion del bloque", los casos del cargue historico se ponen rojos
 * y muestran a cuantos negocios abiertos habria frenado.
 */

const EXIGE = { exige_honorario_confirmado: true }

function caso(p: Partial<EstadoHonorario>): EstadoHonorario {
  return { precioAprobado: null, estado: 'abierto', configLinea: EXIGE, ...p }
}

describe('lineaExigeHonorarioConfirmado', () => {
  it('la linea gana sobre el workspace', () => {
    expect(lineaExigeHonorarioConfirmado(caso({
      configLinea: { exige_honorario_confirmado: false },
      configWorkspace: { exige_honorario_confirmado: true },
    }))).toBe(false)
  })

  it('cae al workspace cuando la linea no lo declara', () => {
    expect(lineaExigeHonorarioConfirmado(caso({
      configLinea: null,
      configWorkspace: { exige_honorario_confirmado: true },
    }))).toBe(true)
  })

  it('sin declaracion NO exige: el default reproduce el comportamiento previo', () => {
    // Medido: metrik y advise cobran por planes recurrentes (44 cobros
    // programados). Un default en `true` los habria roto a los dos.
    expect(lineaExigeHonorarioConfirmado(caso({ configLinea: null, configWorkspace: null }))).toBe(false)
  })
})

describe('faltaHonorarioConfirmado', () => {
  it('V0310: sin precio_aprobado, abierto y con la linea exigiendo -> FRENA', () => {
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: null }))).toBe(true)
  })

  it('cero SIN propuesta aprobada -> FRENA: nadie cotizo todavia', () => {
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: 0 }))).toBe(true)
  })

  it('V0066: cero DECIDIDO (propuesta aprobada al 100% de descuento) -> PASA', () => {
    // Medido el 2026-08-13: su propuesta esta aprobada, con Plan 1 en $850.000 y
    // Plan 2 con 100% de descuento; se aprobo el Plan 2 y su PDF esta en Drive.
    // El criterio anterior lo habria frenado por una decision comercial ya
    // tomada, y el equipo no habria tenido como destrabarlo salvo cambiando un
    // precio que alguien decidio.
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: 0, ceroDeliberado: true }))).toBe(false)
  })

  it('el cero deliberado NO se cuela cuando la linea no exige nada', () => {
    // Redundante en la practica, pero fija el orden: la config manda primero.
    expect(faltaHonorarioConfirmado(caso({
      precioAprobado: 0, ceroDeliberado: true, configLinea: null,
    }))).toBe(false)
  })

  it('el cero deliberado NO le abre la puerta a un precio negativo sin decidir', () => {
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: -1, ceroDeliberado: false }))).toBe(true)
  })

  it('V0306 tras regularizarse: precio 637.500 -> PASA', () => {
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: 637_500 }))).toBe(false)
  })

  it('cargue historico: precio confirmado SIN marca de aprobacion -> PASA', () => {
    // 122 negocios (114 de historico_iva_2026_07 + 8 de iva_devolucion), cero con
    // aprobacion formal, todos con precio. 111 siguen abiertos y 8 ya cobraron.
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: 850_000 }))).toBe(false)
  })

  it('otro workspace sin la config -> PASA aunque no tenga precio', () => {
    expect(faltaHonorarioConfirmado(caso({
      precioAprobado: null, configLinea: null, configWorkspace: null,
    }))).toBe(false)
  })

  it('negocio ya cerrado -> PASA: frenar el registro esconderia plata que entro', () => {
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: null, estado: 'completado' }))).toBe(false)
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: null, estado: 'cancelado' }))).toBe(false)
  })

  it('precio negativo cuenta como faltante', () => {
    expect(faltaHonorarioConfirmado(caso({ precioAprobado: -1 }))).toBe(true)
  })
})

describe('motivoNoPuedeCobrar', () => {
  it('null cuando puede cobrar', () => {
    expect(motivoNoPuedeCobrar(caso({ precioAprobado: 850_000 }))).toBeNull()
  })

  it('nombra la accion concreta que destraba el caso', () => {
    const msg = motivoNoPuedeCobrar(caso({ precioAprobado: null }))
    expect(msg).toContain('propuesta')
    expect(msg).toContain('plan')
  })
})
