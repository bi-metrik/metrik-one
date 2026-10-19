import { describe, expect, it } from 'vitest'

import { escalonesIncoherentes, resumenExtraccion, revisarExtraccion, sugerenciasParaFicha, temporadasMalVencidas, vigenciaPorConfirmar } from './extraccion'

const HOY = '2026-10-19'

/** Una extracción inventada con la forma del esquema 0.2 (proveedor ficticio). */
const EXTRACCION_FICTICIA = {
  esquema_version: '0.2',
  expediente: {
    archivos: [
      { archivo: 'tar0_TARIFAS 2027.pdf', clase: 'tarifario', decision: 'usar' },
      { archivo: 'tar1_TARIFAS 2025.pdf', clase: 'tarifario', decision: 'vencido_sin_reemplazo' },
      { archivo: 'tar2_CERTIFICACION BANCARIA.pdf', clase: 'bancario', decision: 'excluir_bancario' },
    ],
    pedir_actualizacion: ['Tarifa de temporada media 2027: no trae fechas.'],
  },
  documento: { archivo: 'tar0_TARIFAS 2027.pdf' },
  tarifario: {
    proveedor: { nombre: 'Hotel Ficticio del Mar', tipo: 'hotel', ciudad: 'Cartagena' },
    moneda: 'COP',
    vigencia: { desde: '2027-01-01', hasta: '2027-12-31' },
    canal: 'neta_mayorista',
    impuestos: { iva_declarado: true, iva_incluido: false, iva_pct: 19 },
    temporadas: [{ id: 'T1' }, { id: 'T2' }],
    tarifas: [{ precio: 100000 }, { precio: 120000 }, { precio: 90000 }],
    advertencias: ['Semana Santa calculada'],
  },
  datos_ficha: { direccion: 'Calle Falsa 123', ciudad: 'Cartagena' },
}

describe('extracción del motor', () => {
  it('revisa la forma y saca los archivos', () => {
    const r = revisarExtraccion(JSON.stringify(EXTRACCION_FICTICIA), { hoy: HOY })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.extraccion.esquemaVersion).toBe('0.2')
    expect(r.extraccion.archivos).toEqual(['tar0_TARIFAS 2027.pdf', 'tar1_TARIFAS 2025.pdf', 'tar2_CERTIFICACION BANCARIA.pdf'])
    expect(r.extraccion.datosFicha).toMatchObject({ ciudad: 'Cartagena' })
  })

  it('rechaza lo que no es una extracción', () => {
    expect(revisarExtraccion('{no es json')).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) })
    expect(revisarExtraccion({ expediente: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/esquema_version/) })
    expect(revisarExtraccion({ esquema_version: '0.9', expediente: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/0\.9/) })
    expect(revisarExtraccion({ esquema_version: '0.2' })).toMatchObject({ ok: false, error: expect.stringMatching(/expediente/) })
    expect(revisarExtraccion({ esquema_version: '0.2', expediente: {}, tarifario: [] })).toMatchObject({ ok: false })
  })

  it('resume y propone a la ficha solo lo que el documento sí dice', () => {
    const r = revisarExtraccion(EXTRACCION_FICTICIA, { hoy: HOY })
    if (!r.ok) throw new Error(r.error)
    const res = resumenExtraccion(r.extraccion)
    expect(res).toMatchObject({ tarifas: 3, temporadas: 2, moneda: 'COP', canal: 'neta_mayorista', ivaDeclarado: true, ivaIncluido: false, advertencias: 1 })
    expect(res.decisiones).toEqual({ usar: 1, vencido_sin_reemplazo: 1, excluir_bancario: 1 })
    expect(res.pedir).toEqual(['Tarifa de temporada media 2027: no trae fechas.'])
    expect(sugerenciasParaFicha(res)).toEqual({ tarifaCanal: 'neta', ivaDeclarado: true, ivaIncluido: false })
    // «iva_declarado: false» del motor = el documento no lo dice: no se propone «no cobra».
    expect(sugerenciasParaFicha({ canal: 'publica', ivaDeclarado: false, ivaIncluido: false })).toEqual({ tarifaCanal: null, ivaDeclarado: null, ivaIncluido: null })
  })
})

