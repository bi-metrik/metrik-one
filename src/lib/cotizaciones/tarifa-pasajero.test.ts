/**
 * Tarifa por tipo de pasajero. Los fixtures son lecturas REALES del banco de Trappvel
 * (`proyectos/trappvel/clarity/capturas-proveedor/2026-09-16/`), tal como las devolvió el
 * modelo vivo el 2026-09-16 y pasaron por `construirLecturaCasilla`.
 */
import { describe, expect, it } from 'vitest'

import {
  aPesos,
  capturasDesactualizadas,
  casillasDe,
  casillasVigentes,
  composicionDeLectura,
  composicionDeLinea,
  confirmacionDesactualizada,
  confirmadaVigente,
  monedaDeTarifa,
  describirOcupacion,
  faltanPorAcomodar,
  leerTarifaPax,
  lineaPorPasajero,
  mismoTexto,
  normalizarComposicion,
  precioPorPasajero,
  repartirProporcional,
  resolverTarifa,
  tarifaMasReciente,
  validarLecturaEnCasilla,
  type Composicion,
  type LecturaCasilla,
  type TarifaConfirmada,
} from './tarifa-pasajero'

const lectura = (over: Partial<LecturaCasilla>): LecturaCasilla => ({
  moneda: 'COP',
  total: 0,
  aPagarAgencia: null,
  porTipo: [],
  ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
  ocupacionDelItem: false,
  identidad: {},
  notasCliente: [],
  alertas: [],
  campos: [],
  nombre: 'Línea',
  descripcion: '',
  leidaEn: '2026-09-16T12:00:00Z',
  ...over,
})

/** LATAM NDC 4.01.10_PM: 5 ADT + 1 CHD. */
const LATAM = lectura({
  total: 11306378,
  porTipo: [
    { tipo: 'adulto', cantidad: 5, subtotal: 9535315 },
    { tipo: 'nino', cantidad: 1, subtotal: 1771063 },
  ],
  ocupacion: { adultos: 5, ninos: 1, infantes: 0, total: 6 },
  identidad: { aerolinea: 'LATAM', origen: 'Bogotá BOG', destino: 'Orlando MCO', fecha_salida: '2026-10-01', fecha_regreso: null },
})

/** Amadeus 3.57.39_PM-3: 2 ADT + 1 INF, el infante paga solo el fee. */
const AMADEUS = lectura({
  total: 1294351,
  porTipo: [
    { tipo: 'adulto', cantidad: 2, subtotal: 1283014 },
    { tipo: 'infante', cantidad: 1, subtotal: 11337 },
  ],
  ocupacion: { adultos: 2, ninos: 0, infantes: 1, total: 3 },
})

/** Decameron 3.57.39_PM, liquidación: el costo es el total a pagar agencia. */
const DECAMERON = lectura({
  total: 2029118,
  aPagarAgencia: 1818919,
  porTipo: [
    { tipo: 'adulto', cantidad: 2, subtotal: 2019412 },
    { tipo: 'infante', cantidad: 1, subtotal: 9706 },
  ],
  ocupacion: { adultos: 2, ninos: 0, infantes: 1, total: null },
  identidad: { hotel: null, tipo_habitacion: null, regimen: 'Todo Incluido', check_in: null, check_out: null },
})

/** Bedsonline 4.06.11_PM, Cancún: un solo total para 2 ADT + 1 CHD. */
const CANCUN = lectura({
  total: 3780884.17,
  ocupacion: { adultos: 2, ninos: 1, infantes: 0, total: null },
  identidad: {
    hotel: 'Crown Paradise Club Cancun All Inclusive',
    tipo_habitacion: 'Standard Double',
    regimen: 'Todo incluido',
    check_in: '2026-12-19',
    check_out: '2026-12-23',
  },
  notasCliente: ['Impuestos y tasas a pagar en destino: 329,44 MXN, no incluidos en el precio.'],
})

/** Tarjeta 4.03.09_PM-2, París: sin fechas ni ocupación. */
const PARIS = lectura({
  total: 1713265.87,
  ocupacionDelItem: true,
  identidad: { hotel: 'ibis París Alesia Montparnasse distrito XIV', tipo_habitacion: 'Standard Room', regimen: 'Desayuno', check_in: null, check_out: null },
})

const DOS_ADULTOS_UN_NINO: Composicion = { adultos: 2, ninos: 1, infantes: 0 }

