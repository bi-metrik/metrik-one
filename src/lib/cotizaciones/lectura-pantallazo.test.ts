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

/**
 * Los dos defectos que Alejandra y Daniela chocaron en vivo el 2026-09-16.
 *
 * Los números y los estados de los iconos salen del banco real
 * (`capturas-proveedor/2026-09-16/`), medidos: en `3.57.39_PM-3` (tarifa BASIC de Avianca
 * por Amadeus) los tres iconos están dibujados y **solo el primero es azul**; en
 * `4.00.50_PM` (LIGHT) son azules el primero y el segundo. La misma captura BASIC es la
 * del itinerario Cúcuta→Bogotá→Armenia, que es de donde sale la escala.
 */
describe('escala · el cliente quiere saber DÓNDE, no cuántas', () => {
  it('Cúcuta–Bogotá–Armenia dice Bogotá, en la ida y en el regreso, sin repetirlo dos veces', () => {
    const r = evaluarLectura(VUELO, vueloOk({
      origen: v('CUC'), destino: v('AXM'),
      escalas: v('1'), escala_ida: v('Bogotá'), escala_regreso: v('Bogotá'),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(resumenDeLinea(VUELO, r.campos).descripcion).toContain('Escala en Bogotá (ida y regreso)')
  })

  it('escalas distintas se nombran las dos', () => {
    const r = evaluarLectura(VUELO, vueloOk({
      escalas: v('1'), escala_ida: v('Panamá'), escala_regreso: v('Bogotá'),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(descripcion).toContain('Escala ida: Panamá')
    expect(descripcion).toContain('Escala regreso: Bogotá')
  })

  // R-P2 otra vez: el regreso que no se ve NO sale como «regreso directo».
  it('sin escala de regreso leída, la descripción no afirma nada del regreso', () => {
    const r = evaluarLectura(VUELO, vueloOk({
      escalas: v('1'), escala_ida: v('Bogotá'), escala_regreso: v(null, 0),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(descripcion).toContain('Escala ida: Bogotá')
    expect(descripcion).not.toContain('regreso')
  })

  it('sin ciudades leídas, la línea sale exactamente como antes', () => {
    const r = evaluarLectura(VUELO, vueloOk({ escalas: v('2') }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(resumenDeLinea(VUELO, r.campos).descripcion).toContain('2 escalas')
  })
})

describe('equipaje · cuenta el icono RESALTADO, no que el icono exista', () => {
  it('BASIC de Avianca (solo el primer icono a color) sale como «Solo artículo personal»', () => {
    const r = evaluarLectura(VUELO, vueloOk({
      familia_tarifa: v('BASIC Standard economy'),
      equipaje_personal: v('true'), equipaje_mano: v('false'), equipaje_bodega: v('false'),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(descripcion).toContain('Solo artículo personal')
    // El defecto reportado: bodega marcada en una tarifa que solo lleva mochila.
    expect(descripcion).not.toContain('Con equipaje de bodega')
  })

  it('LIGHT (primero y segundo a color) sí dice equipaje de mano, y sigue sin bodega', () => {
    const r = evaluarLectura(VUELO, vueloOk({
      familia_tarifa: v('LIGHT Standard economy'),
      equipaje_personal: v('true'), equipaje_mano: v('true'), equipaje_bodega: v('false'),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(descripcion).toContain('con equipaje de mano')
    expect(descripcion).toContain('Sin equipaje de bodega')
    expect(descripcion).not.toContain('Solo artículo personal')
  })

  // «Solo artículo personal» es una afirmación sobre los TRES iconos. Con uno sin leer, no.
  it('con el equipaje de bodega sin leer no se afirma «solo artículo personal»', () => {
    const r = evaluarLectura(VUELO, vueloOk({
      equipaje_personal: v('true'), equipaje_mano: v('false'), equipaje_bodega: v(null, 0),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { descripcion } = resumenDeLinea(VUELO, r.campos)
    expect(descripcion).not.toContain('Solo artículo personal')
    expect(descripcion).toContain('sin equipaje de mano')
    expect(descripcion).toContain('con artículo personal')
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

describe('tarifa por pasajero · las reglas aprobadas el 2026-09-16', () => {
  it('RX1 en dos capas: «detalle único» con dos opciones contadas se rechaza igual', () => {
    const r = evaluarLectura(HOTEL, { ...hotelOk(), opcionesVisibles: 2 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX1')
  })

  it('RX1: una sola opción contada no rechaza (listado filtrado a un hotel, 7.5)', () => {
    expect(evaluarLectura(HOTEL, { ...hotelOk(), opcionesVisibles: 1 }).ok).toBe(true)
  })

  it('7.4: la tarjeta sin fechas las toma del viaje, marcadas para revisión', () => {
    const r = evaluarLectura(
      HOTEL,
      hotelOk({ check_in: v(null, 0), check_out: v(null, 0) }),
      { fechasViaje: { inicio: '2026-10-07', fin: '2026-10-10' } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const entrada = r.campos.find(c => c.slug === 'check_in')
    expect(entrada).toMatchObject({ valor: '2026-10-07', delItem: true, alertaRevision: true })
    expect(r.avisos[0]).toContain('se toman las del viaje (2026-10-07 a 2026-10-10)')
  })

  it('7.4: sin fechas en el viaje tampoco se inventan, y RX2 sigue en el cargue de siempre', () => {
    const r = evaluarLectura(HOTEL, hotelOk({ check_in: v(null, 0), check_out: v(null, 0) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX2')
  })

  it('fecha sin año: se completa con el del viaje, y un regreso de enero cae en el año siguiente', () => {
    const r = evaluarLectura(
      VUELO,
      vueloOk({ fecha_salida: v('--12-29'), fecha_regreso: v('--01-02') }),
      { fechasViaje: { inicio: '2026-12-29', fin: '2027-01-02' } },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'fecha_salida')?.valor).toBe('2026-12-29')
    expect(r.campos.find(c => c.slug === 'fecha_regreso')?.valor).toBe('2027-01-02')
    expect(r.avisos.some(a => a.includes('no muestra el año'))).toBe(true)
  })

  it('fecha sin año y sin viaje: queda vacía, nunca con un año inventado', () => {
    const r = evaluarLectura(VUELO, vueloOk({ fecha_regreso: v('--01-02') }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'fecha_regreso')?.valor).toBeNull()
  })

  it('RX3 con moneda indicada a mano: se acepta, marcada', () => {
    const r = evaluarLectura(HOTEL, hotelOk({ moneda: v(null, 0) }), { monedaIndicada: 'cop' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'moneda')).toMatchObject({ valor: 'COP', alertaRevision: true, delItem: true })
    expect(r.avisos[0]).toContain('indicada a mano')
  })

  it('por casillas: faltan mínimos descriptivos y se AVISA; faltan los de costo y se rechaza', () => {
    const sinNombre = hotelOk({ hotel: v(null, 0), ciudad: v(null, 0), tipo_habitacion: v(null, 0) })
    const ok = evaluarLectura(HOTEL, sinNombre, { soloMinimosDeCosto: true })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.avisos.some(a => a.startsWith('La captura no muestra: hotel, ciudad, habitación.'))).toBe(true)

    const sinPrecio = evaluarLectura(HOTEL, hotelOk({ precio_total: v(null, 0) }), { soloMinimosDeCosto: true })
    expect(sinPrecio.ok).toBe(false)
    if (!sinPrecio.ok) expect(sinPrecio.codigo).toBe('RX2')

    // El cargue de siempre no cambia: sin el nombre del hotel, RX2.
    expect(evaluarLectura(HOTEL, sinNombre).ok).toBe(false)
  })

  it('con tabla por tipo de pasajero, base_precio no hace falta', () => {
    const cruda = {
      ...hotelOk({ base_precio: v(null, 0) }),
      porTipoPax: [{ tipo: 'adulto' as const, cantidad: 2, subtotal_tipo: 360, moneda: 'USD', confidence: 1 }],
      totalGeneral: 360,
    }
    expect(evaluarLectura(HOTEL, cruda, { soloMinimosDeCosto: true }).ok).toBe(true)
    expect(evaluarLectura(HOTEL, { ...cruda, porTipoPax: [] }, { soloMinimosDeCosto: true }).ok).toBe(false)
  })

  it('7.3: impuestos en destino son nota, no costo', () => {
    const r = evaluarLectura(HOTEL, hotelOk({
      impuestos_incluidos: v('false'),
      impuestos_destino_valor: v('329.44'),
      impuestos_destino_moneda: v('MXN'),
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.join(' ')).toContain('329,44 MXN')
    expect(r.avisos.join(' ')).toContain('no al costo')
    expect(r.avisos.join(' ')).not.toContain('agrégalos como rubro')
  })

  it('impuestos sin decir: ya no rechaza, pero se avisa', () => {
    const r = evaluarLectura(HOTEL, hotelOk({ impuestos_incluidos: v(null, 0) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avisos.join(' ')).toContain('no dice si el precio incluye impuestos')
  })
})
