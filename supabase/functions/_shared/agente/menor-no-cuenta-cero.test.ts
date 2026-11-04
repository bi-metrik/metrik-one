import { describe, expect, it } from 'vitest'
import { planDeCarga } from './bandeja/carga'
import { DUDA_MENORES, esquemaCarga, esquemaCargaCompacta, instruccionesCarga, menoresSinContar, nombraMenores, validarCarga } from './bandeja/extraccion'
import type { CampoEntendible } from '../wa-entendimiento-reglas'

/**
 * Falla en vivo del 2026-11-03 (bandeja de Trappvel). Rehecha con datos INVENTADOS (otro destino, otras fechas, otra
 * ciudad): el comercial escribió «2 adultos y una menor de 4 años» y después las fechas. La extracción vio las dos
 * frases y en su propio cálculo dijo «se toma como niño de 4 años», pero devolvió niños 0 e infantes 0 como «deducido».
 * La tarjeta los mostró igual que cualquier otro dato, se tocó Anotar y la cotización salió por 2 adultos. Abajo, la
 * forma de la salida del modelo de ese turno (la contradicción tal cual), pasada por el código de hoy.
 */

const CAMPOS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  { slug: 'ciudad_origen', tipo: 'texto', label: 'Ciudad de salida', nivel: 'minimo', pregunta: '¿Desde dónde?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Fecha de regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Niños?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Bebés?' },
  { slug: 'edades_menores', tipo: 'texto', label: 'Edades de los niños e infantes', nivel: 'minimo', pregunta: '¿Edades?', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
] as CampoEntendible[]

const HOY = '2026-11-03'
const TEXTOS = [
  'Quiere ir a Pereira, son 2 adultos y una menor de 4 años',
  'Del 14 al 18 de febrero y salen desde Cali',
]

/** La salida del modelo como la de ese turno (sin `menores`: así era el esquema), con los datos cambiados. */
const VALORES_EN_VIVO = {
  destino: { valor: 'PEREIRA', frase: 'Quiere ir a Pereira' },
  ciudad_origen: { valor: 'Cali', frase: 'salen desde Cali' },
  fecha_salida: { valor: '2027-02-14', frase: 'Del 14 al 18 de febrero', como: 'calculado', calculo: 'Próxima ocurrencia del 14 de febrero desde 2026-11-03' },
  fecha_regreso: { valor: '2027-02-18', frase: 'Del 14 al 18 de febrero', como: 'calculado', calculo: 'Próxima ocurrencia del 18 de febrero desde 2026-11-03' },
  adultos: { valor: '2', frase: 'son 2 adultos' },
  ninos: { valor: '0', frase: 'una menor de 4 años', como: 'deducido', calculo: 'Una menor de 4 años es infante o niño; se toma como niño de 4 años' },
  infantes: { valor: '0', frase: 'una menor de 4 años', como: 'deducido', calculo: 'Según la edad, 4 años no es infante (menor de 2)' },
  edades_menores: { valor: '4', frase: 'una menor de 4 años', como: 'escrito' },
}
const crudo = (valores: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  mensajes: TEXTOS.map((_, i) => ({ n: i + 1, clase: 'cliente' })), citas: [], valores, dudas: [], ...extra,
})
const plan = (raw: unknown, data: Record<string, unknown> = {}, previo?: unknown) => planDeCarga({
  bloques: [{ fields: CAMPOS, data }], textos: TEXTOS, raw, hoyISO: HOY, ahoraIso: `${HOY}T21:52:00Z`, previo,
})