describe('composición', () => {
  it('sin al menos un adulto no hay composición', () => {
    expect(normalizarComposicion({ adultos: 0, ninos: 2 })).toBeNull()
    expect(normalizarComposicion({ ninos: 2 })).toBeNull()
  })

  it('niños e infantes ausentes o vacíos valen cero', () => {
    expect(normalizarComposicion({ adultos: '2', ninos: '', infantes: null })).toEqual({ adultos: 2, ninos: 0, infantes: 0 })
  })

  it('un valor no entero NO se redondea: es un dato mal escrito', () => {
    expect(normalizarComposicion({ adultos: 2.5 })).toBeNull()
    expect(normalizarComposicion({ adultos: 2, ninos: -1 })).toBeNull()
  })

  it('la del ítem manda sobre la del viaje (CC4b)', () => {
    const viaje = { adultos: 4, ninos: 0, infantes: 0 }
    expect(composicionDeLinea({ composicion: { adultos: 2, ninos: 0, infantes: 0 } }, viaje)).toEqual({ adultos: 2, ninos: 0, infantes: 0 })
    expect(composicionDeLinea({}, viaje)).toEqual(viaje)
  })

  it('se dice con números y palabras, nunca con siglas (P3)', () => {
    const c = { adultos: 2, ninos: 1, infantes: 1 }
    expect(describirOcupacion(c)).toBe('2 adultos, 1 niño, 1 infante')
    expect(describirOcupacion(c, 'y')).toBe('2 adultos, 1 niño y 1 infante')
    expect(describirOcupacion({ adultos: 1, ninos: 2, infantes: 0 }, 'y')).toBe('1 adulto y 2 niños')
    expect(describirOcupacion(c)).not.toMatch(/ADT|CHD|INF/)
  })
})

describe('casillas (6.1, P1, P2)', () => {
  it('2 adultos + 1 niño + 1 infante: las tres, con la búsqueda literal', () => {
    const cs = casillasDe({ adultos: 2, ninos: 1, infantes: 1 }, 'hotel_detalle')
    expect(cs.map(c => [c.numero, c.titulo])).toEqual([[1, 'Grupo completo'], [2, 'Sin el infante'], [3, 'Solo adultos']])
    expect(cs[0].busqueda).toBe('Busca en la plataforma: 2 adultos, 1 niño, 1 infante')
    expect(cs[1].busqueda).toBe('Busca otra vez el mismo hotel, habitación y fechas con: 2 adultos, 1 niño')
    expect(cs[2].busqueda).toBe('Busca otra vez el mismo hotel, habitación y fechas con: 2 adultos')
    expect(cs[0].condicional).toBe(false)
    expect(cs[1].razonCondicional).toBe('Solo si el pantallazo 1 no separa adultos, niños e infantes')
  })

  it('sin infantes NO hay casilla «sin el infante» (P2)', () => {
    const cs = casillasDe(DOS_ADULTOS_UN_NINO, 'hotel_detalle')
    expect(cs.map(c => c.clave)).toEqual(['grupo_completo', 'solo_adultos'])
    expect(cs[1].numero).toBe(2)
  })

  it('con infantes y sin niños, «sin el infante» y «solo adultos» son una sola casilla', () => {
    const cs = casillasDe({ adultos: 2, ninos: 0, infantes: 1 }, 'vuelo_detalle')
    expect(cs.map(c => c.titulo)).toEqual(['Grupo completo', 'Solo adultos'])
    expect(cs[1].busqueda).toBe('Busca otra vez el mismo vuelo y tarifa con: 2 adultos')
  })

  it('solo adultos: UNA casilla', () => {
    expect(casillasDe({ adultos: 2, ninos: 0, infantes: 0 }, 'hotel_detalle')).toHaveLength(1)
  })
})

