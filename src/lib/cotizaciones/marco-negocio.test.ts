import { describe, expect, it } from 'vitest'

import {
  cotizacionesAbiertas,
  encabezadoDelMarco,
  fechaCortaBogota,
  iataDelDestino,
  muestraCotizaciones,
  perfilDesdeCustomData,
  solicitudDesdeFilas,
  etiquetaDeValor,
} from './marco-negocio'
import type { LineaParaCobertura } from './cobertura-opciones'

function vuelo(id: string, destino: string, origen = 'Bogotá (BOG)'): LineaParaCobertura {
  return {
    id,
    grupo: 'vuelo',
    opcion_de: null,
    es_ajuste: false,
    orden: 0,
    tarifa_pax: {
      casillas: {
        grupo_completo: {
          moneda: 'COP', total: 1, aPagarAgencia: null, porTipo: [],
          ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
          ocupacionDelItem: false,
          identidad: { origen, destino, fecha_salida: '2026-11-09', fecha_regreso: '2026-11-13' },
          notasCliente: [], alertas: [], campos: [], nombre: 'x', descripcion: '', leidaEn: '2026-09-23T00:00:00Z',
        },
      },
    },
  }
}

describe('iataDelDestino', () => {
  it('toma el código del vuelo que llega a la ciudad del destino, sin tildes ni mayúsculas', () => {
    expect(iataDelDestino('san andres', [vuelo('a', 'San Andrés (ADZ)')])).toBe('ADZ')
    expect(iataDelDestino('Orlando', [vuelo('a', 'Orlando MCO')])).toBe('MCO')
  })

  it('un vuelo a otra ciudad no le da código al destino (Providencia vía San Andrés)', () => {
    expect(iataDelDestino('Providencia', [vuelo('a', 'San Andrés (ADZ)')])).toBeNull()
  })

  it('el regreso no cuenta: llega al origen, no al destino', () => {
    expect(iataDelDestino('Bogotá', [vuelo('a', 'San Andrés (ADZ)', 'Bogotá (BOG)')])).toBeNull()
  })

  it('sin vuelos o sin destino, sin código', () => {
    expect(iataDelDestino('Cartagena', [])).toBeNull()
    expect(iataDelDestino(null, [vuelo('a', 'Cartagena (CTG)')])).toBeNull()
  })
})

describe('encabezadoDelMarco', () => {
  const viaje = {
    destino: 'San Andrés',
    fechas: { inicio: '2026-11-09', fin: '2026-11-13' },
    composicion: { adultos: 2, ninos: 1, infantes: 0 },
  }

  it('pone el IATA junto al destino cuando lo hay', () => {
    const e = encabezadoDelMarco(viaje, 'ADZ')
    expect(e.resumen.startsWith('San Andrés · ADZ · 9 al 13 nov 2026')).toBe(true)
    expect(e.motivo).toBeNull()
  })

  it('sin IATA, el nombre solo', () => {
    expect(encabezadoDelMarco(viaje, null).resumen.startsWith('San Andrés · 9 al 13 nov 2026')).toBe(true)
  })

  it('conserva el ámbar de P9 cuando faltan fechas', () => {
    const e = encabezadoDelMarco({ ...viaje, fechas: { inicio: null, fin: null } }, 'ADZ')
    expect(e.motivo).toBe('Faltan las fechas del viaje en el negocio')
  })
})

describe('perfilDesdeCustomData', () => {
  it('traduce las opciones y deja fuera el documento y la autorización', () => {
    const p = perfilDesdeCustomData({
      tipo_cliente: 'leisure',
      rango_presupuesto: 'medio',
      con_quien_viaja: 'ESPOSA E HIJO',
      preferencias: 'TODO INCLUIDO',
      notas_perfil: 'Viajes tranquilos',
      documento_identidad: '1016044186',
      autorizacion_datos: true,
    })
    expect(p).toEqual({
      tipo: 'Leisure',
      conQuienViaja: 'ESPOSA E HIJO',
      bolsillo: 'Medio',
      preferencias: 'TODO INCLUIDO',
      notas: 'Viajes tranquilos',
    })
    expect(JSON.stringify(p)).not.toContain('1016044186')
  })

  it('«sin declarar» no es un bolsillo', () => {
    expect(perfilDesdeCustomData({ rango_presupuesto: 'sin declarar', tipo_cliente: 'corporativo' })?.bolsillo).toBeNull()
  })

  it('sin perfil devuelve null', () => {
    expect(perfilDesdeCustomData({})).toBeNull()
    expect(perfilDesdeCustomData(null)).toBeNull()
    expect(perfilDesdeCustomData({ documento_identidad: '1' })).toBeNull()
  })
})

