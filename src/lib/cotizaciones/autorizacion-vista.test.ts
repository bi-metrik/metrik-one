/**
 * H6 · P6 (verificación D de Vera, 2026-10-14): ya autorizada, la dueña ve «Retirar la
 * autorización». Antes no: el botón exigía `puedeAutorizar`, que exige que la salida bloquee, y al
 * autorizar deja de bloquear.
 */
import { describe, expect, it } from 'vitest'

import { autorizacionDeLaSalida, type SalidaParaAutorizacion } from './autorizacion-vista'

const BAJO_EL_MINIMO: SalidaParaAutorizacion = {
  aplica: true, bloquea: true, dueno: 'Dueña', puedeAutorizar: true, esDueno: true,
  excepcion: null, perdida: null, excepcionesDisponibles: true,
}
/** Lo que devuelve `getSalidaVista` a la dueña justo después de autorizar. */
const AUTORIZADA: SalidaParaAutorizacion = {
  ...BAJO_EL_MINIMO, bloquea: false, puedeAutorizar: false,
  excepcion: { autorizadaPor: 'Dueña', motivo: 'Cliente frecuente' },
}

describe('H6 · P6 · «Retirar la autorización» con la excepción vigente', () => {
  it('la dueña, ya autorizado, la puede retirar', () => {
    const a = autorizacionDeLaSalida(AUTORIZADA, null)!
    expect(a.vigente).toEqual({ por: 'Dueña', motivo: 'Cliente frecuente' })
    expect(a.esDueno).toBe(true)
  })

  it('la asesora, con la misma excepción, no', () => {
    expect(autorizacionDeLaSalida({ ...AUTORIZADA, esDueno: false }, null)!.esDueno).toBe(false)
  })

  it('sin excepción, autoriza quien puede autorizar, como siempre', () => {
    expect(autorizacionDeLaSalida(BAJO_EL_MINIMO, null)!.esDueno).toBe(true)
    expect(autorizacionDeLaSalida({ ...BAJO_EL_MINIMO, puedeAutorizar: false }, null)!.esDueno).toBe(false)
    // Sin cupo de excepciones, la dueña no autoriza (`puedeAutorizar` lo dice el servidor).
    expect(autorizacionDeLaSalida({ ...BAJO_EL_MINIMO, puedeAutorizar: false, excepcionesDisponibles: false }, null)!.esDueno).toBe(false)
  })

  it('sin la regla del piso, no hay nada que pintar', () => {
    expect(autorizacionDeLaSalida({ ...BAJO_EL_MINIMO, aplica: false }, null)).toBeNull()
    expect(autorizacionDeLaSalida(null, null)).toBeNull()
  })

  it('la regla de antes (puedeAutorizar o excepción Y puedeAutorizar) la dejaba sin botón', () => {
    const antes = (s: SalidaParaAutorizacion) => s.puedeAutorizar || (!!s.excepcion && s.puedeAutorizar)
    expect(antes(AUTORIZADA)).toBe(false)
  })
})
