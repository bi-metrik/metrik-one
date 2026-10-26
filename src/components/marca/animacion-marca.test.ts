import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AnimacionMarca from './animacion-marca'
import Loading from '@/app/(app)/loading'
import { CLAVE_INTRO_MARCA, marcarIntroVista, varianteDeIntro } from './intro-de-sesion'

const leer = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8')

function almacenFalso() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('intro de la marca: una vez por sesion', () => {
  it('la primera vez toca la intro; marcada, la liviana', () => {
    const a = almacenFalso()
    expect(varianteDeIntro(a)).toBe('intro')
    // Mirar no gasta: un codigo errado no se lleva la intro.
    expect(varianteDeIntro(a)).toBe('intro')
    marcarIntroVista(a)
    expect(a.getItem(CLAVE_INTRO_MARCA)).toBe('1')
    expect(varianteDeIntro(a)).toBe('liviana')
  })

  it('sin almacen (o si lanza) va la liviana: nunca repetir la intro', () => {
    expect(varianteDeIntro(null)).toBe('liviana')
    const roto = { getItem: () => { throw new Error('privado') }, setItem: () => { throw new Error('privado') } }
    expect(varianteDeIntro(roto)).toBe('liviana')
    expect(() => marcarIntroVista(roto)).not.toThrow()
  })
})

describe('estado de carga de (app)', () => {
  it('pinta la version liviana, anunciada a lectores de pantalla', () => {
    const html = renderToStaticMarkup(React.createElement(Loading))
    expect(html).toContain('data-animacion-marca="liviana"')
    expect(html).toContain('role="status"')
    expect(html).toContain('--retardo:300ms')
    // No es un overlay: ocupa el hueco del contenido, dentro del shell.
    expect(html).not.toMatch(/\bfixed\b/)
  })

  it('la intro enciende cada letra con su retardo', () => {
    const html = renderToStaticMarkup(React.createElement(AnimacionMarca, { variante: 'intro' }))
    expect(html).toContain('data-animacion-marca="intro"')
    expect(html).toContain('--d:300ms')
    expect(html).toContain('--d:572ms')
  })
})

describe('la animacion no retiene a nadie', () => {
  const css = leer('./animacion-marca.module.css')
  const componente = leer('./animacion-marca.tsx')

  it('aparece con retardo y nunca es un overlay propio', () => {
    expect(css).toMatch(/\.raiz\s*\{[^}]*opacity:\s*0;[^}]*animation-delay:\s*var\(--retardo/)
    expect(css).not.toMatch(/position:\s*fixed/)
  })

  it('no lleva temporizadores ni estado: el contenido manda', () => {
    expect(componente).not.toMatch(/setTimeout|requestAnimationFrame|useState|useEffect/)
    expect(componente).not.toMatch(/^'use client'/m)
  })

  it('respeta prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('el layout raiz no la monta (ningun overlay desde el SSR)', () => {
    const layoutRaiz = leer('../../app/layout.tsx')
    expect(layoutRaiz).not.toMatch(/animacion-marca|splash/i)
  })
})