describe('solicitudDesdeFilas', () => {
  // Campos como los declara la config de la línea (datos ficticios): select con `opciones` o con `options`.
  const CAMPOS = [
    { slug: 'destino_tipo', tipo: 'select', options: ['nacional', 'internacional'] },
    { slug: 'tipo_viaje', tipo: 'select', opciones: [{ value: 'playa', label: 'Playa' }, { value: 'naturaleza_aventura', label: 'Naturaleza y aventura' }] },
    { slug: 'fechas_tipo', tipo: 'select', opciones: [{ value: 'fijas', label: 'Fechas fijas' }, { value: 'moviles', label: 'Fechas móviles' }] },
    { slug: 'flexibilidad_fecha', tipo: 'select', opciones: [{ value: 'fines_de_semana', label: 'Solo fines de semana' }] },
    { slug: 'presupuesto', tipo: 'select', opciones: [{ value: '5m_8m', label: 'Entre $5 y $8 millones' }] },
    { slug: 'categoria_hotel', tipo: 'select', opciones: [{ value: '4', label: '4 estrellas' }] },
    { slug: 'plan_alimentacion', tipo: 'select', opciones: [{ value: 'todo_incluido', label: 'Todo incluido' }] },
    { slug: 'equipaje', tipo: 'select', opciones: [{ value: 'bodega', label: 'Maleta de bodega' }] },
    { slug: 'permiso_salida_menores', tipo: 'select', opciones: [{ value: 'tramitado', label: 'Ya lo tienen' }] },
    { slug: 'ciudad_origen', tipo: 'texto' },
    { slug: 'acomodacion', tipo: 'texto' },
  ]
  const VIAJE = { destino: 'Isla Ficticia', fechas: { inicio: '2026-12-01', fin: '2026-12-08' }, composicion: { adultos: 2, ninos: 1, infantes: 0 } }
  const COMPLETA = {
    destino_tipo: 'internacional', tipo_viaje: 'playa', ciudad_origen: 'Medellín', fechas_tipo: 'moviles', flexibilidad_fecha: 'fines_de_semana',
    edades_menores: '9', composicion: 'Pareja con su hijo', presupuesto: '5m_8m', categoria_hotel: 4, plan_alimentacion: 'todo_incluido',
    acomodacion: 'Una habitación triple', equipaje: 'bodega', permiso_salida_menores: 'tramitado', requisitos_especiales: 'Cuna y vista al mar',
    presentacion_destino: 'no entra', numero_pasajeros: 3,
  }

  it('las 12 filas en orden, con la etiqueta de cada opción', () => {
    const s = solicitudDesdeFilas([{}, COMPLETA], VIAJE, CAMPOS)
    expect(s.filas.map(f => [f.label, f.valor])).toEqual([
      ['Destino', 'Isla Ficticia · Internacional · Playa'],
      ['Sale de', 'Medellín'],
      ['Fechas', '1 al 8 dic 2026 · Fechas móviles · Solo fines de semana'],
      ['Pasajeros', '2 adultos, 1 niño'],
      ['Grupo', 'Pareja con su hijo'],
      ['Presupuesto', 'Entre $5 y $8 millones'],
      ['Hotel', '4 estrellas'],
      ['Alimentación', 'Todo incluido'],
      ['Acomodación', 'Una habitación triple'],
      ['Equipaje', 'Maleta de bodega'],
      ['Menores', 'Ya lo tienen'],
      ['Requisitos', 'Cuna y vista al mar'],
    ])
    expect(s.filas.find(f => f.clave === 'pasajeros')?.detalle).toBe('Edades: 9')
    expect(s.filas.filter(f => f.larga).map(f => f.clave)).toEqual(['grupo', 'acomodacion', 'requisitos'])
    expect(s.tienePresupuesto).toBe(true)
  })

  it('un valor sin opción que coincida: primera letra en mayúscula y «_» → espacio', () => {
    const s = solicitudDesdeFilas([{ plan_alimentacion: 'media_pension', tipo_viaje: 'crucero_fluvial' }], VIAJE, CAMPOS)
    expect(s.filas.find(f => f.clave === 'alimentacion')?.valor).toBe('Media pension')
    expect(s.filas.find(f => f.clave === 'destino')?.valor).toBe('Isla Ficticia · Crucero fluvial')
  })

  it('sin la config de los campos, un valor con cara de slug se humaniza y el texto libre va tal cual', () => {
    const s = solicitudDesdeFilas([{ plan_alimentacion: 'todo_incluido', requisitos_especiales: 'silla_de_ruedas y dieta' }], VIAJE)
    expect(s.filas.find(f => f.clave === 'alimentacion')?.valor).toBe('Todo incluido')
    expect(s.filas.find(f => f.clave === 'requisitos')?.valor).toBe('silla_de_ruedas y dieta')
  })

  it('en una fila combinada se omiten las partes vacías', () => {
    const s = solicitudDesdeFilas([{ fechas_tipo: 'fijas' }], { ...VIAJE, destino: null, fechas: { inicio: null, fin: null } }, CAMPOS)
    expect(s.filas.find(f => f.clave === 'destino')).toBeUndefined()
    expect(s.filas.find(f => f.clave === 'fechas')?.valor).toBe('Fechas fijas')
  })

  it('Menores solo si viajan niños o infantes; edades solo si las hay', () => {
    const solo = solicitudDesdeFilas([{ permiso_salida_menores: 'tramitado' }], { ...VIAJE, composicion: { adultos: 2, ninos: 0, infantes: 0 } }, CAMPOS)
    expect(solo.filas.find(f => f.clave === 'menores')).toBeUndefined()
    expect(solo.filas.find(f => f.clave === 'pasajeros')).toEqual({ clave: 'pasajeros', label: 'Pasajeros', valor: '2 adultos' })
  })

  it('el número de pasajeros solo como respaldo si falta la composición', () => {
    const s = solicitudDesdeFilas([{ numero_pasajeros: 4 }], { ...VIAJE, composicion: null }, CAMPOS)
    expect(s.filas.find(f => f.clave === 'pasajeros')?.valor).toBe('4 pasajeros')
    const con = solicitudDesdeFilas([{ numero_pasajeros: 9 }], VIAJE, CAMPOS)
    expect(con.filas.find(f => f.clave === 'pasajeros')?.valor).toBe('2 adultos, 1 niño')
  })

  it('vacía: sin filas y sin presupuesto (la tarjeta pinta el estado vacío)', () => {
    const s = solicitudDesdeFilas([{ presentacion_destino: 'texto', fecha_salida: '2026-12-01' }], { destino: null, fechas: { inicio: null, fin: null }, composicion: null }, CAMPOS)
    expect(s).toEqual({ filas: [], tienePresupuesto: false })
  })
})

