import { describe, expect, it } from 'vitest'

import { ajustesPorDefecto, fechaDeActividadNueva, lecturaDeTarifa, ofrecerTarifas, revisarAjustes, textoPax, calcularEleccion } from './oferta-tarifas'
import { gruposDeTarifas, preseleccion, totalDeFila } from './preseleccion-tarifas'
import { tarifasParaCotizar } from './tarifas-extraidas'
import { definicionDeTipo } from '@/lib/cotizaciones/ranuras-cotizacion'

// Prueba del #1229 (2026-10-21): datos FICTICIOS, ningún proveedor ni precio real.
type Fila = Record<string, unknown>
const fila = (x: Fila) => ({ moneda: 'COP', establecimiento: null, archivo: 'Ficticio.pdf', fuente: { pagina: 1 }, ...x })
function oferta(tarifas: Fila[], composicion = { adultos: 2, ninos: 0, infantes: 0 }, entrada = '2027-02-01', salida: string | null = '2027-02-04', temporadas: Fila[] = [], extra: Fila = {}) {
  const tarifario = { canal: 'neta', temporadas, tarifas: tarifas.map(fila), ...extra }
  const u = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario, monedas: null }, null)
  if (!u.ok) throw new Error(u.motivo)
  return { ...ofrecerTarifas({ usables: u.tarifas, tarifario, composicion, entrada, salida }), composicion, tarifario }
}

// Un operador ficticio con tres actividades distintas: la más barata (el tour nocturno) era la
// que se marcaba sola en la prueba.
const operador = () => oferta(
  [
    { categoria: 'PLAYA FICTICIA', plan: 'CA', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 95000 },
    { categoria: 'ISLA INVENTADA', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 140000 },
    { categoria: 'TOUR NOCTURNO FICTICIO', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 33000 },
  ],
  { adultos: 2, ninos: 0, infantes: 0 }, '2027-02-01', null, [],
  { planes: [{ codigo: 'CA', nombre: 'con almuerzo', incluye: ['ALMUERZO TÍPICO', 'Transporte en lancha'] }] },
)

describe('preselección solo dentro de un mismo servicio (punto 1)', () => {
  it('un operador con 3 actividades distintas NO preselecciona ninguna fila', () => {
    const o = operador()
    expect(preseleccion(o.opciones, o.composicion, o.calendario)).toEqual({ marcadas: {}, como: 'varios_servicios', servicios: 3 })
  })

  it('un hotel con una fila por tipo de pasajero SÍ preselecciona, con el total correcto', () => {
    const o = oferta([
      { categoria: 'Doble Estándar', plan: 'Desayuno', ocupacion: 'doble', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 150000 },
      { categoria: 'Doble Estándar', plan: 'Desayuno', base_precio: 'por_persona_noche', tipo_pasajero: 'nino', precio: 70000 },
      { categoria: 'Doble Estándar', plan: 'Desayuno', base_precio: 'por_persona_noche', tipo_pasajero: 'infante', precio: 0 },
    ], { adultos: 2, ninos: 1, infantes: 1 })
    const p = preseleccion(o.opciones, o.composicion, o.calendario)
    expect(p.como).toBe('unica')
    expect(Object.keys(p.marcadas).sort()).toEqual(['0', '1', '2'])
    const c = calcularEleccion({ opciones: o.opciones, eleccion: { filas: Object.values(p.marcadas) }, composicion: o.composicion, calendario: o.calendario, ajustes: { canal: 'neta', comisionPct: null, ivaIncluido: false, ivaPct: null } })
    // 2 adultos × 3 noches × 150.000 + 1 niño × 3 × 70.000 + el infante en 0
    expect(c.ok && c.calculo.total).toBe(900000 + 210000)
    expect(Object.values(p.marcadas).map((m) => totalDeFila(o.opciones[m.indice], o.composicion, o.calendario, m)!.subtotal)).toEqual([900000, 210000, 0])
  })

  it('una doble y una triple de la misma habitación son dos servicios: no se marca nada', () => {
    const o = oferta([
      { categoria: 'Estándar', ocupacion: 'doble', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 150000 },
      { categoria: 'Estándar', ocupacion: 'triple', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 120000 },
    ])
    expect(preseleccion(o.opciones, o.composicion, o.calendario).como).toBe('varios_servicios')
  })

  it('el mismo tour en dos temporadas, sin fechas para filtrar: es un solo servicio', () => {
    const o = oferta([
      { categoria: 'Tour', temporada_id: 'A', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 100 },
      { categoria: 'Tour', temporada_id: 'B', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 90 },
    ], undefined, '2027-02-01', null, [{ id: 'A', nombre: 'Baja' }, { id: 'B', nombre: 'Alta' }])
    expect(preseleccion(o.opciones, o.composicion, o.calendario).como).toBe('mas_barata')
  })

  it('los grupos se titulan con el nombre completo, sin todo en mayúscula', () => {
    const o = operador()
    expect(gruposDeTarifas(o.opciones).map((g) => g.titulo)).toEqual(['Playa Ficticia con almuerzo', 'Isla Inventada', 'Tour Nocturno Ficticio'])
  })
})

