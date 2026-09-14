import { describe, expect, it } from 'vitest'
import {
  construirGantt,
  posicionTramo,
  textoDesfase,
  fechaCorta,
  type PasoParaGantt,
} from './gantt'

const paso = (p: Partial<PasoParaGantt> & { id: string }): PasoParaGantt => ({
  label: p.id,
  responsable: null,
  plan_inicio: null,
  plan_fin: null,
  real_inicio: null,
  real_fin: null,
  completado: false,
  ...p,
})

const HOY = '2026-09-14' // lunes

describe('construirGantt: estado y desfase por paso', () => {
  it('terminado a tiempo: desfase 0 y sin tramo fuera de plan', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-01', plan_fin: '2026-09-05', real_inicio: '2026-09-01', real_fin: '2026-09-05', completado: true })], HOY)
    expect(m.filas[0].estado).toBe('completado')
    expect(m.filas[0].desfaseDias).toBe(0)
    expect(m.filas[0].fueraDePlan).toBeNull()
  })

  it('terminado tarde: el tramo fuera de plan arranca el día siguiente al fin planeado', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-01', plan_fin: '2026-09-05', real_inicio: '2026-09-02', real_fin: '2026-09-08' })], HOY)
    expect(m.filas[0].estado).toBe('completado')
    expect(m.filas[0].desfaseDias).toBe(3)
    expect(m.filas[0].fueraDePlan).toEqual({ inicio: '2026-09-06', fin: '2026-09-08' })
  })

  it('arrancado sin terminar: la barra real llega hasta hoy', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-10', plan_fin: '2026-09-20', real_inicio: '2026-09-10' })], HOY)
    expect(m.filas[0].real).toEqual({ inicio: '2026-09-10', fin: HOY })
    expect(m.filas[0].estado).toBe('en_curso')
    expect(m.filas[0].desfaseDias).toBe(0)
  })

  it('se le pasó el fin planeado y sigue abierto: atraso contado hasta hoy', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-01', plan_fin: '2026-09-10', real_inicio: '2026-09-01' })], HOY)
    expect(m.filas[0].estado).toBe('atrasado')
    expect(m.filas[0].desfaseDias).toBe(4)
    expect(m.filas[0].fueraDePlan).toEqual({ inicio: '2026-09-11', fin: HOY })
  })

  it('arrancó corrido: proyecta el mismo corrimiento al fin', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-12', plan_fin: '2026-09-30', real_inicio: '2026-09-14' })], HOY)
    expect(m.filas[0].desfaseDias).toBe(2)
    expect(m.filas[0].estado).toBe('atrasado')
  })

  it('sin plan ni real: sin fecha y sin desfase', () => {
    const m = construirGantt([paso({ id: 'a' })], HOY)
    expect(m.filas[0].estado).toBe('sin_fecha')
    expect(m.filas[0].desfaseDias).toBeNull()
    expect(m.desde).toBeNull()
    expect(m.semanas).toEqual([])
  })

  it('terminado antes: desfase negativo', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-01', plan_fin: '2026-09-10', real_fin: '2026-09-08' })], HOY)
    expect(m.filas[0].desfaseDias).toBe(-2)
  })

  it('plan con las puntas al revés se ordena', () => {
    const m = construirGantt([paso({ id: 'a', plan_inicio: '2026-09-20', plan_fin: '2026-09-15' })], HOY)
    expect(m.filas[0].plan).toEqual({ inicio: '2026-09-15', fin: '2026-09-20' })
  })
})

describe('construirGantt: eje y KPIs', () => {
  const pasos = [
    paso({ id: 'a', plan_inicio: '2026-09-02', plan_fin: '2026-09-08', real_inicio: '2026-09-02', real_fin: '2026-09-09', completado: true }),
    paso({ id: 'b', plan_inicio: '2026-09-09', plan_fin: '2026-09-12', real_inicio: '2026-09-10' }),
    paso({ id: 'c', plan_inicio: '2026-09-15', plan_fin: '2026-09-25' }),
  ]
  const m = construirGantt(pasos, HOY)

  it('el eje arranca en lunes y termina en domingo', () => {
    expect(m.desde).toBe('2026-08-31')
    expect(m.hasta).toBe('2026-09-27')
    expect(m.totalDias).toBe(28)
    expect(m.semanas.map(s => s.etiqueta)).toEqual(['31 ago', '07 sep', '14 sep', '21 sep'])
  })

  it('avance por pasos terminados', () => {
    expect(m.kpis).toMatchObject({ completados: 1, total: 3, avancePct: 33 })
  })

  it('el desfase del proyecto lo marca el pendiente más atrasado, no uno ya terminado', () => {
    // 'a' terminó 1 día tarde; 'b' sigue abierta con 2 días de atraso.
    expect(m.kpis.desfaseDias).toBe(2)
    expect(m.kpis.entregaPlan).toBe('2026-09-25')
  })

  it('la entrega proyectada corre la entrega planeada por ese atraso', () => {
    expect(m.kpis.entregaProyectada).toBe('2026-09-27')
    const tarde = construirGantt([...pasos, paso({ id: 'd', plan_inicio: '2026-09-01', plan_fin: '2026-09-24', real_inicio: '2026-09-11' })], HOY)
    expect(tarde.kpis.desfaseDias).toBe(10)
    expect(tarde.kpis.entregaProyectada).toBe('2026-10-05')
  })

  it('todo terminado: el desfase es el de la entrega real contra la planeada', () => {
    const fin = construirGantt([
      paso({ id: 'a', plan_inicio: '2026-09-01', plan_fin: '2026-09-05', real_fin: '2026-09-05', completado: true }),
      paso({ id: 'b', plan_inicio: '2026-09-06', plan_fin: '2026-09-10', real_fin: '2026-09-12', completado: true }),
    ], HOY)
    expect(fin.kpis.entregaProyectada).toBe('2026-09-12')
    expect(fin.kpis.desfaseDias).toBe(2)
  })

  it('posicionTramo: un día ocupa un día del eje', () => {
    expect(posicionTramo({ inicio: '2026-08-31', fin: '2026-08-31' }, m)).toEqual({ izquierda: 0, ancho: (1 / 28) * 100 })
    expect(posicionTramo({ inicio: '2026-09-14', fin: '2026-09-27' }, m)).toEqual({ izquierda: 50, ancho: 50 })
  })
})

describe('textos', () => {
  it('textoDesfase', () => {
    expect(textoDesfase(null)).toBe('Sin fechas')
    expect(textoDesfase(0)).toBe('A tiempo')
    expect(textoDesfase(1)).toBe('1 día de atraso')
    expect(textoDesfase(-3)).toBe('3 días adelantado')
  })

  it('fechaCorta', () => {
    expect(fechaCorta('2026-10-06')).toBe('06 oct')
    expect(fechaCorta(null)).toBe('sin fecha')
  })
})
