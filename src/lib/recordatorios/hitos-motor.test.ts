/**
 * Hitos en la campana (regla 7 del brief del 2026-10-22): resumen diario por persona y un solo
 * aviso a la dirección por hito vencido. Dos corridas el mismo día = un aviso. En día no hábil no
 * sale nada (y nada se pierde: lo del fin de semana va en el resumen del viernes). Datos ficticios.
 *
 * VISTO FALLAR (2026-10-22): quitar el `reclamar` del escalamiento (insertar directo) → cae «dos
 * corridas = un aviso a Edgar»; quitar la consulta previa del resumen → cae «el resumen no se repite».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configHitos, type ViajeHitos } from '@/lib/viaje/hitos'

const EDGAR = 'staff-direccion'
const ALE = 'staff-asesora-a'
const DANI = 'staff-asesora-d'
const WS = '00000000-0000-4000-8000-0000000000a1'
const LLAVE_LOG = ['regla_id', 'entidad_id', 'fecha_objetivo', 'destinatario', 'canal']

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let seq = 0

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  let payload: Fila | Fila[] = {}
  let opciones: { ignoreDuplicates?: boolean } = {}
  const correr = async () => {
    tablas[tabla] ??= []
    if (op === 'insert' || op === 'upsert') {
      const out: Fila[] = []
      for (const f of (Array.isArray(payload) ? payload : [payload]).map((x): Fila => ({ id: `id-${++seq}`, ...x }))) {
        if (tabla === 'recordatorios_log' && tablas[tabla].some(e => LLAVE_LOG.every(k => e[k] === f[k]))) {
          if (op === 'upsert' && opciones.ignoreDuplicates) continue
          return { data: null, error: { message: 'duplicate key', code: '23505' } }
        }
        tablas[tabla].push(f)
        out.push(f)
      }
      return { data: out, error: null }
    }
    const filas = tablas[tabla].filter(f => filtros.every(p => p(f)))
    if (op === 'update') { filas.forEach(f => Object.assign(f, payload)); return { data: filas, error: null } }
    return { data: filas.map(f => ({ ...f })), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    insert: (p: Fila) => { op = 'insert'; payload = p; return q },
    upsert: (p: Fila, o: { ignoreDuplicates?: boolean }) => { op = 'upsert'; payload = p; opciones = o ?? {}; return q },
    update: (p: Fila) => { op = 'update'; payload = p; return q },
    eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return q },
    in: (c: string, v: unknown[]) => { filtros.push(f => v.includes(f[c])); return q },
    filter: () => q,
    limit: () => q,
    maybeSingle: async () => { const r = await correr(); return { data: (r.data ?? [])[0] ?? null, error: r.error } },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => correr().then(res, rej),
  }
  return q
}
const svc = { from: (t: string) => consulta(t), rpc: async () => ({ data: [], error: null }) }

const viaje: ViajeHitos = {
  id: 'neg-1', workspaceId: WS, nombre: 'P 26 1 — Viaje de prueba', cliente: 'Viajera Ficticia', estado: 'abierto', etapaNumero: 5, esPrueba: false,
  salida: '2026-11-09', regreso: '2026-11-12', internacional: false, destino: null, confirmadoEl: '2026-10-01', documentosCompletos: true,
  comercialStaffId: ALE, operacionesStaffId: null, aprobadoresStaffIds: [EDGAR], catalogo: configHitos({ hitos: { activo: true } }),
  servicios: [
    // Vuelo del lunes 9 a las 6:10 → check-in el sábado 7 a las 6:10 → lo cubre Edgar.
    { id: 'vuelo-1', tipo: 'vuelo', nombre: 'Vuelo', estado: 'por_reservar', responsable_staff_id: ALE, fecha_servicio: '2026-11-09', hora_inicio: null, fecha_fin: null, hora_fin: null,
      tramos: [{ fecha: '2026-11-09', hora_salida: '06:10', origen: 'BOG', destino: 'CTG', aerolinea: 'Avianca', numero_vuelo: 'AV1' }], voucher_ref: null, confirmacion_ref: null },
    // Hotel del domingo 8 → reconfirmar el jueves 5: el viernes 6 está vencido.
    { id: 'hotel-1', tipo: 'hotel', nombre: 'Hotel de prueba', estado: 'por_reservar', responsable_staff_id: DANI, fecha_servicio: '2026-11-08', hora_inicio: null, fecha_fin: null, hora_fin: null, tramos: null, voucher_ref: null, confirmacion_ref: null },
    // Tour del sábado 7 → detalles el viernes 6: el «Hoy» de Alejandra.
    { id: 'tour-1', tipo: 'actividad', nombre: 'Tour de prueba', estado: 'por_reservar', responsable_staff_id: ALE, fecha_servicio: '2026-11-07', hora_inicio: null, fecha_fin: null, hora_fin: null, tramos: null, voucher_ref: null, confirmacion_ref: null },
    // «No va»: nada.
    { id: 'tour-2', tipo: 'actividad', nombre: 'Tour que no va', estado: 'cancelado', responsable_staff_id: ALE, fecha_servicio: '2026-11-05', hora_inicio: null, fecha_fin: null, hora_fin: null, tramos: null, voucher_ref: null, confirmacion_ref: null },
  ],
  marcas: [],
}

vi.mock('@/lib/viaje/hitos-datos', () => ({ leerViajesParaHitos: async () => [viaje] }))

const { correrHitos } = await import('./hitos-motor')

beforeEach(() => {
  seq = 0
  tablas = {
    lineas_negocio: [{ id: 'linea-1', workspace_id: WS, config_extra: { hitos: { activo: true }, aprobaciones: { staff_ids: [EDGAR] } } }],
    staff: [
      { id: EDGAR, profile_id: 'perfil-edgar', full_name: 'Edgar Ficticio', workspace_id: WS },
      { id: ALE, profile_id: 'perfil-ale', full_name: 'Alejandra Ficticia', workspace_id: WS },
      { id: DANI, profile_id: 'perfil-dani', full_name: 'Daniela Ficticia', workspace_id: WS },
    ],
    notificaciones: [],
    recordatorios_log: [],
  }
})

const de = (tipo: string, perfil?: string) => tablas.notificaciones.filter(n => n.tipo === tipo && (!perfil || n.destinatario_id === perfil))

describe('hitos en la campana', () => {
  it('viernes: resumen por persona (Edgar con el fin de semana) y un aviso de vencido a Edgar; dos corridas = un aviso', async () => {
    const r1 = await correrHitos(svc, { hoy: '2026-11-06' })
    const r2 = await correrHitos(svc, { hoy: '2026-11-06' })
    expect(r1.escalados).toBe(1)
    expect(r2.escalados).toBe(0)
    expect(r2.escalados_ya).toBe(1)

    const vencidos = de('hito_vencido')
    expect(vencidos).toHaveLength(1)
    expect(vencidos[0]).toMatchObject({ destinatario_id: 'perfil-edgar', entidad_tipo: 'servicio', entidad_id: 'hotel-1', deep_link: '/negocios/neg-1' })
    expect(String(vencidos[0].contenido)).toContain('Daniela no ha hecho: reconfirmar la reserva con el hotel')

    expect(de('agenda_del_dia', 'perfil-edgar')).toHaveLength(1)
    expect(String(de('agenda_del_dia', 'perfil-edgar')[0].contenido)).toContain('Este fin de semana tienes 1: sáb 7 nov 06:10 · check-in')
    expect(de('agenda_del_dia', 'perfil-ale')).toHaveLength(1)
    expect(de('agenda_del_dia', 'perfil-ale')[0].contenido).toBe('Hoy tienes 1 gestión: 1 tour.')
    expect(de('agenda_del_dia', 'perfil-ale')[0].deep_link).toBe('/negocios?vista=pendientes')
    // Daniela solo tiene un vencido: eso va a Edgar, no a su resumen.
    expect(de('agenda_del_dia', 'perfil-dani')).toHaveLength(0)
    // Nada al viajero, nada por el tour que no va.
    expect(tablas.notificaciones.some(n => String(n.destinatario_id).startsWith('cliente:'))).toBe(false)
    expect(tablas.notificaciones.some(n => n.entidad_id === 'tour-2')).toBe(false)
  })

  it('sábado (no hábil): no sale nada', async () => {
    const r = await correrHitos(svc, { hoy: '2026-11-07' })
    expect(r.dia_no_habil).toBe(true)
    expect(tablas.notificaciones).toHaveLength(0)
  })

  it('un hito ya hecho no se escala', async () => {
    viaje.marcas = [{ servicio_id: 'hotel-1', tramo: null, hito_id: 'reconfirmar_hotel', fecha_objetivo: '2026-11-08', estado: 'hecho', evidencia_ref: null, nota: 'Correo del hotel', hecho_por: DANI, hecho_at: '2026-11-05T15:00:00Z' }]
    try {
      const r = await correrHitos(svc, { hoy: '2026-11-06' })
      expect(r.escalados).toBe(0)
      expect(de('hito_vencido')).toHaveLength(0)
    } finally {
      viaje.marcas = []
    }
  })
})
