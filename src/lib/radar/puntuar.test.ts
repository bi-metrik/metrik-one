/**
 * Las pruebas de caso que fijan el puntaje. **Los números no son inventados**: se sacaron
 * corriendo `scripts/temas.py` de `metrik-data` (la implementación que hoy manda el correo
 * semanal) sobre estos mismos objetos el 2026-09-28. Si esta suite pasa, ONE y el correo dicen
 * el mismo FIT; si alguna falla, se separaron.
 *
 * Los tres casos que la spec exige están abajo con su nombre:
 *   · producción audiovisual baja a 2      → `audiovisual` (dominio ajeno NO se topa)
 *   · INVIAS interoperabilidad férrea a -2 → `ferroviario`
 *   · SDP-LP-003-2026 queda en 8           → el caso real de $5.528M
 *   · un tema suma una sola vez            → sinónimos repetidos
 */
import { describe, expect, it } from 'vitest'
import { BIBLIOTECA, PRESETS, exclusionesDeLista, perfilDesdePreset, temasActivos } from './biblioteca'
import { excluido, norm, puntuar, tiene } from './puntuar'

/** Los temas activos de un perfil de fábrica, como los ve `puntuar`. */
function activosDe(clave: string) {
  const p = PRESETS[clave]
  return temasActivos({ seleccionados: p.temas, pesos: p.pesos })
}

const METRIK = activosDe('metrik')
const FABRI = activosDe('fabri')

const fit = (objeto: string, temas = METRIK) => puntuar(objeto, temas, BIBLIOTECA.senalFuerte).fit

/** Objetos REALES del barrido del 2026-09-28 (`barridos/_universo-2026-09-28.json`). */
const SDP_LP_003 =
  'CONTRATAR UNA FÁBRICA DE SOFTWARE QUE PRESTE SERVICIOS DE ANÁLISIS, DISEÑO, DESARROLLO, PRUEBAS, ' +
  'IMPLEMENTACIÓN, MANTENIMIENTO Y EVOLUTIVOS DE LOS SISTEMAS DE INFORMACIÓN DE LA SECRETARÍA DISTRITAL ' +
  'DE PLANEACIÓN, BAJO METODOLOGÍAS ÁGILES, GARANTIZANDO LA CALIDAD, SEGURIDAD Y CONTINUIDAD DE LOS ' +
  'SERVICIOS TECNOLÓGICOS DE LA ENTIDAD'

const INVIAS_FERREO =
  'SOLICITUD DE INFORMACIÓN A PROVEEDORES PARA LA ELABORACIÓN DEL MANUAL DE INTEROPERABILIDAD FÉRREA'

describe('la biblioteca llegó completa (guard: sin esto todo daría 0 y las pruebas pasarían)', () => {
  it('trae los 97 temas, los 14 grupos y los 8 perfiles', () => {
    expect(BIBLIOTECA.temas).toHaveLength(97)
    expect(BIBLIOTECA.grupos).toHaveLength(14)
    expect(Object.keys(BIBLIOTECA.perfiles)).toHaveLength(8)
    expect(BIBLIOTECA.senalFuerte).toBe(8)
  })

  it('el perfil de MeTRIK activa 24 temas y el de Fabri 10', () => {
    expect(METRIK).toHaveLength(24)
    expect(FABRI).toHaveLength(10)
  })

  it('los pesos del perfil pisan los de fábrica', () => {
    // La biblioteca trae `audiovisual` en +8 (es el negocio de una productora); MeTRIK lo pesa -8.
    expect(BIBLIOTECA.temas.find((t) => t.id === 'audiovisual')?.peso).toBe(8)
    expect(METRIK.find((t) => t.id === 'audiovisual')?.peso).toBe(-8)
  })
})

