/**
 * «Marcar el viaje como Bloqueo» contra un doble de Supabase que PERSISTE: se afirma lo que quedó escrito
 * en `negocio_bloques`, no lo que la acción dice. El caso real: Condiciones del viaje es de Solicitud
 * (etapa ya superada), está «completo» y la config no trae `corregir_campos_gerencial`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let permiso: { ok: boolean; error?: string } = { ok: true }
let postAvance = true
const correcciones: unknown[] = []
const actividades: Fila[] = []
const revalidadas: string[] = []

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => { revalidadas.push(p) } }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-1', userId: 'p-1', staffId: 's-1', error: null }),
}))
vi.mock('@/lib/permissions/guard-negocio', () => ({ guardEditarBloque: async () => permiso }))
vi.mock('@/lib/negocios/casilla-compartida', () => ({ resolverDestinoCompartido: async (_s: unknown, id: string) => id }))
vi.mock('@/lib/correcciones/registrar', () => ({
  contextoCorreccion: async () => ({ esPostAvance: postAvance, permiteCorregir: false, dataPrevia: {} }),
  registrarCorrecciones: async (p: unknown) => { correcciones.push(p); return { registradas: 1 } },
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, f: Fila) => { actividades.push(f); return { ok: true, id: 'a-1' } },
}))

const CONFIG_CONDICIONES = {
  config_extra: { label: 'Condiciones del viaje', fields: [{ slug: 'destino' }, { slug: 'modalidad_viaje' }, { slug: 'operador_bloqueo' }] },
  bloque_definitions: { tipo: 'datos' },
}

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' = 'select'
  let payload: Fila = {}
  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(f => filtros.every(([c, v]) => f[c] === v))
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload))
      return { data: filas, error: null }
    }
    return { data: filas.map(f => structuredClone(f)), error: null }
  }
  const q = {
    select: () => q,
    update: (p: Fila) => { operacion = 'update'; payload = p; return q },
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return q },
    maybeSingle: async () => { const r = ejecutar(); return { data: r.data[0] ?? null, error: null } },
    single: async () => { const r = ejecutar(); return { data: r.data[0] ?? null, error: r.data[0] ? null : { message: 'no' } } },
    then: (ok: (r: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok),
  }
  return q
}

let accion: typeof import('./modalidad-actions').cambiarModalidadDelViaje

beforeEach(async () => {
  permiso = { ok: true }
  postAvance = true
  correcciones.length = 0
  actividades.length = 0
  revalidadas.length = 0
  tablas = {
    cotizaciones: [{ id: 'cot-1', negocio_id: 'neg-1' }],
    negocio_bloques: [
      { id: 'nb-otro', negocio_id: 'neg-1', estado: 'completo', data: { nombre: 'x' }, bloque_configs: { config_extra: { fields: [{ slug: 'nombre' }] }, bloque_definitions: { tipo: 'datos' } } },
      {
        id: 'nb-cond', negocio_id: 'neg-1', estado: 'completo',
        data: { destino: 'SAN ANDRÉS', adultos: 3, modalidad_viaje: '', _sugeridos: { destino: { fuente: 'whatsapp' } } },
        bloque_configs: CONFIG_CONDICIONES,
      },
    ],
  }
  accion = (await import('./modalidad-actions')).cambiarModalidadDelViaje
})

const fila = (id: string) => tablas.negocio_bloques.find(f => f.id === id)!

describe('cambiarModalidadDelViaje', () => {
  it('escribe modalidad_viaje = bloqueo en Condiciones del viaje, completo y de etapa superada; lo demás intacto', async () => {
    const r = await accion('cot-1', 'bloqueo')
    expect(r).toEqual({ success: true })
    expect(fila('nb-cond').data).toEqual({ destino: 'SAN ANDRÉS', adultos: 3, modalidad_viaje: 'bloqueo', _sugeridos: { destino: { fuente: 'whatsapp' } } })
    // El estado del bloque no se toca.
    expect(fila('nb-cond').estado).toBe('completo')
    expect(fila('nb-otro').data).toEqual({ nombre: 'x' })
    // Etapa superada: la traza de corrección de siempre, con el valor nuevo.
    expect(correcciones).toHaveLength(1)
    expect(correcciones[0]).toMatchObject({ negocioBloqueId: 'nb-cond', causa: 'dato_posterior', campos: [{ slug: 'modalidad_viaje', antes: null, despues: 'Bloqueo' }] })
    expect(actividades).toHaveLength(0)
    expect(revalidadas).toEqual(['/negocios/neg-1'])
  })

  it('en la etapa vigente deja un evento en el timeline, no una corrección', async () => {
    postAvance = false
    await accion('cot-1', 'bloqueo')
    expect(correcciones).toHaveLength(0)
    expect(actividades[0]).toMatchObject({ entidad_id: 'neg-1', campo_modificado: 'modalidad_viaje', valor_nuevo: 'Bloqueo', autor_id: 's-1' })
  })

  it('sin permiso para editar el bloque no escribe', async () => {
    permiso = { ok: false, error: 'Tu área no edita este bloque' }
    const r = await accion('cot-1', 'bloqueo')
    expect(r).toEqual({ success: false, error: 'Tu área no edita este bloque' })
    expect(fila('nb-cond').data).toMatchObject({ modalidad_viaje: '' })
  })

  it('un negocio sin el campo (otro workspace) no escribe nada', async () => {
    tablas.negocio_bloques = tablas.negocio_bloques.filter(f => f.id !== 'nb-cond')
    const r = await accion('cot-1', 'bloqueo')
    expect(r.success).toBe(false)
    expect(fila('nb-otro').data).toEqual({ nombre: 'x' })
  })

  it('un valor fuera de los dos no escribe', async () => {
    const r = await accion('cot-1', 'playa' as never)
    expect(r.success).toBe(false)
    expect(fila('nb-cond').data).toMatchObject({ modalidad_viaje: '' })
  })

  it('si ya es Bloqueo, no escribe ni deja traza', async () => {
    fila('nb-cond').data = { modalidad_viaje: 'bloqueo' }
    const r = await accion('cot-1', 'bloqueo')
    expect(r).toEqual({ success: true })
    expect(correcciones).toHaveLength(0)
    expect(actividades).toHaveLength(0)
  })
})
