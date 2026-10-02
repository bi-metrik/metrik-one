/**
 * Una sola lectura de la fila de `profiles` del usuario por render (2026-10-02).
 *
 * El layout, `getWorkspace` y `getPlatformAdminState` leian la MISMA fila por separado en
 * cada render: tres viajes a `/profiles` mas el del middleware. Ahora los tres pasan por
 * `leerPerfilDeSesion`, que va envuelta en `cache()`.
 *
 * Lo que se fija:
 *  1. La lectura trae la union de columnas que consumen los tres (si a uno le falta una,
 *     volveria a leer por su cuenta, o leeria `undefined` en silencio).
 *  2. Ninguno de los tres vuelve a leer la fila del usuario por su cuenta.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let selectPedido = ''
let idPedido = ''
vi.mock('./server', () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      expect(tabla).toBe('profiles')
      return {
        select: (cols: string) => {
          selectPedido = cols
          return {
            eq: (_col: string, valor: string) => {
              idPedido = valor
              return {
                single: async () => ({
                  data: {
                    id: valor,
                    workspace_id: 'ws-1',
                    home_workspace_id: null,
                    role: 'owner',
                    full_name: 'Ana',
                    platform_admin: false,
                    workspaces: { slug: 'soena', name: 'SOENA' },
                  },
                  error: null,
                }),
              }
            },
          }
        },
      }
    },
  }),
}))

const { leerPerfilDeSesion } = await import('./perfil-sesion')

const raiz = path.resolve(__dirname, '../../..')
const fuente = (rel: string) => readFileSync(path.join(raiz, rel), 'utf8')

describe('leerPerfilDeSesion', () => {
  it('trae en un viaje todo lo que leen layout, getWorkspace y la barra de plataforma', async () => {
    const perfil = await leerPerfilDeSesion('u-1')
    expect(idPedido).toBe('u-1')
    for (const col of ['id', 'workspace_id', 'home_workspace_id', 'role', 'full_name', 'platform_admin']) {
      expect(selectPedido.split(/[\s,]+/)).toContain(col)
    }
    // La FK nombrada: sin ella PostgREST responde PGRST201 (dos FK hacia `workspaces`).
    expect(selectPedido).toContain('workspaces!profiles_workspace_id_fkey(slug, name)')
    expect(perfil?.workspaces?.slug).toBe('soena')
  })
})

describe('los tres consumidores comparten la lectura', () => {
  it.each([
    'src/app/(app)/layout.tsx',
    'src/lib/actions/get-workspace-impl.ts',
    'src/lib/actions/platform-admin.ts',
  ])('%s usa leerPerfilDeSesion y no relee la fila del usuario', (rel) => {
    const s = fuente(rel)
    expect(s).toContain('leerPerfilDeSesion(user.id)')
    expect(s).not.toMatch(/\.from\('profiles'\)[\s\S]{0,400}?\.eq\('id', user\.id\)/)
  })
})
