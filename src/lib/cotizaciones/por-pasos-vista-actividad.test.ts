import { describe, expect, it } from 'vitest'

import { viajeEnOrden } from './por-pasos-vista'
import { calcularEleccion, lecturaDeTarifa, ofrecerTarifas } from '@/lib/proveedores/oferta-tarifas'
import { tarifasParaCotizar } from '@/lib/proveedores/tarifas-extraidas'
import { definicionDeTipo } from './ranuras-cotizacion'

// Prueba del #1229, punto d: la tarjeta de la actividad titulaba «Actividad en Santa Marta».
// Datos FICTICIOS.
function lecturaFicticia() {
  const tarifario = { canal: 'neta', tarifas: [{ moneda: 'COP', categoria: 'PLAYA FICTICIA', plan: 'CON ALMUERZO', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 95000 }] }
  const u = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario, monedas: null }, null)
  if (!u.ok) throw new Error(u.motivo)
  const composicion = { adultos: 2, ninos: 0, infantes: 0 }
  const o = ofrecerTarifas({ usables: u.tarifas, tarifario, composicion, entrada: '2027-02-01', salida: null })
  const c = calcularEleccion({ opciones: o.opciones, eleccion: { filas: [{ indice: 0 }] }, composicion, calendario: o.calendario, ajustes: { canal: 'neta', comisionPct: null, ivaIncluido: false, ivaPct: null } })
  if (!c.ok) throw new Error(c.error)
  return lecturaDeTarifa({ ranura: definicionDeTipo('actividad'), calculo: c.calculo, elegidas: o.opciones, proveedor: { nombre: 'Operador Ficticio', ciudad: 'Ciudad Inventada' }, composicion, entrada: null, salida: null, leidaEn: '2027-01-01T00:00:00Z' })
}

describe('el título de la tarjeta de una actividad (por pasos)', () => {
  it('con el nombre de la actividad, no «Actividad en …»; el lugar sigue saliendo del bloque', () => {
    const l = lecturaFicticia()
    const linea = { id: 'a1', grupo: 'actividad: Actividad en Ciudad Inventada', nombre: 'PLAYA FICTICIA CON ALMUERZO', orden: 1, tarifa_pax: { casillas: { grupo_completo: l } } }
    const tramos = viajeEnOrden([linea] as never, { destino: 'Ciudad Inventada', fechaInicio: '2027-02-01' })
    const s = tramos.flatMap((t) => t.servicios)[0]
    expect(s.nombre).toBe('Playa Ficticia con almuerzo')
    expect(s.lugar).toBe('Ciudad Inventada')
  })

  it('un bloque que alguien nombró se respeta', () => {
    const linea = { id: 'a1', grupo: 'actividad: Buceo ficticio', nombre: 'OTRO NOMBRE', orden: 1 }
    const tramos = viajeEnOrden([linea] as never, { destino: 'Ciudad Inventada', fechaInicio: '2027-02-01' })
    expect(tramos.flatMap((t) => t.servicios)[0].nombre).toBe('Buceo ficticio')
  })

  it('sin nombre propio en la opción («Opción 1»), queda el del bloque', () => {
    const linea = { id: 'a1', grupo: 'actividad: Actividad en Ciudad Inventada', nombre: 'Opción 1', orden: 1 }
    const tramos = viajeEnOrden([linea] as never, { destino: 'Ciudad Inventada', fechaInicio: '2027-02-01' })
    expect(tramos.flatMap((t) => t.servicios)[0].nombre).toBe('Actividad en Ciudad Inventada')
  })
})
