import { describe, expect, it } from 'vitest'
import {
  ENCABEZADOS,
  armarFilasExcel,
  faseDeNegocio,
  fechaExcel,
  ordenarPagos,
  type CobroExportable,
  type EntradaExcel,
  type NegocioExportable,
} from './export-excel'

/**
 * Pruebas del armado de filas del Excel de negocios.
 *
 * Verificadas por mutación el 2026-09-03 (se cambió la línea, se corrió vitest, se
 * restauró; las siete tumbaron al menos una prueba):
 *   1. quitar el filtro `!c.anulado_at` de `ordenarPagos`   → caen 2 (orden de pagos, primer/segundo)
 *   2. quitar el `Math.max(0, …)` del saldo                  → cae 1 (saldo mínimo 0)
 *   3. `faseDeNegocio` sin la rama de `estado !== 'abierto'` → cae 1 (fase derivada)
 *   4. `fechaExcel` con `new Date(s)` para 'YYYY-MM-DD'      → cae 1 con TZ=America/Bogota,
 *      y NINGUNA con TZ=UTC: ahí `new Date('2026-09-03')` y `new Date(2026, 8, 3)` son el
 *      mismo instante. El TZ de node se fija al arrancar (no sirve `vi.stubEnv`), así que
 *      la garantía es que la aserción compara componentes LOCALES, que es lo que SheetJS
 *      escribe; CI corre en UTC y no la ve, quien pruebe en Bogotá sí.
 *   5. invertir `Si`/`No` en `SI_NO`                          → caen 2 (booleanos, estimado)
 *   6. `Otros pagos` sin el corte del tercer pago             → cae 1 (vacío, no cero)
 *   7. recaudado ignorando `a_tramo2`                         → cae 1 (recaudado 150)
 */

const negocio = (p: Partial<NegocioExportable> & Pick<NegocioExportable, 'id'>): NegocioExportable => ({
  codigo: 'V0001',
  nombre: 'Negocio',
  empresa_nombre: null,
  contacto_nombre: 'Ana',
  contacto_telefono: null,
  cedula: null,
  stage_actual: 'venta',
  etapa_stage: 'venta',
  etapa_nombre: 'Propuesta',
  estado: 'abierto',
  cierre_motivo: null,
  razon_cierre: null,
  created_at: null,
  closed_at: null,
  origen: null,
  aliado_nombre: null,
  es_meta_lead: false,
  servicio_label: null,
  seccional_label: null,
  ciudad_label: null,
  vehiculo_label: null,
  radicado: null,
  numero_factura: null,
  precio_aprobado: null,
  precio_estimado: null,
  horas_habiles_en_etapa: null,
  etapa_sla_horas: null,
  sla_exceso_horas: null,
  reproceso: null,
  marcas: [],
  pausado: false,
  pausado_hasta: null,
  motivo_pausa: null,
  ...p,
})

const cobro = (p: Partial<CobroExportable> & Pick<CobroExportable, 'id'>): CobroExportable => ({
  negocio_id: 'n1',
  monto: 0,
  fecha: null,
  created_at: null,
  external_ref: null,
  anulado_at: null,
  ...p,
})

const entrada = (p: Partial<EntradaExcel> = {}): EntradaExcel => ({
  negocios: [],
  valores: [],
  ventas: [],
  bonificables: [],
  comerciales: [],
  tramos: [],
  cobros: [],
  operaciones: [],
  staff: [],
  baseUrl: 'https://soena.metrikone.co/',
  ...p,
})

describe('ordenarPagos', () => {
  it('ordena por fecha, luego por creación, y deja los anulados fuera aunque vayan primero', () => {
    const pagos = ordenarPagos([
      cobro({ id: 'c-anulado', monto: 999, fecha: '2026-01-01', created_at: '2026-01-01T00:00:00Z', anulado_at: '2026-02-01T00:00:00Z' }),
      cobro({ id: 'c-tarde', monto: 300, fecha: '2026-03-01', created_at: '2026-03-01T10:00:00Z' }),
      cobro({ id: 'c-mismo-dia-2', monto: 200, fecha: '2026-02-01', created_at: '2026-02-01T12:00:00Z' }),
      cobro({ id: 'c-mismo-dia-1', monto: 100, fecha: '2026-02-01', created_at: '2026-02-01T09:00:00Z' }),
      cobro({ id: 'c-sin-fecha', monto: 50, fecha: null, created_at: '2025-12-01T00:00:00Z' }),
    ])
    expect(pagos.map((c) => c.id)).toEqual(['c-mismo-dia-1', 'c-mismo-dia-2', 'c-tarde', 'c-sin-fecha'])
  })
})

