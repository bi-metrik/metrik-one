/**
 * Las respuestas del formulario de Meta, tal como se pintan en la ficha del
 * contacto — FUENTE ÚNICA de la regla.
 *
 * ## Por qué existe
 *
 * Hasta hoy la ficha traía una lista QUEMADA de nombres de campo
 * (`CAMPOS_RESUMEN`): cuatro papeles, con los nombres exactos que el formulario
 * usaba cuando alguien la escribió. Meta renombró el formulario a finales de
 * julio de 2026 y la lista dejó de acertar: `resumen.length === 0`, el bloque
 * `<dl>` no se renderizaba, y la fila del lead pasó a mostrar fuente, fecha y
 * campaña — nada de lo que el lead contestó. El dato nunca se perdió: sigue
 * completo en `payload.field_data`. Lo que se rompió fue la presentación, y como
 * el síntoma es "no hay bloque" y no un error, estuvo así mes y medio.
 *
 * El defecto no era el CONTENIDO de la lista, era que existiera una lista. Por
 * eso aquí no hay ninguna: se pinta TODO lo que el lead contestó, y lo único que
 * se decide es qué se calla.
 *
 * ## Qué se calla
 *
 * Las respuestas de identidad —nombre, correo, teléfono— ya están en la cabecera
 * del contacto; repetirlas dentro del formulario es ruido. Se reconocen por
 * PARECIDO del nombre del campo, no por una lista exacta: es la misma red que
 * usa el webhook (`porParecido`, `meta-leads-webhook/index.ts`) y es la única
 * pieza de ese camino que sobrevivió al cambio de formulario.
 *
 * La red no se puede COMPARTIR con el webhook —corre en Deno y no importa de
 * `src/`—, así que se reescribe con el mismo criterio: nombre sin tildes, en
 * minúsculas, por subcadena.
 *
 * ⚠️ Dos fragmentos del webhook NO están aquí, y es deliberado: `movil` y
 * `whatsapp`. El riesgo de un falso positivo apunta en direcciones opuestas en
 * cada sitio. Allá, un acierto de más elige un valor para un campo que si no
 * quedaría vacío, y además el mapa a mano manda primero. Aquí, un acierto de más
 * BORRA de la pantalla una respuesta real y nadie se entera — que es exactamente
 * el fallo que este archivo viene a cerrar. Y en un formulario de vehículos
 * `automovil` contiene `movil`.
 *
 * ⚠️ El precio de la red es que una pregunta que MENCIONE un dato de identidad
 * sin serlo (`¿cuál es el nombre del concesionario?`) se calla. Es el mismo
 * precio que ya paga el webhook, y es preferible al inverso: la lista exacta no
 * se equivoca nunca y deja de funcionar entera en cuanto alguien renombra. Si
 * aparece un formulario con una pregunta así, el arreglo es acotar el fragmento
 * (`nombre completo`, `tu nombre`), no volver a la lista.
 */

import { formatCOP } from '@/lib/contacts/constants'

/** Una entrada del `field_data` de Meta. Tolerante: los dos campos son opcionales. */
export type CampoFormulario = { name?: string; values?: string[] }

/** Una respuesta lista para pintar. `name` se conserva como llave de React. */
export type CampoResumen = { name: string; label: string; value: string }

/**
 * Fragmentos que delatan un campo de identidad. Cubren español e inglés sin que
 * nadie tenga que anticipar cómo bautizaron el campo en Meta: `nombre_completo`
 * contiene `nombre`, `número_de_teléfono` contiene `tel`, `correo_electrónico`
 * contiene `correo`.
 */
const FRAGMENTOS_IDENTIDAD = ['nombre', 'name', 'email', 'correo', 'mail', 'tel', 'phone', 'celular']

