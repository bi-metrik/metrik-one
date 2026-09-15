import { describe, expect, it } from 'vitest'
import {
  ErrorAlmacenamiento,
  esAlmacenamientoExterno,
  esValorProveedorExterno,
  leerConfigAlmacenamiento,
  nombreVariableLlave,
} from './config'

const LLAVE = 'sb_secret_de_prueba_que_no_existe_0000'
const URL_OK = 'https://abcdefghijklmnop.supabase.co'

function leer(configExtra: unknown, env: Record<string, string | undefined> = {}, slug = 'trappvel') {
  return leerConfigAlmacenamiento({ slug, configExtra, env })
}

describe('nombreVariableLlave', () => {
  it('slug en mayúsculas y cualquier caracter raro a guion bajo', () => {
    expect(nombreVariableLlave('trappvel')).toBe('WS_STORAGE_SECRET_TRAPPVEL')
    expect(nombreVariableLlave('ana-demo')).toBe('WS_STORAGE_SECRET_ANA_DEMO')
  })
})

describe('esAlmacenamientoExterno (la marca que decide qué NO hacer con Drive)', () => {
  it('sin marca o con drive → no', () => {
    expect(esAlmacenamientoExterno({})).toBe(false)
    expect(esAlmacenamientoExterno(null)).toBe(false)
    expect(esAlmacenamientoExterno({ storage_provider: 'drive' })).toBe(false)
    expect(esAlmacenamientoExterno({ storage_provider: '' })).toBe(false)
    expect(esAlmacenamientoExterno({ storage_provider: null })).toBe(false)
  })

  it('supabase_externo → sí', () => {
    expect(esAlmacenamientoExterno({ storage_provider: 'supabase_externo' })).toBe(true)
  })

  it('una errata NO cae a Drive: fail-closed', () => {
    expect(esValorProveedorExterno('supabase-externo')).toBe(true)
    expect(esValorProveedorExterno(true)).toBe(true)
  })
})

describe('leerConfigAlmacenamiento', () => {
  it('sin marca: Drive, sin pedir nada más (ningún workspace existente cambia)', () => {
    expect(leer({})).toEqual({ proveedor: 'drive' })
    expect(leer({ drive_auth_mode: 'service_account' })).toEqual({ proveedor: 'drive' })
  })

  it('completa: devuelve url normalizada y la llave de la variable del slug', () => {
    const cfg = leer(
      { storage_provider: 'supabase_externo', storage_supabase_url: `${URL_OK}/` },
      { WS_STORAGE_SECRET_TRAPPVEL: `  ${LLAVE}\n` },
    )
    expect(cfg).toEqual({ proveedor: 'supabase_externo', slug: 'trappvel', url: URL_OK, llave: LLAVE })
  })

  it('falta la variable de entorno: error claro, sin fallback a Drive', () => {
    let error: unknown
    try {
      leer({ storage_provider: 'supabase_externo', storage_supabase_url: URL_OK }, {})
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ErrorAlmacenamiento)
    expect((error as Error).message).toContain('WS_STORAGE_SECRET_TRAPPVEL')
    expect((error as Error).message).toContain('NO se guardan en Drive')
  })

  it('la llave de OTRO workspace no sirve', () => {
    expect(() =>
      leer(
        { storage_provider: 'supabase_externo', storage_supabase_url: URL_OK },
        { WS_STORAGE_SECRET_SOENA: LLAVE },
      ),
    ).toThrow(/WS_STORAGE_SECRET_TRAPPVEL/)
  })

  it('falta la URL o no es https: error claro', () => {
    const env = { WS_STORAGE_SECRET_TRAPPVEL: LLAVE }
    expect(() => leer({ storage_provider: 'supabase_externo' }, env)).toThrow(/storage_supabase_url/)
    expect(() =>
      leer({ storage_provider: 'supabase_externo', storage_supabase_url: 'http://x.supabase.co' }, env),
    ).toThrow(/storage_supabase_url/)
  })

  it('proveedor desconocido: error, no Drive', () => {
    expect(() => leer({ storage_provider: 'supabase-externo' }, { WS_STORAGE_SECRET_TRAPPVEL: LLAVE })).toThrow(
      /no es un proveedor conocido/,
    )
  })

  it('ningún mensaje de error contiene la llave', () => {
    const casos: Array<[unknown, Record<string, string>]> = [
      [{ storage_provider: 'supabase_externo' }, { WS_STORAGE_SECRET_TRAPPVEL: LLAVE }],
      [{ storage_provider: 'otro' }, { WS_STORAGE_SECRET_TRAPPVEL: LLAVE }],
    ]
    for (const [cfg, env] of casos) {
      try {
        leer(cfg, env)
      } catch (e) {
        expect((e as Error).message).not.toContain(LLAVE)
      }
    }
  })
})
