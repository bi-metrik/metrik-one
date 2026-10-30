/**
 * «Otro servicio» (asistencia médica, seguro de viaje…), lo puro: el catálogo, el nombre de la
 * ranura, lo escrito a mano, la marca de asistencia médica y quién lo lee. Lo que toca la base
 * está en `por-pasos-otro-servicio-e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { esAsistenciaMedica, lineaConAsistenciaMedica, marcarAsistenciaMedica } from './asistencia-medica'
import { estadosPermitidos } from './estado-servicio'
import { incluyeDeOne } from './incluye-por-one'
import { crudaDeOtroServicioManual, lecturaManual, leerOtroServicioManual, validarOtroServicioManual } from './ingreso-manual'
import { esTipoConPantallazo, esTipoRanura, formaDesdeGrupo, grupoDeRanura, nombreAutomaticoDeRanura, TIPOS_CON_PANTALLAZO } from './ranuras-cotizacion'
import { etiquetaDeRanura, gruposCanonicos, grupoCombinable, ranuraDeGrupo, ranuraPorSlug, ranuraSoloPorPasos, resolverRanura } from './ranuras-pantallazo'
import { ubicarLectura } from './ubicar-lectura'
import { normalizarDeteccion, rescatarCortada } from '@/lib/ai/detectar-tipo-captura'
import { tipoDeServicio } from '@/lib/viaje/servicios-desde-tarifa'
import { asistenciasDelViaje, type FilaEntrega } from '@/lib/viaje/entrega'

const OTRO = ranuraPorSlug('otro_detalle')!
const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }

function leer(datos: Record<string, unknown>) {
  const r = lecturaManual({
    ranura: OTRO,
    entrada: { tipo: 'otro', datos: leerOtroServicioManual({ ...VIAJE, cobro: 'por_persona', ...datos }) },
    leidaEn: '2026-10-13T12:00:00.000Z',
    hoy: '2026-10-13',
    fuenteOpcional: true,
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

describe('el catálogo', () => {
  it('«otro» es un tipo de ranura, pero no de los que se detectan ni de los botones de siempre', () => {
    expect(esTipoRanura('otro')).toBe(true)
    expect(esTipoConPantallazo('otro')).toBe(false)
    // QA G9 (M9-1): el tren se detecta y tiene su botón, como los de siempre.
    expect(TIPOS_CON_PANTALLAZO).toEqual(['vuelo', 'hotel', 'actividad', 'traslado', 'tren'])
    expect(gruposCanonicos().map(g => g.grupo)).toEqual(['vuelo', 'hotel', 'actividad', 'traslado', 'tren'])
    expect(ranuraSoloPorPasos(OTRO)).toBe(true)
    expect(ranuraSoloPorPasos(ranuraPorSlug('hotel_detalle'))).toBe(false)
  })

  it('la detección del pantallazo nunca devuelve «otro», ni rescatada de una respuesta cortada', () => {
    expect(normalizarDeteccion({ tipo: 'otro', lugar: 'X' }).tipo).toBeNull()
    expect(normalizarDeteccion({ tipo: 'hotel', lugar: 'Cancún' }).tipo).toBe('hotel')
    expect(rescatarCortada('{"tipo": "otro"')).toBeNull()
  })

  it('sus grupos resuelven; los grupos libres de siempre («seguro», «asistencia») siguen sin ser ranura', () => {
    expect(formaDesdeGrupo('otro: Asistencia médica')).toEqual({ tipo: 'otro', numero: null, nombre: 'Asistencia médica' })
    expect(formaDesdeGrupo('otro 2: Seguro de viaje')).toEqual({ tipo: 'otro', numero: 2, nombre: 'Seguro de viaje' })
    expect(grupoDeRanura({ tipo: 'otro', numero: null, nombre: 'Asistencia médica' })).toBe('otro: Asistencia médica')
    for (const libre of ['seguro', 'asistencia', 'Asistencia médica', 'propina', 'dia-1', 'Otros']) expect(resolverRanura(libre), libre).toBeNull()
    expect(grupoCombinable('otro: Asistencia médica')).toBe(false)
  })

  it('se llama como lo que es, sin repetir el tipo', () => {
    expect(etiquetaDeRanura('otro: Asistencia médica')).toBe('Asistencia médica')
    expect(etiquetaDeRanura('otro')).toBe('Otro servicio')
    expect(etiquetaDeRanura('otro 2')).toBe('Otro servicio 2')
    // Los demás tipos, como siempre.
    expect(etiquetaDeRanura('hotel: Providencia')).toBe('Hotel · Providencia')
  })

  it('el nombre automático es el servicio en frase; el segundo igual lleva su número', () => {
    expect(nombreAutomaticoDeRanura({ tipo: 'otro', servicio: 'ASISTENCIA MÉDICA', lugar: 'San Andrés' })).toBe('Asistencia médica')
    expect(nombreAutomaticoDeRanura({ tipo: 'otro', servicio: 'Asistencia médica', numero: 3, nombresEnUso: ['Asistencia médica'] })).toBe('Asistencia médica 2')
    expect(nombreAutomaticoDeRanura({ tipo: 'otro', servicio: '', nombresEnUso: [] })).toBe('Otro servicio')
    expect(nombreAutomaticoDeRanura({ tipo: 'hotel', lugar: 'Cancún' })).toBe('Hotel en Cancún')
  })

  it('tiene «Opcional», como traslado y actividad; y cada uno suma aparte (nunca compite)', () => {
    expect(estadosPermitidos('otro: Seguro de viaje')).toEqual(['incluido', 'opcional', 'no'])
    const lectura = leer({ nombre: 'Seguro de viaje', neto: 50_000 })
    const lineas = [{ id: 'a', grupo: 'otro: Seguro de viaje', nombre: 'SEGURO DE VIAJE', tarifa_pax: { casillas: { grupo_completo: lectura } } }]
    expect(ubicarLectura({ tipo: 'otro', lectura, pistas: { lugar: null, origen: null, destino: null }, lineas, grupoViaje: VIAJE })).toEqual({ como: 'nueva' })
  })
})

describe('escrito a mano', () => {
  it('obligatorio: nombre y costo; los pasajeros se validan', () => {
    expect(Object.keys(validarOtroServicioManual(leerOtroServicioManual({ ...VIAJE }))).sort()).toEqual(['neto', 'nombre'])
    expect(validarOtroServicioManual(leerOtroServicioManual({ ...VIAJE, nombre: 'Seguro', neto: '10.000' }))).toEqual({})
    expect(validarOtroServicioManual(leerOtroServicioManual({ adultos: 0, ninos: 0, infantes: 0, nombre: 'Seguro', neto: '10.000' }))).toHaveProperty('adultos')
  })

  it('por persona: cada viajero (adulto, niño o infante) con el mismo costo', () => {
    const c = crudaDeOtroServicioManual(leerOtroServicioManual({ ...VIAJE, nombre: 'Asistencia médica', cobro: 'por_persona', neto: '45.000' }))
    expect(c.porTipoPax!.map(f => [f.tipo, f.cantidad, f.subtotal_tipo])).toEqual([['adulto', 6, 270_000], ['nino', 1, 45_000], ['infante', 1, 45_000]])
    expect(c.totalGeneral).toBe(360_000)
  })

  it('un valor por todo: se reparte entre los viajeros y suma exactamente lo escrito', () => {
    const c = crudaDeOtroServicioManual(leerOtroServicioManual({ ...VIAJE, nombre: 'Tarjeta de turismo', cobro: 'total', neto: '100.000' }))
    expect(c.porTipoPax!.reduce((a, f) => a + f.subtotal_tipo, 0)).toBe(100_000)
    expect(c.totalGeneral).toBe(100_000)
    expect(c.porTipoPax!.map(f => f.tipo)).toEqual(['adulto', 'nino', 'infante'])
  })

  it('la lectura queda «a mano», con su nombre y el proveedor en la descripción', () => {
    const l = leer({ nombre: 'Asistencia médica', proveedor: 'Assist Card, plan Básico', neto: 45_000 })
    expect(l).toMatchObject({ origen: 'manual', nombre: 'Asistencia médica', descripcion: 'Proveedor: Assist Card, plan Básico', total: 360_000, asistenciaMedica: true })
  })
})

describe('la marca de asistencia médica', () => {
  it('reconoce la asistencia médica y la asistencia al viajero; un seguro no', () => {
    for (const t of ['Asistencia médica', 'ASISTENCIA MEDICA', 'Asistencia al viajero Assist Card']) expect(esAsistenciaMedica(t), t).toBe(true)
    for (const t of ['Seguro de viaje', 'Tarjeta de turismo', 'asistencia', null]) expect(esAsistenciaMedica(t), String(t)).toBe(false)
  })

  it('solo marca un «otro servicio», y quita una marca que no corresponde', () => {
    const l = leer({ nombre: 'Asistencia médica', neto: 1 })
    expect(marcarAsistenciaMedica('actividad', { ...l }).asistenciaMedica).toBeUndefined()
    expect(marcarAsistenciaMedica('otro', { ...l, nombre: 'Seguro de viaje', asistenciaMedica: true }).asistenciaMedica).toBeUndefined()
    expect(leer({ nombre: 'Seguro de viaje', neto: 1 }).asistenciaMedica).toBeUndefined()
    expect(lineaConAsistenciaMedica({ tarifa_pax: { casillas: { grupo_completo: l } } })).toBe(true)
    expect(lineaConAsistenciaMedica({ tarifa_pax: null })).toBe(false)
  })

  it('en los servicios del viaje: la marcada es «asistencia»; otro servicio sin marca es «otro» (no se adivina por el texto)', () => {
    const asistencia = { grupo: 'otro: Asistencia médica', nombre: 'ASISTENCIA MÉDICA', tarifa_pax: { casillas: { grupo_completo: leer({ nombre: 'Asistencia médica', neto: 1 }) } } }
    const seguro = { grupo: 'otro 2: Seguro de viaje', nombre: 'SEGURO DE VIAJE', tarifa_pax: { casillas: { grupo_completo: leer({ nombre: 'Seguro de viaje', neto: 1 }) } } }
    expect(tipoDeServicio(asistencia, 'otro')).toBe('asistencia')
    expect(tipoDeServicio(seguro, 'otro')).toBe('otro')
    expect(tipoDeServicio(seguro)).toBe('otro')
    // Lo de siempre no cambia: una línea suelta «seguro» sigue siendo asistencia por su texto.
    expect(tipoDeServicio({ grupo: null, nombre: 'SEGURO MÉDICO' })).toBe('asistencia')
    expect(tipoDeServicio({ grupo: 'hotel', nombre: 'X' }, 'hotel')).toBe('hotel')
  })

  it('«Documentos del viajero» muestra sola la asistencia del viaje, con su proveedor', () => {
    const fila = (x: Partial<FilaEntrega>): FilaEntrega => ({ id: 'x', nombre: '', estado: 'pendiente', costo_cotizado: 1, valor_por_pagar: null, voucher_ref: null, gastos: [], ...x })
    expect(asistenciasDelViaje([
      fila({ id: 'a', tipo: 'asistencia', nombre: 'ASISTENCIA MÉDICA', proveedor_nombre: 'Assist Card' }),
      fila({ id: 'b', tipo: 'asistencia', nombre: 'SEGURO MÉDICO', voucher_ref: 'one://v' }),
      fila({ id: 'c', tipo: 'asistencia', nombre: 'Asistencia', estado: 'cancelado' }),
      fila({ id: 'd', tipo: 'otro', nombre: 'Seguro de viaje' }),
    ])).toEqual([
      { id: 'a', texto: 'Asistencia médica · Assist Card', tieneCertificado: false },
      { id: 'b', texto: 'Asistencia médica: Seguro médico', tieneCertificado: true },
    ])
  })
})

describe('«Incluye» armado por ONE', () => {
  it('dice el servicio y, salvo en «general», quién lo presta', () => {
    const l = leer({ nombre: 'Asistencia médica', proveedor: 'Assist Card, plan Básico', neto: 45_000 })
    const items = [{ id: 'a', nombre: 'ASISTENCIA MÉDICA', grupo: 'otro: Asistencia médica', descripcion: null, tarifa_pax: { casillas: { grupo_completo: l } } }]
    expect(incluyeDeOne(items as never, 'normal')).toEqual(['Asistencia médica (Assist Card, plan Básico)'])
    expect(incluyeDeOne(items as never, 'general')).toEqual(['Asistencia médica'])
    expect(ranuraDeGrupo(items[0].grupo)?.slug).toBe('otro_detalle')
  })
})
