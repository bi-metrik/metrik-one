import { describe, expect, it } from 'vitest'
import {
  accionesSobreUsuario,
  cupo,
  cupoDelEspacio,
  esAdministradorSinCosto,
  etiquetaRol,
  licenciaAdicionalLiberable,
  normalizarCorreo,
  usuariosOperativos,
  validarInvitacion,
} from './reglas'

const u = (id: string, role: string, ultimoIngreso: string | null = '2026-09-20T10:00:00Z') => ({ id, role, ultimoIngreso })

describe('roles con nombre de persona', () => {
  it('dueño y administrador son Administrador; el resto, Operador', () => {
    expect(['owner', 'admin', 'operator', 'supervisor', 'read_only'].map(etiquetaRol)).toEqual([
      'Administrador',
      'Administrador',
      'Operador',
      'Operador',
      'Operador',
    ])
  })
})

describe('qué se puede hacer con cada usuario', () => {
  it('a un operador cualquiera se le retira, se le cambia el rol y, sin ingreso, se le reenvía', () => {
    expect(accionesSobreUsuario({ actorId: 'a', objetivo: u('b', 'operator', null), designadoId: 'd' })).toEqual({
      puedeRetirar: true,
      puedeCambiarRol: true,
      puedeReenviar: true,
      nota: null,
    })
  })

  it('nadie se retira ni se degrada a sí mismo', () => {
    expect(accionesSobreUsuario({ actorId: 'a', objetivo: u('a', 'admin'), designadoId: 'd' })).toMatchObject({
      puedeRetirar: false,
      puedeCambiarRol: false,
    })
  })

  it('la persona designada no se retira ni se degrada, tampoco por otro administrador', () => {
    const r = accionesSobreUsuario({ actorId: 'a', objetivo: u('d', 'admin'), designadoId: 'd' })
    expect(r).toMatchObject({ puedeRetirar: false, puedeCambiarRol: false, nota: 'Persona designada del contrato' })
  })

  it('la persona designada que es la que entra tampoco se retira a sí misma', () => {
    expect(accionesSobreUsuario({ actorId: 'd', objetivo: u('d', 'operator'), designadoId: 'd' }).puedeRetirar).toBe(false)
  })

  it('el dueño no se toca desde aquí', () => {
    expect(accionesSobreUsuario({ actorId: 'a', objetivo: u('o', 'owner'), designadoId: null })).toMatchObject({
      puedeRetirar: false,
      puedeCambiarRol: false,
    })
  })

  it('un supervisor se puede retirar pero su rol no se cambia desde aquí', () => {
    expect(accionesSobreUsuario({ actorId: 'a', objetivo: u('s', 'supervisor'), designadoId: null })).toMatchObject({
      puedeRetirar: true,
      puedeCambiarRol: false,
    })
  })

  it('solo se reenvía a quien nunca ha entrado', () => {
    expect(accionesSobreUsuario({ actorId: 'a', objetivo: u('b', 'operator'), designadoId: null }).puedeReenviar).toBe(false)
  })
})

describe('licencias', () => {
  it('2 de 2 en uso: sin cupo', () => {
    expect(cupo(2, 2)).toEqual({ licencias: 2, usados: 2, libres: 0 })
  })

  it('un límite ilegible no abre cupo', () => {
    expect(cupo(Number.NaN, 0).libres).toBe(0)
  })

  it('la invitación se valida antes de crear nada', () => {
    const libre = cupo(3, 2)
    expect(validarInvitacion({ correo: 'ana@cda.co', nombre: 'Ana', rol: 'operator', cupo: libre })).toBeNull()
    expect(validarInvitacion({ correo: 'ana@', nombre: 'Ana', rol: 'operator', cupo: libre })).toBe('correo')
    expect(validarInvitacion({ correo: 'ana@cda.co', nombre: ' ', rol: 'operator', cupo: libre })).toBe('nombre')
    expect(validarInvitacion({ correo: 'ana@cda.co', nombre: 'Ana', rol: 'owner', cupo: libre })).toBe('rol')
    expect(validarInvitacion({ correo: 'ana@cda.co', nombre: 'Ana', rol: 'admin', cupo: cupo(2, 2) })).toBe('sin_cupo')
  })

  it('el correo se guarda normalizado', () => {
    expect(normalizarCorreo('  Ana@CDA.co ')).toBe('ana@cda.co')
  })

  it('al retirar, la licencia adicional se puede dejar de pagar solo si queda sobrando', () => {
    // 3 licencias (1 adicional), 3 usuarios: al retirar uno quedan 2 en uso y sobra una.
    expect(licenciaAdicionalLiberable({ licencias: 3, usadosDespues: 2, adicionalesVigentes: 1 })).toBe(true)
    // Sin adicionales no hay nada que dejar de pagar.
    expect(licenciaAdicionalLiberable({ licencias: 2, usadosDespues: 1, adicionalesVigentes: 0 })).toBe(false)
    // Con el retiro todavía no sobra ninguna (había más usuarios que licencias).
    expect(licenciaAdicionalLiberable({ licencias: 3, usadosDespues: 3, adicionalesVigentes: 1 })).toBe(false)
  })
})

