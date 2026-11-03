/**
 * Autorización, ficha y servicios: la cabecera dice lo mismo que el gate (barrido 2026-10-22).
 */
import { describe, expect, it, vi } from 'vitest'
import { leerEstado } from '@/lib/autorizacion-datos/estado'
import type { ServicioDelNegocio } from '@/lib/viaje/servicios-viaje-datos'
import { cambiosDeEstado, estadoAutorizacion, estadoFicha, estadoServicios, tipoDerivado } from './estado-bloques-derivado'

let rpc: { estado: unknown; error: string | null } = { estado: null, error: null }
vi.mock('@/lib/autorizacion-datos/servidor', () => ({
  estadoDelContacto: async () => ({ estado: leerEstado(rpc.estado), error: rpc.error }),
}))
const { derivarEstadosDeBloques } = await import('./estado-bloques-derivado-datos')

const autorizada = (extra: Record<string, unknown> = {}) => ({ existe: true, vigente: { generales: true, sensibles: false, menores: false, ofertas: false }, ...extra })
const valores = (extra: Record<string, unknown> = {}) => ({ nombre: 'Cliente de prueba', email: null, telefono: '3000000000', rol: null, segmento: null, custom_data: {}, ...extra })
const CAMPOS = [
  { slug: 'nombre', label: 'Nombre', tipo: 'texto' as const, required: true },
  { slug: 'telefono', label: 'Teléfono', tipo: 'telefono' as const, required: true },
  { slug: 'tipo_cliente', label: 'Tipo', tipo: 'select' as const, required: true, options: ['leisure', 'corporativo'] },
  { slug: 'notas', label: 'Notas', tipo: 'textarea' as const },
]

function fila(id: string, extra: Partial<ServicioDelNegocio> = {}): ServicioDelNegocio {
  return {
    id, tipo: 'hotel', nombre: id, proveedor_nombre: null, localizador: null, estado: 'reservado',
    fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 1_000_000, valor_por_pagar: null,
    voucher_ref: null, confirmacion_ref: null, orden: 0, origen: 'cotizacion', gastos: [], aprobaciones: [],
    ...extra,
  }
}
const pagada = (id: string) => fila(id, { gastos: [{ monto: 1_000_000, soporte_url: 'one://x', medio_pago: 'tc', titular_medio: 'empresa' }], confirmacion_ref: 'one://c' })

describe('tipoDerivado', () => {
  it('contacto con variante autorización, contacto de campos y servicios; lo demás no', () => {
    expect(tipoDerivado('contacto', { variante: 'autorizacion' })).toBe('autorizacion')
    expect(tipoDerivado('contacto', { variante: 'campos' })).toBe('ficha')
    expect(tipoDerivado('contacto', {})).toBe('ficha')
    expect(tipoDerivado('servicios', {})).toBe('servicios')
    expect(tipoDerivado('datos', {})).toBeNull()
  })
})

describe('autorización: el mismo veredicto del gate', () => {
  it('firmada y vigente = completo; sin firmar, sin contacto o con menores sin su casilla = pendiente', () => {
    expect(estadoAutorizacion(leerEstado(autorizada()), false)).toBe('completo')
    expect(estadoAutorizacion(leerEstado({ existe: true, vigente: {} }), false)).toBe('pendiente')
    expect(estadoAutorizacion(null, false)).toBe('pendiente')
    expect(estadoAutorizacion(leerEstado(autorizada()), true)).toBe('pendiente')
  })
})

describe('ficha: los campos obligatorios llenos en el contacto', () => {
  it('completa con los obligatorios; un vacío o en blanco la deja pendiente', () => {
    expect(estadoFicha(CAMPOS, valores({ custom_data: { tipo_cliente: 'leisure' } }))).toBe('completo')
    expect(estadoFicha(CAMPOS, valores())).toBe('pendiente')
    expect(estadoFicha(CAMPOS, valores({ telefono: '  ', custom_data: { tipo_cliente: 'leisure' } }))).toBe('pendiente')
    expect(estadoFicha(CAMPOS, null)).toBe('pendiente')
  })
})

describe('servicios: el mismo veredicto de servicios_listos', () => {
  it('con servicios y todos listos = completo; sin servicios o con uno pendiente = pendiente', () => {
    expect(estadoServicios([pagada('a'), pagada('b')], true)).toBe('completo')
    expect(estadoServicios([], true)).toBe('pendiente')
    expect(estadoServicios([pagada('a'), fila('b')], true)).toBe('pendiente')
    expect(estadoServicios([pagada('a'), { ...pagada('b'), aprobaciones: [{ estado: 'rechazada' }] }], true)).toBe('pendiente')
  })
})

