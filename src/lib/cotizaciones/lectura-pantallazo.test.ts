/**
 * Qué se rechaza de un pantallazo, y en qué se convierte lo que se acepta.
 *
 * RX1 es la razón de ser de este frente: ante un listado de resultados el sistema NO
 * elige una fila. El defecto que evita es **mudo** — sale un precio plausible, con la
 * aerolínea correcta, por el número equivocado.
 *
 * ⚠️ Mutaciones MEDIDAS sobre este archivo (aplicadas y revertidas). Ver el reporte
 * del PR para el detalle.
 */
import { describe, expect, it } from 'vitest'

import {
  evaluarLectura,
  montoEnCOP,
  resumenDeLinea,
  rubrosPropuestos,
  type LecturaCruda,
} from './lectura-pantallazo'
import { ranuraDeGrupo, ranuraPorSlug } from './ranuras-pantallazo'

const VUELO = ranuraPorSlug('vuelo_detalle')!
const HOTEL = ranuraPorSlug('hotel_detalle')!

/** Un valor leído con confianza alta. */
const v = (valor: string | null, confianza = 0.95) => ({ value: valor, confidence: confianza })

/** Lectura completa y sana de un vuelo: dos pax, precio POR PAX. */
function vueloOk(over: Record<string, { value: string | null; confidence: number }> = {}): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: 'Detalle del itinerario AV8520 seleccionado',
    campos: {
      aerolinea: v('AVIANCA'),
      origen: v('BOG'),
      destino: v('PUJ'),
      fecha_salida: v('2026-12-12'),
      fecha_regreso: v('2026-12-18'),
      numero_vuelo: v('AV8520'),
      escalas: v('0'),
      familia_tarifa: v('basic'),
      equipaje_bodega: v('false'),
      equipaje_mano: v('true'),
      pax: v('2'),
      moneda: v('COP'),
      precio_total: v('1200000'),
      precio_por_pax: v(null, 0),
      base_precio: v('por_pax'),
      ...over,
    },
    desglose: [],
  }
}

function hotelOk(over: Record<string, { value: string | null; confidence: number }> = {}): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: 'Habitación doble vista al mar, todo incluido',
    campos: {
      hotel: v('Occidental Punta Cana'),
      ciudad: v('Punta Cana'),
      tipo_habitacion: v('Doble vista al mar'),
      regimen: v('Todo incluido'),
      check_in: v('2026-12-12'),
      check_out: v('2026-12-16'),
      noches: v(null, 0),
      ocupacion: v('2 adultos'),
      politica_cancelacion: v('No reembolsable'),
      impuestos_incluidos: v('true'),
      moneda: v('USD'),
      precio_total: v('180'),
      base_precio: v('por_noche'),
      ...over,
    },
    desglose: [],
  }
}

