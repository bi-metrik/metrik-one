// Pruebas de la guarda de versiones repetidas de migracion.
//
// Cada caso monta un repo git DESECHABLE en el temporal del sistema (nunca dentro de
// `supabase/migrations/`) y corre la guarda como proceso, igual que la corre CI. Es
// deliberado que pase por git de verdad: el camino que usa CI es
// `git diff --no-renames --diff-filter=A base...HEAD`, y una prueba que le pasara las rutas
// a mano dejaria ese camino sin ejercitar — que es justo donde vive la decision de alcance
// (solo lo que el PR agrega) que hace util a esta guarda.

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const GUARDA = join(RAIZ, 'scripts/check-migracion-version-duplicada.mjs')

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
}

function tocar(repo, nombre) {
  writeFileSync(join(repo, 'supabase/migrations', nombre), '-- vacia\n')
}

// Monta un repo con `enBase` ya commiteado, y luego aplica `cambios` en una rama.
// `cambios` puede agregar archivos (`agrega`), borrarlos (`borra`) o renombrarlos (`renombra`).
function repoCon({ enBase = [], agrega = [], borra = [], renombra = [] }) {
  const repo = mkdtempSync(join(tmpdir(), 'verdup-'))
  mkdirSync(join(repo, 'supabase/migrations'), { recursive: true })
  git(repo, 'init', '--quiet', '--initial-branch=main')
  git(repo, 'config', 'user.email', 'guarda@test')
  git(repo, 'config', 'user.name', 'Guarda')

  for (const n of enBase) tocar(repo, n)
  // Un archivo fuera de migraciones garantiza que el commit base exista aunque `enBase`
  // este vacio.
  writeFileSync(join(repo, 'README'), 'base\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD').trim()

  git(repo, 'checkout', '--quiet', '-b', 'pr')
  for (const n of agrega) tocar(repo, n)
  for (const n of borra) rmSync(join(repo, 'supabase/migrations', n))
  for (const [de, a] of renombra) {
    git(repo, 'mv', `supabase/migrations/${de}`, `supabase/migrations/${a}`)
  }
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'pr')

  return { repo, base }
}

// Corre la guarda dentro del repo desechable. Devuelve { ok, salida }.
function revisar({ repo, base }, extra = []) {
  try {
    const out = execFileSync('node', [GUARDA, ...extra], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, BASE_REF: base },
    })
    return { ok: true, salida: out }
  } catch (e) {
    return { ok: false, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('versiones repetidas de migracion', () => {
  it('deja pasar una migracion nueva con version libre', () => {
    const r = revisar(
      repoCon({
        enBase: ['20260101000001_uno.sql'],
        agrega: ['20260101000002_dos.sql'],
      }),
    )
    expect(r.ok).toBe(true)
  })

  // El caso que motiva la guarda: el archivo nuevo choca con uno que YA vive en main.
  it('rechaza la migracion nueva que repite la version de una que ya esta en main', () => {
    const r = revisar(
      repoCon({
        enBase: ['20260101000001_uno.sql'],
        agrega: ['20260101000001_otro_nombre.sql'],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('20260101000001')
    // El mensaje tiene que nombrar los dos archivos, o no es accionable sin ir a mirar.
    expect(r.salida).toContain('20260101000001_uno.sql')
    expect(r.salida).toContain('20260101000001_otro_nombre.sql')
    expect(r.salida).toContain('lo agrega este PR')
  })

  it('rechaza dos migraciones del mismo PR que comparten version entre si', () => {
    const r = revisar(
      repoCon({ agrega: ['20260202000001_a.sql', '20260202000001_b.sql'] }),
    )
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('20260202000001_a.sql')
    expect(r.salida).toContain('20260202000001_b.sql')
    // Una version repetida se reporta UNA vez, no una por archivo.
    expect(r.salida).toContain('1 version(es) repetida(s)')
  })

  // La decision de alcance, probada: `main` arrastra 32 colisiones heredadas y la guarda
  // tiene que quedarse callada sobre ellas, o nace roja y se vuelve ruido.
  it('NO reporta una colision heredada que el PR no toca', () => {
    const r = revisar(
      repoCon({
        enBase: ['20260303000001_vieja_a.sql', '20260303000001_vieja_b.sql'],
        agrega: ['20260304000001_nueva.sql'],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.salida).not.toContain('20260303000001')
  })

  // Pero si el PR se mete EN una colision heredada, si la reporta: agregar un tercer archivo
  // sobre una version que ya tiene dos es exactamente el fallo que se quiere cerrar.
  it('SI reporta cuando el PR agrega un archivo sobre una colision heredada', () => {
    const r = revisar(
      repoCon({
        enBase: ['20260303000001_vieja_a.sql', '20260303000001_vieja_b.sql'],
        agrega: ['20260303000001_tercera.sql'],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('la comparten 3 archivos')
  })

  // `--no-renames` existe por esto: sin el flag, git reporta el renombre como R y
  // `--diff-filter=A` no lo ve, asi que mover una migracion vieja a una version ocupada
  // pasaria en silencio.
  it('rechaza el RENOMBRE de una migracion hacia una version ya ocupada', () => {
    const r = revisar(
      repoCon({
        enBase: ['20260404000001_ocupada.sql', '20260405000009_suelta.sql'],
        renombra: [['20260405000009_suelta.sql', '20260404000001_movida.sql']],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('20260404000001_movida.sql')
  })

  it('no dice nada cuando el PR no agrega migraciones', () => {
    const r = revisar(repoCon({ enBase: ['20260505000001_uno.sql'] }))
    expect(r.ok).toBe(true)
    expect(r.salida).toContain('no agrega migraciones')
  })

  // Un archivo borrado en el mismo PR no puede resucitar como colision.
  it('ignora la migracion que el PR borra', () => {
    const r = revisar(
      repoCon({
        enBase: ['20260606000001_uno.sql', '20260606000002_dos.sql'],
        borra: ['20260606000002_dos.sql'],
      }),
    )
    expect(r.ok).toBe(true)
  })
})
