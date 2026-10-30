import { describe, expect, it } from 'vitest'
import type { FilaPublica, TrazaPublica } from './tipos'
import { filasDelTramo, turnosConIA } from './topes'
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
