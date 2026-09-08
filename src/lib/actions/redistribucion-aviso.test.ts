/**
 * Redistribuir una referencia deja aviso SOLO en el negocio que quedó corto.
 *
 * El aviso `recaudo_cambiado_pendiente` es un gate duro que **no cede al override
 * de owner/admin** (decisión del 2026-08-11), y hasta el 2026-09-08 ninguna
 * pantalla podía resolverlo. Ponerlo siempre que se redistribuye congelaba de
 * forma permanente a cualquier negocio con el reparto corregido: pasó con V0442 y
 * V0443 (ref EXT-593279, 2026-09-07), que quedaron atascados en Negociación con
 * el reparto perfectamente cuadrado y hubo que desbloquearlos por SQL.
 *
 * EL DOBLE ESCRIBE, no solo lee: la pregunta es dónde QUEDÓ puesto el aviso, y
 * eso vive en `negocios.metadata`. Con un doble de solo lectura, "no se puso" y
 * "se puso y no se ve" serían indistinguibles.
 *
 * SE VIERON FALLAR EN LAS DOS DIRECCIONES (2026-09-08), porque una prueba que solo
 * cae con el aviso apagado no distingue "puesto donde toca" de "puesto siempre":
 *
 *   · con el aviso INCONDICIONAL (el código de `main`) caen 5 de 7: el caso
 *     V0442/V0443, el que recibe plata, el reparto entre dos con porciones vivas,
 *     el aviso que reportaba la suma de gates del reparto en vez de los suyos, y
 *     el negocio sin cotizar (que pasaba por la razón contraria).
 *   · con el aviso APAGADO caen las otras 5: las que exigen que el aviso SÍ esté.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WS,
  HONORARIO,
  TARIFA,
  PAGO,
  filas,
  reiniciarDoble,
  servicioFalso,
  sembrarNegocio,
  sembrarPorcion,
  avisoDe,
} from '../../../test/redistribucion-doble'

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    userId: 'profile-diana',
    staffId: 'staff-diana',
    role: 'owner',
    areas: ['financiera'],
    supabase: servicioFalso(),
  }),
}))

// Qué gates reabre el recálculo lo decide el motor de avance, que aquí no se
// ejercita: se inyecta por caso para poder probar la rama "un gate reabierto manda".
const gatesPorNegocio: Record<string, number> = {}
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  recalcularNegocioPorCambioDeRecaudo: async (negocioId: string) => ({
    gates_reabiertos: gatesPorNegocio[negocioId] ?? 0,
  }),
  cambiarEtapaNegocio: async () => ({ error: null }),
}))

vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async () => ({ error: null }),
}))

vi.mock('@/lib/epayco', () => ({ consultarTransaccionEpayco: async () => null }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { redistribuirReferencia } from './conciliacion-actions'

const REF = 'EXT-593279'
const MOTIVO = 'porque el ingreso solo quedo en un cliente (area administrativa)'
const CUENTA = HONORARIO + TARIFA // 1.339.312

beforeEach(() => {
  reiniciarDoble()
  for (const k of Object.keys(gatesPorNegocio)) delete gatesPorNegocio[k]
})

describe('redistribuirReferencia — dónde queda el aviso de recaudo cambiado', () => {
  /** V0442 tiene el pago completo; se reparte por mitades con V0443. */
  function sembrarCasoV0442(mitadV0443 = PAGO / 2) {
    sembrarNegocio({ id: 'n-442', codigo: 'V0442' })
    sembrarNegocio({ id: 'n-443', codigo: 'V0443' })
    sembrarPorcion({ cobroId: 'cobro-442', negocioId: 'n-442', monto: PAGO, ref: REF })
    return {
      pagoOriginal: PAGO,
      externalRef: REF,
      motivo: MOTIVO,
      lineas: [
        { negocioId: 'n-442', monto: PAGO - mitadV0443 },
        { negocioId: 'n-443', monto: mitadV0443 },
      ],
    }
  }

  it('el caso V0442/V0443: reparto cuadrado, NINGUNO queda con aviso', async () => {
    const res = await redistribuirReferencia(sembrarCasoV0442())
    expect(res.ok).toBe(true)

    // Cada uno se quedó con $1.356.500 y su cuenta es $1.339.312.
    expect(avisoDe('n-442')).toBeNull()
    expect(avisoDe('n-443')).toBeNull()

    // Y el reparto SÍ ocurrió: no hay aviso porque quedó cuadrado, no porque la
    // acción se haya caído antes de escribir.
    const porciones = filas('cobros').filter(c => c.external_ref === REF && !c.anulado_at)
    expect(porciones.map(c => c.monto).sort((a, b) => Number(a) - Number(b)))
      .toEqual([PAGO / 2, PAGO / 2])
  })

  it('solo el negocio que quedó CORTO se queda con el aviso', async () => {
    // V0443 se lleva $2.000.000 y a V0442 le quedan $713.000, por debajo de su
    // cuenta de $1.339.312. Corto es el que PIERDE plata: el que la recibe no
    // puede quedar peor de lo que estaba.
    const res = await redistribuirReferencia(sembrarCasoV0442(2_000_000))
    expect(res.ok).toBe(true)

    const aviso = avisoDe('n-442')
    expect(aviso).not.toBeNull()
    expect(aviso!.referencia).toBe(REF)
    expect(aviso!.motivo).toBe(MOTIVO)
    expect(aviso!.etapaAlCambiar).toBe('Negociación')
  })

  it('el negocio que RECIBE plata no queda con aviso, ni con la cuenta corta', async () => {
    // V0443 recibe $900.000 contra una cuenta de $1.339.312: se queda corto y aun
    // así no hay nada que decidir, porque antes del reparto tenía cero.
    await redistribuirReferencia(sembrarCasoV0442(900_000))
    expect(avisoDe('n-443')).toBeNull()
  })

  it('con porciones vivas en los DOS, el aviso cae solo en el que pierde y no alcanza', async () => {
    // Los dos tienen plata desde antes; el reparto le quita a V0442 y le da a
    // V0443. Sin este caso, "solo el que quedó corto" se cumpliría por la razón
    // equivocada: en el caso anterior el sano era el que solo recibía.
    sembrarNegocio({ id: 'n-442', codigo: 'V0442' })
    sembrarNegocio({ id: 'n-443', codigo: 'V0443' })
    sembrarPorcion({ cobroId: 'cobro-442', negocioId: 'n-442', monto: 1_400_000, ref: REF })
    sembrarPorcion({ cobroId: 'cobro-443', negocioId: 'n-443', monto: 1_313_000, ref: REF })

    const res = await redistribuirReferencia({
      pagoOriginal: PAGO,
      externalRef: REF,
      motivo: MOTIVO,
      lineas: [
        { negocioId: 'n-442', monto: 700_000 },   // pierde y queda corto
        { negocioId: 'n-443', monto: 2_013_000 }, // recibe
      ],
    })
    expect(res.ok).toBe(true)
    expect(avisoDe('n-442')).not.toBeNull()
    expect(avisoDe('n-443')).toBeNull()
  })

  it('un gate reabierto manda, aunque la plata alcance', async () => {
    gatesPorNegocio['n-442'] = 1
    const res = await redistribuirReferencia(sembrarCasoV0442())
    expect(res.ok).toBe(true)

    const aviso = avisoDe('n-442')
    expect(aviso).not.toBeNull()
    // El aviso reporta los gates de SU negocio, no la suma del reparto completo:
    // antes se le pasaba a todos el total y el aviso de uno hablaba de otro.
    expect(aviso!.gatesReabiertos).toBe(1)
    expect(avisoDe('n-443')).toBeNull()
  })

  it('perdió plata y no hay cuenta que medir: el aviso se queda', async () => {
    // V0442 sin cotizar (sin honorario ni tarifa). No medir no es estar cuadrado.
    sembrarNegocio({ id: 'n-442', codigo: 'V0442', honorario: null, tarifa: 0 })
    sembrarNegocio({ id: 'n-443', codigo: 'V0443' })
    sembrarPorcion({ cobroId: 'cobro-442', negocioId: 'n-442', monto: PAGO, ref: REF })

    const res = await redistribuirReferencia({
      pagoOriginal: PAGO,
      externalRef: REF,
      motivo: MOTIVO,
      lineas: [
        { negocioId: 'n-442', monto: PAGO / 2 },
        { negocioId: 'n-443', monto: PAGO / 2 },
      ],
    })
    expect(res.ok).toBe(true)
    expect(avisoDe('n-442')).not.toBeNull()
    // El otro cubre su cuenta y además solo recibió: sigue sin aviso.
    expect(avisoDe('n-443')).toBeNull()
  })

  it('la cuenta que se mide es honorario + tarifa, no el honorario solo', async () => {
    // $700.000 cubre el honorario ($637.500) y NO la cuenta ($1.339.312). Si el
    // criterio midiera solo contra el honorario, este negocio no dejaría aviso.
    await redistribuirReferencia(sembrarCasoV0442(PAGO - 700_000))
    expect(avisoDe('n-442')).not.toBeNull()
    expect(CUENTA).toBeGreaterThan(700_000)
  })
})