/** Quita tildes y baja a minúsculas. La ñ se descompone a n, que es lo que se quiere. */
function sinTildes(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * ¿Este campo repite un dato que ya está en la cabecera del contacto?
 *
 * Se decide por el NOMBRE del campo, nunca por su valor: un correo tipeado en el
 * campo equivocado sigue siendo una respuesta que el lead dio y que el comercial
 * necesita ver.
 */
export function esCampoDeIdentidad(name: string | undefined): boolean {
  const n = sinTildes(name ?? '')
  return FRAGMENTOS_IDENTIDAD.some((f) => n.includes(f))
}

/**
 * Etiqueta derivada del propio nombre del campo: `¿en_qué_ciudad_reside?` →
 * "En qué ciudad reside".
 *
 * Sale larga y en forma de pregunta, y está bien: es literalmente lo que el lead
 * contestó. La alternativa —un diccionario nombre → etiqueta bonita— es la lista
 * quemada otra vez, con el mismo modo de fallo.
 */
export function etiquetaDeCampo(name: string): string {
  const t = name
    .replace(/[¿?¡!]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return name
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Limpia un valor declarado: quita relleno con guiones bajos y capitaliza enums. */
export function limpiarValor(v: string): string {
  const t = v.replace(/_+$/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Un valor es número limpio si solo trae dígitos, puntos, comas, espacios y `$`,
 * y al menos un dígito. Cualquier letra lo descalifica.
 */
const NUMERO_LIMPIO = /^[\d.,\s$]*\d[\d.,\s$]*$/

/**
 * Formatea el valor de una respuesta.
 *
 * ⚠️ El formateo como COP **no se aplica a ciegas**. El campo de precio dejó de
 * ser un número cuando Meta cambió el formulario: hoy llega como rango de texto
 * (`"$100 - $200 millones"`). Quitarle todo lo que no fuera dígito producía
 * `100200`, que se pintaba **$100.200** — peor que no pintar nada, porque es un
 * dato falso donde el comercial cree que hay un precio.
 *
 * Solo se formatea cuando el valor ES un número limpio. Todo lo demás se pinta
 * tal cual, que es lo honesto: el lead escribió un rango, no una cifra.
 *
 * Límite conocido y aceptado: una coma decimal (`"120,5"`) se lee como separador
 * de miles y daría `$1.205`. No se ha visto un precio de vehículo escrito así, y
 * la alternativa —adivinar cuándo una coma es decimal— vuelve a inventar.
 */
export function valorDeCampo(v: string): string {
  const t = v.trim()
  if (NUMERO_LIMPIO.test(t)) {
    const digitos = t.replace(/[^\d]/g, '')
    const n = Number(digitos)
    if (digitos.length > 0 && Number.isFinite(n) && n > 0) return formatCOP(n)
  }
  return limpiarValor(t)
}

/**
 * Todo lo que el lead contestó, menos la identidad, listo para pintar.
 *
 * Conserva el orden en el que Meta lo entrega, que es el orden del formulario.
 * Un campo sin `values`, con el arreglo vacío o con el primer valor en blanco no
 * aporta nada y no se pinta.
 */
export function resumenDelFormulario(fieldData: CampoFormulario[]): CampoResumen[] {
  const salida: CampoResumen[] = []
  for (const fd of fieldData) {
    const name = fd.name?.trim()
    if (!name) continue
    if (esCampoDeIdentidad(name)) continue
    const bruto = fd.values?.[0]
    if (typeof bruto !== 'string' || !bruto.trim()) continue
    salida.push({ name, label: etiquetaDeCampo(name), value: valorDeCampo(bruto) })
  }
  return salida
}

/**
 * Tipo de persona declarado en el formulario, para sugerirlo al crear el negocio.
 *
 * Estaba roto por los dos lados: buscaba el campo por nombre exacto (que cambió)
 * y comparaba el valor con `startsWith('natural')`, cuando lo que llega es
 * `persona_natural` — y `'persona_natural'.startsWith('natural')` es falso.
 *
 * Ahora el campo se busca por parecido (su nombre menciona `natural` o `jurid`,
 * que es justo lo que hace la pregunta) y el valor se juzga con `includes`, no
 * con `startsWith`, para que el prefijo `persona_` deje de importar.
 *
 * ⚠️ Si el valor menciona las dos cosas —el caso de quien responde con la
 * etiqueta entera de la pregunta— devuelve `null`. No hay respuesta que leer, y
 * sugerir una de las dos sería inventarla; `null` deja el formulario como está
 * hoy, con el comercial eligiendo.
 *
 * ⚠️ **Esta regla tiene una copia deliberada en Deno**, y las dos tienen que
 * moverse juntas: `decidirTipoPersona` en
 * `supabase/functions/_shared/meta-leads/tipo-persona.ts`, que es la que decide
 * el ROL del contacto cuando el lead entra por el webhook de Meta. No se comparte
 * el código porque una edge function no puede importar de `src/`; lo que se
 * comparte es el criterio, y cada copia tiene su prueba con **los mismos cuatro
 * valores reales de producción**. Si alguien cambia una sola, las pruebas de la
 * otra siguen fijando el criterio viejo y la diferencia se ve al leer.
 *
 * Ahí está escrito por qué existe la regla: la copia del webhook comparaba por
 * igualdad exacta y dejó 572 contactos sin rol durante mes y medio, en silencio.
 */
export function detectarTipoPersona(fieldData: CampoFormulario[]): 'natural' | 'juridica' | null {
  for (const fd of fieldData) {
    const n = sinTildes(fd.name ?? '')
    if (!n.includes('natural') && !n.includes('jurid')) continue
    const bruto = fd.values?.[0]
    if (typeof bruto !== 'string' || !bruto.trim()) continue
    const v = sinTildes(bruto)
    const natural = v.includes('natural')
    const juridica = v.includes('jurid')
    if (natural && juridica) return null
    if (juridica) return 'juridica'
    if (natural) return 'natural'
  }
  return null
}