describe('armarFilasExcel — pagos', () => {
  it('primer y segundo pago son los dos más antiguos; el resto se suma en "Otros pagos"', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [negocio({ id: 'n1' })],
      cobros: [
        cobro({ id: 'c3', monto: 30, fecha: '2026-03-03', external_ref: 'R3' }),
        cobro({ id: 'c1', monto: 10, fecha: '2026-01-01', external_ref: 'R1' }),
        cobro({ id: 'c4', monto: 40, fecha: '2026-04-04', external_ref: 'R4' }),
        cobro({ id: 'c2', monto: 20, fecha: '2026-02-02', external_ref: 'R2' }),
        cobro({ id: 'cx', monto: 500, fecha: '2025-01-01', external_ref: 'ANULADO', anulado_at: '2025-02-01' }),
      ],
    }))
    const f = filas[0]
    expect(f['Primer pago monto']).toBe(10)
    expect(f['Primer pago referencia']).toBe('R1')
    expect(f['Primer pago fecha']).toBeInstanceOf(Date)
    expect(f['Segundo pago monto']).toBe(20)
    expect(f['Segundo pago referencia']).toBe('R2')
    expect(f['Otros pagos']).toBe(70)
  })

  it('sin tercer pago, "Otros pagos" queda vacío (no cero); sin pagos, todo vacío', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [negocio({ id: 'n1' }), negocio({ id: 'n2' })],
      cobros: [cobro({ id: 'c1', negocio_id: 'n1', monto: 10, fecha: '2026-01-01' })],
    }))
    expect(filas[0]['Primer pago monto']).toBe(10)
    expect(filas[0]['Segundo pago monto']).toBeNull()
    expect(filas[0]['Otros pagos']).toBeNull()
    expect(filas[1]['Primer pago monto']).toBeNull()
    expect(filas[1]['Primer pago fecha']).toBeNull()
  })
})

describe('armarFilasExcel — dinero', () => {
  it('el saldo nunca baja de cero, y sin honorario no hay saldo', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [
        negocio({ id: 'sobrepagado', precio_aprobado: 100 }),
        negocio({ id: 'debe', precio_aprobado: 100 }),
        negocio({ id: 'sin-precio' }),
      ],
      tramos: [
        { negocio_id: 'sobrepagado', a_tramo1: 100, a_tramo2: 50 },
        { negocio_id: 'debe', a_tramo1: 40, a_tramo2: 0 },
      ],
    }))
    expect(filas[0]['Recaudado honorario']).toBe(150)
    expect(filas[0]['Saldo honorario']).toBe(0)
    expect(filas[1]['Saldo honorario']).toBe(60)
    expect(filas[2]['Honorario con IVA']).toBeNull()
    expect(filas[2]['Saldo honorario']).toBeNull()
    expect(filas[2]['Recaudado honorario']).toBe(0)
  })

  it('sin precio aprobado usa el estimado y lo marca como estimado', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [
        negocio({ id: 'estimado', precio_estimado: 80 }),
        negocio({ id: 'aprobado', precio_aprobado: 100, precio_estimado: 80 }),
      ],
      valores: [{ negocio_id: 'aprobado', valor_base: 84.03, valor_iva: 15.97, plan_pago: 1, techo_tarifa: 701812 }],
    }))
    expect(filas[0]['Honorario con IVA']).toBe(80)
    expect(filas[0]['Precio estimado']).toBe('Si')
    expect(filas[0]['Honorario sin IVA']).toBeNull()
    expect(filas[1]['Honorario con IVA']).toBe(100)
    expect(filas[1]['Precio estimado']).toBe('No')
    expect(filas[1]['Honorario sin IVA']).toBe(84.03)
    expect(filas[1]['IVA']).toBe(15.97)
    expect(filas[1]['Plan de pago']).toBe(1)
    expect(filas[1]['Tarifa UPME confirmada']).toBe(701812)
  })
})

describe('faseDeNegocio', () => {
  it('un negocio que ya no está abierto es Cerrado aunque su etapa siga en una fase', () => {
    expect(faseDeNegocio({ estado: 'completado', etapa_stage: 'cobro', stage_actual: 'cobro' })).toBe('Cerrado')
    expect(faseDeNegocio({ estado: 'abierto', etapa_stage: 'cobro', stage_actual: 'cobro' })).toBe('Financiera')
    expect(faseDeNegocio({ estado: 'abierto', etapa_stage: 'venta', stage_actual: 'venta' })).toBe('Comercial')
    expect(faseDeNegocio({ estado: 'abierto', etapa_stage: 'ejecucion', stage_actual: 'ejecucion' })).toBe('Operaciones')
  })

  it('sin etapa cae al stage del negocio; sin nada, vacío', () => {
    expect(faseDeNegocio({ estado: 'abierto', etapa_stage: null, stage_actual: 'ejecucion' })).toBe('Operaciones')
    expect(faseDeNegocio({ estado: 'abierto', etapa_stage: null, stage_actual: null })).toBeNull()
  })
})

