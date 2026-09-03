import { describe, expect, it } from 'vitest'
import { credencialValida, filasParaUpsert, mesDeTramo, monedasEnConflicto, numeroDeMeta } from './meta-insights'

// Tramos REALES leidos de la Graph API el 2026-09-03 para la campana
// `CAMPAÑA JUNIO 2026 DJ - VIDEO` (id 120248098468670215). El primer tramo empieza
// el 9 de junio, no el 1: es justo el caso que obliga a truncar por mes.
const VIDEO = [
  { date_start: '2026-06-09', date_stop: '2026-06-30', spend: '306691', impressions: '25386', clicks: '760' },
  { date_start: '2026-07-01', date_stop: '2026-07-31', spend: '907714', impressions: '59364', clicks: '1567' },
]

describe('mesDeTramo', () => {
  it('trunca al primer dia del mes aunque el tramo empiece a mitad', () => {
    expect(mesDeTramo('2026-06-09')).toBe('2026-06-01')
    expect(mesDeTramo('2026-07-01')).toBe('2026-07-01')
  })

  it('una fecha que no entiende revienta en vez de inventar un mes', () => {
    expect(() => mesDeTramo('junio')).toThrow()
  })
})

describe('numeroDeMeta', () => {
  it('convierte la cadena que manda Meta', () => {
    expect(numeroDeMeta('306691')).toBe(306691)
    expect(numeroDeMeta('0')).toBe(0)
  })

  it('ausente o ilegible es null, NO cero', () => {
    // Un cero en una columna de dinero afirma "no gasto". Aqui lo unico cierto
    // seria "no se pudo leer", y son cosas distintas.
    expect(numeroDeMeta(undefined)).toBeNull()
    expect(numeroDeMeta('')).toBeNull()
    expect(numeroDeMeta('n/d')).toBeNull()
  })
})

describe('filasParaUpsert', () => {
  const base = {
    workspaceId: '7dea141d-d4da-483d-a78d-b14ef35500c5',
    campaignId: '120248098468670215',
    meta: { name: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', account_id: '1603671527655761', status: 'ACTIVE' },
    currency: 'COP',
    ahoraISO: '2026-09-03T18:00:00.000Z',
  }

  it('parte el gasto por mes y la suma da el total de la campana', () => {
    const filas = filasParaUpsert({ ...base, tramos: VIDEO })
    expect(filas.map(f => f.mes)).toEqual(['2026-06-01', '2026-07-01'])
    expect(filas.map(f => f.spend)).toEqual([306691, 907714])
    // El total que la lente COHORTE va a mostrar sale de sumar los meses.
    expect(filas.reduce((s, f) => s + f.spend, 0)).toBe(1214405)
  })

  it('la etiqueta que guarda es la VIGENTE en Meta, no la del payload del lead', () => {
    // Meta renombro `CLIENTES POTENCIALES AGO 2026 PLUS` a `... AGO ($100)`. Lo que
    // se guarda aqui es el nombre de hoy; el del payload solo sirve de respaldo.
    const filas = filasParaUpsert({
      ...base,
      campaignId: '52656511383228',
      meta: { name: 'CLIENTES POTENCIALES AGO ($100)', account_id: '3229968600725628', status: 'PAUSED' },
      tramos: [{ date_start: '2026-08-06', date_stop: '2026-08-31', spend: '1524621' }],
    })
    expect(filas[0].campaign_name).toBe('CLIENTES POTENCIALES AGO ($100)')
    expect(filas[0].campaign_id).toBe('52656511383228')
  })

  it('un tramo sin gasto legible se descarta, no se guarda como cero', () => {
    const filas = filasParaUpsert({
      ...base,
      tramos: [{ date_start: '2026-06-09', spend: '306691' }, { date_start: '2026-07-01' }],
    })
    expect(filas).toHaveLength(1)
    expect(filas[0].mes).toBe('2026-06-01')
  })

  it('impresiones y clics ausentes no se inventan', () => {
    const filas = filasParaUpsert({ ...base, tramos: [{ date_start: '2026-06-09', spend: '306691' }] })
    expect(filas[0].impressions).toBeNull()
    expect(filas[0].clicks).toBeNull()
  })
})

describe('monedasEnConflicto', () => {
  it('las dos cuentas de SOENA estan en COP: no hay conflicto', () => {
    expect(monedasEnConflicto(['COP', 'COP'])).toEqual([])
  })

  it('mezclar monedas se declara, porque la pantalla suma sin verlas', () => {
    expect(monedasEnConflicto(['COP', 'USD'])).toEqual(['COP', 'USD'])
  })

  it('una moneda que no se pudo leer no cuenta como conflicto', () => {
    expect(monedasEnConflicto(['COP', null])).toEqual([])
  })
})

describe('credencialValida', () => {
  const SERVICE = 'service-role-key-de-prueba'
  const SECRETO = 'secreto-compartido'

  it('el secreto compartido en el cuerpo abre', () => {
    expect(credencialValida({
      esperado: SECRETO, serviceKey: SERVICE,
      secretoEnCuerpo: SECRETO, authorization: null,
    })).toBe(true)
  })

  it('la service role key en Authorization abre, con y sin el prefijo Bearer', () => {
    expect(credencialValida({
      esperado: SECRETO, serviceKey: SERVICE,
      secretoEnCuerpo: undefined, authorization: `Bearer ${SERVICE}`,
    })).toBe(true)
    expect(credencialValida({
      esperado: SECRETO, serviceKey: SERVICE,
      secretoEnCuerpo: undefined, authorization: SERVICE,
    })).toBe(true)
  })

  it('un secreto incorrecto no abre aunque el esperado exista', () => {
    expect(credencialValida({
      esperado: SECRETO, serviceKey: SERVICE,
      secretoEnCuerpo: 'otra-cosa', authorization: null,
    })).toBe(false)
  })

  // La trampa: sin esta guarda, `undefined === undefined` deja entrar a cualquiera
  // el dia que el secreto no este configurado en el proyecto.
  it('si el secreto esperado NO esta configurado, un cuerpo sin secreto NO abre', () => {
    expect(credencialValida({
      esperado: undefined, serviceKey: SERVICE,
      secretoEnCuerpo: undefined, authorization: null,
    })).toBe(false)
    expect(credencialValida({
      esperado: null, serviceKey: SERVICE,
      secretoEnCuerpo: null, authorization: null,
    })).toBe(false)
  })

  // Misma trampa del otro lado: en un entorno sin service key inyectada, una
  // peticion sin cabecera no puede pasar por "coinciden los dos ausentes".
  it('si la service key NO esta en el entorno, una peticion sin Authorization NO abre', () => {
    expect(credencialValida({
      esperado: SECRETO, serviceKey: undefined,
      secretoEnCuerpo: undefined, authorization: undefined,
    })).toBe(false)
  })

  it('una service key incorrecta no abre', () => {
    expect(credencialValida({
      esperado: SECRETO, serviceKey: SERVICE,
      secretoEnCuerpo: undefined, authorization: 'Bearer llave-ajena',
    })).toBe(false)
  })

  it('acepta el prefijo Bearer en cualquier combinacion de mayusculas', () => {
    expect(credencialValida({
      esperado: SECRETO, serviceKey: SERVICE,
      secretoEnCuerpo: undefined, authorization: `bearer ${SERVICE}`,
    })).toBe(true)
  })
})
