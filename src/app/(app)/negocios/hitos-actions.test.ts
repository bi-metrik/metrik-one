/**
 * Acciones de los hitos (brief del 2026-10-22): adjuntar el pasabordo marca hecho; «No aplica» sin
 * motivo se rechaza; un hito ajeno no se cierra; una llave vieja (fecha cambiada) no se acepta.
 * Datos ficticios.
 *
 * VISTO FALLAR (2026-10-22): `guardar(ctx, 'hecho', v.nota, referencia)` con `null` en vez de la
 * referencia → cae «adjuntar el pasabordo marca hecho con su referencia»; quitar `validarCierreHito`
 * de `marcarHito` → cae «“No aplica” sin motivo se rechaza y no escribe».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configHitos, hitosDelViaje, type ViajeHitos } from '@/lib/viaje/hitos'

const ALE = 'staff-asesora-a'
const OTRA = 'staff-otra'
const EDGAR = 'staff-direccion'

let quien = { staffId: ALE, role: 'operator' }
const escritas: Array<{ tabla: string; op: string; fila: unknown; opciones?: unknown }> = []
const subidas: string[] = []

function fakeDb() {
  return {
    from(tabla: string) {
      const q: Record<string, unknown> = {}
      let op = 'select'
      const ret = () => {
        if (tabla === 'negocios') return { data: { id: 'neg-1', estado: 'abierto', linea_id: 'linea-1', lineas_negocio: { config_extra: { hitos: { activo: true }, aprobaciones: { staff_ids: [EDGAR] } } } }, error: null }
        if (tabla === 'negocio_responsables') return { data: [{ staff_id: 'staff-comercial' }], error: null }
        return { data: [], error: null }
      }
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        is: () => q,
        maybeSingle: async () => ret(),
        then: (r: (v: unknown) => unknown) => Promise.resolve(ret()).then(r),
        upsert: async (fila: unknown, opciones: unknown) => { escritas.push({ tabla, op: 'upsert', fila, opciones }); return { error: null } },
        delete: () => { op = 'delete'; escritas.push({ tabla, op, fila: null }); return q },
      })
      return q
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: fakeDb(), workspaceId: '00000000-0000-4000-8000-0000000000a1', staffId: quien.staffId, role: quien.role, areas: ['operaciones'], error: null }),
}))
vi.mock('@/lib/modulos/exigir-modulo', () => ({ exigirModulo: async () => ({ ok: true }), MENSAJE_MODULO_NO_ACTIVO: 'no', REQUISITO: { clarity: 'clarity' } }))
vi.mock('@/lib/almacenamiento/one', () => ({
  subirAOne: async ({ path }: { path: string }) => { subidas.push(path); return { referencia: `one://documentos-one/${path}` } },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const viaje: ViajeHitos = {
  id: 'neg-1', nombre: 'P 26 1 — Viaje de prueba', cliente: 'Viajera Ficticia', estado: 'abierto', etapaNumero: 5, esPrueba: false,
  salida: '2026-11-12', regreso: '2026-11-15', internacional: false, destino: null, confirmadoEl: '2026-10-01', documentosCompletos: true,
  comercialStaffId: 'staff-comercial', operacionesStaffId: null, aprobadoresStaffIds: [EDGAR], catalogo: configHitos({ hitos: { activo: true } }),
  servicios: [{ id: 'vuelo-1', tipo: 'vuelo', nombre: 'Vuelo de prueba', estado: 'por_reservar', responsable_staff_id: ALE, fecha_servicio: '2026-11-12', hora_inicio: null, fecha_fin: null, hora_fin: null,
    tramos: [{ fecha: '2026-11-12', hora_salida: '07:00', origen: 'BOG', destino: 'CTG', aerolinea: 'Avianca', numero_vuelo: 'AV1' }], voucher_ref: null, confirmacion_ref: null }],
  marcas: [],
}
const hitos = hitosDelViaje(viaje, '2026-11-09')
const checkin = hitos.find(h => h.hitoId === 'checkin_vuelo')!

vi.mock('@/lib/viaje/hitos-datos', () => ({ hitosDelNegocio: async () => ({ viaje, hitos }) }))

const { adjuntarHito, marcarHito, deshacerHito } = await import('./hitos-actions')

function archivo(): FormData {
  const fd = new FormData()
  fd.set('negocioId', 'neg-1')
  fd.set('llave', checkin.llave)
  fd.set('file', new File([new Uint8Array([1, 2, 3])], 'pasabordo.png', { type: 'image/png' }))
  return fd
}

beforeEach(() => {
  escritas.length = 0
  subidas.length = 0
  quien = { staffId: ALE, role: 'operator' }
})

describe('acciones de hitos', () => {
  it('adjuntar el pasabordo marca hecho con su referencia', async () => {
    expect(await adjuntarHito(archivo())).toEqual({ ok: true })
    expect(subidas[0]).toMatch(/^00000000-0000-4000-8000-0000000000a1\/negocios\/neg-1\/hitos\/checkin_vuelo-t1-\d+\.png$/)
    expect(escritas).toHaveLength(1)
    const fila = escritas[0].fila as Record<string, unknown>
    expect(fila).toMatchObject({ workspace_id: '00000000-0000-4000-8000-0000000000a1', negocio_id: 'neg-1', servicio_id: 'vuelo-1', tramo: 1, hito_id: 'checkin_vuelo', fecha_objetivo: '2026-11-12', estado: 'hecho', hecho_por: ALE })
    expect(String(fila.evidencia_ref)).toMatch(/^one:\/\/documentos-one\//)
    expect(escritas[0].opciones).toEqual({ onConflict: 'negocio_id,servicio_id,tramo,hito_id,fecha_objetivo' })
  })

  it('el check-in sin adjunto no se marca hecho', async () => {
    const r = await marcarHito({ negocioId: 'neg-1', llave: checkin.llave, estado: 'hecho' })
    expect(r).toEqual({ ok: false, error: 'Adjunta el pasabordo: adjuntarlo marca el check-in hecho.' })
    expect(escritas).toHaveLength(0)
  })

  it('«No aplica» sin motivo se rechaza y no escribe; con motivo se guarda', async () => {
    expect(await marcarHito({ negocioId: 'neg-1', llave: checkin.llave, estado: 'no_aplica', nota: ' ' })).toEqual({ ok: false, error: 'Escribe por qué no aplica.' })
    expect(escritas).toHaveLength(0)
    expect(await marcarHito({ negocioId: 'neg-1', llave: checkin.llave, estado: 'no_aplica', nota: 'El cliente hizo su check-in' })).toEqual({ ok: true })
    expect((escritas[0].fila as Record<string, unknown>).estado).toBe('no_aplica')
  })

  it('un hito de otra persona no se cierra (salvo la dirección)', async () => {
    quien = { staffId: OTRA, role: 'operator' }
    expect((await adjuntarHito(archivo())).ok).toBe(false)
    expect(subidas).toHaveLength(0)
    quien = { staffId: EDGAR, role: 'operator' }
    expect(await adjuntarHito(archivo())).toEqual({ ok: true })
  })

  it('una llave vieja (la fecha del servicio cambió) no se acepta', async () => {
    const r = await marcarHito({ negocioId: 'neg-1', llave: checkin.llave.replace('2026-11-12', '2026-11-10'), estado: 'no_aplica', nota: 'x' })
    expect(r.ok).toBe(false)
    expect(escritas).toHaveLength(0)
  })

  it('deshacer sin marca no hace nada', async () => {
    expect(await deshacerHito({ negocioId: 'neg-1', llave: checkin.llave })).toEqual({ ok: false, error: 'No hay nada que deshacer.' })
  })
})
