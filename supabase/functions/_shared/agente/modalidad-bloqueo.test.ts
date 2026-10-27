import { describe, expect, it } from 'vitest'
import { instruccionesCarga, validarCarga } from './bandeja/extraccion'
import type { CampoEntendible } from '../wa-entendimiento-reglas'

/**
 * Viaje en bloqueo (brief del 2026-10-27): la modalidad y el operador son dos campos más de «Condiciones del
 * viaje» (`sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql`). El bot no tiene una regla por palabra clave:
 * el modelo interpreta «un bloqueo de Aliados» y el código solo revisa que el valor quepa en el campo y que esté
 * sostenido por algo escrito. Datos inventados; el modelo es una salida a mano, sin llamada real.
 */

// La misma forma que declara el SQL de config (sin `nivel`: el bot no los pregunta).
const CAMPOS = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  {
    slug: 'modalidad_viaje', tipo: 'select', label: 'Modalidad',
    ayuda: 'Bloqueo = el cliente compra un paquete de un operador (Aliados Travel, Tu Reserva…) con cupo fijo de vuelo y hotel en fechas cerradas. A medida = la agencia arma el viaje servicio por servicio. Si no lo dicen, A medida.',
    opciones: [{ value: 'a_medida', label: 'A medida' }, { value: 'bloqueo', label: 'Bloqueo' }],
  },
  { slug: 'operador_bloqueo', tipo: 'texto', label: 'Operador del bloqueo', ayuda: 'El operador que vende el bloqueo, como lo dicen.', showIf: { field: 'modalidad_viaje', equals: 'bloqueo' } },
] as unknown as CampoEntendible[]

const MENSAJE = 'quiero ofrecerle a un pasajero un bloqueo de Aliados del 5 al 8 de febrero para Cartagena'

function crudo(valores: Record<string, { valor: string; frase: string; como?: string }>) {
  const todos = Object.fromEntries(CAMPOS.map(f => [f.slug, { valor: 'por_definir', frase: '' }]))
  return { mensajes: [{ n: 1, clase: 'cliente' }], citas: [], valores: { ...todos, ...valores }, dudas: [] }
}

describe('modalidad del viaje desde el bot', () => {
  it('los dos campos van al modelo con su explicación', () => {
    const prompt = instruccionesCarga(CAMPOS, '2026-10-27')
    expect(prompt).toContain('modalidad_viaje')
    expect(prompt).toContain('operador_bloqueo')
  })

  it('lo que interpreta el modelo («bloqueo de Aliados») se guarda como Bloqueo con su operador', () => {
    const v = validarCarga(crudo({
      destino: { valor: 'Cartagena', frase: 'para Cartagena', como: 'escrito' },
      modalidad_viaje: { valor: 'bloqueo', frase: 'un bloqueo de Aliados', como: 'escrito' },
      operador_bloqueo: { valor: 'Aliados', frase: 'un bloqueo de Aliados', como: 'escrito' },
    }), CAMPOS, [MENSAJE], { hoyISO: '2026-10-27', yaTiene: {} })
    expect(v.sugeridos.modalidad_viaje?.valor).toBe('bloqueo')
    expect(v.sugeridos.operador_bloqueo?.valor).toBe('Aliados')
  })

  it('un valor que no es una de las dos opciones no entra', () => {
    const v = validarCarga(crudo({ modalidad_viaje: { valor: 'paquete', frase: 'un bloqueo de Aliados', como: 'escrito' } }), CAMPOS, [MENSAJE], { hoyISO: '2026-10-27', yaTiene: {} })
    expect(v.sugeridos.modalidad_viaje).toBeUndefined()
  })
})
