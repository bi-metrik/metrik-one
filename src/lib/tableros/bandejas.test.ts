import { describe, it, expect } from 'vitest'
import {
  armarBandejas,
  bandejaComercial,
  bandejaFinanciera,
  bandejaOperaciones,
  diasSinMovimiento,
  tablerosOperativosActivos,
  tasaDeCierre,
  type HistorialComercial,
  type EntradaBandejas,
  type NegocioBandeja,
} from './bandejas'

const HOY = '2026-09-28'

/** Un negocio abierto en Contacto, creado y movido hoy. Cada prueba cambia lo que mide. */
function neg(p: Partial<NegocioBandeja> & { id: string }): NegocioBandeja {
  return {
    codigo: p.id.toUpperCase(),
    nombre: `Negocio ${p.id}`,
    estado: 'abierto',
    fase: 'venta',
    etapa: 'Contacto',
    valor: 1_000_000,
    pausado: false,
    pausadoHasta: null,
    creadoEn: `${HOY}T15:00:00Z`,
    etapaCambiadaEn: null,
    ultimaActividad: null,
    ...p,
  }
}

const hace = (dias: number) => {
  const d = new Date(Date.UTC(2026, 8, 28 - dias, 15))
  return d.toISOString()
}

function entrada(p: Partial<EntradaBandejas> = {}): EntradaBandejas {
  return { negocios: [], cartera: [], cuotasPendientes: [], gastosSinSoporte: [], cobradoMes: 0, ...p }
}

describe('tablerosOperativosActivos', () => {
  it('solo el true literal lo enciende', () => {
    expect(tablerosOperativosActivos({ tableros_operativos: true })).toBe(true)
    expect(tablerosOperativosActivos({ tableros_operativos: 'true' })).toBe(false)
    expect(tablerosOperativosActivos({})).toBe(false)
    expect(tablerosOperativosActivos(null)).toBe(false)
  })
})

describe('diasSinMovimiento', () => {
  it('toma lo mas reciente entre actividad, entrada a la etapa y creacion', () => {
    const n = neg({ id: 'a', creadoEn: hace(100), etapaCambiadaEn: hace(40), ultimaActividad: hace(9) })
    expect(diasSinMovimiento(n, HOY)).toBe(9)
  })

  it('sin actividad cae a la entrada a la etapa, y sin ella a la creacion', () => {
    expect(diasSinMovimiento(neg({ id: 'a', creadoEn: hace(50), etapaCambiadaEn: hace(20) }), HOY)).toBe(20)
    expect(diasSinMovimiento(neg({ id: 'a', creadoEn: hace(50) }), HOY)).toBe(50)
  })

  it('cuenta en dia de Bogota: las 11 p. m. del 27 en Bogota ya son el 28 en UTC', () => {
    // 2026-09-28T04:00Z = 27-sep 23:00 en Bogota: un dia, no cero.
    expect(diasSinMovimiento(neg({ id: 'a', creadoEn: '2026-09-28T04:00:00Z' }), HOY)).toBe(1)
  })
})

