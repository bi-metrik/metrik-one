import { describe, expect, it } from 'vitest'
import type { FilaPublica, TrazaPublica } from './tipos'
import { desdeCierre, filasDelTramo, turnosConIA } from './topes'
import { motivoAviso } from './autorizacion'
import { cierreDeChatwoot } from './chatwoot-webhook'
import { fotosDelTurno, fotosYaEnviadas } from './ventas/fotos-ventas'
import type { ProductoVenta } from './ventas/catalogo-ventas'

// 30-oct, Dimpro: Messenger reusa la misma conversación; tras 31 turnos en dos días el bot pasó a persona por el tope
// y no mandó las fotos del MP-15 y el MP-17 porque ya habían salido el día anterior.
const turno = (traza: Partial<TrazaPublica>) => ({ direccion: 'entrante', texto: 'x', traza: { tipo: 'modelo', ...traza } }) as unknown as FilaPublica
const foto = (codigo: string) => ({ codigo, ok: true }) as unknown as NonNullable<TrazaPublica['fotos']>[number]

describe('el tramo de la conversación', () => {
  it('cuenta desde el último aviso de bienvenida', () => {
    const viejo = [turno({ aviso: { clave: 'rf.bienvenida' } as TrazaPublica['aviso'] }), ...Array.from({ length: 29 }, () => turno({}))]
    const nuevo = [turno({ aviso: { clave: 'rf.bienvenida' } as TrazaPublica['aviso'] }), turno({})]
    expect(turnosConIA([...viejo, ...nuevo])).toBe(32)
    expect(turnosConIA(filasDelTramo([...viejo, ...nuevo]))).toBe(2)
    expect(filasDelTramo(viejo.slice(1))).toHaveLength(29)
  })

  it('las fotos de un tramo anterior no cuentan como enviadas', () => {
    const filas = [turno({ aviso: { clave: 'rf.bienvenida' } as TrazaPublica['aviso'], fotos: [foto('MP-17')] }), turno({ aviso: { clave: 'rf.bienvenida' } as TrazaPublica['aviso'] }), turno({ fotos: [foto('MP-15')] })]
    expect([...fotosYaEnviadas(filas)]).toEqual([15])
  })

  it('un turno que abre tramo manda las fotos aunque ya hubieran salido', () => {
    const catalogo = [{ codigo: 'MP-17', nombre: 'Taladro', titulo: 'Taladro 20V', fotos: ['https://x/17.jpg'] }] as unknown as ProductoVenta[]
    const filas = [turno({ herramientas: [{ nombre: 'ver_catalogo', ok: true, datos: { productos: [{ codigo: 'MP-17', tiene_foto: true }] } }] as unknown as TrazaPublica['herramientas'], fotos: [foto('MP-17')] })]
    const p = { texto: 'MP-17 Taladro 20V, $324.900.', herramientas: undefined, catalogo, filas, pedido: 'quiero un taladro' }
    expect(fotosDelTurno(p)).toHaveLength(0)
    expect(fotosDelTurno({ ...p, tramoNuevo: true }).map((f) => f.codigo)).toEqual(['MP-17'])
  })
})

// 30-oct, Dimpro: Mauricio resolvió la conversación en Chatwoot y el «Hola» siguiente siguió con «¡Hola de nuevo!
// ¿Sigues buscando el taladro inalámbrico?». Resolver = empezar de nuevo.
describe('resolver en Chatwoot reinicia la conversación', () => {
  const fila = (id: string, created_at: string, traza: Partial<TrazaPublica> | null, direccion = 'entrante') => ({ id, direccion, texto: 'x', created_at, traza }) as unknown as FilaPublica
  it('lee el cierre de los dos eventos de Chatwoot, y nada más', () => {
    expect(cierreDeChatwoot({ event: 'conversation_status_changed', status: 'resolved', id: 4, inbox_id: 5 })).toEqual({ conversacionId: 4, inboxId: 5, cuentaId: null })
    expect(cierreDeChatwoot({ event: 'message_created', message_type: 'activity', account: { id: 77 }, inbox: { id: 5 }, conversation: { id: 4, status: 'resolved' } })).toEqual({ conversacionId: 4, inboxId: 5, cuentaId: 77 })
    expect(cierreDeChatwoot({ event: 'conversation_status_changed', status: 'open', id: 4 })).toBeNull()
    expect(cierreDeChatwoot({ event: 'message_created', message_type: 'incoming', conversation: { id: 4, status: 'resolved' } })).toBeNull()
  })
  it('después de la marca, el próximo mensaje es «el primero»: con aviso y sin lo de antes', () => {
    const filas = [
      fila('a', '2026-10-30T20:00:00Z', { tipo: 'modelo', aviso: { clave: 'rf.bienvenida' } as TrazaPublica['aviso'] }),
      fila('b', '2026-10-30T20:01:00Z', { tipo: 'modelo' }),
      fila('c', '2026-10-30T21:05:00Z', { cierre: true } as Partial<TrazaPublica>, 'saliente'),
      fila('d', '2026-10-30T21:06:00Z', null),
    ]
    expect(motivoAviso(filas, new Set(['d']), 0, 24)).toBeNull()
    expect(desdeCierre(filas).map((f) => f.id)).toEqual(['d'])
    expect(motivoAviso(desdeCierre(filas), new Set(['d']), 0, 24)).toBe('primero')
    expect(desdeCierre(filas.slice(0, 2))).toHaveLength(2)
  })
})
