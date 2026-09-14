import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * El gate existe Y ESTÁ CABLEADO.
 *
 * ⚠️ Por qué esta prueba lee el archivo en vez de ejecutar `cambiarEtapaNegocioConGate`:
 * esa server action arrastra `getWorkspace`, los guards de permiso, el motor de rutas y
 * media docena de tablas; doblarla entera para afirmar una línea costaría más que el
 * gate. Y el hueco que deja la prueba de `gate-margen-datos.test.ts` es real y conocido:
 * `evaluarGateMargen` puede funcionar perfecto y nadie llamarla — «un criterio perfecto
 * que la action no invoca se ve igual que un gate que funciona».
 *
 * Es el mismo recurso que ya usa `activity/tipos.test.ts` contra el archivo de la
 * migración: barato, y lo que fija es exactamente lo que no se puede ver de otra forma.
 *
 * Lo que NO fija: que el gate corra ANTES de escribir la etapa. Eso se lee una vez en
 * el archivo (está dentro del bloque de gates, que retorna antes del UPDATE) y no se
 * puede afirmar desde aquí.
 */

const ACTIONS = join(process.cwd(), 'src/app/(app)/negocios/negocio-v2-actions.ts')

describe('contrato · el gate margen_sobre_piso está cableado al avance de etapa', () => {
  const fuente = readFileSync(ACTIONS, 'utf8')

  it('la action importa el evaluador', () => {
    expect(fuente).toContain("import { evaluarGateMargen } from '@/lib/cotizaciones/gate-margen-datos'")
  })

  it('el gate es opt-in por etapa, con el nombre exacto', () => {
    expect(fuente).toContain("etapaGates.includes('margen_sobre_piso')")
  })

  it('cuando bloquea, devuelve `gate_bloqueado` como los demás gates', () => {
    // El bloque entero, para que reordenar el archivo no lo parta en silencio.
    const bloque = fuente.slice(
      fuente.indexOf("etapaGates.includes('margen_sobre_piso')"),
      fuente.indexOf("etapaGates.includes('sobrepago_conciliado')"),
    )
    expect(bloque).toContain('await evaluarGateMargen(supabase, negocioId)')
    expect(bloque).toContain('veredicto.bloquea')
    expect(bloque).toContain("error: 'gate_bloqueado'")
  })

  it('respeta el mensaje configurable de la etapa', () => {
    expect(fuente).toContain("gateMessagesMargen['margen_sobre_piso']")
  })
})