describe('los casos que la spec fija', () => {
  it('SDP-LP-003-2026 (fábrica de software, $5.528M) queda en 8', () => {
    const r = puntuar(SDP_LP_003, METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(8)
    // 9 (fábrica de software) + 5 (sistemas de información) − 6 (mantenimiento, topado en −6
    // porque la mitad del bruto es 7): el tope de forma no muerde aquí, pero el caso es el que
    // fijó la escala nueva (antes de «un tema suma una sola vez» daba 13).
    expect(r.hits.map((h) => h.id).sort()).toEqual(['fabrica-software', 'mantenimiento', 'sistemas-informacion'])
    expect(r.pos).toBe(true)
  })

  it('INVIAS interoperabilidad férrea queda en -2', () => {
    const r = puntuar(INVIAS_FERREO, METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(-2)
    // +6 interoperabilidad − 8 ferroviario. Ojo: aquí NO hay señal fuerte (6 < 8), así que ningún
    // tope entra en juego. Este caso fija el número del falso positivo del 2026-09-07 (salía en
    // FIT 6 porque `FERREO` no cruzaba `FERREA`); la asimetría del tope la prueba el caso de
    // abajo, «el tope NO protege al castigo por dominio ajeno» — se descubrió mutando `puntuar`:
    // topar también el dominio deja este caso intacto y pasaría inadvertido.
    expect(r.hits.map((h) => h.id).sort()).toEqual(['ferroviario', 'interoperabilidad'])
    // Coincide con un tema positivo y AUN ASÍ está en negativo. El fit ordena; la coincidencia filtra.
    expect(r.pos).toBe(true)
  })

  it('producción audiovisual baja a 2 aunque haya señal fuerte', () => {
    // +10 inteligencia artificial (señal fuerte: 10 >= 8) − 8 audiovisual = 2.
    const r = puntuar('PRESTAR SERVICIOS DE INTELIGENCIA ARTIFICIAL PARA LA PRODUCCION AUDIOVISUAL DE LA ENTIDAD', METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(2)
    expect(r.hits.map((h) => h.id).sort()).toEqual(['audiovisual', 'ia-nucleo'])
  })

  it('un tema suma UNA sola vez aunque el objeto repita sus sinónimos', () => {
    // `sistemas-informacion` (+5) tiene dos términos: SISTEMA DE INFORMACION y EVOLUTIVO. El
    // objeto dice los dos, y dos veces el primero.
    const r = puntuar('SISTEMA DE INFORMACION Y EVOLUTIVOS DEL SISTEMA DE INFORMACION MISIONAL', METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(5)
    expect(r.hits).toHaveLength(1)
    // Y en negativo igual: `audiovisual` tiene 6 términos y el objeto dice tres.
    expect(fit('PRODUCCION AUDIOVISUAL, CONTENIDO AUDIOVISUAL Y POSPRODUCCION DE PIEZAS')).toBe(-8)
  })
})

describe('el tope del castigo por forma de compra', () => {
  it('con señal fuerte, el castigo de compra se topa en la mitad del bruto', () => {
    // 9 (software a la medida) + 8 (desarrollo) = 17 bruto; −6 mantenimiento −7 suministro = −13,
    // topado en −floor(17/2) = −8. 17 − 8 = 9.
    const r = puntuar('DESARROLLO DE SOFTWARE A LA MEDIDA CON MANTENIMIENTO Y SUMINISTRO', METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(9)
  })

  it('el tope NO protege al castigo por dominio ajeno, en el mismo objeto', () => {
    // El caso que separa las dos clases de castigo en una sola medición: +9 fábrica de software
    // (señal fuerte), −6 mantenimiento (forma, topado en −floor(9/2) = −4) y −8 audiovisual
    // (dominio, completo). 9 − 4 − 8 = −3. Si el dominio también se topara en −4 daría +1, y un
    // contrato de producción audiovisual volvería a entrar por decir «fábrica de software».
    const r = puntuar('FABRICA DE SOFTWARE PARA LA PRODUCCION AUDIOVISUAL CON MANTENIMIENTO', METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(-3)
    expect(r.hits.map((h) => h.id).sort()).toEqual(['audiovisual', 'fabrica-software', 'mantenimiento'])
  })

  it('sin señal fuerte, el castigo de compra entra completo', () => {
    // Sin ningún tema positivo: −7 de suministro, sin tope que lo proteja.
    expect(fit('SUMINISTRO DE PAPELERIA PARA LA SEDE ADMINISTRATIVA')).toBe(-7)
  })

  it('un objeto que no menciona nada queda en 0 y sin coincidencias', () => {
    const r = puntuar('ARRENDAMIENTO DE UN PREDIO RURAL EN EL MUNICIPIO', METRIK, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(0)
    expect(r.hits).toEqual([])
    expect(r.pos).toBe(false)
  })
})

describe('palabras completas, plural S/ES y tildes', () => {
  it('cruza el plural pero no el prefijo de otra palabra', () => {
    expect(tiene(norm('SISTEMAS DE INFORMACIÓN DE LA ENTIDAD'), 'SISTEMA DE INFORMACION')).toBe(true)
    // El defecto que perdió SDP-LP-003-2026 durante meses, al revés: OPERACION no está en COOPERACION.
    expect(tiene(norm('CONVENIO DE COOPERACION INTERNACIONAL'), 'OPERACION')).toBe(false)
  })

  it('el plural tolerado es S/ES, no el género: FERREO no cruza FERREA', () => {
    expect(tiene(norm('VIA FÉRREA'), 'FERREO')).toBe(false)
    // Por eso la biblioteca lista las dos formas en el mismo tema, y el tema igual suma una vez.
    expect(fit(INVIAS_FERREO)).toBe(-2)
  })

  it('las tildes no cambian el resultado', () => {
    expect(fit('FÁBRICA DE SOFTWARE')).toBe(fit('FABRICA DE SOFTWARE'))
    expect(fit('FÁBRICA DE SOFTWARE')).toBe(9)
  })
})

describe('las exclusiones son del perfil', () => {
  const exFabri = PRESETS.fabri.exclusiones

  it('un stem excluye como fragmento y una palabra como palabra completa', () => {
    expect(excluido('MANTENIMIENTO DE SEÑALIZACIÓN VIAL EN LA VÍA', exFabri)).toBe('senalizacion vial')
    expect(excluido('SERVICIO DE ASEO Y CAFETERÍA', exFabri)).toBe('aseo')
  })

  it('VIGILANCIA no excluye VIDEOVIGILANCIA (los 4 procesos de más medidos el 2026-09-28)', () => {
    const objeto =
      'ARRENDAMIENTO DE INFRAESTRUCTURA TECNOLOGICA PARA EL SISTEMA DE VIDEOVIGILANCIA, QUE INCLUYE ' +
      'LOS SERVICIOS DE GRABACION Y ALMACENAMIENTO'
    expect(excluido(objeto, exFabri)).toBeNull()
    // Y la palabra sola sí excluye: la regla no se aflojó, se precisó.
    expect(excluido('SERVICIO DE VIGILANCIA PRIVADA', exFabri)).toBe('vigilancia')
  })

  it('un perfil sin exclusiones no excluye nada', () => {
    expect(excluido('SERVICIO DE ASEO Y CAFETERÍA', PRESETS.mobiliario.exclusiones)).toBeNull()
    expect(excluido('CUALQUIER COSA', null)).toBeNull()
  })

  it('la lista plana del workspace se vuelve a partir en stems y palabras', () => {
    const ex = exclusionesDeLista(perfilDesdePreset('fabri').exclusiones)
    expect(ex.stems).toContain('SENALIZACION VIAL')
    expect(ex.palabras).toContain('VIGILANCIA')
    // Y aplicada da lo mismo que la del preset: el viaje por la base no cambia el filtro.
    expect(excluido('SISTEMA DE VIDEOVIGILANCIA', ex)).toBeNull()
    expect(excluido('MANTENIMIENTO DE SEÑALIZACIÓN VIAL', ex)).toBe('senalizacion vial')
  })
})

describe('el perfil de Fabri, el primer cliente', () => {
  it('acrílico y vitrinas pesan lo que decidió la calibración', () => {
    const r = puntuar('SUMINISTRO DE VITRINAS Y EXHIBIDORES EN ACRILICO', FABRI, BIBLIOTECA.senalFuerte)
    expect(r.fit).toBe(19)
    expect(r.hits.map((h) => h.id).sort()).toEqual(['acrilico', 'vitrinas'])
  })

  it('el mismo objeto no le suma nada al perfil de MeTRIK', () => {
    // `suministro` es −7 y ninguno de los temas de mobiliario está activo para MeTRIK.
    expect(fit('SUMINISTRO DE VITRINAS Y EXHIBIDORES EN ACRILICO')).toBe(-7)
  })

  it('el perfil vacío no puntúa nada', () => {
    expect(activosDe('vacio')).toEqual([])
    expect(fit(SDP_LP_003, activosDe('vacio'))).toBe(0)
  })
})

describe('temas propios del workspace', () => {
  it('un tema propio suma, y uno con el id de la biblioteca la pisa', () => {
    const propios = [{ id: 'mi-nicho', grupo: 'propio', nombre: 'Mi nicho', peso: 4, terminos: ['DRONE'] }]
    const temas = temasActivos({ seleccionados: ['mi-nicho'], propios })
    expect(puntuar('ADQUISICION DE DRONES PARA CATASTRO', temas, BIBLIOTECA.senalFuerte).fit).toBe(4)

    const pisado = temasActivos({
      seleccionados: ['ia-nucleo'],
      propios: [{ id: 'ia-nucleo', grupo: 'tic', nombre: 'IA (mío)', peso: 3, terminos: ['INTELIGENCIA ARTIFICIAL'] }],
    })
    expect(puntuar('SERVICIOS DE INTELIGENCIA ARTIFICIAL', pisado, BIBLIOTECA.senalFuerte).fit).toBe(3)
  })

  it('un tema seleccionado que no existe se ignora, no rompe', () => {
    expect(temasActivos({ seleccionados: ['no-existe'] })).toEqual([])
  })
})
