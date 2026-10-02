import { describe, expect, it } from 'vitest'
import {
  CLAVE_CONFLICTOS,
  conflictosDe,
  descartarConflictoEnData,
  soltarConflictosEditados,
  textoConflicto,
  type MarcaConflicto,
} from './sugeridos'
import { sanearDataDelNavegador } from './data-escribible'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const marca: MarcaConflicto = { fuente: 'whatsapp', entrega_id: 'e2', valor: '2026-11-20', frase: 'el 20 de noviembre', en: '2026-09-30T15:00:00Z', origen: 'audio' }
const guardada = { fecha_salida: '2026-11-15', _conflictos: { fecha_salida: marca } }

describe('el conflicto que deja la bandeja en un negocio existente', () => {
  it('la clave y la forma son las que escribe la edge function', () => {
    // El módulo de Deno no se importa desde src (sus imports llevan `.ts`): se compara el texto.
    // La forma escrita la prueba `wa-carga-reglas.test.ts`; aquí, que esta lectura la entiende.
    const edge = readFileSync(path.resolve(__dirname, '../../../supabase/functions/_shared/wa-carga-reglas.ts'), 'utf8')
    expect(edge).toContain(`export const CLAVE_CONFLICTOS = '${CLAVE_CONFLICTOS}';`)
    for (const campo of ['fuente: CanalEntrega;', 'entrega_id: string;', 'valor: string | number;', 'frase: string;', 'en: string;', "origen: 'audio' | 'mensaje';"]) {
      expect(edge).toContain(campo)
    }
    // La fuente admite lo pegado en la web (solicitud sin formulario, 2026-10-02), igual que aquí.
    const reglas = readFileSync(path.resolve(__dirname, '../../../supabase/functions/_shared/wa-entendimiento-reglas.ts'), 'utf8')
    expect(reglas).toContain("export type CanalEntrega = 'whatsapp' | 'web';")
    expect(conflictosDe(guardada)).toEqual({ fecha_salida: marca })
  })

  it('si la persona cambia el valor al guardar, el conflicto se da por resuelto', () => {
    const nueva = soltarConflictosEditados(guardada, { ...guardada, fecha_salida: '2026-11-20' })
    expect(nueva._conflictos).toBeUndefined()
    expect(nueva.fecha_salida).toBe('2026-11-20')
  })

  it('si guarda sin tocar ese campo, el conflicto sigue', () => {
    const nueva = soltarConflictosEditados(guardada, { ...guardada, adultos: 2 })
    expect(nueva._conflictos).toEqual(guardada._conflictos)
  })

  it('«Dejar el actual» quita el conflicto y no toca el valor', () => {
    const nueva = descartarConflictoEnData(guardada, 'fecha_salida')
    expect(nueva).toEqual({ fecha_salida: '2026-11-15' })
    expect(descartarConflictoEnData(guardada, 'otro')).toBe(guardada)
  })

  it('el navegador no puede escribir ni borrar la marca', () => {
    const d = sanearDataDelNavegador({
      entrante: { fecha_salida: '2026-11-15', _conflictos: {} },
      guardada,
      tipo: 'datos',
      configExtra: { fields: [{ slug: 'fecha_salida', tipo: 'fecha' }] },
      workspaceId: 'ws',
      modo: 'reemplazo',
    })
    expect(d._conflictos).toEqual(guardada._conflictos)
  })

  it('el texto del aviso: qué dijo, dónde y cuándo (día de Bogotá)', () => {
    expect(textoConflicto('20 nov', marca)).toBe('El cliente dijo 20 nov en el audio del 30-sep')
    expect(textoConflicto('3', { ...marca, origen: 'mensaje', en: '2026-10-01T02:00:00Z' })).toBe('El cliente dijo 3 en el mensaje del 30-sep')
  })
})