describe('etiquetaDeValor', () => {
  it('opciones como pares o como lista de valores', () => {
    expect(etiquetaDeValor('a', { slug: 'x', opciones: [{ value: 'a', label: 'Uno' }] })).toBe('Uno')
    expect(etiquetaDeValor('nacional', { slug: 'x', options: ['nacional'] })).toBe('Nacional')
    expect(etiquetaDeValor('todo_incluido', { slug: 'x', opciones: [{ value: 'todo_incluido' }] })).toBe('Todo incluido')
    expect(etiquetaDeValor('texto libre', { slug: 'x', tipo: 'texto' })).toBe('texto libre')
  })
})

describe('cotizacionesAbiertas', () => {
  it('lista borrador, enviada y aceptada; deja fuera rechazada y vencida; la última editada primero', () => {
    const filas = [
      { id: '1', codigo: 'COT-1', estado: 'borrador', valor_total: 100, updated_at: '2026-09-20T10:00:00Z' },
      { id: '2', codigo: 'COT-2', estado: 'rechazada', valor_total: 100, updated_at: '2026-09-23T10:00:00Z' },
      { id: '3', codigo: 'COT-3', estado: 'enviada', valor_total: 200, updated_at: '2026-09-22T10:00:00Z' },
      { id: '4', codigo: 'COT-4', estado: 'vencida', valor_total: 100, updated_at: '2026-09-21T10:00:00Z' },
      { id: '5', codigo: null, consecutivo: 'COT-5', estado: 'aceptada', valor_total: null, updated_at: '2026-09-19T10:00:00Z' },
    ]
    expect(cotizacionesAbiertas(filas).map(c => c.codigo)).toEqual(['COT-3', 'COT-1', 'COT-5'])
  })
})

describe('muestraCotizaciones', () => {
  it('solo en las etapas 2 y 3', () => {
    expect(muestraCotizaciones({ nombre: 'Solicitud', stage: 'venta', numero: 1 })).toBe(false)
    expect(muestraCotizaciones({ nombre: 'Cotización', stage: 'venta', numero: 2 })).toBe(true)
    expect(muestraCotizaciones({ nombre: 'Seguimiento', stage: 'venta', numero: 3 })).toBe(true)
    expect(muestraCotizaciones({ nombre: 'Confirmación', stage: 'venta', numero: 4 })).toBe(false)
    expect(muestraCotizaciones(null)).toBe(false)
  })
})

describe('fechaCortaBogota', () => {
  it('usa la hora de Bogotá: las 2 a.m. UTC del 24 son el 23', () => {
    expect(fechaCortaBogota('2026-09-24T02:00:00Z')).toBe('23 sep')
    expect(fechaCortaBogota(null)).toBeNull()
  })
})
