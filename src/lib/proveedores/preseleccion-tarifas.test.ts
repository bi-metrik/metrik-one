import { describe, expect, it } from 'vitest'

import { ofrecerTarifas } from './oferta-tarifas'
import { alternarFila, cupoDeFila, gruposDeTarifas, preseleccion, totalDeFila } from './preseleccion-tarifas'
import { cubreFechas, tarifasCitables, tarifasCitablesPorProveedor } from './tarifas-citables'
import { tarifasParaCotizar } from './tarifas-extraidas'

type Fila = Record<string, unknown>
const fila = (x: Fila) => ({ moneda: 'COP', establecimiento: null, archivo: 'Ficticio.pdf', fuente: { pagina: 1 }, ...x })
function oferta(tarifas: Fila[], composicion = { adultos: 2, ninos: 0, infantes: 0 }, entrada = '2027-02-01', salida: string | null = '2027-02-04', temporadas: Fila[] = []) {
  const tarifario = { canal: 'neta', temporadas, tarifas: tarifas.map(fila) }
  const u = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario, monedas: null }, null)
  if (!u.ok) throw new Error(u.motivo)
  return { ...ofrecerTarifas({ usables: u.tarifas, tarifario, composicion, entrada, salida }), composicion }
}

describe('lo que viene marcado al abrir (punto 3)', () => {
  it('una fila por tipo de pasajero: se marca sola, con lo que propone ONE', () => {
    const o = oferta([
      { categoria: 'Tour', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 },
      { categoria: 'Tour', base_precio: 'por_persona', tipo_pasajero: 'nino', precio: 60000 },
    ], { adultos: 2, ninos: 1, infantes: 0 }, '2027-02-01', null)
    const p = preseleccion(o.opciones, o.composicion, o.calendario)
    expect(p.como).toBe('unica')
    expect(p.marcadas).toEqual({ 0: { indice: 0, cantidad: 2, noches: null, tipo: 'adulto' }, 1: { indice: 1, cantidad: 1, noches: null, tipo: 'nino' } })
  })

  it('varias para el mismo pasajero: gana la de menor total; se puede cambiar', () => {
    const o = oferta([
      { categoria: 'Superior', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 380000 },
      { categoria: 'Estándar', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000 },
    ])
    const p = preseleccion(o.opciones, o.composicion, o.calendario)
    expect(p.como).toBe('mas_barata')
    expect(Object.keys(p.marcadas)).toEqual(['1'])
    expect(p.marcadas[1]).toMatchObject({ cantidad: 1, noches: 3 })
  })

  it('las filtradas (otra temporada) y las sin base de precio no se marcan', () => {
    const o = oferta(
      [
        { categoria: 'Estándar', temporada_id: 'A', base_precio: 'por_habitacion_noche', ocupacion: 'doble', precio: 100 },
        { categoria: 'Estándar', temporada_id: 'B', base_precio: 'por_habitacion_noche', ocupacion: 'doble', precio: 50 },
        { categoria: 'Sin base', precio: 10 },
      ],
      undefined, '2027-02-01', '2027-02-04',
      [{ id: 'A', nombre: 'Baja', rangos: [{ desde: '2027-01-01', hasta: '2027-03-01' }] }, { id: 'B', nombre: 'Alta', rangos: [{ desde: '2027-06-01', hasta: '2027-07-01' }] }],
    )
    expect(Object.keys(preseleccion(o.opciones, o.composicion, o.calendario).marcadas)).toEqual(['0'])
  })

  it('con filas por persona para adulto, la elección va por persona; sin ellas, por el total', () => {
    const o = oferta([
      { categoria: 'Grupo', base_precio: 'por_grupo', precio: 50000 },
      { categoria: 'Persona', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 40000 },
    ])
    expect(Object.keys(preseleccion(o.opciones, o.composicion, o.calendario).marcadas)).toEqual(['1'])
  })

  it('no mezcla monedas: la más barata manda la moneda', () => {
    const o = oferta([
      { categoria: 'COP', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 400000 },
      { categoria: 'USD', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 90, moneda: 'USD' },
      { categoria: 'Niño COP', base_precio: 'por_persona', tipo_pasajero: 'nino', precio: 1000 },
    ], { adultos: 2, ninos: 1, infantes: 0 }, '2027-02-01', null)
    const p = preseleccion(o.opciones, o.composicion, o.calendario)
    const monedas = Object.keys(p.marcadas).map((k) => o.opciones.find((x) => x.indice === Number(k))!.moneda)
    expect(new Set(monedas).size).toBe(1)
  })
})

