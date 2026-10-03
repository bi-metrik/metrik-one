import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El bono de operaciones pasa por el caché compartido del workspace, pero el recorte
 * del dinero ajeno es por PERSONA. Este archivo prueba que el recorte se hace después
 * del caché: la entrada guardada por quien lo ve todo no le llega entera a un operativo.
 */

import { almacen } from '../../../../test/cache-incremental-doble'

const sesion = vi.hoisted(() => ({ actual: null as unknown }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => sesion.actual,
}))

import { getOperacionesBono } from './operaciones-actions'

const WS = '11111111-1111-1111-1111-111111111111'
const ANA = 'staff-ana'
const LUIS = 'staff-luis'
const JEFA = 'staff-jefa'

const respuestaBono = {
  personas: [
    { staff_id: ANA, nombre: 'Ana', bono: 500000 },
    { staff_id: LUIS, nombre: 'Luis', bono: 300000 },
  ],
  supervisor: { staff_id: JEFA, nombre: 'Jefa', bono: 900000 },
}

function cliente() {
  const llamadas: string[] = []
  return {
    llamadas,
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'current_user_workspace_id') return { data: WS, error: null }
      llamadas.push(fn)
      return { data: structuredClone(respuestaBono), error: null }
    }),
  }
}

beforeEach(() => almacen.clear())

describe('getOperacionesBono con caché', () => {
  it('la supervisora llena el caché; el operativo sale de él y solo ve SU bono', async () => {
    const deLaJefa = cliente()
    sesion.actual = { supabase: deLaJefa, workspaceId: WS, role: 'supervisor', staffId: JEFA }
    const vistaJefa = await getOperacionesBono(2026, 10)
    expect(deLaJefa.llamadas).toEqual(['get_operaciones_bono_resumen'])
    expect(vistaJefa?.personas.map((p) => p.bono)).toEqual([500000, 300000])

    const deAna = cliente()
    sesion.actual = { supabase: deAna, workspaceId: WS, role: 'operator', staffId: ANA }
    const vistaAna = await getOperacionesBono(2026, 10)
    expect(deAna.llamadas).toEqual([]) // salió del caché
    expect(vistaAna?.personas.map((p) => p.bono)).toEqual([500000, undefined])
    expect(vistaAna?.supervisor).toBeNull()

    // Y el recorte de Ana no ensució la entrada: la jefa sigue viendo todo.
    sesion.actual = { supabase: cliente(), workspaceId: WS, role: 'supervisor', staffId: JEFA }
    const otraVez = await getOperacionesBono(2026, 10)
    expect(otraVez?.personas.map((p) => p.bono)).toEqual([500000, 300000])
    expect(otraVez?.supervisor?.bono).toBe(900000)
  })

  it('la entrada guardada es la respuesta cruda de la RPC, sin recorte de nadie', async () => {
    sesion.actual = { supabase: cliente(), workspaceId: WS, role: 'operator', staffId: ANA }
    await getOperacionesBono(2026, 10)
    expect(almacen.size).toBe(1)
    const [entrada] = [...almacen.values()]
    expect(JSON.parse(entrada.body)).toEqual(respuestaBono)
  })
})
