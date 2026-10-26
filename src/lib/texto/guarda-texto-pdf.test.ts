/**
 * Guarda de CI: ningún PDF dibuja texto sin pasar por `texto-latino.ts`.
 *
 * El 010 se cayó con «WinAnsi cannot encode "В"» (V0121, 2026-10-06) porque el texto llegaba
 * crudo a `drawText` de pdf-lib. La regla: todo `drawText(` del repo dibuja
 *   - `textoParaPdf(...)`, o
 *   - una variable que el MISMO archivo obtuvo de `sanitize`/`textoParaPdf` (lista de abajo,
 *     con su porqué).
 * Un `drawText` nuevo con otra cosa, o un archivo nuevo que dibuje sin importar la pieza, pone
 * esta prueba en rojo. Además, la copia de Deno de la pieza tiene que ser idéntica.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()

/** Variables que el archivo ya pasó por `sanitize`/`textoParaPdf` antes de dibujar. */
const VARIABLES_SANEADAS: Record<string, string[]> = {
  // `toDraw` sale de `sanitize(value)` recortado; `ch` es un carácter de `sanitize(chars)`.
  'src/lib/pdf/acroform.ts': ['toDraw', 'ch'],
}

function archivos(dir: string): string[] {
  const out: string[] = []
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...archivos(p))
    else if (/\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\.(ts|tsx|mjs)$/.test(n)) out.push(p)
  }
  return out
}

const fuentes = ['src', 'scripts', 'supabase/functions'].flatMap((d) => archivos(join(RAIZ, d)))

describe('todo drawText pasa por texto-latino', () => {
  const llamadas: Array<{ archivo: string; arg: string }> = []
  for (const f of fuentes) {
    const txt = readFileSync(f, 'utf8')
    for (const m of txt.matchAll(/\.drawText\(\s*([^,)]+)/g)) {
      llamadas.push({ archivo: relative(RAIZ, f), arg: m[1].trim() })
    }
  }

  it('hay llamadas que revisar (la guarda no está ciega)', () => {
    expect(llamadas.length).toBeGreaterThanOrEqual(3)
  })

  it.each(llamadas.map((l) => [`${l.archivo}: drawText(${l.arg})`, l] as const))('%s', (_n, l) => {
    const permitidas = VARIABLES_SANEADAS[l.archivo] ?? []
    const ok = l.arg.startsWith('textoParaPdf(') || permitidas.includes(l.arg)
    expect(ok, `${l.archivo} dibuja «${l.arg}» sin pasar por textoParaPdf/sanitize (src/lib/texto/texto-latino.ts)`).toBe(true)
  })

  it('las variables permitidas de verdad salen de sanitize en su archivo', () => {
    for (const [archivo, vars] of Object.entries(VARIABLES_SANEADAS)) {
      const txt = readFileSync(join(RAIZ, archivo), 'utf8')
      expect(txt).toMatch(/textoParaPdf\(/)
      for (const v of vars) expect(txt).toContain(v)
      expect(txt).toMatch(/const text = sanitize\(/)
    }
  })
})

describe('la copia de Deno no se separa', () => {
  it('supabase/functions/_shared/texto-latino.ts es idéntica a src/lib/texto/texto-latino.ts', () => {
    const fuente = readFileSync(join(RAIZ, 'src/lib/texto/texto-latino.ts'), 'utf8')
    const copia = readFileSync(join(RAIZ, 'supabase/functions/_shared/texto-latino.ts'), 'utf8')
    expect(copia).toBe(fuente)
  })

  it('la pieza no importa nada (Deno no resuelve @/lib)', () => {
    const fuente = readFileSync(join(RAIZ, 'src/lib/texto/texto-latino.ts'), 'utf8')
    expect(fuente).not.toMatch(/^import /m)
  })
})