describe('bandejaComercial', () => {
  it('7 dias o menos no es pendiente; mas de 7 pide seguimiento; mas de 30, perder o reactivar', () => {
    const b = bandejaComercial(
      [
        neg({ id: 'quieto7', creadoEn: hace(7) }),
        neg({ id: 'quieto8', creadoEn: hace(8) }),
        neg({ id: 'quieto31', creadoEn: hace(31) }),
      ],
      HOY,
    )
    expect(b.filas.map((f) => [f.clave, f.accion])).toEqual([
      ['negocio-quieto31', 'Marcar perdido o reactivar'],
      ['negocio-quieto8', 'Registrar seguimiento'],
    ])
    expect(b.filas[0].href).toBe('/negocios/quieto31')
  })

  it('no mira negocios pausados, cerrados ni fuera de venta', () => {
    const b = bandejaComercial(
      [
        neg({ id: 'pausado', creadoEn: hace(60), pausado: true }),
        neg({ id: 'perdido', creadoEn: hace(60), estado: 'perdido' }),
        neg({ id: 'ejec', creadoEn: hace(60), fase: 'ejecucion' }),
      ],
      HOY,
    )
    expect(b.filas).toEqual([])
  })

  it('una pausa con fecha vencida deja de proteger al negocio', () => {
    const b = bandejaComercial([neg({ id: 'p', creadoEn: hace(60), pausado: true, pausadoHasta: '2026-09-20' })], HOY)
    expect(b.filas).toHaveLength(1)
  })

  it('contexto: entradas de 7 dias y propuestas abiertas con su valor', () => {
    const b = bandejaComercial(
      [
        neg({ id: 'nuevo', creadoEn: hace(2) }),
        neg({ id: 'prop', creadoEn: hace(20), etapa: 'Propuesta', valor: 7_500_000 }),
      ],
      HOY,
    )
    const [entradas, propuestas] = b.contexto
    expect(entradas.valor).toBe(1)
    expect(propuestas.valor).toBe(7_500_000)
    expect(propuestas.nota).toBe('1 propuesta')
  })

  // Etapas de dos lineas: una comercial (Contacto/Propuesta/Ejecucion/Cobro) y la de las
  // suscripciones, que solo tiene Venta/Cobro y cuyos negocios nacen directo en Cobro.
  const HISTORIAL_BASE: HistorialComercial = {
    etapas: [
      { id: 'e-contacto', lineaId: 'clarity', nombre: 'Contacto', stage: 'venta' },
      { id: 'e-propuesta', lineaId: 'clarity', nombre: 'Propuesta', stage: 'venta' },
      { id: 'e-ejecucion', lineaId: 'clarity', nombre: 'Ejecucion', stage: 'ejecucion' },
      { id: 'e-cobro', lineaId: 'clarity', nombre: 'Cobro', stage: 'cobro' },
      { id: 'v-venta', lineaId: 'valida', nombre: 'Venta', stage: 'venta' },
      { id: 'v-cobro', lineaId: 'valida', nombre: 'Cobro', stage: 'cobro' },
    ],
    cambios: [],
  }

  it('tasa: ganado solo si el historial lo muestra saliendo de venta; perdido solo desde venta', () => {
    const negocios = [
      neg({ id: 'ganado', lineaId: 'clarity', fase: 'ejecucion', creadoEn: hace(60) }),
      neg({ id: 'ganadoViejo', lineaId: 'clarity', fase: 'cobro', creadoEn: hace(200) }),
      neg({ id: 'movidoPorSql', lineaId: 'clarity', fase: 'ejecucion', creadoEn: hace(30) }),
      neg({ id: 'perdido', lineaId: 'clarity', estado: 'perdido', cerradoEn: hace(10) }),
      neg({ id: 'perdidoViejo', lineaId: 'clarity', estado: 'perdido', cerradoEn: hace(120) }),
      neg({ id: 'perdidoEnEjecucion', lineaId: 'clarity', fase: 'ejecucion', estado: 'perdido', cerradoEn: hace(5) }),
    ]
    const historial: HistorialComercial = {
      ...HISTORIAL_BASE,
      cambios: [
        { negocioId: 'ganado', anterior: 'Contacto', nuevo: 'Propuesta', fecha: hace(50) },
        { negocioId: 'ganado', anterior: 'Propuesta', nuevo: 'Ejecucion', fecha: hace(40) },
        // Salio de venta hace 150 dias: fuera de la ventana de 90.
        { negocioId: 'ganadoViejo', anterior: 'Propuesta', nuevo: 'Cobro', fecha: hace(150) },
      ],
    }
    expect(tasaDeCierre(negocios, historial, HOY)).toEqual({ ganados: 1, perdidos: 1 })
    const tasa = bandejaComercial(negocios, HOY, historial).contexto[2]
    expect(tasa.valor).toBe(50)
    expect(tasa.nota).toBe('1 de 2 decididos')
  })

  it('una suscripcion nacida directo en Cobro NUNCA cuenta como ganada', () => {
    const negocios = [
      neg({ id: 'cda', lineaId: 'valida', fase: 'cobro', etapa: 'Cobro', creadoEn: hace(5) }),
      neg({ id: 'cdaCerrada', lineaId: 'valida', fase: null, estado: 'completado', creadoEn: hace(20) }),
      neg({ id: 'perdido', lineaId: 'clarity', estado: 'perdido', cerradoEn: hace(10) }),
    ]
    // Hasta un cambio Cobro -> Cobro (o de cualquier etapa que no sea venta) se ignora.
    const historial: HistorialComercial = {
      ...HISTORIAL_BASE,
      cambios: [{ negocioId: 'cda', anterior: 'Cobro', nuevo: 'Cobro', fecha: hace(3) }],
    }
    expect(tasaDeCierre(negocios, historial, HOY)).toEqual({ ganados: 0, perdidos: 1 })
    expect(bandejaComercial(negocios, HOY, historial).contexto[2].valor).toBe(0)
  })

  it('el nombre del historial se lee contra las etapas de LA linea del negocio, y acepta el id', () => {
    const negocios = [
      neg({ id: 'porId', lineaId: 'clarity', fase: 'ejecucion' }),
      // "Venta" no existe en la linea clarity: el cambio no prueba nada.
      neg({ id: 'otraLinea', lineaId: 'clarity', fase: 'cobro' }),
    ]
    const historial: HistorialComercial = {
      ...HISTORIAL_BASE,
      cambios: [
        { negocioId: 'porId', anterior: 'e-propuesta', nuevo: 'e-ejecucion', fecha: hace(4) },
        { negocioId: 'otraLinea', anterior: 'Venta', nuevo: 'Cobro', fecha: hace(4) },
      ],
    }
    expect(tasaDeCierre(negocios, historial, HOY)).toEqual({ ganados: 1, perdidos: 0 })
  })

  it('sin nada decidido la tasa es null, no un 0% que se lee como fracaso', () => {
    const b = bandejaComercial([neg({ id: 'a' })], HOY)
    expect(b.contexto[2].valor).toBeNull()
  })
})

