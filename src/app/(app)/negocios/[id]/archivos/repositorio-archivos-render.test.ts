/**
 * El repositorio de archivos se PINTA de verdad: grupos, nombre, fecha, tamaño y el
 * enlace de cada archivo por el endpoint que firma. Una prueba pura de
 * `agruparRepositorio` no fija que el JSX use `hrefArchivo` y no la ruta cruda.
 *
 * ⚠️ Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RepositorioArchivos from './repositorio-archivos'
import { agruparRepositorio } from '@/lib/almacenamiento/repositorio'

const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const ruta = (resto: string) => `negocios/${NEG}/${resto}`

const render = (props: Parameters<typeof RepositorioArchivos>[0]) =>
  renderToStaticMarkup(React.createElement(RepositorioArchivos, props))

describe('RepositorioArchivos', () => {
  const grupos = agruparRepositorio(
    NEG,
    [
      { path: ruta('5-documentos-del-viajero/pasaporte-y-visado.pdf'), bytes: 1.25 * 1024 * 1024, actualizado: '2026-09-14T20:00:00Z', mime: 'application/pdf' },
    ],
    ['2. Legal', '5. Documentos del viajero'],
  )

  it('pinta cada grupo con su nombre legible, el archivo, su tamaño y su fecha', () => {
    const html = render({ negocioId: NEG, negocio: { codigo: 'M1 26 1', nombre: 'Viaje Japón' }, estado: { tipo: 'ok', grupos, truncado: false } })
    expect(html).toContain('M1 26 1')
    expect(html).toContain('5. Documentos del viajero')
    expect(html).toContain('2. Legal')
    expect(html).toContain('Sin archivos')
    expect(html).toContain('pasaporte-y-visado.pdf')
    expect(html).toContain('1,3 MB')
    expect(html).toMatch(/14[^<]*sept?[^<]*2026/)
  })

  it('cada archivo abre y descarga por el endpoint que firma, nunca por la ruta del bucket', () => {
    const html = render({ negocioId: NEG, negocio: null, estado: { tipo: 'ok', grupos, truncado: false } })
    const ref = encodeURIComponent(`sbext://one-documentos/${ruta('5-documentos-del-viajero/pasaporte-y-visado.pdf')}`)
    expect(html).toContain(`href="/api/archivos/abrir?ref=${ref}"`)
    expect(html).toContain(`href="/api/archivos/abrir?ref=${ref}&amp;descargar=1"`)
    expect(html).not.toContain('supabase.co')
  })

  it('avisa cuando la lista está incompleta', () => {
    const html = render({ negocioId: NEG, negocio: null, estado: { tipo: 'ok', grupos, truncado: true } })
    expect(html).toContain('La lista está incompleta')
  })

  it('sin acceso: no pinta archivos ni el nombre del negocio, y vuelve a la lista', () => {
    const html = render({ negocioId: NEG, negocio: null, estado: { tipo: 'sin_acceso' } })
    expect(html).toContain('No tienes acceso')
    expect(html).toContain('href="/negocios"')
    expect(html).not.toContain('/api/archivos/abrir')
  })

  it('error de lectura: lo dice en vez de mostrar un repositorio vacío', () => {
    const html = render({ negocioId: NEG, negocio: null, estado: { tipo: 'error', mensaje: 'No se pudo leer el repositorio de archivos.' } })
    expect(html).toContain('No se pudo leer el repositorio')
    expect(html).not.toContain('todavía no tiene archivos')
  })
})