describe('resolución con el banco real', () => {
  it('LATAM: el servidor divide el subtotal de la fila (TP1)', () => {
    const e = resolverTarifa({ adultos: 5, ninos: 1, infantes: 0 }, { grupo_completo: LATAM }, 'vuelo_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos.map(c => [c.tipo, c.unitario])).toEqual([['adulto', 1907063], ['nino', 1771063]])
    expect(e.costoTotal).toBe(11306378)
    expect(e.mensaje).toBe('Este pantallazo ya trae el precio de adultos y niños. No hace falta nada más.')
    expect(lineaPorPasajero(e.costos, e.moneda)).toBe('Adulto $1.907.063 · Niño $1.771.063')
  })

  it('Amadeus: el infante que paga solo el fee', () => {
    const e = resolverTarifa({ adultos: 2, ninos: 0, infantes: 1 }, { grupo_completo: AMADEUS }, 'vuelo_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos.map(c => [c.tipo, c.total, c.unitario])).toEqual([['adulto', 1283014, 641507], ['infante', 11337, 11337]])
    expect(e.costoTotal).toBe(1294351)
  })

  it('Decameron: el costo es el total a pagar agencia leído, y se reparte sin perder un peso', () => {
    const e = resolverTarifa({ adultos: 2, ninos: 0, infantes: 1 }, { grupo_completo: DECAMERON }, 'hotel_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costoTotal).toBe(1818919)
    const suma = e.costos.reduce((a, c) => a + c.total, 0)
    expect(Math.round(suma * 100) / 100).toBe(1818919)
    // No se recalcula restando comisión y prestación (2.029.118 − 187.288 − 15.624 = 1.826.206).
    expect(suma).not.toBe(1826206)
    expect(e.costos[0].deDonde).toContain('$2.019.412')
    expect(e.costos[1].deDonde).toContain('$9.706')
  })

  it('Bedsonline Cancún: un solo total con un niño es «falta desglose» y pide la casilla 2 (TP4, P4)', () => {
    const e = resolverTarifa(DOS_ADULTOS_UN_NINO, { grupo_completo: CANCUN }, 'hotel_detalle')
    expect(e.estado).toBe('falta')
    if (e.estado !== 'falta') return
    expect(e.siguiente.clave).toBe('solo_adultos')
    expect(e.mensaje).toBe('Este pantallazo tiene un solo total para el grupo. Falta el 2: busca con 2 adultos.')
  })

  it('tarjeta de solo adultos: el total se divide entre los adultos (TP4 no aplica)', () => {
    const e = resolverTarifa({ adultos: 2, ninos: 0, infantes: 0 }, { grupo_completo: PARIS }, 'hotel_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos).toHaveLength(1)
    expect(e.costos[0].unitario).toBe(856632.94)
  })

  it('con la casilla 2 el niño es la diferencia (CC4a)', () => {
    const b = { ...CANCUN, total: 2900000, ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: null } }
    const e = resolverTarifa(DOS_ADULTOS_UN_NINO, { grupo_completo: CANCUN, solo_adultos: b }, 'hotel_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos.map(c => [c.tipo, c.total])).toEqual([['adulto', 2900000], ['nino', 880884.17]])
    expect(e.costos[0].unitario).toBe(1450000)
  })

  it('tres tipos: infante = A − B, niño = B − C, adulto = C, y varios del mismo tipo en partes iguales (CC3)', () => {
    const c = { adultos: 2, ninos: 2, infantes: 1 }
    const casillas = {
      grupo_completo: lectura({ total: 5000000 }),
      sin_infantes: lectura({ total: 4800000 }),
      solo_adultos: lectura({ total: 3000000 }),
    }
    const e = resolverTarifa(c, casillas, 'hotel_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos.map(x => [x.tipo, x.total, x.unitario])).toEqual([
      ['adulto', 3000000, 1500000],
      ['nino', 1800000, 900000],
      ['infante', 200000, 200000],
    ])
  })

  it('diferencia en cero: hay que confirmar que el menor no paga (CC2)', () => {
    const b = { ...CANCUN, ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: null } }
    const e = resolverTarifa(DOS_ADULTOS_UN_NINO, { grupo_completo: CANCUN, solo_adultos: b }, 'hotel_detalle')
    expect(e.estado).toBe('confirmar_menor_no_paga')
    const confirmado = resolverTarifa(
      DOS_ADULTOS_UN_NINO,
      { grupo_completo: CANCUN, solo_adultos: { ...b, menorNoPagaConfirmado: true } },
      'hotel_detalle',
    )
    expect(confirmado.estado).toBe('resuelta')
  })

  it('sin pantallazo 1 pide el 1', () => {
    const e = resolverTarifa(DOS_ADULTOS_UN_NINO, {}, 'hotel_detalle')
    expect(e.estado).toBe('vacia')
  })
})

/**
 * §2.4 del diseño del 2026-09-21: la composición es un RESULTADO de la lectura, no una
 * pregunta previa. Lo que se afirma aquí es que la captura la acredita cuando la trae, y
 * que un desconocimiento NO se rellena con ceros.
 */
describe('la ocupación sale de la captura', () => {
  it('la captura de Amadeus acredita 2 adultos y 1 infante sin que nadie lo escriba', () => {
    expect(composicionDeLectura(AMADEUS)).toEqual({ adultos: 2, ninos: 0, infantes: 1 })
    expect(composicionDeLectura(LATAM)).toEqual({ adultos: 5, ninos: 1, infantes: 0 })
  })

  it('sin ocupación en la imagen NO se inventa: hay que preguntar', () => {
    // 7.4 · la tarjeta no la muestra y la lectura la tomó del ítem.
    expect(composicionDeLectura(lectura({ total: 900000, ocupacionDelItem: true }))).toBeNull()
    // Solo un total de personas («3 huéspedes»): no se puede partir por tipo.
    expect(composicionDeLectura(lectura({ total: 900000, ocupacion: { adultos: null, ninos: null, infantes: null, total: 3 } }))).toBeNull()
    // Sin un adulto no hay composición con la que cotizar (ni casilla «solo adultos»).
    expect(composicionDeLectura(lectura({ total: 900000, ocupacion: { adultos: 0, ninos: 1, infantes: 0, total: 1 } }))).toBeNull()
  })

  it('solo se avisa lo que FALTA del viaje; cubrir de más no se reporta', () => {
    const linea: Composicion = { adultos: 2, ninos: 0, infantes: 1 }
    expect(faltanPorAcomodar(linea, { adultos: 6, ninos: 1, infantes: 1 })).toEqual({ adultos: 4, ninos: 1, infantes: 0 })
    expect(describirOcupacion(faltanPorAcomodar(linea, { adultos: 6, ninos: 1, infantes: 1 }) as Composicion, 'y'))
      .toBe('4 adultos y 1 niño')
    expect(faltanPorAcomodar(linea, { adultos: 2, ninos: 0, infantes: 1 })).toBeNull()
    expect(faltanPorAcomodar(linea, { adultos: 1, ninos: 0, infantes: 0 })).toBeNull()
    // Sin viaje declarado no hay contra qué comparar.
    expect(faltanPorAcomodar(linea, null)).toBeNull()
  })
})

describe('validación de un pantallazo contra su casilla (P5)', () => {
  /**
   * §2.1 · el primer pantallazo entra sin composición: no hay casilla contra la cual
   * comparar, así que solo se juzga si la captura cuadra consigo misma.
   */
  it('sin composición: la casilla 1 se acepta con TP2 y nada más', () => {
    const ok = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: AMADEUS, composicion: null, casillas: {}, ranuraSlug: 'vuelo_detalle' })
    expect(ok).toEqual({ ok: true, alertas: [] })

    const malo = { ...LATAM, porTipo: [{ tipo: 'adulto' as const, cantidad: 5, subtotal: 6093500 }, LATAM.porTipo[1]] }
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: malo, composicion: null, casillas: {}, ranuraSlug: 'vuelo_detalle' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.codigo).toBe('TP2')
  })

  it('sin composición, una casilla complementaria no tiene qué buscar', () => {
    const v = validarLecturaEnCasilla({ clave: 'solo_adultos', lectura: AMADEUS, composicion: null, casillas: {}, ranuraSlug: 'vuelo_detalle' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.codigo).toBe('CASILLA')
    expect(v.mensaje).toContain('Pega primero el pantallazo del proveedor')
  })

  it('TP2: filas que no suman el total general se rechazan', () => {
    const malo = { ...LATAM, porTipo: [{ tipo: 'adulto' as const, cantidad: 5, subtotal: 6093500 }, LATAM.porTipo[1]] }
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: malo, composicion: { adultos: 5, ninos: 1, infantes: 0 }, casillas: {}, ranuraSlug: 'vuelo_detalle' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.codigo).toBe('TP2')
  })

  it('TP2 tolera un peso por fila de redondeo', () => {
    const redondeo = { ...AMADEUS, total: 1294352 }
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: redondeo, composicion: { adultos: 2, ninos: 0, infantes: 1 }, casillas: {}, ranuraSlug: 'vuelo_detalle' })
    expect(v.ok).toBe(true)
  })

  it('TP3: la ocupación del pantallazo no es la de la casilla', () => {
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: LATAM, composicion: { adultos: 4, ninos: 1, infantes: 0 }, casillas: {}, ranuraSlug: 'vuelo_detalle' })
    expect(v).toEqual({
      ok: false,
      codigo: 'TP3',
      mensaje: 'Este pantallazo es para 5 adultos y 1 niño. En la casilla 1 va la búsqueda con 4 adultos y 1 niño.',
    })
  })

  it('P5: en la casilla 2 va la búsqueda con otra ocupación', () => {
    const v = validarLecturaEnCasilla({
      clave: 'sin_infantes',
      lectura: lectura({ total: 100, ocupacion: { adultos: 2, ninos: 2, infantes: 0, total: null }, identidad: { hotel: 'X' } }),
      composicion: { adultos: 2, ninos: 1, infantes: 1 },
      casillas: { grupo_completo: lectura({ total: 200, identidad: { hotel: 'X' } }) },
      ranuraSlug: 'hotel_detalle',
    })
    expect(v).toEqual({
      ok: false,
      codigo: 'TP3',
      mensaje: 'Este pantallazo es para 2 adultos y 2 niños. En la casilla 2 va la búsqueda con 2 adultos y 1 niño.',
    })
  })

  it('7.4: sin ocupación visible se acepta con la de la casilla y una alerta', () => {
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: PARIS, composicion: { adultos: 2, ninos: 0, infantes: 0 }, casillas: {}, ranuraSlug: 'hotel_detalle' })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.alertas[0]).toContain('se toma la de la casilla (2 adultos)')
  })

  it('CC1: otro hotel se rechaza con el nombre de los dos (banco real)', () => {
    const v = validarLecturaEnCasilla({ clave: 'solo_adultos', lectura: PARIS, composicion: DOS_ADULTOS_UN_NINO, casillas: { grupo_completo: CANCUN }, ranuraSlug: 'hotel_detalle' })
    expect(v).toEqual({
      ok: false,
      codigo: 'CC1',
      mensaje:
        'Este pantallazo es de otro hotel (ibis París Alesia Montparnasse distrito XIV vs. Crown Paradise Club Cancun All Inclusive). ' +
        'Busca el mismo hotel de la casilla 1.',
    })
  })

  it('CC1: otra moneda se rechaza', () => {
    const usd = { ...CANCUN, moneda: 'USD', total: 900, ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: null } }
    const v = validarLecturaEnCasilla({ clave: 'solo_adultos', lectura: usd, composicion: DOS_ADULTOS_UN_NINO, casillas: { grupo_completo: CANCUN }, ranuraSlug: 'hotel_detalle' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.mensaje).toBe('Este pantallazo está en USD y el de la casilla 1 en COP. Busca con la misma moneda.')
  })

  it('CC1: para restar hace falta el nombre del hotel en las dos capturas', () => {
    const sinNombre = { ...CANCUN, total: 2900000, identidad: { ...CANCUN.identidad, hotel: null }, ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: null } }
    const v = validarLecturaEnCasilla({ clave: 'solo_adultos', lectura: sinNombre, composicion: DOS_ADULTOS_UN_NINO, casillas: { grupo_completo: CANCUN }, ranuraSlug: 'hotel_detalle' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.codigo).toBe('CC1')
    expect(v.mensaje).toContain('el nombre del hotel')
  })

  it('CC2: la búsqueda con menos personas no puede costar más (resta negativa)', () => {
    const b = { ...CANCUN, total: 5401263.1, ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: null } }
    const v = validarLecturaEnCasilla({ clave: 'solo_adultos', lectura: b, composicion: DOS_ADULTOS_UN_NINO, casillas: { grupo_completo: CANCUN }, ranuraSlug: 'hotel_detalle' })
    expect(v).toEqual({
      ok: false,
      codigo: 'CC2',
      mensaje:
        'El pantallazo con 2 adultos cuesta más que el de 2 adultos y 1 niño ($5.401.263 contra $3.780.884). ' +
        'La tarifa cambió entre búsquedas o hay otra promoción aplicada: vuelve a buscar las dos con la misma tarifa.',
    })
  })

  it('con el pantallazo 1 ya desglosado, las demás casillas no hacen falta', () => {
    const v = validarLecturaEnCasilla({ clave: 'solo_adultos', lectura: AMADEUS, composicion: { adultos: 2, ninos: 0, infantes: 1 }, casillas: { grupo_completo: AMADEUS }, ranuraSlug: 'vuelo_detalle' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.codigo).toBe('NO_HACE_FALTA')
  })

  it('un nombre truncado por la tarjeta coincide con el completo', () => {
    expect(mismoTexto('Double Or Twin St...', 'Double or Twin Standard')).toBe(true)
    expect(mismoTexto('Crown Paradise Club', 'Crown Paradise Golden')).toBe(false)
  })
})

