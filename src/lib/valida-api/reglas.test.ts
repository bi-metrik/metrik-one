import { describe, expect, it } from 'vitest'
import {
  clienteOperable,
  clienteValidaDe,
  moduloValidaApiActivo,
  nombreLlaveValido,
  puedeOperarLlaves,
  puedeVerPagos,
} from './reglas'
import { MODULOS } from '@/lib/modulos/catalogo'

const CLIENTE_4D_SOFT = '8c211c68-6c25-4beb-b364-c91c284d6379'

describe('moduloValidaApiActivo', () => {
  it('usa la misma llave que el catálogo de módulos', () => {
    // Si el catálogo renombrara la llave, el módulo quedaría apagado sin que nada fallara.
    expect(MODULOS.valida_api.clave).toBe('valida_api')
  })

  it('solo `true` lo enciende', () => {
    expect(moduloValidaApiActivo({ valida_api: true })).toBe(true)
    expect(moduloValidaApiActivo({ valida_api: 'true' })).toBe(false)
    expect(moduloValidaApiActivo({ valida_consulta: true })).toBe(false)
    expect(moduloValidaApiActivo(null)).toBe(false)
  })
})

describe('clienteValidaDe: el cliente sale del workspace, nunca del navegador', () => {
  it('lee config_extra.valida_cliente_id', () => {
    expect(clienteValidaDe({ valida_cliente_id: CLIENTE_4D_SOFT })).toBe(CLIENTE_4D_SOFT)
  })

  it('un valor que no es uuid se trata como ausente', () => {
    expect(clienteValidaDe({ valida_cliente_id: '../otro-cliente' })).toBeNull()
    expect(clienteValidaDe({ valida_cliente_id: 123 })).toBeNull()
    expect(clienteValidaDe({})).toBeNull()
    expect(clienteValidaDe(null)).toBeNull()
  })

  it('NO confunde la llave de consulta (valida_api_key) con el cliente', () => {
    expect(clienteValidaDe({ valida_api_key: 'vld_xxx' })).toBeNull()
  })
})

describe('clienteOperable: hace falta el módulo Y el cliente', () => {
  // Forma medida en producción el 2026-09-16: `afi` es cliente de INTEGRACIÓN, trae
  // valida_cliente_id y NO tiene el módulo valida_api.
  const AFI_MODULES = { business: true, valida_consulta: true }
  const AFI_CONFIG = { valida_cliente_id: '55a4400c-e588-4fcb-b46d-8873cf87ff9b' }

  it('un workspace de integración con cliente pero sin el módulo NO opera nada', () => {
    expect(clienteOperable(AFI_MODULES, AFI_CONFIG)).toBeNull()
  })

  it('con el módulo encendido y el cliente, sí', () => {
    expect(clienteOperable({ valida_api: true }, { valida_cliente_id: CLIENTE_4D_SOFT })).toBe(CLIENTE_4D_SOFT)
  })

  it('con el módulo pero sin cliente, tampoco', () => {
    expect(clienteOperable({ valida_api: true }, {})).toBeNull()
  })
})

describe('roles', () => {
  it('llaves y pagos: owner y admin', () => {
    for (const r of ['owner', 'admin']) {
      expect(puedeOperarLlaves(r)).toBe(true)
      expect(puedeVerPagos(r)).toBe(true)
    }
    for (const r of ['supervisor', 'operator', 'read_only', 'contador', null, undefined]) {
      expect(puedeOperarLlaves(r)).toBe(false)
      expect(puedeVerPagos(r)).toBe(false)
    }
  })
})

describe('nombreLlaveValido', () => {
  it('entre 1 y 60 caracteres, recortado', () => {
    expect(nombreLlaveValido('  ERP  ')).toBe('ERP')
    expect(nombreLlaveValido('')).toBeNull()
    expect(nombreLlaveValido('   ')).toBeNull()
    expect(nombreLlaveValido('x'.repeat(61))).toBeNull()
    expect(nombreLlaveValido('x'.repeat(60))).toBe('x'.repeat(60))
  })
})
