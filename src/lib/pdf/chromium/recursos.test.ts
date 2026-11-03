import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cssDeFuentes,
  incrustarFotos,
  inyectarEstilo,
  peticionPermitida,
  pieDePagina,
  tipoDeImagen,
} from './recursos'
import { accesoAlEnsayo } from './acceso-ensayo'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('incrustarFotos', () => {
  it('cambia src y url() por data URL y repite la misma foto sin releerla', () => {
    let lecturas = 0
    const { html, faltantes, incrustadas } = incrustarFotos(
      `<img src="fotos/a.jpg"><div style="background-image:url(fotos/a.jpg)"></div><img src='fotos/b.png'>`,
      (f) => {
        lecturas++
        return bytes(f)
      },
    )
    expect(html).toContain(`src="data:image/jpeg;base64,${Buffer.from('a.jpg').toString('base64')}"`)
    expect(html).toContain(`url(data:image/jpeg;base64,`)
    expect(html).toContain(`src='data:image/png;base64,`)
    expect(html).not.toContain('fotos/')
    expect(incrustadas).toBe(3)
    expect(lecturas).toBe(2)
    expect(faltantes).toEqual([])
  })

  it('deja igual y reporta la foto que no existe o no es imagen', () => {
    const { html, faltantes } = incrustarFotos(`<img src="fotos/no.jpg"><a href="fotos/x.txt">`, () => null)
    expect(html).toBe(`<img src="fotos/no.jpg"><a href="fotos/x.txt">`)
    expect(faltantes.sort()).toEqual(['no.jpg', 'x.txt'])
  })

  it('no toca rutas que solo contienen «fotos/» en medio', () => {
    const { html } = incrustarFotos(`<img src="/otras/fotos/a.jpg">`, () => bytes('x'))
    expect(html).toBe(`<img src="/otras/fotos/a.jpg">`)
  })
})

describe('fuentes y estilo', () => {
  it('declara cada fuente como woff2 embebido', () => {
    const css = cssDeFuentes([{ familia: 'Inter', peso: 600, estilo: 'normal', datos: bytes('w') }])
    expect(css).toContain("font-family:'Inter'")
    expect(css).toContain('font-weight:600')
    expect(css).toContain("url(data:font/woff2;base64,dw==) format('woff2')")
  })

  it('inyecta el estilo dentro del head', () => {
    expect(inyectarEstilo('<html><head><title>x</title></head>', 'b{}')).toBe(
      '<html><head><style>b{}</style><title>x</title></head>',
    )
    expect(inyectarEstilo('<p>x</p>', 'b{}')).toBe('<style>b{}</style><p>x</p>')
  })

  it('el pie escapa el texto y trae los marcadores de página de Chromium', () => {
    const pie = pieDePagina({ izquierda: 'A <b> & C', codigo: 'COT-1', colorLinea: '#e63380' })
    expect(pie).toContain('A &lt;b&gt; &amp; C')
    expect(pie).toContain('class="pageNumber"')
    expect(pie).toContain('class="totalPages"')
  })

  it('las once fuentes del repo son woff2 de verdad', () => {
    const dir = path.join(__dirname, 'fuentes')
    const archivos = readdirSync(dir).filter((f) => f.endsWith('.woff2'))
    // 9 de la propuesta + Liberation Sans 400/700 de los documentos del expediente (2026-10-29).
    expect(archivos).toHaveLength(11)
    for (const f of archivos) expect(readFileSync(path.join(dir, f)).subarray(0, 4).toString('latin1')).toBe('wOF2')
  })
})

describe('red cerrada', () => {
  it('solo deja pasar lo que va dentro del documento', () => {
    expect(peticionPermitida('data:image/png;base64,xx')).toBe(true)
    expect(peticionPermitida('about:blank')).toBe(true)
    expect(peticionPermitida('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(peticionPermitida('https://yfjqscvvxetobiidnepa.supabase.co/x')).toBe(false)
    expect(peticionPermitida('file:///etc/passwd')).toBe(false)
  })

  it('reconoce los tipos de imagen', () => {
    expect(tipoDeImagen('A.JPG')).toBe('image/jpeg')
    expect(tipoDeImagen('x.svg')).toBe('image/svg+xml')
    expect(tipoDeImagen('x.gif')).toBeNull()
  })
})

describe('accesoAlEnsayo', () => {
  it('solo el GET de un preview queda abierto', () => {
    expect(accesoAlEnsayo({ vercelEnv: 'preview', metodo: 'GET' })).toBe('abierto')
    expect(accesoAlEnsayo({ vercelEnv: 'preview', metodo: 'POST' })).toBe('requiere_admin')
    expect(accesoAlEnsayo({ vercelEnv: 'production', metodo: 'GET' })).toBe('requiere_admin')
    expect(accesoAlEnsayo({ vercelEnv: undefined, metodo: 'GET' })).toBe('requiere_admin')
  })
})

describe('fixture del ensayo', () => {
  it('toda foto que el prototipo nombra está en el repo', () => {
    const dir = path.join(__dirname, 'ensayo')
    const html = readFileSync(path.join(dir, 'doc.html'), 'utf8')
    const { faltantes, incrustadas } = incrustarFotos(html, (f) => {
      try {
        return readFileSync(path.join(dir, 'fotos', f))
      } catch {
        return null
      }
    })
    expect(faltantes).toEqual([])
    expect(incrustadas).toBeGreaterThan(20)
  })
})
