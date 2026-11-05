import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ofrecePersona } from './dominio-ventas'
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro'
import { CLAVES_CIERRA_SOLA, TEXTOS_CIERRA_SOLA, actualizacionSqlDimpro } from './semilla-sql-dimpro'

/** Dimi cierra la venta solo (Mauricio, 4-nov): no ofrece pasar a una persona. Los textos del bot son los reales. */

describe('el modelo no ofrece pasar a una persona', () => {
  it('las ofertas reales de la conversación 10 (4-nov) no salen', () => {
    expect(ofrecePersona('No tengo datos en la ficha para compararla con la batería original de tu taladro, así que no te puedo decir cuál es mejor. Lo que sí sé de esta: es de 20 V, 4.0 Ah. ¿Quieres que una persona del equipo te confirme la comparación?')).toBe(true)
    expect(ofrecePersona('Si la tuya es de 2 Ah, esta de 4.0 Ah tiene el doble de capacidad. ¿Quieres que te pase con una persona del equipo para que lo confirme?')).toBe(true)
  })

  it('otras formas de ofrecerla', () => {
    for (const t of [
      'Si prefieres, te paso con alguien del equipo.',
      'Puedo pasarte con un asesor.',
      '¿Prefieres hablar con alguien?',
      'Eso no lo tengo; una persona del equipo te lo confirma por aquí.',
      'Te comunico con un asesor.',
    ]) expect(ofrecePersona(t), t).toBe(true)
  })

  it('lo que no es ofrecerla sí sale', () => {
    for (const t of [
      'Sí, puedes recoger el producto en el punto de venta de Dimpro, sin costo. La recogida es con cita: el equipo te escribe para agendarla.',
      'La garantía legal la tramita DIMPRO.',
      'Eso no lo tengo en la ficha. Lo que sí sé: es de 20 V y 4.0 Ah. ¿Te sirve?',
      'Si la tuya es de 2 Ah, esta tiene el doble de capacidad, así que dura más por carga. ¿La llevas?',
      'Las mesas son de hasta 9 personas.',
    ]) expect(ofrecePersona(t), t).toBe(false)
  })
})

describe('el reglamento ya no manda a ofrecer la persona', () => {
  const ficha = (clave: string) => REGLAMENTO_DIMPRO.find((f) => f.clave === clave)!

  it('el aviso de entrada no ofrece «persona» y el «no» a la autorización tampoco', () => {
    expect(ficha('rf.bienvenida').hacer).not.toMatch(/persona|alguien del equipo/)
    expect(ficha('rf.autorizacion_no').hacer).not.toMatch(/persona|alguien del equipo/)
  })

  it('ninguna guía le dice al modelo que ofrezca una persona', () => {
    for (const f of REGLAMENTO_DIMPRO.filter((x) => x.tipo !== 'respuesta_fija')) {
      expect(f.hacer, f.clave).not.toMatch(/ofr[eé]cel[ea] (de nuevo )?pasar|ofrece una persona|ofrécele de nuevo pasar/)
    }
    expect(ficha('inv.cierras_tu').hacer).toContain('Nunca ofreces ni sugieres pasar con una persona')
  })

  it('las fichas de la actualización existen y el archivo es la salida del generador', () => {
    for (const c of CLAVES_CIERRA_SOLA) expect(ficha(c), c).toBeTruthy()
    const archivo = readFileSync(join(process.cwd(), 'sql/dimpro/2026-11-04_cierra-sola.sql'), 'utf8')
    expect(archivo.trimEnd()).toBe(actualizacionSqlDimpro(CLAVES_CIERRA_SOLA, REGLAMENTO_DIMPRO, TEXTOS_CIERRA_SOLA).trimEnd())
  })
})
