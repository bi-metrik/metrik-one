/**
 * El origen de la asignación (`negocio_responsables.asignado_origen`, migración 20261026090000) que escribe la única
 * escritura de responsables (app y bot). Con persona = `persona`; el bot sin persona y la regla por etapa lo declaran.
 */
import { describe, expect, it } from 'vitest'
import { asignarResponsableCon, origenDeAsignacion } from './asignar-responsable'

type Fila = Record<string, unknown>

function fakeDb() {
  const upserts: Fila[] = []
  const client = {
    from(tabla: string) {
      const q = {
        select: () => q, eq: () => q, delete: () => q,
        upsert: (fila: Fila) => { upserts.push(fila); return Promise.resolve({ error: null }) },
        maybeSingle: async () => {
          if (tabla === 'negocios') return { data: { workspace_id: 'ws-1' } }
          if (tabla === 'staff') return { data: { id: 'st-x', full_name: 'Alejandra Pinto' } }
          return { data: null }
        },
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: tabla === 'staff_areas' ? [{ area: 'comercial' }] : [] }).then(ok),
      }
      return q
    },
  }
  return { client, upserts }
}

describe('origen de la asignación', () => {
  it('sin declararlo: persona si alguien asignó, null si no', () => {
    expect(origenDeAsignacion({ assignedBy: 'p-edgar' })).toBe('persona')
    expect(origenDeAsignacion({ assignedBy: null })).toBeNull()
    expect(origenDeAsignacion({ assignedBy: null, origen: 'bot_whatsapp' })).toBe('bot_whatsapp')
  })

  it('Edgar elige a Alejandra desde el bot: assigned_by = perfil de Edgar y origen persona', async () => {
    const { client, upserts } = fakeDb()
    await asignarResponsableCon(client, { negocioId: 'n1', staffId: 'st-ale', assignedBy: 'p-edgar', origen: 'persona' }, async () => {})
    expect(upserts[0]).toMatchObject({ staff_id: 'st-ale', assigned_by: 'p-edgar', asignado_origen: 'persona', asignado_etapa_id: null })
  })

  it('el bot sin persona y la regla por etapa (con su etapa)', async () => {
    const a = fakeDb()
    await asignarResponsableCon(a.client, { negocioId: 'n1', staffId: 'st-ale', assignedBy: null, origen: 'bot_whatsapp' }, async () => {})
    expect(a.upserts[0]).toMatchObject({ assigned_by: null, asignado_origen: 'bot_whatsapp', asignado_etapa_id: null })
    const b = fakeDb()
    await asignarResponsableCon(b.client, { negocioId: 'n1', staffId: 'st-ale', assignedBy: null, origen: 'regla_etapa', etapaId: 'et-1' }, async () => {})
    expect(b.upserts[0]).toMatchObject({ asignado_origen: 'regla_etapa', asignado_etapa_id: 'et-1' })
  })

  it('la etapa solo se escribe con origen regla_etapa', async () => {
    const { client, upserts } = fakeDb()
    await asignarResponsableCon(client, { negocioId: 'n1', staffId: 'st-ale', assignedBy: 'p-edgar', etapaId: 'et-1' }, async () => {})
    expect(upserts[0]).toMatchObject({ asignado_origen: 'persona', asignado_etapa_id: null })
  })
})