/** Una extracción 0.3 inventada (cadena ficticia con dos hoteles y moneda por fila). */
function v03(cambios: { tarifario?: Record<string, unknown>; expediente?: Record<string, unknown> } = {}) {
  return {
    esquema_version: '0.3',
    expediente: { archivos: [{ archivo: 'tar0_TARIFAS CADENA 2027.pdf', decision: 'usar' }], pedir_actualizacion: [], ...cambios.expediente },
    tarifario: {
      moneda: 'COP',
      vigencia: { desde: '2027-01-01', hasta: '2027-12-31', texto: 'Vigencia 2027', fuente: 'contenido', requiere_confirmacion: false },
      temporadas: [{ id: 'T1', nombre: 'Alta', vigente: true, rangos: [{ desde: '2027-06-15', hasta: '2027-07-15' }] }],
      tarifas: [
        { establecimiento: 'Hotel Ficticio Centro', categoria: 'Estándar', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000, moneda: 'COP' },
        { establecimiento: 'Hotel Ficticio Playa', categoria: 'Suite', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 150, moneda: 'USD' },
      ],
      ...cambios.tarifario,
    },
  }
}

describe('esquema 0.3 y chequeos de la torre', () => {
  it('acepta 0.3 con moneda por fila y resume monedas y establecimientos', () => {
    const r = revisarExtraccion(v03(), { hoy: HOY })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.extraccion.avisos).toEqual([])
    const res = resumenExtraccion(r.extraccion)
    expect(res.monedas).toEqual(['COP', 'USD'])
    expect(res.establecimientos).toEqual(['Hotel Ficticio Centro', 'Hotel Ficticio Playa'])
    expect(res.vigencia).toEqual({ desde: '2027-01-01', hasta: '2027-12-31', texto: 'Vigencia 2027', fuente: 'contenido', requiereConfirmacion: false })
  })

  it('una fila 0.3 sin moneda es error (en 0.2 no)', () => {
    const sinMoneda = v03({ tarifario: { tarifas: [{ categoria: 'Estándar', precio: 100000 }, { categoria: 'Suite', precio: 200000, moneda: 'COP' }] } })
    expect(revisarExtraccion(sinMoneda, { hoy: HOY })).toMatchObject({ ok: false, errores: ['1 fila sin moneda (esquema 0.3).'] })
    expect(revisarExtraccion({ ...sinMoneda, esquema_version: '0.2' }, { hoy: HOY }).ok).toBe(true)
    expect(revisarExtraccion(v03({ tarifario: { tarifas: [{ precio: 1, moneda: 'ARS' }] } }), { hoy: HOY })).toMatchObject({ ok: false, error: expect.stringMatching(/ARS/) })
  })

  it('la vigencia 0.3 trae una fuente conocida; sin fechas o por confirmar avisa', () => {
    expect(revisarExtraccion(v03({ tarifario: { vigencia: { desde: null, hasta: null, fuente: 'adivinada' } } }), { hoy: HOY })).toMatchObject({ ok: false, error: expect.stringMatching(/fuente/) })
    const sinFechas = revisarExtraccion(v03({ tarifario: { vigencia: { desde: null, hasta: null, texto: null, fuente: 'ninguna', requiere_confirmacion: true } } }), { hoy: HOY })
    expect(sinFechas).toMatchObject({ ok: true, extraccion: { avisos: ['Vigencia por confirmar al cargar.'] } })
    expect(vigenciaPorConfirmar({ vigencia: { desde: '2027-01-01', hasta: '2027-12-31', fuente: 'nombre_archivo', requiere_confirmacion: true } })).toBe(true)
    expect(vigenciaPorConfirmar({ vigencia: { desde: '2027-01-01', hasta: null } })).toBe(true)
    expect(vigenciaPorConfirmar({ vigencia: { desde: '2027-01-01', hasta: '2027-12-31', requiere_confirmacion: false } })).toBe(false)
  })

  it('datos prohibidos: correo y cuenta frenan; un celular solo avisa', () => {
    const conCorreo = v03({ tarifario: { condiciones: { pago: 'Escribir a reservas@hotel-ficticio.com' } } })
    expect(revisarExtraccion(conCorreo, { hoy: HOY })).toMatchObject({ ok: false, error: expect.stringMatching(/correo/) })
    const conCuenta = v03({ tarifario: { condiciones: { pago: 'Consignar en cuenta de ahorros No. 123456789' } } })
    expect(revisarExtraccion(conCuenta, { hoy: HOY })).toMatchObject({ ok: false, error: expect.stringMatching(/cuenta/) })
    const conCelular = v03({ tarifario: { condiciones: { pago: 'Confirmar al 310 123 4567' } } })
    expect(revisarExtraccion(conCelular, { hoy: HOY })).toMatchObject({ ok: true, extraccion: { avisos: ['Posible celular en la extracción.'] } })
  })

  it('las decisiones del expediente son las de la instrucción', () => {
    const r = revisarExtraccion(v03({ expediente: { archivos: [{ archivo: 'a.pdf', decision: 'usar' }, { archivo: 'b.pdf', decision: 'descartar_por_reemplazo' }, { archivo: 'c.pdf' }] } }), { hoy: HOY })
    expect(r).toMatchObject({ ok: false, error: 'Decisión inválida en el expediente: descartar_por_reemplazo, vacía.' })
  })

  it('L48: una temporada vencida con un rango que aún no termina es error; con todos pasados, no', () => {
    const temporadas = [
      { id: 'T1', nombre: 'Alta', vigente: false, rangos: [{ desde: '2026-03-29', hasta: '2026-04-05' }, { desde: '2026-12-15', hasta: '2027-01-15' }] },
      { id: 'T2', nombre: 'Baja', vigente: false, rangos: [{ desde: '2026-01-16', hasta: '2026-03-28' }] },
    ]
    expect(temporadasMalVencidas({ temporadas }, HOY)).toEqual(['Alta'])
    expect(revisarExtraccion(v03({ tarifario: { temporadas } }), { hoy: HOY })).toMatchObject({ ok: false, error: expect.stringMatching(/L48.*Alta/) })
    // Un rango que termina HOY sigue vigente.
    expect(temporadasMalVencidas({ temporadas: [{ nombre: 'Media', vigente: false, rangos: [{ hasta: HOY }] }] }, HOY)).toEqual(['Media'])
    expect(revisarExtraccion(v03({ tarifario: { temporadas: [temporadas[1]] } }), { hoy: HOY }).ok).toBe(true)
  })

  it('L60: un total de grupo que cae a menos del 70 % marca; un descuento normal por persona no', () => {
    const tour = (pax: number, precio: number, extra: Record<string, unknown> = {}) => ({ categoria: 'Tour ficticio', servicio: 'tour', pax_min: pax, base_precio: 'por_persona', tipo_pasajero: 'adulto', precio, moneda: 'COP', ...extra })
    // 1 pax 300.000 (total 300.000) → 2 pax 100.000 c/u (total 200.000 = 67 %): el de 2 pax es un total de grupo leído por persona.
    const malo = [tour(1, 300000), tour(2, 100000)]
    expect(escalonesIncoherentes(malo)).toEqual(['Tour ficticio'])
    expect(revisarExtraccion(v03({ tarifario: { tarifas: malo } }), { hoy: HOY })).toMatchObject({ ok: false, error: expect.stringMatching(/L60/) })
    // Precio por persona que baja con descuento normal: el total sube.
    expect(escalonesIncoherentes([tour(1, 200000), tour(2, 160000), tour(4, 120000), tour(8, 90000)])).toEqual([])
    // Justo en el 70 % no marca (la torre exige «menos del 70 %»).
    expect(escalonesIncoherentes([tour(1, 200000), tour(2, 70000)])).toEqual([])
    // Por grupo: el precio ya es el total.
    expect(escalonesIncoherentes([tour(1, 300000, { base_precio: 'por_grupo' }), tour(4, 250000, { base_precio: 'por_grupo' })])).toEqual([])
    expect(escalonesIncoherentes([tour(1, 300000, { base_precio: 'por_grupo' }), tour(4, 150000, { base_precio: 'por_grupo' })])).toEqual(['Tour ficticio'])
  })

  it('L60 copia las exclusiones de la torre', () => {
    const fila = (pax: number, precio: number, extra: Record<string, unknown> = {}) => ({ categoria: 'X', pax_min: pax, base_precio: 'por_persona', precio, ...extra })
    // Niños: no se comparan.
    expect(escalonesIncoherentes([fila(1, 300000, { tipo_pasajero: 'nino' }), fila(2, 10000, { tipo_pasajero: 'nino' })])).toEqual([])
    // Bases por habitación, vehículo o trayecto: no se comparan.
    for (const base_precio of ['por_habitacion_noche', 'por_vehiculo_trayecto', 'por_trayecto_total']) {
      expect(escalonesIncoherentes([fila(1, 300000, { base_precio }), fila(2, 10000, { base_precio })])).toEqual([])
    }
    // Dos filas en el mismo escalón: la llave no separa variantes, no se compara.
    expect(escalonesIncoherentes([fila(1, 300000), fila(1, 280000), fila(2, 10000)])).toEqual([])
    // Llaves distintas (otro establecimiento) no se mezclan.
    expect(escalonesIncoherentes([fila(1, 300000, { establecimiento: 'A' }), fila(2, 10000, { establecimiento: 'B' })])).toEqual([])
    // Sin tipo de pasajero sí cuenta (como adulto).
    expect(escalonesIncoherentes([fila(1, 300000), fila(2, 10000)])).toEqual(['X'])
  })
})
