// ============================================================
// Las funciones comunes a todo rol (spec §2.2, «Comunes a todo rol»): las pone el componedor; no se prenden ni se asignan
// ------------------------------------------------------------
// · `nucleo.responder` y `nucleo.proponer` no están aquí: los declara el núcleo (`../herramientas.ts`). `proponer` solo
//   aparece si el rol tiene alguna acción.
// · `comun.persona`: el paso a una persona (§4.2, `../persona.ts`), configurado por la ficha `rol.escalamiento`. En
//   Chatwoot (motor `publico`) es el cierre `pasar_a_persona` que ya existe: nota, etiqueta, equipo y `open`; es el
//   respaldo de Sabor (decisión del 26-oct). En WhatsApp es el cierre `pasar_a_persona` del motor `persona`
//   (`dominioPersona`): un botón al WhatsApp de MeTRIK (o al número de la ficha) con el mensaje ya escrito.
// · `comun.fuera_de_tema`: sin herramienta. La respuesta fija `rf.fuera_de_tema` la arma el código con las funciones del
//   rol (`../componer.ts`, `textoFueraDeTema`), no un texto que nombra todo.
// ============================================================

import type { Funcion } from './tipos.ts';

export const COMUN_PERSONA: Funcion = {
  clave: 'comun.persona',
  familia: 'comun',
  queHace: '',
  herramientas: { publico: { cierres: ['pasar_a_persona'] }, persona: { cierres: ['pasar_a_persona'] } },
  candados: [],
  fichas: [],
  comun: true,
};

export const COMUN_FUERA_DE_TEMA: Funcion = {
  clave: 'comun.fuera_de_tema',
  familia: 'comun',
  queHace: '',
  herramientas: {},
  candados: [],
  fichas: ['alc.no_temas', 'rf.fuera_de_tema'],
  comun: true,
};

export const FUNCIONES_COMUNES: Funcion[] = [COMUN_PERSONA, COMUN_FUERA_DE_TEMA];