describe('falla en vivo 2026-11-03: «una menor de 4 años» no se anota como 0 niños y 0 infantes', () => {
  it('la salida real del modelo ya no propone niños 0 ni infantes 0: los descarta y pregunta', () => {
    const p = plan(crudo(VALORES_EN_VIVO))
    expect(p.plan.sugeridos.ninos).toBeUndefined()
    expect(p.plan.sugeridos.infantes).toBeUndefined()
    expect(p.entendido.join('\n')).not.toMatch(/Niños: 0|Infantes: 0/)
    expect(p.duda).toBe(DUDA_MENORES)
    expect(p.dudaCampo).toBe('ninos')
    // Lo demás sigue anotable.
    expect(p.plan.sugeridos.adultos.valor).toBe(2)
    expect(p.entendido).toContain('Adultos: 2')
    expect(p.falta).toContain('Niños')
  })

  it('con el modelo bien (1 niño, 0 infantes) entra, y el conteo deducido va resaltado en la tarjeta', () => {
    const p = plan(crudo({
      ...VALORES_EN_VIVO,
      ninos: { valor: '1', frase: 'una menor de 4 años', como: 'deducido', calculo: 'menor de 4 años: 2 años o más' },
    }, { menores: 1 }))
    expect(p.plan.sugeridos.ninos.valor).toBe(1)
    expect(p.plan.sugeridos.infantes.valor).toBe(0)
    expect(p.plan.sugeridos.edades_menores.valor).toBe('4')
    expect(p.duda).toBeUndefined()
    expect(p.entendido).toContain('⚠️ *Niños: 1* (deducido, confírmalo)')
    expect(p.entendido).toContain('⚠️ *Infantes: 0* (deducido, confírmalo)')
    // Ningún conteo de pasajeros sale con «(deducido)» sin resaltar.
    for (const l of p.entendido) if (/^(Adultos|Niños|Infantes):/.test(l)) expect(l).not.toMatch(/\((deducido|calculado)\)/)
    // Lo que no es un conteo conserva la marca corta.
    expect(p.entendido).toContain('Fecha de salida: 14 feb (calculado)')
  })

  it('un 0 de una propuesta anterior no vuelve a entrar por la unión con la pendiente', () => {
    const previo = { sugeridos: { ninos: { valor: 0, frase: 'una menor de 4 años', como: 'deducido' }, infantes: { valor: 0, frase: 'una menor de 4 años', como: 'deducido' } } }
    const p = plan(crudo({ adultos: { valor: '2', frase: 'son 2 adultos' } }), {}, previo)
    expect(p.plan.sugeridos.ninos).toBeUndefined()
    expect(p.plan.sugeridos.infantes).toBeUndefined()
  })

  it('el modelo declara menores aunque ninguna palabra los nombre («la peladita»): tampoco acepta 0 y 0', () => {
    const v = validarCarga(
      { mensajes: [{ n: 1, clase: 'cliente' }], valores: { ninos: { valor: '0', frase: 'van con la peladita' }, infantes: { valor: '0', frase: 'van con la peladita' } }, menores: 1 },
      CAMPOS, ['van con la peladita'], { hoyISO: HOY },
    )
    expect(v.hayMenores).toBe(true)
    expect(v.sugeridos.ninos).toBeUndefined()
    expect(v.descartados.map((d) => d.slug)).toEqual(['ninos', 'infantes'])
  })

  it('sin menores, o con menores negados, el 0 sí vale', () => {
    const v = validarCarga(
      { mensajes: [{ n: 1, clase: 'cliente' }], valores: { adultos: { valor: '2', frase: 'son 2 adultos sin niños' }, ninos: { valor: '0', frase: 'sin niños' }, infantes: { valor: '0', frase: 'sin niños' } }, menores: 0 },
      CAMPOS, ['son 2 adultos sin niños'], { hoyISO: HOY },
    )
    expect(v.hayMenores).toBe(false)
    expect(v.sugeridos.ninos.valor).toBe(0)
    expect(v.dudas).toEqual([])
  })

  it('lo ya preguntado no se vuelve a preguntar, pero el 0 igual no entra', () => {
    const v = validarCarga(crudo(VALORES_EN_VIVO), CAMPOS, TEXTOS, { hoyISO: HOY, yaPreguntado: ['ninos'] })
    expect(v.sugeridos.ninos).toBeUndefined()
    expect(v.dudas).toEqual([])
  })

  it('nombraMenores: la red de seguridad lee la mención y su negación', () => {
    expect(nombraMenores(['son 2 adultos y una menor de 4 años'])).toBe(true)
    expect(nombraMenores(['van con sus dos hijos'])).toBe(true)
    expect(nombraMenores(['llevan un bebé de 8 meses'])).toBe(true)
    expect(nombraMenores(['2 adultos, sin niños'])).toBe(false)
    expect(nombraMenores(['no van niños'])).toBe(false)
    expect(nombraMenores(['ella y su esposo, ningún menor'])).toBe(false)
    expect(nombraMenores(['2 adultos a Cartagena'])).toBe(false)
  })

  it('menoresSinContar solo dispara con los dos conteos en número', () => {
    expect(menoresSinContar(true, { ninos: 0, infantes: 0 })).toBe(true)
    expect(menoresSinContar(true, { ninos: 0 })).toBe(false)
    expect(menoresSinContar(true, { ninos: 1, infantes: 0 })).toBe(false)
    expect(menoresSinContar(false, { ninos: 0, infantes: 0 })).toBe(false)
  })

  it('el prompt da el ejemplo del niño y la invariante; los dos esquemas piden menores', () => {
    const p = instruccionesCarga(CAMPOS, HOY)
    expect(p).toContain('«una menor de 4 años», 1 niño')
    expect(p).toContain('Si hablan de un menor, niños + infantes')
    expect((esquemaCarga(CAMPOS) as { properties: Record<string, unknown> }).properties.menores).toBeDefined()
    expect((esquemaCargaCompacta(CAMPOS) as { properties: Record<string, unknown> }).properties.menores).toBeDefined()
  })
})
