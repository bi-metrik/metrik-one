import { describe, expect, it } from 'vitest'
import { desdeCompacta, esquemaCarga, esquemaCargaCompacta, instruccionesCarga, omitidosCompacta, validarCarga } from './bandeja/extraccion'
import { leerConfigAgente } from './config'
import { CAMPOS_ARNES } from './arnes/conjuntos'

/**
 * La extracción de `anotar`/`cargar` tarda ~4 s (en vivo, 2026-10-09: p50 4,1 s cuando corre) y casi todo es salida:
 * el esquema de hoy exige `{ valor, frase, como, calculo }` para CADA campo, la mayoría «por_definir» con frase vacía.
 * El compacto pide solo los campos con valor (`datos`) y la lista de los que no (`sin_dato`). La lista existe porque
 * quitar el `required` sin ella (2026-10-09) bajó a 1,4 s pero llenó 2 campos de 14. Aquí, sin modelo (la facturación de
 * Google está cortada el 2026-10-12): que las dos formas validen IGUAL y cuánto texto de salida ahorra la compacta.
 */

const HOY = '2026-10-09'
const M_PAX = 'Quiero que coticemos M1 26 2 ahora para que vayan 2 adultos y un niño de año y medio. Serían 6 noches saliendo desde Bogotá el 19 de noviembre. calcula la fecha de regreso'
const TEXTOS = ['A listo. Vamos a retomar el viaje a miami. vamos a hacer una nueva cotización', M_PAX]

type Dato = { campo: string; valor: string; frase: string; como?: string; calculo?: string }
/** Lo que el modelo entendería de M_PAX (d3260a5a), una vez. */
const DATOS: Dato[] = [
  { campo: 'destino', valor: 'Miami', frase: 'retomar el viaje a miami', como: 'escrito', calculo: '' },
  { campo: 'ciudad_origen', valor: 'Bogotá', frase: 'saliendo desde Bogotá', como: 'escrito', calculo: '' },
  { campo: 'fecha_salida', valor: '2026-11-19', frase: 'el 19 de noviembre', como: 'escrito', calculo: '' },
  { campo: 'fecha_regreso', valor: '2026-11-25', frase: 'Serían 6 noches', como: 'calculado', calculo: 'salida 2026-11-19 + 6 noches' },
  { campo: 'adultos', valor: '2', frase: 'vayan 2 adultos', como: 'escrito', calculo: '' },
  { campo: 'ninos', valor: '0', frase: 'un niño de año y medio', como: 'deducido', calculo: 'el único menor tiene año y medio: infante' },
  { campo: 'infantes', valor: '1', frase: 'un niño de año y medio', como: 'deducido', calculo: 'año y medio es menor de 2' },
  { campo: 'edades_menores', valor: '1.5', frase: 'un niño de año y medio', como: 'escrito', calculo: '' },
]
const MENSAJES = [{ n: 1, clase: 'cliente' }, { n: 2, clase: 'cliente' }]

/** La salida de hoy: los 4 subcampos de CADA campo (así la devuelve el modelo con el esquema de hoy). */
function completa() {
  const valores = Object.fromEntries(CAMPOS_ARNES.filter((f) => !f.suma_de).map((f) => [f.slug, { valor: 'por_definir', frase: '', como: 'escrito', calculo: '' }]))
  for (const d of DATOS) valores[d.campo] = { valor: d.valor, frase: d.frase, como: d.como!, calculo: d.calculo! }
  return { mensajes: MENSAJES, citas: [...new Set(DATOS.map((d) => d.frase))], valores, dudas: [] }
}
function compacta() {
  const llenos = new Set(DATOS.map((d) => d.campo))
  return { mensajes: MENSAJES, datos: DATOS, sin_dato: CAMPOS_ARNES.filter((f) => !f.suma_de && !llenos.has(f.slug)).map((f) => f.slug), dudas: [] }
}

