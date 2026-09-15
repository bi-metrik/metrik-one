import { describe, it, expect } from 'vitest'
import {
  revisarTarifaConfirmada,
  revisarTarifaEnBloque,
  justificacionSuficiente,
  PISO_TARIFA_UPME_COP,
  MARGEN_TARIFA_UPME,
} from './tarifa-confirmada'

/** Config del bloque real de SOENA, recortada a lo que esta revisión lee. */
const CONFIG = {
  tarifa_confirmacion: {
    enabled: true,
    ref_field: 'tarifa_upme_ref',
    confirmada_field: 'tarifa_upme_confirmada',
    justificacion_field: 'tarifa_upme_motivo_diferencia',
  },
}

describe('revisarTarifaConfirmada — piso de cordura', () => {
  it('rechaza el punto de miles leído como decimal (V0498, V0497, V0264, V0475, V0301)', () => {
    // Los cuatro casos abiertos medidos en producción el 2026-09-15.
    for (const [valor, ref] of [
      [769.898, 770159],
      [769.898, 769664],
      [795.037, 794863],
      [701.812, 701812],
    ] as const) {
      const r = revisarTarifaConfirmada({ valor, referencia: ref })
      expect(r?.codigo).toBe('piso')
    }
  })

  it('rechaza una tarifa de un dígito aunque el toggle esté marcado (V0321, V0323)', () => {
    expect(revisarTarifaConfirmada({ valor: 5, referencia: 701812 })?.codigo).toBe('piso')
    expect(revisarTarifaConfirmada({ valor: 5, referencia: 843078 })?.codigo).toBe('piso')
  })

  it('rechaza por piso AUNQUE no haya referencia', () => {
    expect(revisarTarifaConfirmada({ valor: 769.898 })?.codigo).toBe('piso')
    expect(revisarTarifaConfirmada({ valor: 5, referencia: null })?.codigo).toBe('piso')
  })

  it('el piso NO se puede saltar con una justificación', () => {
    // Ninguna diferencia de criterio produce una tarifa de cinco pesos.
    const r = revisarTarifaConfirmada({
      valor: 5,
      referencia: 701812,
      justificacion: 'la UPME nos cobró esto, lo confirmé con la plataforma',
      reglas: CONFIG.tarifa_confirmacion,
    })
    expect(r?.codigo).toBe('piso')
  })

  it('deja pasar la tarifa legítima más baja de producción ($62.849)', () => {
    expect(revisarTarifaConfirmada({ valor: 62849, referencia: 62849 })).toBeNull()
  })

  it('el piso vive por debajo de cinco dígitos', () => {
    expect(PISO_TARIFA_UPME_COP).toBe(10_000)
    expect(revisarTarifaConfirmada({ valor: 9999 })?.codigo).toBe('piso')
    expect(revisarTarifaConfirmada({ valor: 10_000 })).toBeNull()
  })
})

describe('revisarTarifaConfirmada — margen contra la referencia', () => {
  it('deja pasar la tarifa que coincide con la referencia', () => {
    expect(revisarTarifaConfirmada({ valor: 770159, referencia: 770159 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 701812, referencia: 701812 })).toBeNull()
  })

  it('deja pasar los ajustes finos que la operación ya hace hoy', () => {
    // Medidos en producción: redondeos y ajustes de decenas de pesos.
    expect(revisarTarifaConfirmada({ valor: 701800, referencia: 701812 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 700000, referencia: 701812 })).toBeNull() // 0,26%
    expect(revisarTarifaConfirmada({ valor: 869932, referencia: 887231 })).toBeNull() // 1,95%
  })

  it('rechaza el primer caso que sí se aparta (V0310: 14,79%)', () => {
    const r = revisarTarifaConfirmada({ valor: 701812, referencia: 823599, reglas: CONFIG.tarifa_confirmacion })
    expect(r?.codigo).toBe('margen')
    expect(r?.mensaje).toContain('121.787')
    expect(r?.mensaje).toContain('14,8%')
  })

  it('rechaza el doble de la referencia (V0283)', () => {
    expect(revisarTarifaConfirmada({ valor: 701812, referencia: 350906 })?.codigo).toBe('margen')
  })

  it('el margen por defecto es 5% y corta donde dice', () => {
    expect(MARGEN_TARIFA_UPME).toBe(0.05)
    expect(revisarTarifaConfirmada({ valor: 105_000, referencia: 100_000 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 105_001, referencia: 100_000 })?.codigo).toBe('margen')
    expect(revisarTarifaConfirmada({ valor: 95_000, referencia: 100_000 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 94_999, referencia: 100_000 })?.codigo).toBe('margen')
  })

  it('el bloque puede declarar otro margen', () => {
    const reglas = { margen_pct: 0.5 }
    expect(revisarTarifaConfirmada({ valor: 701812, referencia: 823599, reglas })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 701812, referencia: 350906, reglas })?.codigo).toBe('margen')
  })

  it('sin referencia no hay margen que juzgar: solo el piso', () => {
    expect(revisarTarifaConfirmada({ valor: 2_500_000 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 2_500_000, referencia: 0 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: 2_500_000, referencia: 'sin dato' })).toBeNull()
  })
})