describe('armarFilasExcel — booleanos y vacíos', () => {
  it('escribe Si/No, y deja vacío lo que no se sabe', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [
        negocio({
          id: 'n1',
          es_meta_lead: true,
          reproceso: { tipo: 'dian', ciclo: 1, etapa_retorno: null },
          pausado: true,
          motivo_pausa: 'cliente',
          marcas: [
            { tipo: 'descuento', nota: null, marcado_por_id: null, marcado_por_nombre: null, marcado_en: '2026-09-01T00:00:00Z' },
            { tipo: 'sin_honorario', nota: null, marcado_por_id: null, marcado_por_nombre: null, marcado_en: '2026-09-01T00:00:00Z' },
          ],
        }),
        negocio({ id: 'n2' }),
      ],
      ventas: [{ negocio_id: 'n1', fecha_venta: '2026-08-15', caso_completo: true }],
      bonificables: [
        { negocio_id: 'n1', bonificable: false },
        { negocio_id: 'n2', bonificable: null },
      ],
    }))
    const [a, b] = filas
    expect(a['Lead Meta']).toBe('Si')
    expect(a['Reproceso']).toBe('Si')
    expect(a['Pausado']).toBe('Si')
    expect(a['Caso completo']).toBe('Si')
    expect(a['Bonificable']).toBe('No')
    expect(a['Marcas']).toBe('Con descuento, Sin honorario')

    expect(b['Lead Meta']).toBe('No')
    expect(b['Reproceso']).toBe('No')
    expect(b['Pausado']).toBe('No')
    // Sin venta no hay "caso completo" que afirmar; sin umbral, "bonificable" no se sabe.
    expect(b['Caso completo']).toBeNull()
    expect(b['Bonificable']).toBeNull()
    expect(b['Marcas']).toBeNull()
    expect(b['Fecha venta']).toBeNull()
  })
})

describe('fechaExcel', () => {
  it('un día ("YYYY-MM-DD") es ese día en componentes locales, sin correrse por UTC', () => {
    const d = fechaExcel('2026-09-03')
    expect(d).toBeInstanceOf(Date)
    expect([d!.getFullYear(), d!.getMonth() + 1, d!.getDate()]).toEqual([2026, 9, 3])
    expect([d!.getHours(), d!.getMinutes()]).toEqual([0, 0])
  })

  it('un instante se proyecta a la hora de pared de Bogotá (UTC-5)', () => {
    // 02:30 UTC del 3 de septiembre es las 21:30 del 2 en Bogotá.
    const d = fechaExcel('2026-09-03T02:30:00Z')
    expect([d!.getFullYear(), d!.getMonth() + 1, d!.getDate(), d!.getHours(), d!.getMinutes()])
      .toEqual([2026, 9, 2, 21, 30])
  })

  it('vacío o basura es celda vacía', () => {
    expect(fechaExcel(null)).toBeNull()
    expect(fechaExcel('')).toBeNull()
    expect(fechaExcel('no es fecha')).toBeNull()
  })

  it('las columnas de fecha de la fila llevan Date, no texto', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [negocio({ id: 'n1', created_at: '2026-09-01T15:00:00Z', closed_at: '2026-09-02T15:00:00Z', pausado_hasta: '2026-09-10' })],
      ventas: [{ negocio_id: 'n1', fecha_venta: '2026-08-15', caso_completo: null }],
    }))
    const f = filas[0]
    for (const col of ['Fecha creacion', 'Fecha venta', 'Fecha cierre', 'Pausado hasta'] as const) {
      expect(f[col]).toBeInstanceOf(Date)
    }
  })
})

describe('armarFilasExcel — identidad, personas y forma', () => {
  it('conserva el orden de entrada, arma el link con el slug y resuelve comercial y operaciones por nombre', () => {
    const filas = armarFilasExcel(entrada({
      negocios: [negocio({ id: 'b', codigo: 'V0002' }), negocio({ id: 'a', codigo: 'V0001', empresa_nombre: 'ACME', contacto_nombre: 'Ana' })],
      comerciales: [{ negocio_id: 'a', comercial_staff_id: 's-jess' }],
      operaciones: [{ negocio_id: 'a', staff_id: 's-daniela' }],
      staff: [
        { id: 's-jess', full_name: 'Jessica' },
        { id: 's-daniela', full_name: 'Daniela' },
      ],
    }))
    expect(filas.map((f) => f['Codigo'])).toEqual(['V0002', 'V0001'])
    expect(filas[1]['Link ONE']).toBe('https://soena.metrikone.co/negocios/a')
    expect(filas[1]['Cliente']).toBe('ACME')
    expect(filas[1]['Comercial']).toBe('Jessica')
    expect(filas[1]['Operaciones']).toBe('Daniela')
    expect(filas[0]['Cliente']).toBe('Ana')
    expect(filas[0]['Comercial']).toBeNull()
    expect(filas[0]['Operaciones']).toBeNull()
  })

  it('cada fila tiene exactamente las 49 columnas del spec, en su orden', () => {
    const [f] = armarFilasExcel(entrada({ negocios: [negocio({ id: 'n1' })] }))
    expect(ENCABEZADOS).toHaveLength(49)
    expect(Object.keys(f)).toEqual([...ENCABEZADOS])
  })

  it('el cierre junta motivo y razón', () => {
    const [f] = armarFilasExcel(entrada({
      negocios: [negocio({ id: 'n1', estado: 'completado', cierre_motivo: 'perdido', razon_cierre: 'No incluido en UPME' })],
    }))
    expect(f['Cierre']).toBe('Perdido — No incluido en UPME')
    expect(f['Fase']).toBe('Cerrado')
  })
})