describe('bandejaOperaciones', () => {
  it('lista la ejecucion sin avance y cuenta aparte la que esta en pausa', () => {
    const b = bandejaOperaciones(
      [
        neg({ id: 'viejo', fase: 'ejecucion', creadoEn: hace(130), etapaCambiadaEn: hace(118), valor: 5_000_000 }),
        neg({ id: 'reciente', fase: 'ejecucion', creadoEn: hace(130), ultimaActividad: hace(1), valor: 10_000_000 }),
        neg({ id: 'pausa', fase: 'ejecucion', creadoEn: hace(14), pausado: true }),
      ],
      HOY,
    )
    expect(b.filas.map((f) => f.clave)).toEqual(['negocio-viejo'])
    expect(b.filas[0].accion).toBe('Actualizar avance')
    expect(b.contexto.map((c) => c.valor)).toEqual([2, 15_000_000, 1])
  })
})

describe('bandejaFinanciera', () => {
  const alma = neg({ id: 'alma', codigo: 'A1 26 1', fase: 'cobro' })

  it('una cuota vencida entra cuando pasan los 3 dias de gracia del cron', () => {
    const fila = (dias_mora: number) => ({
      negocio_id: 'alma', codigo: 'A1 26 1', nombre: 'ALMA', honorario: 4_800_000, honorario_recaudado: 1_200_000,
      saldo: 3_600_000, dias: 161, con_cronograma: true, saldo_vencido: 400_000, dias_mora,
    })
    expect(bandejaFinanciera(entrada({ negocios: [alma], cartera: [fila(2)] }), HOY).filas).toEqual([])
    const b = bandejaFinanciera(entrada({ negocios: [alma], cartera: [fila(13)] }), HOY)
    expect(b.filas).toHaveLength(1)
    expect(b.filas[0].accion).toBe('Llamar o registrar pago')
    expect(b.filas[0].detalle).toBe('$400.000 vencido · 13 días de mora')
    // Lo vencido del contexto es lo vencido de verdad, no todo el saldo del contrato.
    expect(b.contexto[1].valor).toBe(400_000)
  })

  it('lo vencido en gracia suma al contexto aunque todavia no pida accion', () => {
    const b = bandejaFinanciera(entrada({
      negocios: [alma],
      cartera: [{ negocio_id: 'alma', codigo: 'A1 26 1', nombre: 'ALMA', honorario: 1, honorario_recaudado: 0,
        saldo: 500_000, dias: 10, con_cronograma: true, saldo_vencido: 500_000, dias_mora: 1 }],
    }), HOY)
    expect(b.filas).toEqual([])
    expect(b.contexto[1].valor).toBe(500_000)
  })

  it('la primera cuota sin pagar de un negocio que la cartera no ve tambien entra', () => {
    const cda = neg({ id: 'cda', codigo: 'C1 26 1', fase: 'cobro', valor: null })
    const b = bandejaFinanciera(entrada({
      negocios: [cda],
      cuotasPendientes: [{ negocioId: 'cda', monto: 150_000, fechaEsperada: '2026-09-20' }],
    }), HOY)
    expect(b.filas.map((f) => f.titulo)).toEqual(['C1 26 1 · Negocio cda'])
    expect(b.contexto[1].valor).toBe(150_000)
  })

  it('una cuota de un negocio que la cartera ya ve no se cuenta dos veces', () => {
    const b = bandejaFinanciera(entrada({
      negocios: [alma],
      cartera: [{ negocio_id: 'alma', codigo: 'A1 26 1', nombre: 'ALMA', honorario: 1, honorario_recaudado: 0,
        saldo: 400_000, dias: 10, con_cronograma: true, saldo_vencido: 400_000, dias_mora: 13 }],
      cuotasPendientes: [{ negocioId: 'alma', monto: 400_000, fechaEsperada: '2026-09-15' }],
    }), HOY)
    expect(b.filas).toHaveLength(1)
    expect(b.contexto[1].valor).toBe(400_000)
  })

  it('por cobrar en 30 dias suma solo cuotas futuras dentro de la ventana y fuera de negocios perdidos', () => {
    const perdido = neg({ id: 'x', estado: 'perdido' })
    const b = bandejaFinanciera(entrada({
      negocios: [alma, perdido],
      cuotasPendientes: [
        { negocioId: 'alma', monto: 400_000, fechaEsperada: '2026-10-15' },
        { negocioId: 'alma', monto: 999, fechaEsperada: '2026-11-15' },
        { negocioId: 'x', monto: 777, fechaEsperada: '2026-10-01' },
      ],
    }), HOY)
    expect(b.contexto[2].valor).toBe(400_000)
  })

  it('los gastos esperando soporte van despues de la plata, con enlace a su mes', () => {
    const b = bandejaFinanciera(entrada({
      negocios: [alma],
      cartera: [{ negocio_id: 'alma', codigo: 'A1 26 1', nombre: 'ALMA', honorario: 1, honorario_recaudado: 0,
        saldo: 400_000, dias: 10, con_cronograma: true, saldo_vencido: 400_000, dias_mora: 13 }],
      gastosSinSoporte: [{ id: 'g1', fecha: '2026-06-11', monto: 12_000, descripcion: 'Parqueadero', categoria: 'transporte' }],
    }), HOY)
    expect(b.filas.map((f) => f.accion)).toEqual(['Llamar o registrar pago', 'Subir soporte'])
    expect(b.filas[1].href).toBe('/movimientos?tipo=egresos&mes=2026-06')
  })

  it('el cobrado del mes pasa tal cual', () => {
    expect(bandejaFinanciera(entrada({ cobradoMes: 2_000 }), HOY).contexto[0].valor).toBe(2_000)
  })
})

describe('armarBandejas', () => {
  it('bandeja vacia es la meta: sin filas, cada una trae su mensaje', () => {
    const b = armarBandejas(entrada(), HOY)
    expect(b.comercial.filas).toEqual([])
    expect(b.operaciones.filas).toEqual([])
    expect(b.financiero.filas).toEqual([])
    expect(b.financiero.vacia).toMatch(/Nada vencido/)
  })
})