describe('el esquema compacto de la extracción', () => {
  it('valida exactamente igual que el de hoy', () => {
    const a = validarCarga(completa(), CAMPOS_ARNES, TEXTOS, { hoyISO: HOY })
    const b = validarCarga(compacta(), CAMPOS_ARNES, TEXTOS, { hoyISO: HOY })
    expect(b.sugeridos).toEqual(a.sugeridos)
    expect(b.descartados).toEqual(a.descartados)
    expect(b.historia).toEqual(a.historia)
    expect(Object.keys(b.sugeridos).sort()).toEqual(DATOS.map((d) => d.campo).sort())
  })

  it('un campo en datos con por_definir o sin frase escrita se trata como en el de hoy; lo de hoy pasa sin tocar', () => {
    const raw = { ...compacta(), datos: [...DATOS, { campo: 'presupuesto', valor: 'por_definir', frase: '' }, { campo: 'categoria_hotel', valor: '4', frase: 'cinco estrellas de lujo' }] }
    const v = validarCarga(raw, CAMPOS_ARNES, TEXTOS, { hoyISO: HOY })
    expect(v.sugeridos.presupuesto).toBeUndefined()
    expect(v.descartados).toContainEqual({ slug: 'categoria_hotel', motivo: 'sin una frase escrita del viaje que lo sostenga' })
    const hoy = completa()
    expect(desdeCompacta(hoy)).toBe(hoy)
  })

  it('los campos que no puso en ninguna de las dos listas se cuentan (para medir que no se salte campos)', () => {
    const raw = { ...compacta(), sin_dato: ['presupuesto'] }
    expect(omitidosCompacta(raw, CAMPOS_ARNES).sort()).toEqual(['categoria_hotel', 'composicion', 'destino_tipo', 'fechas_tipo', 'requisitos_especiales'])
    expect(omitidosCompacta(compacta(), CAMPOS_ARNES)).toEqual([])
    expect(omitidosCompacta(completa(), CAMPOS_ARNES)).toEqual([])
  })

  it('el esquema: datos y sin_dato obligatorios, con los slugs como vocabulario cerrado', () => {
    const e = esquemaCargaCompacta(CAMPOS_ARNES) as { required: string[]; properties: Record<string, { items: { properties?: Record<string, { enum?: string[] }>; enum?: string[] } }> }
    expect(e.required).toEqual(['mensajes', 'datos', 'sin_dato'])
    expect(e.properties.datos.items.properties!.campo.enum).toContain('fecha_regreso')
    expect(e.properties.sin_dato.items.enum).toContain('presupuesto')
    expect(e.properties).not.toHaveProperty('citas')
    expect(esquemaCargaCompacta(CAMPOS_ARNES, { chat: true }).properties).toHaveProperty('otros')
  })

  it('el prompt compacto cambia solo lo que se devuelve y no pasa del tope de 1.200 tokens', () => {
    const hoy = instruccionesCarga([], HOY)
    const p = instruccionesCarga([], HOY, {}, {}, undefined, { compacta: true })
    expect(p).toContain('sin_dato: el slug de CADA campo que queda en "por_definir". Todo campo va en datos o en sin_dato, en uno solo.')
    expect(p).not.toContain('2. citas')
    expect(hoy).toContain('3. valores: para CADA campo')
    // Las reglas de interpretación son las mismas.
    expect(p).toContain('Interpretar no es inventar')
    expect(p).toContain('Infante es menor de 2 años')
    expect(Math.ceil(p.length / 4)).toBeLessThanOrEqual(1200)
  })

  it('la salida compacta es más corta que la de hoy aun con 8 de 14 campos llenos (estimado: 4 caracteres por token)', () => {
    const tok = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4)
    expect(tok(compacta())).toBeLessThan(tok(completa()) * 0.75)
  })

  it('apagada por defecto; agente_config.extraccion_compacta la enciende sin deploy', () => {
    expect(leerConfigAgente({ agente: true }).extraccionCompacta).toBe(false)
    expect(leerConfigAgente({ agente: true, agente_config: { extraccion_compacta: true } }).extraccionCompacta).toBe(true)
    expect(esquemaCarga(CAMPOS_ARNES)).not.toHaveProperty('properties.datos')
  })
})
