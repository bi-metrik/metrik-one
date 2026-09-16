/**
 * Los cuatro archivos de catálogo de A2, leídos por el MISMO camino que usa la ruta.
 *
 * Sin esto, «los archivos están escritos» sería una afirmación: un frontmatter con una coma de
 * más o un slug que no existe en el catálogo de módulos solo se descubriría el día que la
 * Action corra contra producción. Aquí se descubre en CI.
 *
 * Y fija la decisión que más caro sale equivocada: **nada nace con IVA del 19 %**
 * (2026-09-15/16, toda suscripción se vende como servicio de computación en la nube, excluido
 * por el art. 476 ET).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { prepararVersion } from './recibir-version'
import { CLAVES_DE_MODULO } from '@/lib/modulos/catalogo'

const RAIZ = path.resolve(__dirname, '../../..')
const DIR = path.join(RAIZ, 'docs/catalogo-servicios/cerebro/catalogo/servicios')

const ESPERADOS = ['licencia-clarity', 'licencia-sustenta', 'valida-api-bolsa', 'valida-cda-licencia']

const archivos = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()

describe('los archivos de A2', () => {
  it('están los cuatro que pide la entrega (guard: sin esto la suite pasaría vacía)', () => {
    expect(archivos.map((f) => f.replace(/\.md$/, ''))).toEqual(ESPERADOS)
  })

  for (const archivo of archivos) {
    const slug = archivo.replace(/\.md$/, '')
    const texto = readFileSync(path.join(DIR, archivo), 'utf8')
    const r = prepararVersion({ fuente_ruta: `cerebro/catalogo/servicios/${archivo}`, archivo: texto })

    describe(slug, () => {
      it('pasa el mismo camino que la ruta: frontmatter + esquema + slug', () => {
        // Si esto falla, el mensaje trae los motivos exactos que devolvería el 422.
        expect(r.ok ? [] : r.detalles, r.ok ? '' : r.error).toEqual([])
        expect(r.ok).toBe(true)
      })

      it('su slug es el del nombre del archivo', () => {
        expect(r.ok && r.slug).toBe(slug)
      })

      it('nace en la versión 1', () => {
        expect(r.ok && r.version).toBe(1)
      })

      it('su módulo es uno que existe en el catálogo de módulos', () => {
        expect(r.ok && CLAVES_DE_MODULO).toContain(r.ok ? r.definicion.modulo : '')
      })

      it('está EXCLUIDO de IVA y no declara tarifa', () => {
        expect(r.ok && r.definicion.tratamiento_iva).toBe('excluido')
        expect(r.ok && r.definicion.iva_pct).toBeUndefined()
      })

      it('cita de dónde salen el precio y el tratamiento de IVA', () => {
        expect(r.ok && r.definicion.precios_lista_fuente.length).toBeGreaterThan(0)
        expect(r.ok && r.definicion.tratamiento_iva_fuente.length).toBeGreaterThan(0)
      })

      it('no trae comisión: eso lo define cada contrato (N3)', () => {
        expect(texto).not.toMatch(/^comision\s*:/m)
      })
    })
  }
})

describe('lo que cada archivo tiene que decir de su negocio', () => {
  const def = (slug: string) => {
    const texto = readFileSync(path.join(DIR, `${slug}.md`), 'utf8')
    const r = prepararVersion({ fuente_ruta: `cerebro/catalogo/servicios/${slug}.md`, archivo: texto })
    if (!r.ok) throw new Error(`${slug}: ${r.detalles.join('; ')}`)
    return r.definicion
  }

  it('la licencia de un CDA se cobra por ciclo y su precio por defecto son $150.000', () => {
    // $150.000 sin IVA por cobro (decisión del 2026-09-15). El precio de AFI ($50.000) NO
    // está aquí: es comisión, y la comisión vive en el contrato.
    const d = def('valida-cda-licencia')
    expect(d.disparador_cobro).toBe('ciclo')
    expect(d.parametros.precio_mensual.por_defecto).toBe(150_000)
    expect(d.modulo).toBe('valida_consulta')
  })

  it('el paquete de Valida API se cobra por CONSUMO, no por calendario', () => {
    // Por eso no usa `planes_cobro`: el cron que crea cuotas le inventaría un calendario.
    const d = def('valida-api-bolsa')
    expect(d.disparador_cobro).toBe('consumo')
    expect(d.parametros.umbral_cobro_pct.por_defecto).toBe(95) // D1
    expect(d.parametros.tope_renovaciones_mes).toMatchObject({ por_defecto: 2, max: 2 })
  })

  it('las dos licencias de módulo se cobran por ciclo y traen los 5 días de gracia de D4', () => {
    for (const slug of ['licencia-clarity', 'licencia-sustenta']) {
      const d = def(slug)
      expect(d.disparador_cobro, slug).toBe('ciclo')
      expect(d.parametros.dias_gracia.por_defecto, slug).toBe(5)
    }
  })

  it('el día de cobro no pasa de 28: un 31 no existe todos los meses', () => {
    for (const slug of ['licencia-clarity', 'licencia-sustenta', 'valida-cda-licencia']) {
      expect(def(slug).parametros.dia_cobro.max, slug).toBe(28)
    }
  })

  it('cada archivo declara los documentos contractuales que lo cubren', () => {
    for (const slug of ESPERADOS) {
      expect(def(slug).documentos.length, slug).toBeGreaterThan(0)
    }
  })
})
