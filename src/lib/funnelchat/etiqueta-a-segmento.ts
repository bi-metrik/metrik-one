// Traduce una etiqueta de FunnelChat al status de gestion del contacto en ONE.
//
// Direccion: FunnelChat -> ONE. Quien trabaja los contactos vive en el inbox de
// FunnelChat, no en ONE; ahi es donde marca "ya lo llame", "no contesta", "no
// califica". Sin esto ese trabajo se queda encerrado en FunnelChat y el status en
// ONE envejece hasta volverse decorativo: en el listado de contactos dice lo que
// alguien puso la ultima vez que entro a ONE, que puede ser nunca.
//
// ⚠️ Toca UNICAMENTE `contactos.segmento`. Ni negocios, ni etapas, ni responsables.
// Una etiqueta de WhatsApp es evidencia de una conversacion, no de un tramite.
//
// ⚠️ La COLUMNA se llama `segmento` por historia; el concepto visible es "status
// del contacto" (ver STATUS_CONTACTO en catalogos/constants). No son lo mismo que
// los "segmentos" del modulo de compliance.

import { STATUS_CONTACTO } from '@/lib/catalogos/constants'

/** Sin tildes, sin espacios de sobra, en minusculas. Las etiquetas las escriben
 *  personas: "No contesta", "no contesta " y "No Contestá" son la misma. */
export function normalizarEtiqueta(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Deja el telefono en los 10 digitos del movil colombiano.
 *
 * FunnelChat manda `573155542420` (con indicativo, sin +) y ONE guarda
 * `3155542420`. Comparar los crudos no cruza NINGUN contacto, y el sintoma seria
 * "el webhook llega pero no pasa nada", que es el mas caro de diagnosticar.
 *
 * Devuelve null si no quedan 10 digitos que empiecen por 3: un fijo o un numero
 * internacional no es un movil colombiano y buscarlo por sufijo cruzaria contactos
 * que no son. Preferimos no escribir a escribirle al que no es.
 */
export function telefonoMovilCo(valor: string | null | undefined): string | null {
  const digitos = (valor ?? '').replace(/\D/g, '')
  if (digitos.length < 10) return null
  const diez = digitos.slice(-10)
  return /^3\d{9}$/.test(diez) ? diez : null
}

export type ResultadoMapa =
  | { ok: true; segmento: string }
  | { ok: false; motivo: 'sin_mapa_configurado' | 'etiqueta_sin_mapa' | 'segmento_invalido'; detalle: string }

/**
 * El mapa vive en `workspaces.config_extra.funnelchat.mapa_segmentos`, NO aqui.
 *
 * Los nombres de las etiquetas son de cada cliente —SOENA usa "Seguimiento" y
 * "No calificado"— y el dia que renombren una, cambiar un literal en el codigo y
 * esperar un despliegue para que el equipo comercial recupere su tablero es una
 * dependencia que no tiene por que existir. Es configuracion, no logica.
 *
 * Un mapa PARCIAL es lo normal y es correcto: "Pendiente Bizagi" o "Calificado"
 * describen el caso, no la gestion del contacto, y no tienen equivalente. Esas
 * etiquetas no se traducen a nada y la razon queda escrita en el evento. Lo que
 * NO se hace es inventarles un status para que "no falle": eso ensuciaria el
 * status de gestion con informacion que no es de gestion.
 */
export function resolverSegmento(
  etiqueta: string,
  mapa: Record<string, unknown> | null | undefined,
): ResultadoMapa {
  if (!mapa || Object.keys(mapa).length === 0) {
    return {
      ok: false,
      motivo: 'sin_mapa_configurado',
      detalle: 'falta config_extra.funnelchat.mapa_segmentos en el workspace',
    }
  }

  const buscada = normalizarEtiqueta(etiqueta)
  const entrada = Object.entries(mapa).find(([clave]) => normalizarEtiqueta(clave) === buscada)

  if (!entrada) {
    return { ok: false, motivo: 'etiqueta_sin_mapa', detalle: etiqueta }
  }

  const destino = String(entrada[1] ?? '')
  // El mapa es dato editable a mano: un valor con un dedazo escribiria en
  // `contactos.segmento` un status que el catalogo no reconoce, y el chip saldria
  // en gris sin que nadie sepa de donde salio. Se valida contra el catalogo.
  const valido = (STATUS_CONTACTO as readonly { value: string }[]).some(s => s.value === destino)
  if (!valido) {
    return { ok: false, motivo: 'segmento_invalido', detalle: `${etiqueta} -> ${destino}` }
  }

  return { ok: true, segmento: destino }
}
