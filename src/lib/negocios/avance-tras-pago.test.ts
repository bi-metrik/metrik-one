import { describe, it, expect } from 'vitest'
import { ofrecimientoDeAvance, type EstadoTrasPago } from './avance-tras-pago'

/** Caso base: negocio abierto, con destino, con permiso y sin nada que lo retenga. */
function estado(parche: Partial<EstadoTrasPago> = {}): EstadoTrasPago {
  return {
    estado: 'abierto',
    pausado: false,
    etapaDestinoNombre: 'Cartera',
    puedeAvanzar: true,
    motivos: [],
    ...parche,
  }
}

describe('se ofrece el avance', () => {
  it('sin nada que retenga, se dibuja el botón con el destino por defecto', () => {
    expect(ofrecimientoDeAvance(estado())).toEqual({
      tipo: 'avanzar',
      etapaDestinoNombre: 'Cartera',
    })
  })

  // El saldo NO entra en esta decisión, y es deliberado: no es un gate por sí mismo.
  // La guía de Segundo cobro dice justo eso, que avanzar con saldo manda el caso a
  // Cartera. Quien registró el pago puede necesitar exactamente eso.
  it('con saldo pendiente y sin gates, el avance SIGUE ofreciéndose', () => {
    // El saldo ni siquiera es un campo de este módulo: si alguna vez lo fuera, este
    // caso sería indistinguible del anterior y dejaría de probar algo.
    expect(Object.keys(estado())).not.toContain('saldo')
    expect(ofrecimientoDeAvance(estado()).tipo).toBe('avanzar')
  })
})

describe('el caso está retenido', () => {
  it('se listan los motivos con sus nombres, no un "hay gates pendientes"', () => {
    expect(
      ofrecimientoDeAvance(estado({ motivos: ['Certificado bancario', 'Aviso de la cita'] })),
    ).toEqual({
      tipo: 'retenido',
      motivos: ['Certificado bancario', 'Aviso de la cita'],
    })
  })

  it('un solo motivo también retiene', () => {
    expect(ofrecimientoDeAvance(estado({ motivos: ['Comprobante del pago UPME'] })).tipo)
      .toBe('retenido')
  })
})

describe('no hay permiso para avanzar esta etapa', () => {
  it('el panel lo dice en vez de dibujar un botón que el servidor va a rechazar', () => {
    expect(ofrecimientoDeAvance(estado({ puedeAvanzar: false }))).toEqual({ tipo: 'sin_permiso' })
  })

  // Listarle los gates a quien no puede avanzar sugiere que resolverlos lo desbloquea.
  // No es cierto: seguiría sin poder.
  it('sin permiso manda sobre los gates, aunque además haya motivos', () => {
    expect(
      ofrecimientoDeAvance(estado({ puedeAvanzar: false, motivos: ['Certificado bancario'] })).tipo,
    ).toBe('sin_permiso')
  })
})

describe('no hay nada que ofrecer', () => {
  // Mismo criterio que el resto del producto (`negocioCerrado`), no una lista nueva.
  it('un negocio completado, perdido o cancelado no recibe oferta', () => {
    for (const e of ['completado', 'perdido', 'cancelado']) {
      expect(ofrecimientoDeAvance(estado({ estado: e })).tipo).toBe('no_aplica')
    }
  })

  // `activo` existe en producción (2 negocios del workspace metrik) y NO es un cierre.
  it('un estado que no es de cierre sigue recibiendo la oferta', () => {
    expect(ofrecimientoDeAvance(estado({ estado: 'activo' })).tipo).toBe('avanzar')
    expect(ofrecimientoDeAvance(estado({ estado: null })).tipo).toBe('avanzar')
  })

  // La ficha del negocio hace el mismo corte: con el negocio pausado esconde
  // "Avanzar" y deja solo "Reactivar".
  it('un negocio pausado no recibe oferta', () => {
    expect(ofrecimientoDeAvance(estado({ pausado: true })).tipo).toBe('no_aplica')
  })

  it('la última etapa de la línea no tiene a dónde avanzar', () => {
    expect(ofrecimientoDeAvance(estado({ etapaDestinoNombre: null })).tipo).toBe('no_aplica')
  })

  // Un cerrado no se explica con los gates ni con el permiso: no hay caso que mover.
  it('cerrado manda sobre el permiso y sobre los motivos', () => {
    expect(
      ofrecimientoDeAvance(
        estado({ estado: 'completado', puedeAvanzar: false, motivos: ['Certificado bancario'] }),
      ).tipo,
    ).toBe('no_aplica')
  })

  it('pausado manda sobre el permiso y sobre los motivos', () => {
    expect(
      ofrecimientoDeAvance(
        estado({ pausado: true, puedeAvanzar: false, motivos: ['Certificado bancario'] }),
      ).tipo,
    ).toBe('no_aplica')
  })

  // Sin destino no se puede prometer nada, ni siquiera a quien tiene permiso.
  it('sin destino manda sobre el permiso', () => {
    expect(
      ofrecimientoDeAvance(estado({ etapaDestinoNombre: null, puedeAvanzar: true })).tipo,
    ).toBe('no_aplica')
  })
})