describe('el nombre completo y lo que incluye llegan al documento (punto 2)', () => {
  const o = oferta(
    [{ categoria: 'PLAYA FICTICIA', plan: 'CON ALMUERZO', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 95000 }],
    { adultos: 2, ninos: 0, infantes: 0 }, '2027-02-01', null, [],
    { planes: [{ codigo: 'CA', nombre: 'CON ALMUERZO', incluye: ['ALMUERZO TÍPICO', 'Transporte en lancha'] }] },
  )
  const ranura = definicionDeTipo('actividad')
  const c = calcularEleccion({ opciones: o.opciones, eleccion: { filas: [{ indice: 0 }] }, composicion: o.composicion, calendario: o.calendario, ajustes: { canal: 'neta', comisionPct: null, ivaIncluido: false, ivaPct: null } })
  if (!c.ok) throw new Error(c.error)
  const l = lecturaDeTarifa({ ranura, calculo: c.calculo, elegidas: o.opciones, proveedor: { nombre: 'Operador Ficticio', ciudad: 'Ciudad Inventada' }, composicion: o.composicion, entrada: null, salida: null, leidaEn: '2027-01-01T00:00:00Z' })

  it('la línea se llama con la fila completa, en capitalización normal', () => {
    expect(l.nombre).toBe('Playa Ficticia con almuerzo')
    expect(l.campos.find((x) => x.label === 'Actividad')?.valor).toBe('Playa Ficticia con almuerzo')
  })

  it('lo que incluye va en la descripción y en las notas para el cliente', () => {
    expect(l.descripcion).toBe('Incluye: almuerzo típico y transporte en lancha.')
    expect(l.notasCliente).toEqual(['Incluye: almuerzo típico y transporte en lancha.'])
  })
})

describe('IVA sin respaldo (punto 3)', () => {
  const ficha = { tarifaCanal: null, ivaIncluido: null, ivaDeclarado: null }
  it('un tarifario que no declara IVA deja iva_pct vacío', () => {
    expect(ajustesPorDefecto({ ficha, tarifario: { impuestos: { iva_declarado: false, iva_incluido: false, iva_pct: null } } }).ivaPct).toBeNull()
    expect(ajustesPorDefecto({ ficha, tarifario: {} }).ivaPct).toBeNull()
  })

  it('uno con IVA declarado lo conserva; la ficha que dice «cobra IVA» da el 19 general', () => {
    expect(ajustesPorDefecto({ ficha, tarifario: { impuestos: { iva_declarado: true, iva_pct: 5 } } }).ivaPct).toBe(5)
    expect(ajustesPorDefecto({ ficha, tarifario: { impuestos: { iva_declarado: true } } }).ivaPct).toBe(19)
    expect(ajustesPorDefecto({ ficha: { ...ficha, ivaDeclarado: true }, tarifario: {} }).ivaPct).toBe(19)
  })

  it('la ficha que dice «no cobra IVA» manda; el precio que ya trae IVA necesita su %', () => {
    expect(ajustesPorDefecto({ ficha: { ...ficha, ivaDeclarado: false }, tarifario: { impuestos: { iva_declarado: true, iva_pct: 19 } } }).ivaPct).toBeNull()
    expect(ajustesPorDefecto({ ficha, tarifario: { impuestos: { iva_incluido: true } } })).toMatchObject({ ivaIncluido: true, ivaPct: 19 })
  })

  it('revisar los ajustes: null se queda null; marcar «trae IVA» sin % toma el general', () => {
    const defecto = { canal: 'neta' as const, comisionPct: null, ivaIncluido: false, ivaPct: null }
    expect(revisarAjustes({ ivaPct: null }, defecto)).toEqual({ ok: true, ajustes: defecto })
    expect(revisarAjustes({ ivaIncluido: true }, defecto)).toEqual({ ok: true, ajustes: { ...defecto, ivaIncluido: true, ivaPct: 19 } })
  })
})

describe('menores', () => {
  it('(c) el escalón de pax se lee completo', () => {
    expect(textoPax(1, null)).toBe('desde 1 pax')
    expect(textoPax(2, 4)).toBe('2 a 4 pax')
    expect(textoPax(6, 6)).toBe('6 pax')
    expect(textoPax(null, 4)).toBe('hasta 4 pax')
    expect(textoPax(null, null)).toBeNull()
  })

  it('(e) el día de la actividad: la fecha de la fila o el único día del viaje', () => {
    expect(fechaDeActividadNueva([{ fechaSalida: '2027-02-02' }], { entrada: '2027-02-01', salida: '2027-02-04' })).toBe('2027-02-02')
    expect(fechaDeActividadNueva([{ fechaSalida: null }], { entrada: '2027-02-01', salida: '2027-02-01' })).toBe('2027-02-01')
    expect(fechaDeActividadNueva([{ fechaSalida: null }], { entrada: '2027-02-01', salida: '2027-02-04' })).toBeNull()
    expect(fechaDeActividadNueva([{ fechaSalida: '2027-02-02' }, { fechaSalida: '2027-02-03' }], { entrada: '2027-02-01', salida: '2027-02-01' })).toBeNull()
  })
})