describe('precio por pasajero', () => {
  const confirmada: TarifaConfirmada = {
    composicion: { adultos: 5, ninos: 1, infantes: 0 },
    costos: [
      { tipo: 'adulto', cantidad: 5, unitarioCOP: 1907063, totalCOP: 9535315 },
      { tipo: 'nino', cantidad: 1, unitarioCOP: 1771063, totalCOP: 1771063 },
    ],
    costoTotalCOP: 11306378,
    moneda: 'COP',
    tasa: null,
    confirmadaEn: '2026-09-16T12:00:00Z',
  }

  it('reparte el precio de la línea en proporción al costo, y la suma es el precio de la línea', () => {
    const precios = precioPorPasajero(confirmada, 13301621)
    const suma = precios.reduce((a, p) => a + p.precioUnitario * p.cantidad, 0)
    expect(Math.abs(suma - 13301621)).toBeLessThanOrEqual(3)
    expect(precios.map(p => p.tipo)).toEqual(['adulto', 'nino'])
    // Mismo factor de margen para los dos tipos (D5 abierta): precio / costo igual.
    expect(precios[0].precioUnitario / 1907063).toBeCloseTo(precios[1].precioUnitario / 1771063, 4)
  })

  it('deja de estar vigente si alguien cambió el costo de la línea', () => {
    expect(confirmadaVigente(confirmada, 11306378)).toBe(true)
    expect(confirmadaVigente(confirmada, 11306380)).toBe(true)
    expect(confirmadaVigente(confirmada, 11400000)).toBe(false)
  })

  it('repartirProporcional no pierde ni un centavo', () => {
    const r = repartirProporcional(1818919, [2019412, 9706])
    expect(Math.round((r[0] + r[1]) * 100)).toBe(181891900)
  })

  it('a pesos: sin tasa no hay conversión (R-P5)', () => {
    expect(aPesos(180.5, 'USD', null)).toBeNull()
    expect(aPesos(180.5, 'USD', 4000)).toBe(722000)
    expect(aPesos(3780884.17, 'COP', null)).toBe(3780884.17)
  })
})

