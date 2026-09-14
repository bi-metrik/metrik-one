import { describe, it, expect } from 'vitest'
import {
  tocaLaPlaneacion,
  snapshotDePasos,
  describirCambios,
  decidirVersion,
  cierreDeVentana,
  type PasoPlan,
} from './versionado'

const paso = (p: Partial<PasoPlan> & { id: string }): PasoPlan => ({
  orden: 0,
  label: 'Paso',
  fecha_inicio: null,
  fecha_fin: null,
  responsable_id: null,
  ...p,
})

describe('tocaLaPlaneacion', () => {
  it('mover una fecha planeada es planeación', () => {
    expect(tocaLaPlaneacion({ fecha_fin: '2026-11-23' })).toBe(true)
  })

  it('renombrar un paso es planeación', () => {
    expect(tocaLaPlaneacion({ label: 'Montaje ramal norte' })).toBe(true)
  })

  it('marcar el inicio real NO es planeación', () => {
    expect(tocaLaPlaneacion({ fecha_inicio_real: '2026-10-06' })).toBe(false)
  })

  it('completar un paso NO es planeación', () => {
    expect(tocaLaPlaneacion({ completado: true })).toBe(false)
  })

  it('la fecha planeada cuenta aunque se guarde con el mismo valor', () => {
    // El payload la trae: quien la envía está editando el plan, aunque no la mueva.
    expect(tocaLaPlaneacion({ fecha_inicio: '2026-09-15' })).toBe(true)
  })

  it('un guardado vacío no corta nada', () => {
    expect(tocaLaPlaneacion({})).toBe(false)
  })
})

describe('snapshotDePasos', () => {
  it('congela los pasos ordenados y con los nulos explícitos', () => {
    const snap = snapshotDePasos([
      paso({ id: 'b', orden: 2, label: 'Prefabricado' }),
      paso({ id: 'a', orden: 1, label: 'Ingeniería', fecha_inicio: '2026-09-15' }),
    ])
    expect(snap.map(p => p.label)).toEqual(['Ingeniería', 'Prefabricado'])
    expect(snap[1].fecha_fin).toBeNull()
    expect(snap[1].responsable_nombre).toBeNull()
  })
})

describe('describirCambios', () => {
  it('cuenta el paso nuevo y el que se fue', () => {
    const antes = [paso({ id: 'a', label: 'Ingeniería' })]
    const despues = [paso({ id: 'b', label: 'Cuarto de bombas' })]
    expect(describirCambios(antes, despues)).toEqual([
      'Se agregó "Cuarto de bombas"',
      'Se quitó "Ingeniería"',
    ])
  })

  it('dice de dónde a dónde se movió la fecha', () => {
    const antes = [paso({ id: 'a', label: 'Compra de tubería', fecha_fin: '2026-09-29' })]
    const despues = [paso({ id: 'a', label: 'Compra de tubería', fecha_fin: '2026-10-06' })]
    const frases = describirCambios(antes, despues)
    expect(frases).toHaveLength(1)
    expect(frases[0]).toContain('Compra de tubería')
    expect(frases[0]).toContain('06 oct')
    expect(frases[0]).toContain('29 sep')
  })

  it('una fecha que se estrena se lee como "antes sin fecha"', () => {
    const antes = [paso({ id: 'a', label: 'Dossier' })]
    const despues = [paso({ id: 'a', label: 'Dossier', fecha_inicio: '2026-11-17' })]
    expect(describirCambios(antes, despues)[0]).toContain('antes sin fecha')
  })

  it('el avance real no aparece: el snapshot solo lleva plan', () => {
    const mismos = [paso({ id: 'a', label: 'Montaje', fecha_inicio: '2026-10-13' })]
    expect(describirCambios(mismos, mismos)).toEqual([])
  })
})

describe('decidirVersion', () => {
  const ahora = new Date('2026-09-14T15:00:00Z')

  it('sin versiones, la primera es la 1', () => {
    expect(decidirVersion({ vigente: null, autorId: 'omar', ahora })).toEqual({
      accion: 'crear',
      numero: 1,
    })
  })

  it('la misma sesión de planeación acumula en la versión abierta', () => {
    expect(
      decidirVersion({
        vigente: { numero: 3, creado_por: 'omar', abierta_hasta: '2026-09-14T15:20:00Z' },
        autorId: 'omar',
        ahora,
      }),
    ).toEqual({ accion: 'acumular', numero: 3 })
  })

  it('con la ventana vencida corta una versión nueva', () => {
    expect(
      decidirVersion({
        vigente: { numero: 3, creado_por: 'omar', abierta_hasta: '2026-09-14T14:59:00Z' },
        autorId: 'omar',
        ahora,
      }),
    ).toEqual({ accion: 'crear', numero: 4 })
  })

  it('otro autor corta versión aunque la ventana siga abierta', () => {
    expect(
      decidirVersion({
        vigente: { numero: 3, creado_por: 'omar', abierta_hasta: '2026-09-14T15:20:00Z' },
        autorId: 'diana',
        ahora,
      }),
    ).toEqual({ accion: 'crear', numero: 4 })
  })

  it('una versión sin ventana (publicada) corta la siguiente', () => {
    expect(
      decidirVersion({
        vigente: { numero: 7, creado_por: 'omar', abierta_hasta: null },
        autorId: 'omar',
        ahora,
      }),
    ).toEqual({ accion: 'crear', numero: 8 })
  })
})

describe('cierreDeVentana', () => {
  it('abre media hora desde el cambio', () => {
    expect(cierreDeVentana(new Date('2026-09-14T15:00:00Z'))).toBe('2026-09-14T15:30:00.000Z')
  })
})
