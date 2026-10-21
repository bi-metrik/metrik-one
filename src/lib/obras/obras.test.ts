/**
 * Lógica pura de las obras (parte web de la Fase 1 del asistente de obras).
 *
 * Lo que se fija: el formato de las cifras ($1.850.000), el cierre (utilidad «hasta hoy» y sus
 * avisos), la regla de marcar pagada (§6.3-d: con diferencia se pregunta; «no» no marca), que lo
 * retenido por cliente solo sume pagadas, las validaciones de los formularios y que el código
 * hable el mismo idioma que la migración (CHECK de categorías y el error del trigger de llegadas).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { horaParaCampo, numeroCorto, pesos, porcentaje, textoJornadas } from './formato'
import { AVISO_FALTAN_GASTOS, resumirCierre, rubrosDeCierre, type FilaCierreObra } from './cierre'
import {
  decidirMarcarPagada,
  diferenciaDeFactura,
  MENSAJE_DIFERENCIA_NO_ES_RETENCION,
  retenidoPorCliente,
  validarFactura,
  type FacturaObra,
} from './facturas'
import { horaDeLlegada, mensajeErrorLlegada, textoFraccion, validarLlegada } from './llegadas'
import { CATEGORIAS_FISCALES_RUBRO, MAX_NOMBRE_RUBRO, nombreRepetido, validarRubro } from './rubros'
import { normalizarTelefono, validarColaborador, validarValorJornada, valorVigente } from './colaboradores'
import { MAX_NOMBRE_CORTO, validarCondiciones } from './condiciones'
import { COLUMNAS_CSV, filasIngresos, filasJornadas, filasObras, filasPagos, filasRetenido } from './csv'
import { faltaMigracionObras, obrasActivas, puedeEditarObras, puedeVerObras } from './modulo'

const MIGRACION = readFileSync(join(process.cwd(), 'supabase/migrations/20261021183000_obras_asistente_wa.sql'), 'utf8')
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

describe('formato', () => {
  it('pesos colombianos sin decimales ni espacio', () => {
    expect(pesos(1850000)).toBe('$1.850.000')
    expect(pesos(0)).toBe('$0')
    expect(pesos(-25000000)).toBe('-$25.000.000')
    expect(pesos(999.6)).toBe('$1.000')
    expect(pesos(null)).toBe('$0')
    expect(pesos('abc')).toBe('$0')
  })
  it('porcentaje, jornadas y número corto', () => {
    expect(porcentaje(0.443)).toBe('44 %')
    expect(porcentaje(null)).toBe('—')
    expect(textoJornadas(1)).toBe('1 jornada')
    expect(textoJornadas(38)).toBe('38 jornadas')
    expect(textoJornadas(12.5)).toBe('12,5 jornadas')
    expect(numeroCorto(1500)).toBe('1.500')
  })
  it('la hora del campo se lee en Bogotá', () => {
    expect(horaParaCampo('2026-10-21T12:12:00Z')).toBe('07:12')
    expect(horaParaCampo('2026-10-21T07:05:00-05:00')).toBe('07:05')
  })
})

function fila(p: Partial<FilaCierreObra> = {}): FilaCierreObra {
  return {
    negocio_id: UUID_A,
    codigo: 'X1 26 1',
    nombre: 'Obra',
    nombre_corto: null,
    estado: 'abierto',
    empresa_id: null,
    vendido: 48000000,
    gastos_por_rubro: [
      { rubro: 'Materiales de obra', total: 14320000 },
      { rubro: 'transporte', total: 2100000 },
    ],
    gastos_total: 16420000,
    mano_obra: 5320000,
    jornadas: 38,
    jornadas_sin_valor: 0,
    utilidad: 26260000,
    facturado: 0,
    cobrado: 24000000,
    retenido: 0,
    saldo_facturas: 0,
    por_cobrar: 24000000,
    ...p,
  }
}

describe('cierre de obra', () => {
  it('mientras anda: «Utilidad hasta hoy» y el aviso de gastos faltantes', () => {
    const r = resumirCierre(fila())
    expect(r.cerrada).toBe(false)
    expect(r.tituloUtilidad).toBe('Utilidad hasta hoy')
    expect(r.avisos).toEqual([AVISO_FALTAN_GASTOS])
    expect(r.utilidadPct).toBeCloseTo(26260000 / 48000000)
  })
  it('cerrada: «Utilidad» y sin el aviso', () => {
    const r = resumirCierre(fila({ estado: 'completado' }))
    expect(r.cerrada).toBe(true)
    expect(r.tituloUtilidad).toBe('Utilidad')
    expect(r.avisos).not.toContain(AVISO_FALTAN_GASTOS)
  })
  it('jornadas sin valor se avisan; sin vendido no hay porcentaje', () => {
    const r = resumirCierre(fila({ jornadas_sin_valor: 3, vendido: 0 }))
    expect(r.avisos.some((a) => a.includes('3 llegadas sin valor'))).toBe(true)
    expect(r.utilidadPct).toBeNull()
  })
  it('un gasto sin rubro de obra se rotula con su categoría; lo raro se salta', () => {
    expect(rubrosDeCierre([{ rubro: 'transporte', total: 5 }, { rubro: 'Equipos', total: 3 }, 'x', null, { total: 'nan' }])).toEqual([
      { rubro: 'Transporte', total: 5 },
      { rubro: 'Equipos', total: 3 },
    ])
    expect(rubrosDeCierre(null)).toEqual([])
  })
})

function factura(p: Partial<FacturaObra> = {}): FacturaObra {
  return {
    id: UUID_A,
    negocio_id: UUID_B,
    empresa_id: 'e1',
    numero_factura: 'FE-231',
    fecha_emision: '2026-10-15',
    monto: 25000000,
    estado: 'abierta',
    pagada_at: null,
    recibido: 23500000,
    saldo_pendiente: 1500000,
    retenido: null,
    ...p,
  }
}

describe('marcar pagada (§6.3-d)', () => {
  it('con diferencia, primero pregunta si toda es retención', () => {
    const d = decidirMarcarPagada(factura())
    expect(d).toEqual({ accion: 'preguntar', diferencia: 1500000, pregunta: '¿Toda la diferencia es retención?' })
  })
  it('«sí» marca; «no» no marca y dice qué hacer', () => {
    expect(decidirMarcarPagada(factura(), 'si')).toEqual({ accion: 'marcar', diferencia: 1500000 })
    expect(decidirMarcarPagada(factura(), 'no')).toEqual({ accion: 'no_marcar', diferencia: 1500000, mensaje: MENSAJE_DIFERENCIA_NO_ES_RETENCION })
  })
  it('sin diferencia marca de una; ya pagada o recibido de más, no', () => {
    expect(decidirMarcarPagada(factura({ recibido: 25000000 }))).toEqual({ accion: 'marcar', diferencia: 0 })
    expect(decidirMarcarPagada(factura({ estado: 'pagada' })).accion).toBe('bloquear')
    const d = decidirMarcarPagada(factura({ recibido: 26000000 }), 'si')
    expect(d.accion).toBe('bloquear')
    expect(d.accion === 'bloquear' && d.error).toContain('$1.000.000')
  })
  it('la diferencia se redondea al centavo', () => {
    expect(diferenciaDeFactura({ monto: 0.3, recibido: 0.1 })).toBe(0.2)
  })
})

describe('retenido por cliente', () => {
  it('lo retenido solo de pagadas; el saldo solo de abiertas', () => {
    const filas = retenidoPorCliente(
      [
        factura({ id: 'a', estado: 'pagada', recibido: 24000000, retenido: 1000000, saldo_pendiente: null }),
        factura({ id: 'b', estado: 'abierta', recibido: 10000000, saldo_pendiente: 15000000, retenido: null }),
        factura({ id: 'c', empresa_id: 'e2', estado: 'abierta', monto: 5000000, recibido: 0, saldo_pendiente: 5000000 }),
      ],
      (id) => (id === 'e1' ? 'Cliente uno' : 'Cliente dos'),
    )
    expect(filas[0]).toMatchObject({ cliente: 'Cliente uno', retenido: 1000000, saldoPendiente: 15000000, facturasPagadas: 1, facturasAbiertas: 1, facturado: 50000000 })
    expect(filas[1]).toMatchObject({ cliente: 'Cliente dos', retenido: 0, saldoPendiente: 5000000 })
  })
})

describe('validaciones', () => {
  it('factura', () => {
    expect(validarFactura({ numero_factura: ' FE-1 ', fecha_emision: '2026-10-01', monto: '1000' })).toEqual({
      ok: true,
      datos: { numero_factura: 'FE-1', fecha_emision: '2026-10-01', monto: 1000, soporte_url: null },
    })
    expect(validarFactura({ numero_factura: '', fecha_emision: '2026-10-01', monto: 1 }).ok).toBe(false)
    expect(validarFactura({ numero_factura: 'X', fecha_emision: '2999-01-01', monto: 1 }).ok).toBe(false)
    expect(validarFactura({ numero_factura: 'X', fecha_emision: '2026-10-01', monto: 0 }).ok).toBe(false)
  })
  it('llegada: hora de Bogotá, nada de días futuros', () => {
    const ok = validarLlegada({ collaborator_id: UUID_A, negocio_id: UUID_B, fecha: '2026-10-21', hora: '07:12' }, '2026-10-21')
    expect(ok).toEqual({ ok: true, datos: { collaborator_id: UUID_A, negocio_id: UUID_B, fecha: '2026-10-21', hora: '2026-10-21T07:12:00-05:00' } })
    expect(validarLlegada({ collaborator_id: UUID_A, negocio_id: UUID_B, fecha: '2026-10-22', hora: '07:12' }, '2026-10-21').ok).toBe(false)
    expect(validarLlegada({ collaborator_id: 'x', negocio_id: UUID_B, fecha: '2026-10-21', hora: '07:12' }, '2026-10-21').ok).toBe(false)
    expect(validarLlegada({ collaborator_id: UUID_A, negocio_id: UUID_B, fecha: '2026-10-21', hora: '25:00' }, '2026-10-21').ok).toBe(false)
    expect(horaDeLlegada('2026-10-21', '13:40')).toBe('2026-10-21T13:40:00-05:00')
    expect(textoFraccion(0.5)).toBe('Media')
    expect(textoFraccion(1)).toBe('Completa')
  })
  it('rubro: nombre de máximo 24 y categoría del CHECK', () => {
    expect(validarRubro({ nombre: 'x'.repeat(MAX_NOMBRE_RUBRO), categoria: 'materiales' }).ok).toBe(true)
    expect(validarRubro({ nombre: 'x'.repeat(MAX_NOMBRE_RUBRO + 1), categoria: 'materiales' }).ok).toBe(false)
    expect(validarRubro({ nombre: 'Viaje', categoria: 'viaticos' }).ok).toBe(false)
    expect(nombreRepetido(' materiales ', [{ id: 'a', nombre: 'Materiales' }], null)).toBe(true)
    expect(nombreRepetido('Materiales', [{ id: 'a', nombre: 'Materiales' }], 'a')).toBe(false)
  })
  it('colaborador: celular como lo busca el bot y valor vigente', () => {
    expect(normalizarTelefono('300 123 4567')).toBe('573001234567')
    expect(normalizarTelefono('+57 300-123-4567')).toBe('573001234567')
    expect(normalizarTelefono('12345')).toBeNull()
    expect(validarColaborador({ name: ' Pedro ', phone: '3001234567', tipo: 'operario' })).toEqual({
      ok: true,
      datos: { name: 'Pedro', phone: '573001234567', tipo: 'operario' },
    })
    expect(validarValorJornada({ valor: 0, vigente_desde: '2026-10-01' }).ok).toBe(false)
    const valores = [
      { id: 'a', valor: 120000, vigente_desde: '2026-09-01' },
      { id: 'b', valor: 140000, vigente_desde: '2026-10-15' },
    ]
    expect(valorVigente(valores, '2026-10-14')?.id).toBe('a')
    expect(valorVigente(valores, '2026-10-15')?.id).toBe('b')
    expect(valorVigente(valores, '2026-08-31')).toBeNull()
  })
  it('condiciones: nombre corto de máximo 20; vacío es null', () => {
    expect(validarCondiciones({ nombre_corto: 'x'.repeat(MAX_NOMBRE_CORTO), anticipo_pct: '50', forma_pago: '', plazo_pago_dias: '30' })).toEqual({
      ok: true,
      datos: { nombre_corto: 'x'.repeat(MAX_NOMBRE_CORTO), anticipo_pct: 50, forma_pago: null, plazo_pago_dias: 30 },
    })
    expect(validarCondiciones({ nombre_corto: 'x'.repeat(MAX_NOMBRE_CORTO + 1) }).ok).toBe(false)
    expect(validarCondiciones({ anticipo_pct: 101 }).ok).toBe(false)
    expect(validarCondiciones({ plazo_pago_dias: 2.5 }).ok).toBe(false)
  })
})

describe('el código habla el idioma de la migración', () => {
  it('las categorías del formulario de rubros están en el CHECK de obra_rubros', () => {
    const check = /categoria text not null default 'otros' check \(categoria = any \(array\[([^\]]+)\]\)\)/.exec(MIGRACION)
    expect(check).not.toBeNull()
    const enMigracion = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const c of CATEGORIAS_FISCALES_RUBRO) expect(enMigracion).toContain(c.value)
  })
  it('el error del trigger de dos obras por día se traduce', () => {
    const m = /raise exception '(llegada: ya hay dos obras[^']*)'/.exec(MIGRACION)
    expect(m).not.toBeNull()
    expect(mensajeErrorLlegada({ code: '23514', message: m![1] })).toContain('dos obras distintas')
    expect(mensajeErrorLlegada({ code: '23505', message: 'duplicate key' })).toContain('ya tiene una llegada')
  })
  it('los topes de texto coinciden con los CHECK', () => {
    expect(MIGRACION).toContain(`char_length(btrim(nombre)) between 1 and ${MAX_NOMBRE_RUBRO}`)
    expect(MIGRACION).toContain(`char_length(btrim(nombre_corto)) between 1 and ${MAX_NOMBRE_CORTO}`)
  })
})

describe('CSV', () => {
  const obra = () => ({ codigo: 'X1 26 1', nombre: 'Obra', cliente: 'Cliente' })
  it('cada archivo trae exactamente sus columnas, en orden', () => {
    const pagos = filasPagos([{ fecha: '2026-10-01', monto: 1, descripcion: null, categoria: 'materiales', negocio_id: null, numero_transaccion: '9', numero_repetido: false, rubro: null }], obra)
    expect(Object.keys(pagos[0])).toEqual(COLUMNAS_CSV.pagos)
    expect(pagos[0].obra).toBe('Gasto de empresa')
    expect(pagos[0].rubro).toBe('Materiales')
    const ing = filasIngresos([{ fecha: '2026-10-01', monto: 1, negocio_id: UUID_A, numero_transaccion: null, tipo_cobro: null, notas: null, factura: 'FE-1' }], obra)
    expect(Object.keys(ing[0])).toEqual(COLUMNAS_CSV.ingresos)
    const jor = filasJornadas([{ fecha: '2026-10-01', hora: '2026-10-01T12:00:00Z', colaborador: 'Pedro', negocio_id: UUID_A, fraccion: 0.5, valor_jornada: 140000, costo: 70000 }], obra)
    expect(Object.keys(jor[0])).toEqual(COLUMNAS_CSV.jornadas)
    expect(jor[0]).toMatchObject({ hora_llegada: '07:00', jornada: 'Media', costo: 70000 })
    const obras = filasObras([{ negocio_id: UUID_A, codigo: 'X', nombre: 'O', nombre_corto: null, estado: 'abierto', vendido: 100, gastos_total: 10, mano_obra: 10, jornadas: 1, jornadas_sin_valor: 0, utilidad: 80, facturado: 0, cobrado: 0, retenido: 0, saldo_facturas: 0, por_cobrar: 100 }], obra)
    expect(Object.keys(obras[0])).toEqual(COLUMNAS_CSV.obras)
    expect(obras[0].utilidad_pct).toBe(80)
  })
  it('retenido: solo facturas pagadas, con el día de Bogotá', () => {
    const r = filasRetenido(
      [
        { numero_factura: 'A', fecha_emision: '2026-10-01', negocio_id: UUID_A, monto: 10, recibido: 9, retenido: 1, estado: 'pagada', pagada_at: '2026-10-21T03:00:00Z' },
        { numero_factura: 'B', fecha_emision: '2026-10-01', negocio_id: UUID_A, monto: 10, recibido: 5, retenido: null, estado: 'abierta', pagada_at: null },
      ],
      obra,
    )
    expect(r).toHaveLength(1)
    expect(Object.keys(r[0])).toEqual(COLUMNAS_CSV.retenido)
    expect(r[0].pagada_el).toBe('2026-10-20')
  })
})

describe('módulo y roles', () => {
  it('solo con la llave obras', () => {
    expect(obrasActivas({ business: true, obras: true })).toBe(true)
    expect(obrasActivas({ business: true })).toBe(false)
    expect(obrasActivas(null)).toBe(false)
  })
  it('escriben dueño y administrador; solo lectura ve', () => {
    expect(puedeEditarObras('owner')).toBe(true)
    expect(puedeEditarObras('admin')).toBe(true)
    expect(puedeEditarObras('supervisor')).toBe(false)
    expect(puedeEditarObras('read_only')).toBe(false)
    expect(puedeVerObras('read_only')).toBe(true)
    expect(puedeVerObras('operator')).toBe(false)
  })
  it('reconoce la migración sin aplicar', () => {
    expect(faltaMigracionObras({ code: 'PGRST205', message: 'Could not find the table public.v_cierre_obra' })).toBe(true)
    expect(faltaMigracionObras({ code: '42703', message: 'column negocios.nombre_corto does not exist' })).toBe(true)
    expect(faltaMigracionObras({ code: '23505', message: 'duplicate' })).toBe(false)
  })
})