describe('leerTarifaPax', () => {
  it('un jsonb roto no rompe la pantalla', () => {
    expect(leerTarifaPax(null)).toEqual({})
    expect(leerTarifaPax({ casillas: { grupo_completo: { total: 'x' } } }).casillas).toEqual({})
  })

  it('conserva las casillas bien formadas', () => {
    const t = leerTarifaPax({ composicion: { adultos: 2 }, casillas: { grupo_completo: CANCUN } })
    expect(t.composicion).toEqual({ adultos: 2, ninos: 0, infantes: 0 })
    expect(t.casillas?.grupo_completo?.total).toBe(3780884.17)
  })

  it('lee la marca de escritura del servidor; sin ella, null', () => {
    expect(leerTarifaPax({ actualizadaEn: '2026-09-16T14:21:45.600Z' }).actualizadaEn).toBe('2026-09-16T14:21:45.600Z')
    expect(leerTarifaPax({ casillas: {} }).actualizadaEn).toBeNull()
    expect(leerTarifaPax({ actualizadaEn: 42 }).actualizadaEn).toBeNull()
  })

  it('el aviso viejo de «año completado con el del viaje» deja de mostrarse al leer; los demás siguen', () => {
    const viejo = 'La captura no muestra el año de salida y regreso: se completa con el del viaje (2026). Confírmalo.'
    const otro = 'La captura muestra 3 pasajeros y la línea dice 2.'
    const t = leerTarifaPax({ casillas: { grupo_completo: { ...CANCUN, alertas: [viejo, otro] } } })
    expect(t.casillas?.grupo_completo?.alertas).toEqual([otro])
  })
})

