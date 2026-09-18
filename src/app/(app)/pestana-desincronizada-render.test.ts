/**
 * Lo que la pantalla de pestaña desincronizada PROMETE, renderizado.
 *
 * Prueba de render a propósito: la regla pura puede estar bien y el JSX pintar otra cosa.
 * Lo que se fija acá es lo único que hace útil a esta pantalla:
 *
 *   - nombra los DOS espacios de trabajo (en cuál quedó la pestaña, en cuál está la
 *     sesión) y sus dos slugs, para que la persona los reconozca contra su barra de
 *     direcciones;
 *   - ofrece continuar en el de la sesión, con enlace al subdominio correcto;
 *   - el botón de "traer esta pestaña de vuelta" SOLO aparece para el platform admin, que
 *     es el único que puede mover `profiles.workspace_id` (`switchWorkspace` lo vuelve a
 *     exigir del lado del servidor);
 *   - a quien no es platform admin no se le pinta el NOMBRE del workspace ajeno, solo el
 *     slug, que ya está en su propia URL.
 *
 * Las afirmaciones van sobre el NODO (atributo `data-desync` + su texto exacto) y no
 * sobre el texto de toda la pantalla: un `toContain` de una palabra seguiría verde con el
 * elemento borrado, porque el nombre del workspace aparece también en la prosa.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`, y renombrarlo a `.tsx`
 * lo sacaría de la suite en silencio.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// La server action arrastra `server-only` y el cliente de Supabase; la pantalla solo
// necesita su referencia para el botón.
vi.mock('@/lib/actions/platform-admin', () => ({
  switchWorkspace: async () => ({ success: true, targetSlug: 'soena', actionLink: null }),
}))
vi.mock('@/lib/workspace/redirigir-tras-switch', () => ({
  redirectAfterSwitch: () => {},
}))

const { PestanaDesincronizada } = await import('./pestana-desincronizada')

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** El texto del nodo marcado con `data-desync="<marca>"`, o null si no existe. */
function nodo(html: string, marca: string): string | null {
  const m = html.match(new RegExp(`data-desync="${marca}"[^>]*>([^<]*)`))
  return m ? m[1].trim() : null
}

const BASE = {
  slugPestana: 'soena',
  slugSesion: 'metrik',
  nombreSesion: 'MéTRIK',
  urlSesion: 'https://metrik.metrikone.co/',
}

describe('la pantalla nombra los dos espacios de trabajo', () => {
  const html = renderToStaticMarkup(
    React.createElement(PestanaDesincronizada, {
      ...BASE,
      workspaceDePestana: { id: 'ws-soena', slug: 'soena', name: 'SOENA' },
    }),
  )

  it('dice en cuál quedó la pestaña y en cuál está la sesión', () => {
    expect(nodo(html, 'nombre-pestana')).toBe('SOENA')
    expect(nodo(html, 'nombre-sesion')).toBe('MéTRIK')
  })

  it('muestra los dos slugs, que son lo que la persona ve en la barra de direcciones', () => {
    expect(nodo(html, 'slug-pestana')).toBe('soena')
    expect(nodo(html, 'slug-sesion')).toBe('metrik')
  })

  it('explica que el cambio vino de otra pestaña y que acá no se guarda nada', () => {
    const t = texto(html)
    expect(t).toMatch(/se cambia de espacio de trabajo desde otra pestaña/)
    expect(t).toMatch(/no muestra ni guarda nada/)
  })

  it('el botón primario lleva al subdominio de la sesión', () => {
    expect(html).toContain('href="https://metrik.metrikone.co/"')
    expect(nodo(html, 'continuar')).toBe('Continuar en MéTRIK')
  })
})

describe('el botón de volver es solo del platform admin', () => {
  it('con el workspace de la pestaña resuelto, ofrece traerla de vuelta', () => {
    const html = renderToStaticMarkup(
      React.createElement(PestanaDesincronizada, {
        ...BASE,
        workspaceDePestana: { id: 'ws-soena', slug: 'soena', name: 'SOENA' },
      }),
    )
    expect(html).toContain('data-desync="volver"')
    expect(texto(html)).toMatch(/Traer esta pestaña de vuelta a SOENA/)
  })

  it('sin él (o sea, para quien no es platform admin) no hay botón de volver', () => {
    const html = renderToStaticMarkup(
      React.createElement(PestanaDesincronizada, { ...BASE, workspaceDePestana: null }),
    )
    expect(html).not.toContain('data-desync="volver"')
    expect(texto(html)).not.toMatch(/Traer esta pestaña de vuelta/)
    // Y sigue teniendo salida: el botón de continuar no depende del rol.
    expect(html).toContain('data-desync="continuar"')
  })

  it('a quien no es platform admin no se le pinta el nombre del workspace ajeno', () => {
    const html = renderToStaticMarkup(
      React.createElement(PestanaDesincronizada, { ...BASE, workspaceDePestana: null }),
    )
    // Cae al slug, que ya está en la URL de esa misma pestaña.
    expect(nodo(html, 'nombre-pestana')).toBe('soena')
    expect(texto(html)).not.toContain('SOENA')
  })
})