describe('RX1 · ante varias opciones no se elige ninguna', () => {
  it('un listado de resultados se rechaza aunque traiga todos los campos', () => {
    // La trampa: un listado de vuelos TIENE aerolínea, ruta, fechas y precio — seis
    // veces. Si el rechazo se dedujera de los campos faltantes, este caso pasaría.
    const listado: LecturaCruda = { ...vueloOk(), veredicto: 'varias_opciones' }
    const r = evaluarLectura(VUELO, listado)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX1')
  })

  it('la instrucción es accionable, no un código de error', () => {
    const r = evaluarLectura(VUELO, { ...vueloOk(), veredicto: 'varias_opciones' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.instruccion).toBe('Selecciona el vuelo y sube la pantalla del itinerario elegido.')
    expect(r.instruccion).not.toContain('RX1')
  })

  it('en hotel la instrucción es la del hotel, no la del vuelo', () => {
    const r = evaluarLectura(HOTEL, { ...hotelOk(), veredicto: 'varias_opciones' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.instruccion).toContain('habitación')
    expect(r.instruccion).not.toContain('vuelo')
  })

  it('RX1 se juzga ANTES que los campos mínimos', () => {
    // Un listado al que además le falta la moneda tiene que salir por RX1: mandar a
    // «escribe la moneda» sobre un comparador es la instrucción equivocada.
    const r = evaluarLectura(VUELO, { ...vueloOk({ moneda: v(null, 0) }), veredicto: 'varias_opciones' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX1')
  })
})

describe('RX2 a RX5 · el resto de los rechazos', () => {
  it('RX4: la captura es de otra ranura', () => {
    const r = evaluarLectura(VUELO, { ...vueloOk(), veredicto: 'otra_ranura' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX4')
    expect(r.instruccion).toContain('no es de vuelo')
  })

  it('RX5: no es una pantalla de reserva', () => {
    const r = evaluarLectura(VUELO, { ...vueloOk(), veredicto: 'no_es_pantalla_de_precio' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX5')
  })

  it('RX3: sin moneda no se crea nada, y se dice por separado', () => {
    // No se agrupa con los demás faltantes a propósito: su instrucción es distinta
    // (se puede indicar a mano) y es el error más caro del motor.
    const r = evaluarLectura(VUELO, vueloOk({ moneda: v(null, 0) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX3')
    expect(r.instruccion).toContain('moneda')
  })

  it('RX2: falta un mínimo y se nombra cuál', () => {
    const r = evaluarLectura(VUELO, vueloOk({ pax: v(null, 0) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX2')
    expect(r.instruccion).toContain('pasajeros')
  })

  it('RX2: varios faltantes se listan en plural', () => {
    const r = evaluarLectura(VUELO, vueloOk({ pax: v(null, 0), aerolinea: v(null, 0) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.instruccion).toContain('No se ven estos datos')
    expect(r.instruccion.toLowerCase()).toContain('aerolínea')
    expect(r.instruccion.toLowerCase()).toContain('pasajeros')
  })

  it('un mínimo leído con POCA confianza cuenta como ausente', () => {
    // Media lectura de una tarifa es peor que ninguna: se ve igual que una completa.
    const r = evaluarLectura(VUELO, vueloOk({ precio_total: v('1200000', 0.4) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX2')
  })

  it('un campo NO mínimo con poca confianza no rechaza: queda vacío', () => {
    const r = evaluarLectura(VUELO, vueloOk({ numero_vuelo: v('AV8520', 0.3) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'numero_vuelo')?.valor).toBeNull()
  })
})

describe('base_precio · lo que convierte un precio correcto en un margen falso', () => {
  it('por_pax multiplica por los pasajeros', () => {
    const r = evaluarLectura(VUELO, vueloOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rubros = rubrosPropuestos(VUELO, r.campos, r.desglose)
    expect(rubros).toHaveLength(1)
    expect(rubros[0]).toMatchObject({ cantidad: 2, unidad: 'pax', valorUnitario: 1_200_000 })
  })

  it('total NO multiplica: el mismo número, otra cifra de costo', () => {
    // El control que hace válida la prueba anterior. Con el mismo 1.200.000, leerlo
    // como total deja el costo a la mitad y el margen inflado.
    const r = evaluarLectura(VUELO, vueloOk({ base_precio: v('total') }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rubros = rubrosPropuestos(VUELO, r.campos, r.desglose)
    expect(rubros[0].cantidad).toBe(1)
  })

  it('por_noche saca las noches de las fechas cuando la captura no las dice', () => {
    // 12 a 16 de diciembre son CUATRO noches. Derivarlo de las dos fechas no
    // contradice R-P4: las dos están en la imagen y son campos mínimos.
    const r = evaluarLectura(HOTEL, hotelOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rubros = rubrosPropuestos(HOTEL, r.campos, r.desglose)
    expect(rubros[0]).toMatchObject({ cantidad: 4, unidad: 'noches', valorUnitario: 180 })
  })

  it('las noches que declara la captura mandan sobre las derivadas', () => {
    const r = evaluarLectura(HOTEL, hotelOk({ noches: v('5') }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(rubrosPropuestos(HOTEL, r.campos, r.desglose)[0].cantidad).toBe(5)
  })
})

describe('desglose · §3.5', () => {
  it('sin desglose se crea UN rubro de tarifa', () => {
    const r = evaluarLectura(VUELO, vueloOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rubros = rubrosPropuestos(VUELO, r.campos, r.desglose)
    expect(rubros).toHaveLength(1)
    expect(rubros[0].concepto).toBe('Tarifa')
  })

  it('con desglose manda el desglose, y NO se suma además el total', () => {
    // Crear el rubro del total además de las filas contaría el mismo dinero dos veces.
    const cruda: LecturaCruda = {
      ...hotelOk({ base_precio: v('total'), precio_total: v('820') }),
      desglose: [
        { concepto: 'Tarifa', cantidad: 4, unidad: 'noches', valor_unitario: 180, moneda: 'USD', confidence: 0.9 },
        { concepto: 'Impuestos', cantidad: 1, unidad: 'estadía', valor_unitario: 100, moneda: 'USD', confidence: 0.9 },
      ],
    }
    const r = evaluarLectura(HOTEL, cruda)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rubros = rubrosPropuestos(HOTEL, r.campos, r.desglose)
    expect(rubros).toHaveLength(2)
    expect(rubros.map(x => x.concepto)).toEqual(['Tarifa', 'Impuestos'])
    expect(rubros.reduce((a, x) => a + x.cantidad * x.valorUnitario, 0)).toBe(820)
  })

  it('un desglose que NO cuadra con el total se DESCARTA, y gana el total', () => {
    // Medido contra el modelo vivo, dos corridas sobre la misma imagen: en una la fila
    // «Tarifa aérea (2 adultos) 1.860.000» volvió como 2 × 930.000 (cuadra) y en la
    // otra como 2 × 1.860.000 — desglose 4.260.000 contra un total de 2.400.000. El
    // total salió idéntico y con confianza 1 en las dos, así que es el número estable.
    const cruda: LecturaCruda = {
      ...hotelOk({ base_precio: v('total'), precio_total: v('820') }),
      desglose: [
        { concepto: 'Tarifa', cantidad: 4, unidad: 'noches', valor_unitario: 400, moneda: 'USD', confidence: 0.9 },
      ],
    }
    const r = evaluarLectura(HOTEL, cruda)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.some(a => a.includes('no suma el total'))).toBe(true)
    // Y el costo propuesto es el TOTAL, no los 1.600 del desglose fantasma.
    const rubros = rubrosPropuestos(HOTEL, r.campos, r.desglose)
    expect(rubros).toHaveLength(1)
    expect(rubros[0].cantidad * rubros[0].valorUnitario).toBe(820)
  })

  it('un desglose que SÍ cuadra se conserva: el control de la prueba anterior', () => {
    const cruda: LecturaCruda = {
      ...hotelOk({ base_precio: v('total'), precio_total: v('820') }),
      desglose: [
        { concepto: 'Tarifa', cantidad: 4, unidad: 'noches', valor_unitario: 180, moneda: 'USD', confidence: 0.9 },
        { concepto: 'Resort fee', cantidad: 1, unidad: 'estadía', valor_unitario: 100, moneda: 'USD', confidence: 0.9 },
      ],
    }
    const r = evaluarLectura(HOTEL, cruda)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.some(a => a.includes('no suma el total'))).toBe(false)
    expect(rubrosPropuestos(HOTEL, r.campos, r.desglose)).toHaveLength(2)
  })
})

describe('moneda e impuestos · los avisos que deciden plata', () => {
  it('una moneda distinta de COP pide tasa de cambio', () => {
    const r = evaluarLectura(HOTEL, hotelOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.some(a => a.includes('USD') && a.includes('tasa de cambio'))).toBe(true)
  })

  it('en COP no se pide nada: el aviso solo aparece cuando aplica', () => {
    const r = evaluarLectura(HOTEL, hotelOk({ moneda: v('COP'), precio_total: v('720000') }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.some(a => a.includes('tasa de cambio'))).toBe(false)
  })

  it('impuestos NO incluidos se avisa: el costo cargado no los tiene', () => {
    const r = evaluarLectura(HOTEL, hotelOk({ impuestos_incluidos: v('false') }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.some(a => a.includes('impuestos NO están incluidos'))).toBe(true)
  })

  it('el sistema NO inventa una tasa: sin ella no hay valor en pesos', () => {
    expect(montoEnCOP(180, 'USD', null)).toBeNull()
    expect(montoEnCOP(180, 'USD', 0)).toBeNull()
    expect(montoEnCOP(180, 'USD', 4150)).toBe(747_000)
    // En COP la tasa sobra: el valor es el valor.
    expect(montoEnCOP(720_000, 'COP', null)).toBe(720_000)
  })
})

describe('R-P2 · lo no leído queda vacío, nunca en cero', () => {
  it('un campo opcional ausente no aparece en la descripción', () => {
    const r = evaluarLectura(VUELO, vueloOk({ numero_vuelo: v(null, 0), familia_tarifa: v(null, 0) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(descripcion).not.toContain('Vuelo:')
    expect(descripcion).not.toContain('Tarifa:')
  })

  it('escalas ausente NO se escribe como «Directo»', () => {
    // Cero escalas es una AFIRMACIÓN: el vuelo es directo. Si no se leyó, callar.
    const r = evaluarLectura(VUELO, vueloOk({ escalas: v(null, 0) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(resumenDeLinea(VUELO, r.campos).descripcion).not.toContain('Directo')
  })

  it('escalas en 0 SÍ se escribe como «Directo»: el cero leído es un dato', () => {
    const r = evaluarLectura(VUELO, vueloOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(resumenDeLinea(VUELO, r.campos).descripcion).toContain('Directo')
  })

  it('una fila del desglose sin valor no se propone como rubro en cero', () => {
    const r = evaluarLectura(VUELO, vueloOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rubros = rubrosPropuestos(VUELO, r.campos, [
      { concepto: 'Tarifa', cantidad: 1, unidad: 'pax', valor_unitario: 900_000, moneda: 'COP', confidence: 0.9 },
    ])
    expect(rubros).toHaveLength(1)
  })
})

describe('el nombre y la descripción de la línea', () => {
  it('un vuelo se nombra por aerolínea y ruta', () => {
    const r = evaluarLectura(VUELO, vueloOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { nombre, descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(nombre).toBe('AVIANCA BOG–PUJ')
    expect(descripcion).toContain('Salida: 2026-12-12')
    // Los dos campos de equipaje se redactan por separado: concatenarlos bajo un
    // «Incluye» imprimía «Incluye sin equipaje de bodega y equipaje de mano».
    expect(descripcion).toContain('Sin equipaje de bodega, con equipaje de mano')
    expect(descripcion).not.toContain('Incluye sin equipaje')
  })

  it('un hotel se nombra por hotel y ciudad', () => {
    const r = evaluarLectura(HOTEL, hotelOk())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { nombre, descripcion } = resumenDeLinea(HOTEL, r.campos)
    expect(nombre).toBe('Occidental Punta Cana · Punta Cana')
    expect(descripcion).toContain('2026-12-12 a 2026-12-16')
    expect(descripcion).toContain('Todo incluido')
  })
})

describe('la ranura se deriva del grupo', () => {
  it('los grupos canónicos resuelven', () => {
    expect(ranuraDeGrupo('vuelo')?.slug).toBe('vuelo_detalle')
    expect(ranuraDeGrupo('hotel')?.slug).toBe('hotel_detalle')
    expect(ranuraDeGrupo('traslado')?.slug).toBe('traslado_detalle')
    expect(ranuraDeGrupo('actividad')?.slug).toBe('actividad_detalle')
  })

  it('mayúsculas, tildes y plurales caen en el mismo contrato', () => {
    expect(ranuraDeGrupo('Hotel')?.slug).toBe('hotel_detalle')
    expect(ranuraDeGrupo('  HOTELES ')?.slug).toBe('hotel_detalle')
    expect(ranuraDeGrupo('aéreo')?.slug).toBe('vuelo_detalle')
    expect(ranuraDeGrupo('aereo')?.slug).toBe('vuelo_detalle')
  })

  it('el nombre de un proveedor NO es una ranura, y está bien que no lo sea', () => {
    expect(ranuraDeGrupo('Hotel Occidental')).toBeNull()
    expect(ranuraDeGrupo('dia-1')).toBeNull()
    expect(ranuraDeGrupo('seguro')).toBeNull()
    expect(ranuraDeGrupo(null)).toBeNull()
    expect(ranuraDeGrupo('')).toBeNull()
  })

  it('un slug fuera del registro no devuelve nada heredado del prototipo', () => {
    // Mismo guard que `plantillaCotizacionPropia`: el grupo viene de una columna de
    // texto que edita una persona.
    expect(ranuraPorSlug('constructor')).toBeNull()
    expect(ranuraPorSlug('toString')).toBeNull()
  })
})