describe('marcar reemplaza, nunca suma (la elección no deja dos para el mismo pasajero)', () => {
  const o = oferta([
    { categoria: 'Bahía', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 },
    { categoria: 'Islas', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 150000 },
    { categoria: 'Niño', base_precio: 'por_persona', tipo_pasajero: 'nino', precio: 60000 },
  ], { adultos: 2, ninos: 1, infantes: 0 }, '2027-02-01', null)

  it('otra del mismo pasajero reemplaza; la de otro pasajero se queda', () => {
    let m = alternarFila({}, o.opciones[0], o.opciones, o.composicion, o.calendario)
    m = alternarFila(m, o.opciones[2], o.opciones, o.composicion, o.calendario)
    m = alternarFila(m, o.opciones[1], o.opciones, o.composicion, o.calendario)
    expect(Object.keys(m).sort()).toEqual(['1', '2'])
    expect(cupoDeFila(o.opciones[0], o.calendario)).toBe(cupoDeFila(o.opciones[1], o.calendario))
  })

  it('tocar la marcada la desmarca', () => {
    const m = alternarFila({ 0: { indice: 0 } }, o.opciones[0], o.opciones, o.composicion, o.calendario)
    expect(m).toEqual({})
  })
})

describe('el total de cada tarjeta y los grupos', () => {
  it('«2 × $105.000 = $210.000»; una habitación por noche lleva sus noches', () => {
    const tour = oferta([{ categoria: 'Tour', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 }], undefined, '2027-02-01', null)
    expect(totalDeFila(tour.opciones[0], tour.composicion, tour.calendario)).toEqual({ subtotal: 210000, texto: '2 × $105.000 = $210.000' })
    const hotel = oferta([{ categoria: 'Doble', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000 }])
    expect(totalDeFila(hotel.opciones[0], hotel.composicion, hotel.calendario)).toEqual({ subtotal: 900000, texto: '1 × 3 noches × $300.000 = $900.000' })
    const grupo = oferta([{ categoria: 'Lancha', base_precio: 'por_grupo', precio: 500000 }])
    expect(totalDeFila(grupo.opciones[0], grupo.composicion, grupo.calendario)?.texto).toBe('$500.000')
  })

  it('agrupa por habitación (categoría) y plan, en el orden del tarifario', () => {
    const o = oferta([
      { categoria: 'Doble', plan: 'Desayuno', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 1 },
      { categoria: 'Suite', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 2 },
      { categoria: 'Doble', plan: 'Desayuno', base_precio: 'por_persona_noche', tipo_pasajero: 'nino', precio: 3 },
    ])
    expect(gruposDeTarifas(o.opciones).map((g) => [g.titulo, g.opciones.map((x) => x.indice)])).toEqual([['Doble · Desayuno', [0, 2]], ['Suite', [1]]])
  })
})

describe('qué proveedor se puede citar: el criterio único del buscador y de Proveedores (puntos 1 y 4)', () => {
  const x = (estado: string, created_at: string, desde: string | null = '2027-01-01', hasta: string | null = '2027-12-31') => ({ proveedor_id: 'p', estado, created_at, vigencia_desde: desde, vigencia_hasta: hasta })

  it('con revisada: citable; solo borrador: no, pero «por revisar»; nada: no', () => {
    expect(tarifasCitables([x('revisada', '2026-10-01')])).toMatchObject({ citable: true, porRevisar: false })
    expect(tarifasCitables([x('borrador', '2026-10-01', null, null)])).toMatchObject({ citable: false, porRevisar: true })
    expect(tarifasCitables([])).toMatchObject({ citable: false, porRevisar: false })
  })

  it('un borrador más nuevo que la revisada: sigue citable, con «por revisar»', () => {
    expect(tarifasCitables([x('revisada', '2026-10-01'), x('borrador', '2026-10-05', null, null)])).toMatchObject({ citable: true, porRevisar: true })
  })

  it('con fechas del viaje: cubre o no cubre; sin fechas, no se sabe', () => {
    expect(tarifasCitables([x('revisada', 't')], { inicio: '2027-02-01', fin: '2027-02-04' }).cubre).toBe(true)
    expect(tarifasCitables([x('revisada', 't')], { inicio: '2027-12-30', fin: '2028-01-02' }).cubre).toBe(false)
    expect(tarifasCitables([x('revisada', 't')]).cubre).toBeNull()
    expect(cubreFechas({ desde: '2027-01-01', hasta: '2027-12-31' }, { inicio: '2027-05-05', fin: null })).toBe(true)
  })

  it('la sucursal de una cadena toma las extracciones de la cadena', () => {
    const m = tarifasCitablesPorProveedor([{ id: 'suc', tarifario_de_id: 'cad' }, { id: 'sola' }], [{ ...x('revisada', 't'), proveedor_id: 'cad' }])
    expect(m.get('suc')?.citable).toBe(true)
    expect(m.get('sola')?.citable).toBe(false)
  })
})
