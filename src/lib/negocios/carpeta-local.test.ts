import { describe, it, expect } from 'vitest'
import {
  CLAVE_CARPETA_LOCAL,
  normalizarCarpetaLocal,
  leerCarpetaLocal,
  conCarpetaLocal,
  exigeCarpetaLocal,
  gateSeResuelveConCarpeta,
  puedeEditarCarpetaLocal,
} from './carpeta-local'
import { bloqueoCarpetaLocal } from './gate-carpeta-local'
import { canAdvanceStage, type Area, type Role, type Stage, type UserContext } from '@/lib/permissions/can-edit'

describe('normalizarCarpetaLocal', () => {
  it('acepta la forma proyectos/{cliente}/{proyecto}/', () => {
    expect(normalizarCarpetaLocal('proyectos/soena/ve/')).toEqual({ ok: true, carpeta: 'proyectos/soena/ve/' })
    expect(normalizarCarpetaLocal('proyectos/metrik-one/cobros-2026/')).toEqual({
      ok: true,
      carpeta: 'proyectos/metrik-one/cobros-2026/',
    })
  })

  it('agrega la barra final si falta', () => {
    expect(normalizarCarpetaLocal('proyectos/soena/ve')).toEqual({ ok: true, carpeta: 'proyectos/soena/ve/' })
  })

  it('recorta espacios antes de validar', () => {
    expect(normalizarCarpetaLocal('  proyectos/afi/one  ')).toEqual({ ok: true, carpeta: 'proyectos/afi/one/' })
  })

  it('vacío o solo espacios es borrar, nunca un texto vacío', () => {
    expect(normalizarCarpetaLocal('')).toEqual({ ok: true, carpeta: null })
    expect(normalizarCarpetaLocal('   ')).toEqual({ ok: true, carpeta: null })
    expect(normalizarCarpetaLocal(null)).toEqual({ ok: true, carpeta: null })
    expect(normalizarCarpetaLocal(undefined)).toEqual({ ok: true, carpeta: null })
  })

  it.each([
    ['mayúsculas (no se bajan en silencio: podría ser otra carpeta)', 'proyectos/SOENA/ve/'],
    ['un solo nivel', 'proyectos/soena/'],
    ['tres niveles', 'proyectos/soena/ve/qa/'],
    ['raíz distinta', 'cerebro/soena/ve/'],
    ['ruta absoluta', '/proyectos/soena/ve/'],
    ['guion bajo', 'proyectos/soena/ve_2/'],
    ['tildes', 'proyectos/soena/devolución/'],
    ['espacios dentro', 'proyectos/soena/ve 2/'],
    ['doble barra final', 'proyectos/soena/ve//'],
    ['segmento vacío', 'proyectos//ve/'],
    ['barra invertida', 'proyectos\\soena\\ve\\'],
  ])('rechaza %s', (_caso, entrada) => {
    const r = normalizarCarpetaLocal(entrada)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/proyectos\/\{cliente\}\/\{proyecto\}\//)
  })
})

describe('leerCarpetaLocal', () => {
  it('lee la carpeta guardada', () => {
    expect(leerCarpetaLocal({ carpeta_local: 'proyectos/soena/ve/', otra: 1 })).toBe('proyectos/soena/ve/')
  })

  it('con el criterio de "vacía" del trigger: sin texto no hay carpeta', () => {
    expect(leerCarpetaLocal({ carpeta_local: '' })).toBeNull()
    expect(leerCarpetaLocal({ carpeta_local: '   ' })).toBeNull()
    expect(leerCarpetaLocal({ carpeta_local: 42 })).toBeNull()
    expect(leerCarpetaLocal({ carpeta_local: null })).toBeNull()
    expect(leerCarpetaLocal({})).toBeNull()
    expect(leerCarpetaLocal(null)).toBeNull()
    expect(leerCarpetaLocal(['proyectos/soena/ve/'])).toBeNull()
  })
})

describe('conCarpetaLocal', () => {
  const METADATA = {
    siigo_cliente: { identificacion: '123' },
    reproceso: { activo: true },
    carpeta_local: 'proyectos/viejo/caso/',
  }

  it('reemplaza la carpeta y conserva el resto de las claves', () => {
    expect(conCarpetaLocal(METADATA, 'proyectos/soena/ve/')).toEqual({
      siigo_cliente: { identificacion: '123' },
      reproceso: { activo: true },
      carpeta_local: 'proyectos/soena/ve/',
    })
  })

  it('borrar QUITA la clave, no deja un texto vacío', () => {
    const r = conCarpetaLocal(METADATA, null)
    expect(CLAVE_CARPETA_LOCAL in r).toBe(false)
    expect(r).toEqual({ siigo_cliente: { identificacion: '123' }, reproceso: { activo: true } })
  })

  it('no muta la metadata que recibe', () => {
    const copia = structuredClone(METADATA)
    conCarpetaLocal(METADATA, null)
    conCarpetaLocal(METADATA, 'proyectos/soena/ve/')
    expect(METADATA).toEqual(copia)
  })

  it('tolera metadata ausente', () => {
    expect(conCarpetaLocal(null, 'proyectos/soena/ve/')).toEqual({ carpeta_local: 'proyectos/soena/ve/' })
    expect(conCarpetaLocal(undefined, null)).toEqual({})
  })
})

