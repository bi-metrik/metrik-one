import { describe, expect, it } from 'vitest'

import { celularLegible, firmaConLaAsesora, pieConLaAsesora } from './asesora'

const A = { nombre: 'Asesora Ficticia', cargo: 'Asesora de viajes', correo: 'asesora@agencia.test', celular: '+573000000002' }

describe('asesora en la propuesta', () => {
  it('el celular se lee como se dicta', () => {
    expect(celularLegible('+573000000002')).toBe('300 000 0002')
    expect(celularLegible('3000000002')).toBe('300 000 0002')
    expect(celularLegible('+1 305 555 0100')).toBe('+1 305 555 0100')
    expect(celularLegible(null)).toBeNull()
  })

  it('el pie conserva el sitio web configurado y nada más del dueño', () => {
    expect(pieConLaAsesora('www.agencia.test · contacto@agencia.test · 300 000 0000', A)).toBe('Asesora Ficticia · Asesora de viajes · asesora@agencia.test · 300 000 0002 · www.agencia.test')
    expect(pieConLaAsesora('contacto@agencia.test · Bogotá', A)).toBe('Asesora Ficticia · Asesora de viajes · asesora@agencia.test · 300 000 0002')
    expect(pieConLaAsesora('www.agencia.test', null)).toBe('www.agencia.test')
  })

  it('la firma: sin asesora, la configurada', () => {
    const f = { nombre: 'Dueño', cargo: 'Director', contacto: 'x' }
    expect(firmaConLaAsesora(f, null)).toBe(f)
    expect(firmaConLaAsesora(f, { ...A, correo: null })).toEqual({ nombre: 'Asesora Ficticia', cargo: 'Asesora de viajes', contacto: '300 000 0002' })
  })
})