describe('el administrador designado no ocupa licencia (decisión 2026-09-24)', () => {
  const personas = (...ids: string[]) => ids.map((id) => ({ id }))

  it('con 2 licencias: el designado más dos operativos llenan el cupo, sin pagar adicional', () => {
    const c = cupoDelEspacio({ licencias: 2, usuarios: personas('d', 'a', 'b'), designadoId: 'd' })
    expect(c).toEqual({ licencias: 2, usados: 2, libres: 0 })
  })

  it('el designado solo, o con un operativo, deja cupo para invitar', () => {
    expect(cupoDelEspacio({ licencias: 2, usuarios: personas('d'), designadoId: 'd' }).libres).toBe(2)
    const uno = cupoDelEspacio({ licencias: 2, usuarios: personas('d', 'a'), designadoId: 'd' })
    expect(uno).toEqual({ licencias: 2, usados: 1, libres: 1 })
    expect(validarInvitacion({ correo: 'ana@cda.co', nombre: 'Ana', rol: 'operator', cupo: uno })).toBeNull()
  })

  it('el tercer operativo ya no cabe: ahí empieza el usuario adicional', () => {
    const lleno = cupoDelEspacio({ licencias: 2, usuarios: personas('d', 'a', 'b'), designadoId: 'd' })
    expect(validarInvitacion({ correo: 'c@cda.co', nombre: 'Carla', rol: 'operator', cupo: lleno })).toBe('sin_cupo')
    // Con un adicional comprado (3 licencias) entra el tercero.
    expect(cupoDelEspacio({ licencias: 3, usuarios: personas('d', 'a', 'b', 'c'), designadoId: 'd' }).libres).toBe(0)
  })

  it('sin persona designada cuentan todos, como antes', () => {
    expect(cupoDelEspacio({ licencias: 2, usuarios: personas('d', 'a', 'b'), designadoId: null })).toEqual({
      licencias: 2,
      usados: 3,
      libres: 0,
    })
  })

  it('un designado que no está en la lista no descuenta a nadie', () => {
    expect(cupoDelEspacio({ licencias: 2, usuarios: personas('a', 'b'), designadoId: 'x' }).usados).toBe(2)
  })

  it('solo la persona designada es administrador sin costo', () => {
    expect(esAdministradorSinCosto('d', 'd')).toBe(true)
    expect(esAdministradorSinCosto('a', 'd')).toBe(false)
    expect(esAdministradorSinCosto('d', null)).toBe(false)
    expect(usuariosOperativos(personas('a', 'd', 'b'), 'd').map((u) => u.id)).toEqual(['a', 'b'])
  })

  it('retirar un operativo con un adicional pagado lo deja liberar, contando sin el designado', () => {
    // 3 licencias (1 adicional), designado + 3 operativos; al retirar uno quedan 2 operativos.
    const despues = cupoDelEspacio({ licencias: 3, usuarios: personas('d', 'a', 'b'), designadoId: 'd' })
    expect(licenciaAdicionalLiberable({ licencias: 3, usadosDespues: despues.usados, adicionalesVigentes: 1 })).toBe(true)
  })
})
