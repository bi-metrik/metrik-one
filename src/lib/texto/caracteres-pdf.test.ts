/**
 * El 010 se caía con «WinAnsi cannot encode "В" (0x0412)» (V0121, 2026-10-06): la IA leyó una
 * В CIRÍLICA en la dirección del RUT. Los dobles exactos se convierten; lo que no tiene doble
 * («Л» por «JI», V0167) no se adivina: se dice qué campo corregir.
 */
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  CaracterNoImprimibleError,
  aLetraLatina,
  caracteresNoImprimibles,
  datosParaPdf,
  revisarLetrasLeidas,
  textoParaPdf,
} from './caracteres-pdf'
import { generarFormulario010, type Formulario010Datos, type Formulario010Constantes } from '@/lib/pdf/formulario-010'
import { generarFormulario1668, type Formulario1668Datos, type Formulario1668Constantes } from '@/lib/pdf/formulario-1668'

const DIR_V0121 = 'CIR 2 66 В 151' // В cirílica, como llegó del RUT

describe('dobles exactos', () => {
  it('la В cirílica de V0121 queda como B latina', () => {
    expect(aLetraLatina(DIR_V0121)).toBe('CIR 2 66 B 151')
    expect(caracteresNoImprimibles(DIR_V0121)).toEqual([])
  })

  it('cirílico y griego que se ven igual, en mayúscula y minúscula', () => {
    expect(aLetraLatina('АВЕКМНОРСТХ аеорсх ΑΒΕΚΜΝΟΡΤΧ')).toBe('ABEKMHOPCTX aeopcx ABEKMNOPTX')
  })

  it('el español no se toca: tildes, eñe, diéresis, símbolos de WinAnsi', () => {
    const s = 'ÁLVAREZ MUÑOZ, PINGÜINO — Nº 3 · 50% € ¿sí?'
    expect(aLetraLatina(s)).toBe(s)
    expect(caracteresNoImprimibles(s)).toEqual([])
  })

  it('comillas tipográficas, espacios raros y caracteres invisibles se normalizan', () => {
    expect(aLetraLatina('“CALLE” 5 B​')).toBe('"CALLE" 5 B')
  })
})

describe('lo que no tiene doble no se adivina', () => {
  it('«МЕЛА» (V0167) deja la Л y la Л', () => {
    expect(caracteresNoImprimibles('RESTREPO МЕЛА SANTIAGO')).toEqual(['Л'])
  })

  it('textoParaPdf lanza un error para la persona, no el de la fuente', () => {
    try {
      textoParaPdf('САЛСА CUNDINAMARCA', 'Dirección')
      throw new Error('no lanzó')
    } catch (e) {
      expect(e).toBeInstanceOf(CaracterNoImprimibleError)
      expect((e as Error).message).toBe('El campo «Dirección» tiene un carácter no válido: "Л". Corrígelo y vuelve a generar.')
      expect((e as Error).message).not.toMatch(/WinAnsi/)
    }
  })

  it('datosParaPdf convierte lo convertible y nombra el campo que no', () => {
    const ok = datosParaPdf({ direccion: DIR_V0121, nit: '123', vacio: null })
    expect(ok).toEqual({ ok: true, datos: { direccion: 'CIR 2 66 B 151', nit: '123', vacio: null } })

    const mal = datosParaPdf({ direccion: DIR_V0121, nombre_certificado: 'RESTREPO МЕЛА SANTIAGO' }, (c) => (c === 'nombre_certificado' ? 'Nombre' : c))
    expect(mal.ok).toBe(false)
    if (!mal.ok) {
      expect(mal.campo).toBe('nombre_certificado')
      expect(mal.mensaje).toBe('El campo «Nombre» tiene un carácter no válido: "Л". Corrígelo y vuelve a generar.')
    }
  })
})

describe('la extracción marca el campo', () => {
  it('un doble exacto se corrige y NO va a revisión', () => {
    expect(revisarLetrasLeidas(DIR_V0121)).toEqual({ valor: 'CIR 2 66 B 151', noValidas: [] })
  })
  it('una letra sin doble va a revisión con el valor a la vista', () => {
    expect(revisarLetrasLeidas('RESTREPO МЕЛА SANTIAGO')).toEqual({ valor: 'RESTREPO MEЛA SANTIAGO', noValidas: ['Л'] })
  })
  it('el español no se marca', () => {
    expect(revisarLetrasLeidas('PEÑA ÁVILA').noValidas).toEqual([])
  })
})

// ── Los formularios de verdad, sobre la plantilla oficial ───────────────────────────────

const vacio010 = new Proxy({}, { get: () => null }) as unknown as Formulario010Datos
const constantes010: Formulario010Constantes = {
  concepto: '3', tipo_solicitud: 'A solicitud de parte', tipo_obligacion: 'UPME', concepto_saldo: 'IVA',
}

describe('formulario 010', () => {
  it('con la dirección de V0121 (В cirílica) se genera', async () => {
    const bytes = await generarFormulario010({ ...vacio010, direccion: DIR_V0121, primer_apellido: 'RESTREPO' }, constantes010)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)
  })

  it('con «Л» no se cae con el error de la fuente: avisa qué corregir', async () => {
    await expect(generarFormulario010({ ...vacio010, primer_apellido: 'МЕЛА' }, constantes010))
      .rejects.toThrow(/carácter no válido: "Л"/)
  })
})

describe('formulario 1668', () => {
  it('con un nombre con В cirílica se genera', async () => {
    const datos = new Proxy({ primer_apellido: 'ВOTERO' }, { get: (t, k) => (t as Record<string | symbol, unknown>)[k] ?? null }) as unknown as Formulario1668Datos
    const bytes = await generarFormulario1668(datos, {} as Formulario1668Constantes)
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
