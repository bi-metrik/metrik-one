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
 * el archivo (retorna antes del UPDATE) y no se puede afirmar desde aquí.
 *
 * Desde el 2026-09-22 el gate vive FUERA del bloque que salta el override: saltarlo con
 * motivo es solo del dueño del workspace. Eso sí se fija aquí.
 */

const ACTIONS = join(process.cwd(), 'src/app/(app)/negocios/negocio-v2-actions.ts')

describe('contrato · el gate margen_sobre_piso está cableado al avance de etapa', () => {
  const fuente = readFileSync(ACTIONS, 'utf8')

  it('la action importa el evaluador', () => {
    expect(fuente).toContain("import { evaluarGateMargen } from '@/lib/cotizaciones/gate-margen-datos'")
  })

  // El bloque entero, para que reordenar el archivo no lo parta en silencio.
  const inicio = fuente.indexOf("gatesDeLaEtapa.includes('margen_sobre_piso')")
  const bloque = fuente.slice(inicio, fuente.indexOf('// ── Control de fraude', inicio))

  it('el gate es opt-in por etapa, con el nombre exacto', () => {
    expect(inicio).toBeGreaterThan(-1)
  })

  it('cuando bloquea, devuelve `gate_bloqueado` como los demás gates', () => {
    expect(bloque).toContain('await evaluarGateMargen(supabase, negocioId, {')
    expect(bloque).toContain('veredicto.bloquea')
    expect(bloque).toContain("error: 'gate_bloqueado'")
  })

  it('saltarlo con motivo es SOLO del dueño: el override de otro rol no lo apaga', () => {
    // Vive fuera del bloque `if (!motivoOverride ...)`: si volviera adentro, cualquier
    // rol con `omitir_gate` se lo saltaría con un motivo.
    const bloqueDeGates = fuente.indexOf('if (!motivoOverride && negocio.etapa_actual_id) {')
    expect(bloqueDeGates).toBeGreaterThan(-1)
    expect(inicio).toBeGreaterThan(fuente.indexOf("etapaGates.includes('conciliacion_diana')"))
    expect(bloque).toContain('esDuenoDelWorkspace(')
    expect(bloque).toContain('if (!(motivoOverride && esDueno))')
    // Para quien no es el dueño el bloqueo no cede al override, y la pantalla no ofrece
    // «Omitir» sobre algo que el servidor va a rechazar.
    expect(bloque).toContain('omitible: false')
  })

  it('respeta el mensaje configurable de la etapa', () => {
    expect(fuente).toContain("gateMessagesMargen['margen_sobre_piso']")
  })
})
