/**
 * El OPERADOR de cada paquete de bloqueo (H-13 del QA de Trappvel del 2026-10-29, viaje 02).
 *
 * La solicitud guarda el operador del viaje en UN campo de texto (`operador_bloqueo`). Con dos
 * operadores queda «ALIADOS TRAVEL / TU RESERVA» (o «… Y TU RESERVA»): ese texto se copiaba igual
 * en cada paquete (`tarifa_pax.bloqueo.operador`) y de ahí al servicio, como si fuera UN operador,
 * y ningún paquete quedaba ligado a su ficha del Directorio.
 *
 * Aquí, puro (servidor y navegador):
 *  · `operadoresDeLaSolicitud`: el texto de la solicitud partido en sus operadores.
 *  · `operadorInicialDelPaquete`: con UN operador, el paquete nace con él (como antes); con varios,
 *    nace sin operador y la asesora lo elige en la tarjeta (o lo trae la lectura del pantallazo).
 *  · `operadorAlGuardar`: lo que el servidor guarda. Nunca el texto mezclado de varios.
 *  · `operadorDeLaLectura`: el operador que el lector vio en el pantallazo, si es uno de la
 *    solicitud (o, sin operadores en la solicitud, el leído).
 *  · `fichaDelOperador`: la ficha del Directorio (`fotos_perfiles`) que es ese operador.
 */

/** «Aliados Travel S.A.S.» → «aliadostravel»: para comparar nombres sin tildes, mayúsculas ni sociedad. */
export function claveDeNombre(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|sas|e\.?u\.?)\s*$/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Lo que separa a dos operadores en el texto de la solicitud: «/», «,», «;», «+», «&» y « y » (la
 * forma del viaje 02: «ALIADOS TRAVEL Y TU RESERVA»). Un operador con « y » en el nombre se parte:
 * la asesora lo escribe entero en el paquete y ese manda.
 */
const SEPARADOR = /\s*(?:\/|,|;|\+|&|\s+y\s+)\s*/i

/**
 * Los operadores que nombra la solicitud, en orden y sin repetir. «ALIADOS TRAVEL / TU RESERVA» →
 * [«ALIADOS TRAVEL», «TU RESERVA»]; «TU RESERVA» → [«TU RESERVA»]; vacío → [].
 */
export function operadoresDeLaSolicitud(texto: string | null | undefined): string[] {
  if (typeof texto !== 'string') return []
  const out: string[] = []
  const vistos = new Set<string>()
  for (const parte of texto.split(SEPARADOR)) {
    const t = parte.replace(/\s+/g, ' ').trim()
    const k = claveDeNombre(t)
    if (!k || vistos.has(k)) continue
    vistos.add(k)
    out.push(t.slice(0, 120))
  }
  return out
}

/** El operador con que nace un paquete: el único de la solicitud, o ninguno si hay varios. */
export function operadorInicialDelPaquete(operadorSolicitud: string | null | undefined): string | null {
  const ops = operadoresDeLaSolicitud(operadorSolicitud)
  return ops.length === 1 ? ops[0] : null
}

/** ¿Este operador es el texto que junta a VARIOS operadores (no uno solo)? */
export function esOperadorMezclado(operador: string | null | undefined): boolean {
  return operadoresDeLaSolicitud(operador).length > 1
}

/**
 * El operador que se guarda en el paquete. El escrito o elegido en la tarjeta manda; si no hay, el
 * único de la solicitud. Un texto que junta varios operadores no es el operador de NADIE: el
 * paquete queda sin operador (y la tarjeta pide elegirlo) en vez de heredar la mezcla.
 */
export function operadorAlGuardar(delPaquete: string | null | undefined, deLaSolicitud: string | null | undefined): string | null {
  const propio = typeof delPaquete === 'string' ? delPaquete.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (propio && !esOperadorMezclado(propio)) return propio
  return operadorInicialDelPaquete(deLaSolicitud)
}

/**
 * El operador que leyó el lector del pantallazo (logo o nombre), como lo escribe la solicitud. Con
 * operadores en la solicitud solo vale si es uno de ellos (el modelo puede confundir la marca del
 * hotel con la del operador); sin ellos, el leído.
 */
export function operadorDeLaLectura(leido: string | null | undefined, candidatos: readonly string[]): string | null {
  const k = claveDeNombre(leido)
  if (!k) return null
  if (candidatos.length === 0) return (leido as string).replace(/\s+/g, ' ').trim().slice(0, 120)
  const iguales = candidatos.filter(c => claveDeNombre(c) === k)
  if (iguales.length === 1) return iguales[0]
  // «Tu Reserva» leído contra «TU RESERVA TRAVEL» en la solicitud, o al revés.
  const parecidos = candidatos.filter(c => {
    const kc = claveDeNombre(c)
    return kc.length >= 5 && k.length >= 5 && (kc.startsWith(k) || k.startsWith(kc))
  })
  return parecidos.length === 1 ? parecidos[0] : null
}

export interface FichaDeOperador {
  id: string
  nombre: string | null
  tipo_proveedor?: string | null
}

const TIPOS_OPERADOR = new Set(['operador', 'mayorista'])

/**
 * La ficha del Directorio que es el operador: por nombre, sin tildes, mayúsculas ni sociedad. Solo
 * si hay UNA (con dos del mismo nombre, la que sea operador o mayorista; si siguen dos, ninguna:
 * no se adivina). Sin igual exacto, una que empiece igual («Aliados» ↔ «Aliados Travel»), si es una.
 */
export function fichaDelOperador<F extends FichaDeOperador>(operador: string | null | undefined, fichas: readonly F[]): F | null {
  const k = claveDeNombre(operador)
  if (!k || esOperadorMezclado(operador)) return null
  const unica = (lista: F[]): F | null => {
    if (lista.length === 1) return lista[0]
    const ops = lista.filter(f => TIPOS_OPERADOR.has(String(f.tipo_proveedor ?? '')))
    return ops.length === 1 ? ops[0] : null
  }
  const exactas = fichas.filter(f => claveDeNombre(f.nombre) === k)
  if (exactas.length > 0) return unica(exactas)
  if (k.length < 5) return null
  return unica(fichas.filter(f => {
    const kf = claveDeNombre(f.nombre)
    return kf.length >= 5 && (kf.startsWith(k) || k.startsWith(kf))
  }))
}

/**
 * La ficha que queda en la línea del paquete (`items.proveedor_id`). La del operador, si está en el
 * Directorio. Si no, la que tenía se suelta solo si era la de OTRO proveedor (el operador anterior):
 * una de hotel se conserva, es la llave de sus fotos en el PDF.
 */
export function proveedorDelPaquete(a: { ficha: FichaDeOperador | null; previa: string | null; fichas: readonly FichaDeOperador[] }): string | null {
  if (a.ficha) return a.ficha.id
  if (a.previa && a.fichas.some(f => f.id === a.previa)) return null
  return a.previa
}