describe('tarifaMasReciente · qué pinta la casilla después de guardar', () => {
  const pagina = leerTarifaPax({ actualizadaEn: '2026-09-16T14:20:26.000Z', casillas: {} })
  const guardada = leerTarifaPax({ actualizadaEn: '2026-09-16T14:21:45.600Z', casillas: { grupo_completo: CANCUN } })

  it('caso real (elegir COP): la página no trajo la lectura y la casilla pinta lo guardado', () => {
    expect(tarifaMasReciente(pagina, guardada).casillas?.grupo_completo?.total).toBe(3780884.17)
  })

  it('una página escrita antes de la marca (sin actualizadaEn) también pierde', () => {
    expect(tarifaMasReciente(leerTarifaPax({ casillas: {} }), guardada)).toBe(guardada)
  })

  it('cuando la página llega igual de nueva o más, manda la página', () => {
    const refrescada = leerTarifaPax({ actualizadaEn: '2026-09-16T14:21:45.600Z', casillas: { grupo_completo: CANCUN } })
    expect(tarifaMasReciente(refrescada, guardada)).toBe(refrescada)
    const despues = leerTarifaPax({ actualizadaEn: '2026-09-16T14:30:00.000Z', casillas: {} })
    expect(tarifaMasReciente(despues, guardada)).toBe(despues)
  })

  it('sin nada guardado, o guardado sin marca, manda la página', () => {
    expect(tarifaMasReciente(pagina, null)).toBe(pagina)
    expect(tarifaMasReciente(pagina, leerTarifaPax({ casillas: { grupo_completo: CANCUN } }))).toBe(pagina)
  })
})

/**
 * Brief del 2026-09-22, parte 1: una captura buscada para otros pasajeros no entra a ninguna
 * cuenta. El hueco original era el de «solo adultos» (un precio para 2 dividido entre 3), y
 * su hermano es el del desglose (el subtotal de 2 adultos repartido entre 3).
 */
