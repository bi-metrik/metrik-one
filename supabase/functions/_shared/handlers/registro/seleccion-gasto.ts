// ============================================================
// La respuesta a «¿Para cuál?» de un gasto (W01, estado `awaiting_selection`) — módulo PURO
//
// Antes, todo lo que no fuera un número de la lista recibía «Responde con un número del 1 al N.». Mauricio,
// 2026-10-20: «Revisa el I1 26 5» y «No quiero, te estoy dando el id del negocio» rebotaron igual, y el gasto se
// quedó colgado. Ahora:
//   · número de la lista o botón → esa opción;
//   · un código de negocio en el texto («I1 26 5», «i1-26-5», dentro de una frase) → se busca ese negocio;
//   · «cancelar» → cancela;
//   · el texto de una opción («Gasto de empresa») → esa opción;
//   · cualquier otro texto con letras → se busca como nombre (negocio, empresa o contacto);
//   · nada de eso → se vuelve a preguntar con la lista. Nunca se descarta en silencio.
// ============================================================

import { extraerCodigoNegocio } from '../../wa-codigo-negocio.ts';

export type OpcionGasto = { id: string; label: string; _tipo?: string };

export type DecisionSeleccion =
  | { accion: 'opcion'; opcion: OpcionGasto }
  | { accion: 'codigo'; codigo: string }
  | { accion: 'cancelar' }
  | { accion: 'pista'; texto: string }
  | { accion: 'repreguntar' };

const CANCELA = ['cancelar', 'cancela', 'cancel', 'cancelalo', 'cancélalo', 'no', 'nel', '❌'];

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decidirSeleccionGasto(
  entrada: { texto: string; botonId?: string },
  opciones: OpcionGasto[],
): DecisionSeleccion {
  if (entrada.botonId) {
    const porBoton = opciones.find((o) => o.id === entrada.botonId);
    if (porBoton) return { accion: 'opcion', opcion: porBoton };
  }

  const crudo = (entrada.texto ?? '').trim();
  if (/^\d+$/.test(crudo)) {
    const n = parseInt(crudo, 10);
    return n >= 1 && n <= opciones.length ? { accion: 'opcion', opcion: opciones[n - 1] } : { accion: 'repreguntar' };
  }

  const codigo = extraerCodigoNegocio(crudo);
  if (codigo) {
    // Si el código es el de una opción de la lista, es esa opción (sin ir a la base).
    const enLista = opciones.find((o) => extraerCodigoNegocio(o.label) === codigo);
    return enLista ? { accion: 'opcion', opcion: enLista } : { accion: 'codigo', codigo };
  }

  if (CANCELA.includes(crudo.toLowerCase())) return { accion: 'cancelar' };

  const texto = normalizar(crudo);
  if (!texto || !/\p{L}/u.test(texto)) return { accion: 'repreguntar' };

  const porTexto = opciones.find((o) => {
    const label = normalizar(o.label);
    return label === texto || (o.id === 'empresa' && /(^| )empresa( |$)/.test(texto) && texto.split(' ').length <= 4);
  });
  if (porTexto) return { accion: 'opcion', opcion: porTexto };

  return { accion: 'pista', texto: crudo };
}

/** El texto con el que se vuelve a preguntar: dice qué se puede responder. */
export function textoRepregunta(noEncontrado?: string): string {
  const cabeza = noEncontrado ? `No encontré un negocio abierto para «${noEncontrado}».` : 'No te entendí.';
  return `${cabeza} Responde con el número, el código del negocio (p. ej. I1 26 5) o su nombre:`;
}