describe('servicios en la etapa que pide vouchers (QA 2026-10-29, M1-1 y M6-1)', () => {
  it('la confirmación del último servicio antes que su voucher: en E5 completo, en E6 pendiente hasta el voucher', () => {
    const sinVoucher = [{ ...pagada('vuelo'), voucher_ref: 'one://v' }, pagada('traslado')]
    expect(estadoServicios(sinVoucher, true)).toBe('completo')
    expect(estadoServicios(sinVoucher, true, true)).toBe('pendiente')
    const conVoucher = sinVoucher.map(f => ({ ...f, voucher_ref: 'one://v' }))
    expect(estadoServicios(conVoucher, true, true)).toBe('completo')
  })
})

describe('cambiosDeEstado', () => {
  it('escribe solo lo que cambia, en los dos sentidos; sin veredicto o con otro estado no toca', () => {
    expect(cambiosDeEstado([
      { instanciaId: 'a', actual: 'pendiente', derivado: 'completo' },
      { instanciaId: 'b', actual: 'completo', derivado: 'pendiente' },
      { instanciaId: 'c', actual: 'completo', derivado: 'completo' },
      { instanciaId: 'd', actual: 'pendiente', derivado: null },
      { instanciaId: 'e', actual: 'rechazado', derivado: 'completo' },
    ])).toEqual({ completar: ['a'], reabrir: ['b'] })
  })
})

describe('derivarEstadosDeBloques (lee de donde vive el dato)', () => {
  function db(opts: { contacto?: unknown; caidas?: string[]; bloquesData?: unknown[] } = {}) {
    return {
      from(tabla: string) {
        const res = opts.caidas?.includes(tabla)
          ? { data: null, error: { message: 'caída' } }
          : tabla === 'contactos'
            ? { data: opts.contacto ?? null, error: null }
            : tabla === 'negocio_bloques'
              ? { data: (opts.bloquesData ?? []).map(d => ({ data: d })), error: null }
              : { data: [], error: null }
        const q: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'neq', 'order']) q[m] = () => q
        q.maybeSingle = () => Promise.resolve(res)
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok)
        return q
      },
    }
  }
  const BLOQUES = [
    { instanciaId: 'nb-aut', tipo: 'autorizacion' as const },
    { instanciaId: 'nb-ficha', tipo: 'ficha' as const, campos: CAMPOS },
  ]

  it('la autorización firmada pone el bloque en completo; revocada, en pendiente (el caso de Mauricio)', async () => {
    rpc = { estado: autorizada(), error: null }
    const ok = await derivarEstadosDeBloques(db({ contacto: valores({ custom_data: { tipo_cliente: 'leisure' } }) }), { workspaceId: 'w', negocioId: 'n', contactoId: 'c', configLinea: {}, bloques: BLOQUES })
    expect(ok.get('nb-aut')).toBe('completo')
    expect(ok.get('nb-ficha')).toBe('completo')
    rpc = { estado: { existe: true, vigente: {}, requiere_reaceptar: true }, error: null }
    const rev = await derivarEstadosDeBloques(db({ contacto: valores() }), { workspaceId: 'w', negocioId: 'n', contactoId: 'c', configLinea: {}, bloques: BLOQUES })
    expect(rev.get('nb-aut')).toBe('pendiente')
    expect(rev.get('nb-ficha')).toBe('pendiente')
  })

  it('con menores en el viaje exige su casilla, como el gate', async () => {
    rpc = { estado: autorizada(), error: null }
    const r = await derivarEstadosDeBloques(db({ bloquesData: [{ adultos: 2, ninos: 1 }] }), { workspaceId: 'w', negocioId: 'n', contactoId: 'c', configLinea: {}, bloques: BLOQUES.slice(0, 1) })
    expect(r.get('nb-aut')).toBe('pendiente')
  })

  it('lo que no se puede leer queda sin veredicto (no se toca)', async () => {
    rpc = { estado: null, error: 'rpc caída' }
    const r = await derivarEstadosDeBloques(db({ caidas: ['contactos'] }), { workspaceId: 'w', negocioId: 'n', contactoId: 'c', configLinea: {}, bloques: BLOQUES })
    expect(r.get('nb-aut')).toBeNull()
    expect(r.get('nb-ficha')).toBeNull()
  })

  it('servicios: con la línea apagada no hay veredicto; encendida y sin servicios, pendiente', async () => {
    const b = [{ instanciaId: 'nb-sv', tipo: 'servicios' as const }]
    expect((await derivarEstadosDeBloques(db(), { workspaceId: 'w', negocioId: 'n', contactoId: null, configLinea: {}, bloques: b })).get('nb-sv')).toBeNull()
    expect((await derivarEstadosDeBloques(db(), { workspaceId: 'w', negocioId: 'n', contactoId: null, configLinea: { servicios_viaje: { activo: true } }, bloques: b })).get('nb-sv')).toBe('pendiente')
  })
})