describe('capturas desactualizadas', () => {
  const DOS: Composicion = { adultos: 2, ninos: 0, infantes: 0 }
  const TRES: Composicion = { adultos: 3, ninos: 0, infantes: 0 }
  const dosAdultos = (over: Partial<LecturaCasilla> = {}) => lectura({
    total: 2000000,
    ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 },
    paraComposicion: DOS,
    ...over,
  })

  it('el hueco: un precio buscado para 2 adultos NO se divide entre 3', () => {
    const e = resolverTarifa(TRES, { grupo_completo: dosAdultos() }, 'hotel_detalle')
    expect(e.estado).toBe('desactualizada')
    expect(e.mensaje).toBe('Este pantallazo es para 2 adultos y la línea ahora cubre 3 adultos: pega uno nuevo.')
    // Con la composición con que se buscó, se resuelve como siempre.
    expect(resolverTarifa(DOS, { grupo_completo: dosAdultos() }, 'hotel_detalle').estado).toBe('resuelta')
  })

  it('el hermano del hueco: un desglose de 2 adultos tampoco se reparte entre 3', () => {
    const conDesglose = dosAdultos({ porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 2000000 }] })
    expect(resolverTarifa(TRES, { grupo_completo: conDesglose }, 'vuelo_detalle').estado).toBe('desactualizada')
  })

  it('una lectura anterior a la marca se juzga por lo que la captura acredita', () => {
    const vieja = dosAdultos({ paraComposicion: undefined })
    expect(resolverTarifa(TRES, { grupo_completo: vieja }, 'hotel_detalle').estado).toBe('desactualizada')
  })

  it('sin marca y sin ocupación visible NO se marca nada: no se inventan alertas', () => {
    const sinEvidencia = dosAdultos({ paraComposicion: undefined, ocupacionDelItem: true })
    expect(capturasDesactualizadas(TRES, { grupo_completo: sinEvidencia }, 'hotel_detalle')).toEqual([])
  })

  it('se compara casilla por casilla: «solo adultos» sigue vigente si los adultos no cambian', () => {
    const antes: Composicion = { adultos: 2, ninos: 1, infantes: 1 }
    const ahora: Composicion = { adultos: 2, ninos: 1, infantes: 2 }
    const casillas = {
      grupo_completo: lectura({ total: 300, paraComposicion: antes }),
      sin_infantes: lectura({ total: 200, paraComposicion: antes }),
      solo_adultos: lectura({ total: 100, paraComposicion: antes }),
    }
    const viejas = capturasDesactualizadas(ahora, casillas, 'hotel_detalle')
    expect(viejas.map(v => v.clave)).toEqual(['grupo_completo'])
    expect(Object.keys(casillasVigentes(ahora, casillas, 'hotel_detalle'))).toEqual(['sin_infantes', 'solo_adultos'])
  })

  it('una complementaria vieja no cuenta si el pantallazo 1, vigente, ya trae cada tipo', () => {
    const ahora: Composicion = { adultos: 3, ninos: 1, infantes: 0 }
    const casillas = {
      grupo_completo: lectura({
        total: 400,
        porTipo: [{ tipo: 'adulto', cantidad: 3, subtotal: 300 }, { tipo: 'nino', cantidad: 1, subtotal: 100 }],
        paraComposicion: ahora,
      }),
      solo_adultos: lectura({ total: 200, paraComposicion: { adultos: 2, ninos: 1, infantes: 0 } }),
    }
    expect(capturasDesactualizadas(ahora, casillas, 'vuelo_detalle')).toEqual([])
    // Pero si el 1 no resuelve solo, la complementaria vieja SÍ frena, y dice cuál es.
    const sinDesglose = { ...casillas, grupo_completo: lectura({ total: 400, paraComposicion: ahora }) }
    const viejas = capturasDesactualizadas(ahora, sinDesglose, 'hotel_detalle')
    expect(viejas).toHaveLength(1)
    expect(viejas[0].mensaje).toBe('El pantallazo 2 (solo adultos) es para 2 adultos y ahora hace falta con 3 adultos: pega uno nuevo.')
  })

  it('la confirmación: otra composición la marca, la misma no', () => {
    const tarifa = leerTarifaPax({
      casillas: { grupo_completo: dosAdultos() },
      confirmada: { composicion: DOS, costos: [], costoTotalCOP: 2000000, moneda: 'COP', tasa: null, confirmadaEn: '2026-09-22T10:00:00Z' },
    })
    expect(confirmacionDesactualizada(tarifa, DOS)).toBeNull()
    expect(confirmacionDesactualizada(tarifa, TRES)).toMatchObject({ motivo: 'composicion' })
  })
})