describe('exigeCarpetaLocal', () => {
  it('solo el booleano JSON true la enciende, como en el trigger', () => {
    expect(exigeCarpetaLocal({ exigir_carpeta_local: true })).toBe(true)
    expect(exigeCarpetaLocal({ exigir_carpeta_local: 'true' })).toBe(false)
    expect(exigeCarpetaLocal({ exigir_carpeta_local: 1 })).toBe(false)
    expect(exigeCarpetaLocal({})).toBe(false)
    expect(exigeCarpetaLocal(null)).toBe(false)
  })
})

describe('gateSeResuelveConCarpeta', () => {
  it('reconoce el bloqueo que devuelve el rechazo MK001', () => {
    const bloqueo = bloqueoCarpetaLocal({ code: 'MK001', message: 'sin carpeta' })
    expect(bloqueo).not.toBeNull()
    expect(gateSeResuelveConCarpeta([bloqueo!])).toBe(true)
  })

  it('los demás gates, aunque no sean omitibles, no ofrecen la carpeta', () => {
    expect(gateSeResuelveConCarpeta([{ nombre: 'Recaudo cambiado', es_gate: true, omitible: false }] as never)).toBe(false)
    expect(gateSeResuelveConCarpeta([])).toBe(false)
  })
})

describe('puedeEditarCarpetaLocal', () => {
  const persona = (role: Role, areas: Area[] = [], id = 's-1'): UserContext => ({ id, role, areas })
  const negocio = (stage: Stage | null, responsables: string[] = [], areasQueAvanzan?: Area[]) =>
    ({ stage, responsables, areasQueAvanzan })

  it('owner, admin y supervisor corrigen la carpeta aunque su área no sea la de la etapa', () => {
    expect(puedeEditarCarpetaLocal(persona('owner', ['financiera']), negocio('venta'))).toBe(true)
    expect(puedeEditarCarpetaLocal(persona('admin', ['operaciones']), negocio('venta'))).toBe(true)
    expect(puedeEditarCarpetaLocal(persona('supervisor', ['financiera']), negocio('venta'))).toBe(true)
  })

  it('el operador responsable de la etapa puede, el ajeno no', () => {
    expect(puedeEditarCarpetaLocal(persona('operator', ['comercial']), negocio('venta', ['s-1']))).toBe(true)
    expect(puedeEditarCarpetaLocal(persona('operator', ['comercial']), negocio('venta', ['otro']))).toBe(false)
    expect(puedeEditarCarpetaLocal(persona('operator', ['operaciones']), negocio('venta', ['s-1']))).toBe(false)
  })

  it('la etapa que invita a otra área a avanzarla también la deja escribir la carpeta', () => {
    expect(
      puedeEditarCarpetaLocal(persona('operator', ['operaciones']), negocio('venta', ['s-1'], ['operaciones'])),
    ).toBe(true)
  })

  it('read_only y contador nunca', () => {
    expect(puedeEditarCarpetaLocal(persona('read_only'), negocio('venta', ['s-1']))).toBe(false)
    expect(puedeEditarCarpetaLocal(persona('contador'), negocio('venta', ['s-1']))).toBe(false)
  })

  it('sin stage se juzga como venta, igual que el guard del avance', () => {
    expect(puedeEditarCarpetaLocal(persona('operator', ['comercial']), negocio(null, ['s-1']))).toBe(true)
    expect(puedeEditarCarpetaLocal(persona('operator', ['operaciones']), negocio(null, ['s-1']))).toBe(false)
  })

  // El modal del gate solo se abre a quien pasó `guardAvanzarStage`. Si esa persona no
  // pudiera guardar la carpeta, el modal volvería a ser un callejón sin salida.
  it('quien puede avanzar el negocio SIEMPRE puede escribir la carpeta que lo destraba', () => {
    const roles: Role[] = ['owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only']
    const combinaciones: Area[][] = [[], ['comercial'], ['operaciones'], ['financiera'], ['direccion']]
    const stages: Stage[] = ['venta', 'ejecucion', 'cobro', 'cerrado']
    let casosQueAvanzan = 0
    for (const role of roles) {
      for (const areas of combinaciones) {
        for (const stage of stages) {
          for (const responsables of [[], ['s-1']]) {
            for (const invitadas of [undefined, ['operaciones'] as Area[]]) {
              const user = persona(role, areas)
              if (canAdvanceStage(user, stage, responsables, invitadas)) {
                casosQueAvanzan++
                expect(puedeEditarCarpetaLocal(user, negocio(stage, responsables, invitadas))).toBe(true)
              }
            }
          }
        }
      }
    }
    // Control: la malla tiene que ejercitar casos reales, o el bucle no prueba nada.
    expect(casosQueAvanzan).toBeGreaterThan(20)
  })
})
