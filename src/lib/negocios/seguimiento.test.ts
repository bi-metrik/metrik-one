import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { RAZONES_PERDIDA_NEGOCIO } from './constants'
import {
  MOTIVOS_PERDIDA_SEGUIMIENTO,
  configSeguimiento,
  etiquetaMotivoPerdida,
  maxDiasPausaDeLinea,
  motivoPerdidaInvalido,
  versionEnCadena,
} from './seguimiento'

describe('configuración de seguimiento de la línea', () => {
  it('ausente = apagado, con 14 días de pausa como hoy', () => {
    expect(configSeguimiento(null)).toMatchObject({ activo: false, maxDiasAplazar: 14 })
    expect(configSeguimiento({ seguimiento: { activo: 'si' } }).activo).toBe(false)
  })

  it('los cinco motivos de Noor caen sobre values globales (los reportes no se rompen)', () => {
    const globales = new Set<string>(RAZONES_PERDIDA_NEGOCIO.map((r) => r.value))
    expect(MOTIVOS_PERDIDA_SEGUIMIENTO.map((m) => m.label)).toEqual(['Precio', 'Se fue con otra agencia', 'Cambió de planes', 'No respondió', 'Otro'])
    expect(MOTIVOS_PERDIDA_SEGUIMIENTO.every((m) => globales.has(m.value))).toBe(true)
  })

  it('motivos propios de la línea solo si caen sobre un value global', () => {
    const cfg = configSeguimiento({
      seguimiento: { activo: true, motivos_perdida: [{ value: 'precio', label: 'Caro' }, { value: 'inventado', label: 'X' }] },
    })
    expect(cfg.motivosPerdida).toEqual([{ value: 'precio', label: 'Caro' }])
  })

  it('plazo de la pausa: entero de 1 a 365; lo demás cae a 14', () => {
    expect(maxDiasPausaDeLinea({ pausa: { max_dias: 60 } })).toBe(60)
    expect(maxDiasPausaDeLinea({ pausa: { max_dias: 0 } })).toBe(14)
    expect(maxDiasPausaDeLinea({ pausa: { max_dias: '60' } })).toBe(14)
  })

  it('motivo y etiqueta: encendido exige la lista; apagado no valida nada', () => {
    const on = configSeguimiento({ seguimiento: { activo: true } })
    const off = configSeguimiento({})
    expect(motivoPerdidaInvalido(on, 'duplicado')).toMatch(/Escoge un motivo/)
    expect(motivoPerdidaInvalido(on, 'timing')).toBeNull()
    expect(motivoPerdidaInvalido(off, 'cualquiera')).toBeNull()
    expect(etiquetaMotivoPerdida(on, 'timing')).toBe('Cambió de planes')
    expect(etiquetaMotivoPerdida(off, 'timing')).toBe('No es el momento')
  })
})

describe('versión por la cadena duplicada_de (F1-3)', () => {
  it('v1 la original, v3 la copia de la copia; un ciclo no se cuelga', () => {
    const padre = new Map<string, string | null>([['a', null], ['b', 'a'], ['c', 'b'], ['x', 'y'], ['y', 'x']])
    expect(versionEnCadena('a', padre)).toBe(1)
    expect(versionEnCadena('c', padre)).toBe(3)
    expect(versionEnCadena('x', padre)).toBe(2)
  })
})

describe('migración origen_version', () => {
  it('columna nullable con los 4 orígenes', async () => {
    const db = new PGlite()
    await db.exec(`create table public.cotizaciones (id serial primary key);
                   insert into public.cotizaciones default values;`)
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations/20261012180000_cotizaciones_origen_version.sql'), 'utf8'))
    const r = await db.query<{ origen_version: string | null }>('select origen_version from public.cotizaciones')
    expect(r.rows[0].origen_version).toBeNull()
    await db.exec(`update public.cotizaciones set origen_version = 'prerreserva_vencida'`)
    await expect(db.exec(`update public.cotizaciones set origen_version = 'capricho'`)).rejects.toThrow(/check/i)
    await db.close()
  }, 30_000) // PGlite arranca lento con la suite completa en paralelo
})