describe('la moneda de la tarifa', () => {
  const conf = (moneda: string) => ({
    composicion: { adultos: 1 }, costos: [], costoTotalCOP: 1, moneda, tasa: null, confirmadaEn: '2026-09-22T10:00:00Z',
  })

  it('la elegida por una persona manda sobre la leída; la leída sobre la supuesta', () => {
    const leidaUSD = lectura({ moneda: 'USD' })
    const supuesta = lectura({ moneda: 'COP', monedaAsumida: true })
    expect(monedaDeTarifa(leerTarifaPax({ casillas: { grupo_completo: leidaUSD } })))
      .toMatchObject({ moneda: 'USD', asumida: false, origen: 'captura' })
    expect(monedaDeTarifa(leerTarifaPax({ casillas: { grupo_completo: supuesta } })))
      .toMatchObject({ moneda: 'COP', asumida: true, origen: 'supuesta' })
    expect(monedaDeTarifa(leerTarifaPax({
      casillas: { grupo_completo: leidaUSD },
      moneda: { valor: 'COP', por: 'Ana', porId: 'p-1', en: '2026-09-22T10:00:00Z' },
    }))).toMatchObject({ moneda: 'COP', asumida: false, origen: 'persona', leida: 'USD' })
  })

  it('sin lecturas no hay nada que confirmar: COP y no supuesta', () => {
    expect(monedaDeTarifa({})).toMatchObject({ moneda: 'COP', asumida: false, origen: 'sin_lectura' })
  })

  it('cambiar la moneda después de confirmar marca la confirmación', () => {
    const tarifa = leerTarifaPax({
      casillas: { grupo_completo: lectura({ moneda: 'COP' }) },
      confirmada: conf('COP'),
      moneda: { valor: 'USD', por: null, porId: null, en: '2026-09-22T11:00:00Z' },
    })
    expect(confirmacionDesactualizada(tarifa, { adultos: 1, ninos: 0, infantes: 0 })).toMatchObject({ motivo: 'moneda' })
  })

  it('CC1: una supuesta no choca con ninguna; dos leídas distintas sí', () => {
    const c: Composicion = { adultos: 2, ninos: 1, infantes: 0 }
    const base = { clave: 'solo_adultos' as const, composicion: c, ranuraSlug: 'hotel_detalle' }
    const hotel = { hotel: 'Decameron Cartagena', tipo_habitacion: null, regimen: null, check_in: null, check_out: null }
    const uno = lectura({ moneda: 'USD', total: 1000, identidad: hotel, ocupacion: { adultos: 2, ninos: 1, infantes: 0, total: 3 } })
    const dos = (over: Partial<LecturaCasilla>) =>
      lectura({ moneda: 'COP', total: 500, identidad: hotel, ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ...over })

    const leidasDistintas = validarLecturaEnCasilla({ ...base, lectura: dos({}), casillas: { grupo_completo: uno } })
    expect(leidasDistintas).toMatchObject({ ok: false, codigo: 'CC1' })
    expect(leidasDistintas.ok ? '' : leidasDistintas.mensaje).toContain('en COP y el de la casilla 1 en USD')
    // La supuesta no es evidencia: sigue a la de la línea.
    expect(validarLecturaEnCasilla({ ...base, lectura: dos({ monedaAsumida: true }), casillas: { grupo_completo: uno } }).ok).toBe(true)
    // Una leída que contradice la moneda que eligió una persona se rechaza, aunque la 1 fuera supuesta.
    const elegida = validarLecturaEnCasilla({
      ...base,
      lectura: dos({ moneda: 'EUR' }),
      casillas: { grupo_completo: lectura({ ...uno, monedaAsumida: true }) },
      monedaDecidida: 'USD',
    })
    expect(elegida).toMatchObject({ ok: false, codigo: 'CC1' })
    expect(elegida.ok ? '' : elegida.mensaje).toContain('se eligió USD')
    // Y la que coincide con la elegida pasa.
    expect(validarLecturaEnCasilla({
      ...base,
      lectura: dos({ moneda: 'USD' }),
      casillas: { grupo_completo: lectura({ ...uno, monedaAsumida: true }) },
      monedaDecidida: 'USD',
    }).ok).toBe(true)
  })

  it('leerTarifaPax conserva la moneda elegida y el costo en otra moneda; sin ellos, ni aparecen', () => {
    const t = leerTarifaPax({
      moneda: { valor: 'usd', por: 'Ana', porId: 'p-1', en: '2026-09-22T10:00:00Z' },
      costoManual: { moneda: 'EUR', valor: 100, tasa: 4500, por: null, porId: null, en: '2026-09-22T10:00:00Z' },
    })
    expect(t.moneda).toMatchObject({ valor: 'USD', por: 'Ana' })
    expect(t.costoManual).toMatchObject({ moneda: 'EUR', valor: 100, tasa: 4500 })
    const vacia = leerTarifaPax({ casillas: { grupo_completo: CANCUN } })
    expect('moneda' in vacia).toBe(false)
    expect('costoManual' in vacia).toBe(false)
    expect('paraComposicion' in (vacia.casillas?.grupo_completo ?? {})).toBe(false)
  })
})
