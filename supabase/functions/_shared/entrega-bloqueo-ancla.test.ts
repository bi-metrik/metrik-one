import { describe, expect, it } from 'vitest'
import { decidirAncla, pareceRespuesta, tieneSenalDeBloqueo, tituloDeEntrega, type EntregaAbierta } from './entrega-bloqueo-ancla'

/** El ancla del pedido (brief del 2026-11-04): lo citado va a su hilo; lo suelto, solo sin duda; si no, se pregunta. */

const AHORA = new Date('2026-11-04T20:10:00Z')
const ent = (x: Partial<EntregaAbierta> & { id: string }): EntregaAbierta => ({
  codigo: null, cliente: null, estado: 'recibiendo', wamids: [], tieneEncabezado: true, ultimaEn: '2026-11-04T20:09:00Z', ...x,
})
const texto = (t: string, ctx: string | null = null) => ({ tipo: 'texto' as const, texto: t, contextoWamid: ctx, botonId: null })
const imagen = (ctx: string | null = null) => ({ tipo: 'imagen' as const, texto: null, contextoWamid: ctx, botonId: null })

describe('señales', () => {
  it('reconoce el bloqueo dicho', () => {
    expect(tieneSenalDeBloqueo('es el bloqueo de aliados de navidad')).toBe(true)
    expect(tieneSenalDeBloqueo('Holaa cotízame esto para Laura Gómez porfa')).toBe(false)
  })
  it('reconoce una respuesta corta', () => {
    expect(pareceRespuesta('sí, 1 pública')).toBe(true)
    expect(pareceRespuesta('2 no aplica')).toBe(true)
    expect(pareceRespuesta('viaja con el esposo y la hija de 4 añitos')).toBe(false)
  })
  it('el título del botón cabe en 20 caracteres', () => {
    expect([...tituloDeEntrega({ codigo: 'COT-2026-0015', cliente: 'Marta Ruiz Peña' })].length).toBeLessThanOrEqual(20)
  })
})

describe('decidirAncla', () => {
  it('lo que cita un mensaje del hilo va a ese pedido, aunque haya otros abiertos', () => {
    const a = ent({ id: 'A', estado: 'por_confirmar', wamids: ['wa1', 'out-a'] })
    const b = ent({ id: 'B', estado: 'por_confirmar', wamids: ['wb1', 'out-b'] })
    expect(decidirAncla(texto('sí, 1 pública', 'out-b'), [a, b], 'p', AHORA)).toEqual({ accion: 'responder', entregaId: 'B' })
    expect(decidirAncla(imagen('out-a'), [a, b], 'p', AHORA)).toEqual({ accion: 'agregar', entregaId: 'A' })
  })

  it('un pantallazo suelto con dos pedidos abiertos se pregunta, nunca se adivina', () => {
    const a = ent({ id: 'A', codigo: 'COT-2026-0101', cliente: 'Laura Gómez' })
    const b = ent({ id: 'B', codigo: 'COT-2026-0102', cliente: 'Marta Ruiz' })
    const d = decidirAncla(imagen(), [a, b], 'pz9', AHORA)
    expect(d.accion).toBe('preguntar')
    if (d.accion === 'preguntar') {
      expect(d.opciones.map(o => o.id)).toEqual(['eb|asignar|A|pz9', 'eb|asignar|B|pz9', 'eb|asignar|nuevo|pz9'])
      expect(d.opciones.length).toBeLessThanOrEqual(3)
    }
  })

  it('un pantallazo suelto con un solo pedido en curso y nada esperando respuesta va a ese', () => {
    expect(decidirAncla(imagen(), [ent({ id: 'A' })], 'p', AHORA)).toEqual({ accion: 'agregar', entregaId: 'A' })
  })

  it('un pantallazo suelto con un pedido en curso y otro esperando respuesta se pregunta', () => {
    const d = decidirAncla(imagen(), [ent({ id: 'A' }), ent({ id: 'B', estado: 'por_confirmar' })], 'p', AHORA)
    expect(d.accion).toBe('preguntar')
  })

  it('un texto con «bloqueo» abre otro pedido aunque haya uno en curso', () => {
    expect(decidirAncla(texto('bloqueo para Marta, 3 adultos'), [ent({ id: 'A' })], 'p', AHORA)).toEqual({ accion: 'nueva', tentativo: false })
  })

  it('el encabezado que le falta al pedido en curso (llegaron primero los pantallazos) se le suma', () => {
    expect(decidirAncla(texto('es bloqueo para Laura'), [ent({ id: 'A', tieneEncabezado: false })], 'p', AHORA)).toEqual({ accion: 'agregar', entregaId: 'A' })
  })

  it('sin nada abierto: un pantallazo abre pedido; un texto sin señal, tentativo', () => {
    expect(decidirAncla(imagen(), [], 'p', AHORA)).toEqual({ accion: 'nueva', tentativo: false })
    expect(decidirAncla(texto('cotízame esto para Laura'), [], 'p', AHORA)).toEqual({ accion: 'nueva', tentativo: true })
  })

  it('«sí» suelto con un solo pedido esperando respuesta es de ese; con dos, se pregunta', () => {
    const a = ent({ id: 'A', estado: 'por_confirmar' })
    expect(decidirAncla(texto('sí'), [a], 'p', AHORA)).toEqual({ accion: 'responder', entregaId: 'A' })
    const d = decidirAncla(texto('sí'), [a, ent({ id: 'B', estado: 'por_confirmar' })], 'p', AHORA)
    expect(d.accion).toBe('preguntar')
  })

  it('un pedido en curso de hace más de 10 minutos ya no recibe sueltos', () => {
    expect(decidirAncla(imagen(), [ent({ id: 'A', ultimaEn: '2026-11-04T19:50:00Z' })], 'p', AHORA)).toEqual({ accion: 'nueva', tentativo: false })
  })

  it('los toques de los botones', () => {
    const b = (id: string) => ({ tipo: 'boton' as const, texto: null, contextoWamid: null, botonId: id })
    expect(decidirAncla(b('eb|tipo|bloqueo|E1'), [], 'p', AHORA)).toEqual({ accion: 'tipo', entregaId: 'E1', tipo: 'bloqueo' })
    expect(decidirAncla(b('eb|asignar|nuevo|pz3'), [], 'p', AHORA)).toEqual({ accion: 'asignar', entregaId: 'nuevo', piezaId: 'pz3' })
    expect(decidirAncla(b('ag|p|xyz'), [], 'p', AHORA)).toEqual({ accion: 'otro' })
  })
})