describe('revisarTarifaConfirmada — la diferencia grande se declara, no se calla', () => {
  it('una justificación escrita deja registrar la diferencia', () => {
    const r = revisarTarifaConfirmada({
      valor: 701812,
      referencia: 823599,
      justificacion: 'La plataforma UPME liquidó la tarifa mínima del Art. 13',
      reglas: CONFIG.tarifa_confirmacion,
    })
    expect(r).toBeNull()
  })

  it('un relleno corto NO cuenta como justificación', () => {
    const r = revisarTarifaConfirmada({
      valor: 701812,
      referencia: 823599,
      justificacion: 'ok',
      reglas: CONFIG.tarifa_confirmacion,
    })
    expect(r?.codigo).toBe('margen')
  })

  it('sin campo de justificación configurado, el rechazo es duro y el mensaje no ofrece salida', () => {
    const r = revisarTarifaConfirmada({
      valor: 701812,
      referencia: 823599,
      justificacion: 'La plataforma UPME liquidó la tarifa mínima del Art. 13',
      reglas: { margen_pct: 0.05 },
    })
    expect(r?.codigo).toBe('margen')
    expect(r?.mensaje).toContain('Corrige la cifra')
  })

  it('justificacionSuficiente exige texto, no espacios', () => {
    expect(justificacionSuficiente('           ')).toBe(false)
    expect(justificacionSuficiente(undefined)).toBe(false)
    expect(justificacionSuficiente(123456789012)).toBe(false)
    expect(justificacionSuficiente('Cobro real UPME')).toBe(true)
  })
})

describe('revisarTarifaConfirmada — lo que no le toca juzgar', () => {
  it('un campo vacío o a medio escribir no se rechaza (lo resuelve `required`)', () => {
    expect(revisarTarifaConfirmada({ valor: '', referencia: 770159 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: null, referencia: 770159 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: undefined })).toBeNull()
  })

  it('el cero no se rechaza aquí (lo resuelve `no_cero`)', () => {
    // Dos controles sobre el mismo hueco darían dos mensajes distintos.
    expect(revisarTarifaConfirmada({ valor: 0, referencia: 701812 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: '0', referencia: 701812 })).toBeNull()
  })

  it('lee el valor tecleado a la colombiana antes de juzgarlo', () => {
    expect(revisarTarifaConfirmada({ valor: '769.898', referencia: 770159 })).toBeNull()
    expect(revisarTarifaConfirmada({ valor: '$ 770.159', referencia: 770159 })).toBeNull()
  })
})

describe('revisarTarifaEnBloque', () => {
  const previa = { tarifa_upme_confirmada: 770159, tarifa_upme_ref: 770159 }

  it('no toca ningún bloque que no declare `tarifa_confirmacion.enabled`', () => {
    expect(revisarTarifaEnBloque({}, previa, { tarifa_upme_confirmada: 5 })).toBeNull()
    expect(revisarTarifaEnBloque(null, previa, { tarifa_upme_confirmada: 5 })).toBeNull()
    expect(
      revisarTarifaEnBloque({ tarifa_confirmacion: { enabled: false } }, previa, { tarifa_upme_confirmada: 5 }),
    ).toBeNull()
  })

  it('rechaza el valor mal tecleado que llega a guardarse', () => {
    const r = revisarTarifaEnBloque(CONFIG, { tarifa_upme_ref: 770159 }, { tarifa_upme_confirmada: 769.898 })
    expect(r?.codigo).toBe('piso')
  })

  it('guardar otro campo del bloque NO re-juzga la tarifa', () => {
    expect(revisarTarifaEnBloque(CONFIG, { tarifa_upme_confirmada: 5, tarifa_upme_ref: 701812 }, { tarifa_confirmada: true })).toBeNull()
  })

  it('un valor malo YA guardado no traba el bloque si no se vuelve a escribir', () => {
    // V0310 (14,79%) tiene que seguir siendo editable en todo lo demás.
    const vieja = { tarifa_upme_confirmada: 701812, tarifa_upme_ref: 823599 }
    expect(revisarTarifaEnBloque(CONFIG, vieja, { tarifa_upme_confirmada: 701812 })).toBeNull()
    // Y el mismo valor escrito en otra forma tampoco es un cambio.
    expect(revisarTarifaEnBloque(CONFIG, vieja, { tarifa_upme_confirmada: '701.812' })).toBeNull()
  })

  it('pero si el valor CAMBIA, se juzga', () => {
    const vieja = { tarifa_upme_confirmada: 701812, tarifa_upme_ref: 823599 }
    expect(revisarTarifaEnBloque(CONFIG, vieja, { tarifa_upme_confirmada: 701813 })?.codigo).toBe('margen')
  })

  it('un bloque sin nada guardado sí se juzga desde el primer valor', () => {
    expect(revisarTarifaEnBloque(CONFIG, {}, { tarifa_upme_confirmada: 5 })?.codigo).toBe('piso')
    expect(revisarTarifaEnBloque(CONFIG, null, { tarifa_upme_confirmada: 5 })?.codigo).toBe('piso')
  })

  it('la referencia y el motivo se leen de la mezcla: escribir los dos a la vez funciona', () => {
    const r = revisarTarifaEnBloque(
      CONFIG,
      { tarifa_upme_ref: 823599 },
      {
        tarifa_upme_confirmada: 701812,
        tarifa_upme_motivo_diferencia: 'La plataforma UPME liquidó la tarifa mínima',
      },
    )
    expect(r).toBeNull()
  })

  it('el motivo que YA estaba guardado también vale', () => {
    const r = revisarTarifaEnBloque(
      CONFIG,
      { tarifa_upme_ref: 823599, tarifa_upme_motivo_diferencia: 'La plataforma UPME liquidó la tarifa mínima' },
      { tarifa_upme_confirmada: 701812 },
    )
    expect(r).toBeNull()
  })

  it('respeta los nombres de campo que declare el bloque', () => {
    const cfg = {
      tarifa_confirmacion: { enabled: true, ref_field: 'ref', confirmada_field: 'conf' },
    }
    expect(revisarTarifaEnBloque(cfg, { ref: 100_000 }, { conf: 200_000 })?.codigo).toBe('margen')
    expect(revisarTarifaEnBloque(cfg, { ref: 100_000 }, { tarifa_upme_confirmada: 200_000 })).toBeNull()
  })
})
