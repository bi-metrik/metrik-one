// ============================================================
// Arnés de la bandeja por ROL (Trappvel, 2026-10-29) — los casos de cada rol
// ------------------------------------------------------------
// `correr.ts --rol <clave>` corre, con las fichas del rol (`bandeja/roles-trappvel.ts`) y el dominio compuesto como en
// producción, los casos de la bandeja de hoy (conjunto 1, quién lleva, perfil, archivos: lo que ya hace Agus no puede
// empeorar) más los casos propios del rol:
//   · mano derecha (el dueño): un viaje de una solicitud reenviada y un gasto con foto en la misma conversación;
//     un gasto de un viaje dicho por texto; su consulta de gastos; una llamada (actividad) en un viaje; «la llevo yo».
//   · asesora: no registra gastos ni ve cifras (no tiene esas herramientas) y «la llevo yo» es suya.
// La verdad es el estado final de las dos bases en memoria (bandeja y ONE): `p.escrituras` trae las dos.
// Datos inventados.
// ============================================================

import type { PuertoMemoria } from '../memoria.ts';
import type { MiembroEquipo } from '../bandeja/dominio.ts';
import type { Traza } from '../tipos.ts';
import type { ClaveRolTrappvel } from '../bandeja/roles-trappvel.ts';
import { CONJUNTO_1, CONJUNTO_ADJUNTOS, CONJUNTO_PERFIL, CONJUNTO_RESPONSABLE, DIRECTORIO, VIAJES, viajeCon } from './conjuntos.ts';
import type { CasoArnes, Veredicto } from './conjuntos.ts';

/** La factura sintética es del 2026-10-20: estos casos corren el 29-oct (con el reloj del arnés, del 6-oct, sería futura). */
const HOY_ROLES = '2026-10-29T15:00:00Z';
const ok = (motivo: string): Veredicto => ({ ok: true, motivo });
const mal = (motivo: string): Veredicto => ({ ok: false, motivo });
const de = (p: PuertoMemoria, tipo: string) => p.escrituras.filter((e) => e.tipo === tipo);
const usoHerramienta = (t: Traza[], nombre: string) => t.some((x) => (x.herramientas ?? []).some((h) => h.nombre === nombre && h.ok));
const propuso = (t: Traza[], accion: string) => t.some((x) => x.propuesta?.accion === accion);

/** El equipo comercial de estos casos: nombres inventados (el dueño, dos asesoras). */
const EQUIPO_ROLES: MiembroEquipo[] = [
  { id: 'st-dueno', nombre: 'Rodrigo Vélez', esQuienEscribe: false },
  { id: 'st-lina', nombre: 'Lina Arango', esQuienEscribe: false },
  { id: 'st-paula', nombre: 'Paula Ortiz', esQuienEscribe: false },
];
const escribe = (id: string): MiembroEquipo[] => EQUIPO_ROLES.map((m) => ({ ...m, esQuienEscribe: m.id === id }));
const comoDueno = { contactos: DIRECTORIO, viajes: VIAJES, equipo: escribe('st-dueno'), remitente: { nombre: 'Rodrigo', rol: 'owner' } };
const comoAsesora = { contactos: DIRECTORIO, viajes: VIAJES, equipo: escribe('st-paula'), remitente: { nombre: 'Paula', rol: 'operator' } };

export const CASOS_MANO_DERECHA: CasoArnes[] = [
  {
    ...comoDueno, id: 'md-viaje-y-gasto', conjunto: 1, ahora: HOY_ROLES, sinClienteNuevo: true, extraccion: true, viajesPermitidos: [],
    titulo: 'misma conversación: abre un viaje de una solicitud reenviada, la carga, y registra un gasto de empresa con la foto de la factura',
    pasos: [
      { reenvia: 'Hola Rodrigo, queremos ir a San Andrés del 8 al 13 de enero de 2027, somos 2 adultos y un niño (9)' },
      { escribe: 'ábrele un viaje a Laura Gómez con eso, lo lleva Lina' },
      { toca: 'Sí, ábrelo', oEscribe: 'sí' },
      { escribe: 'cárgale lo que te reenvié' },
      { toca: 'Cargar', oEscribe: 'sí' },
      { adjunta: { archivo: 'factura', pie: 'y esta factura la pagué yo, es de la oficina' } },
      { toca: 'Gasto de empresa', oEscribe: 'es gasto de empresa' },
      { toca: 'Registrar', oEscribe: 'sí' },
    ],
    esperado: (p, t) => {
      const v = viajeCon(p, 'c-laura', 'st-lina', t);
      if (!v.ok) return v;
      const codigo = String(de(p, 'viaje')[0].codigo);
      if (!de(p, 'carga').concat(de(p, 'anotacion')).some((e) => e.codigo === codigo)) return mal(`no cargó la solicitud en ${codigo}`);
      const gastos = de(p, 'gasto');
      if (gastos.length !== 1) return mal(`se esperaba 1 gasto y hay ${gastos.length}`);
      if (gastos[0].monto !== 84500) return mal(`el gasto quedó por ${String(gastos[0].monto)} (la factura dice 84.500)`);
      if (gastos[0].negocio !== null) return mal(`el gasto quedó en ${String(gastos[0].negocio)}, no de empresa`);
      if (gastos[0].soporte !== true) return mal('el gasto quedó sin la foto de soporte');
      return ok(`viaje ${codigo} con su carga y el gasto de empresa con soporte`);
    },
  },
  {
    ...comoDueno, id: 'md-gasto-viaje', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: 'un gasto de un viaje dicho por texto: va al negocio del viaje, no se anota como dato',
    pasos: [{ escribe: 'pagué 120.000 de transporte para el viaje M1 26 1' }, { toca: 'Registrar', oEscribe: 'sí' }],
    esperado: (p) => {
      const gastos = de(p, 'gasto');
      if (de(p, 'carga').length) return mal('lo anotó en el viaje como dato');
      if (gastos.length !== 1) return mal(`se esperaba 1 gasto y hay ${gastos.length}`);
      if (gastos[0].monto !== 120000 || gastos[0].negocio !== 'M1 26 1') return mal(`gasto ${String(gastos[0].monto)} en ${String(gastos[0].negocio)}`);
      return ok('gasto de 120.000 en M1 26 1');
    },
  },
  {
    ...comoDueno, id: 'md-consulta-gastos', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: 'el dueño consulta los gastos: lo contesta con la consulta, sin escribir',
    pasos: [{ escribe: 'cuánto hemos gastado esta semana' }],
    esperado: (p, t) => {
      if (p.escrituras.length) return mal('escribió algo en una consulta');
      if (!usoHerramienta(t, 'gastos_recientes')) return mal('no consultó los gastos');
      return ok('consultó los gastos sin escribir');
    },
  },
  {
    ...comoDueno, id: 'md-llamada', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: ['M1 26 1'],
    titulo: 'una llamada en un viaje: una sola anotación (actividad o dato del viaje), en ese viaje',
    pasos: [{ escribe: 'anota en el M1 26 1 que hoy llamé a Martín y quedó de confirmarme mañana' }, { toca: 'Registrar', oEscribe: 'sí' }],
    esperado: (p) => {
      const act = de(p, 'actividad');
      const carga = de(p, 'carga');
      if (act.length + carga.length !== 1) return mal(`se esperaba 1 anotación y hay ${act.length} actividades y ${carga.length} cargas`);
      if (act.length && act[0].negocio !== 'M1 26 1') return mal(`la actividad quedó en ${String(act[0].negocio)}`);
      if (carga.length && carga[0].codigo !== 'M1 26 1') return mal(`la anotación quedó en ${String(carga[0].codigo)}`);
      return ok(act.length ? 'actividad en M1 26 1' : 'anotación en M1 26 1');
    },
  },
  {
    ...comoDueno, id: 'md-yo', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: '«lo llevo yo» del dueño: el viaje es suyo',
    pasos: [{ escribe: 'ábreme un viaje nuevo para Martín Mora a Madrid, lo llevo yo' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => viajeCon(p, 'c-martin', 'st-dueno', t),
  },
];

export const CASOS_ASESORA: CasoArnes[] = [
  {
    ...comoAsesora, id: 'av-gasto-no', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: 'la asesora pide registrar un gasto: no tiene cómo y no escribe nada',
    pasos: [{ escribe: 'regístrame un gasto de 50.000 de taxi del M1 26 1' }],
    esperado: (p, t) => {
      if (p.escrituras.length) return mal('escribió algo');
      if (propuso(t, 'gasto')) return mal('propuso un gasto');
      if (!t.some((x) => x.tipo === 'modelo' && x.salida)) return mal('no contestó');
      return ok('no registró el gasto y contestó');
    },
  },
  {
    ...comoAsesora, id: 'av-cifras-no', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: 'la asesora pregunta cifras: no hay consulta de gastos ni de dinero',
    pasos: [{ escribe: 'cuánto llevamos gastado en el viaje M1 26 1 y cuánto vale' }],
    esperado: (p, t) => {
      if (p.escrituras.length) return mal('escribió algo');
      if (usoHerramienta(t, 'gastos_recientes') || usoHerramienta(t, 'ver_negocio')) return mal('consultó cifras que su rol no ve');
      return ok('no consultó cifras');
    },
  },
  {
    ...comoAsesora, id: 'av-factura-no', conjunto: 1, ahora: HOY_ROLES, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: 'la asesora manda la foto de una factura para registrar: no se registra ni se vuelve dato de un viaje',
    pasos: [{ adjunta: { archivo: 'factura', pie: 'regístrame esta factura' } }],
    esperado: (p) => (p.escrituras.length ? mal(`escribió ${p.escrituras.map((e) => e.tipo).join(', ')}`) : ok('no escribió nada')),
  },
  {
    ...comoAsesora, id: 'av-yo', conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
    titulo: '«la llevo yo» de la asesora: el viaje es suyo',
    pasos: [{ escribe: 'viaje nuevo para Martín Mora a Madrid, la llevo yo' }, { toca: 'Sí, ábrelo', oEscribe: 'sí' }],
    esperado: (p, t) => viajeCon(p, 'c-martin', 'st-paula', t),
  },
];

/** El nombre del asistente de Trappvel (decisión de Mauricio, 2026-10-30): va en `perfil.valores.nombre`. */
export const NOMBRE_ASISTENTE_TRAPPVEL = 'Trappi';

/** Lo que el asistente dijo en cada turno (el texto de lo que salió). */
const dichos = (t: Traza[]) => t.filter((x) => x.salida).map((x) => x.salida?.texto ?? '');

/** El saludo: la primera vez se presenta como Trappi; en el siguiente mensaje no se vuelve a presentar. */
const saludo = (base: typeof comoDueno, id: string): CasoArnes => ({
  ...base, id, conjunto: 1, sinClienteNuevo: true, viajesPermitidos: [],
  titulo: `saludo: la primera vez se presenta como ${NOMBRE_ASISTENTE_TRAPPVEL}, y no se vuelve a presentar`,
  pasos: [{ escribe: 'hola, buenos días' }, { escribe: 'qué viajes tiene abiertos Martín Mora?' }],
  esperado: (p, t) => {
    if (p.escrituras.length) return mal('escribió algo en un saludo');
    const [primero, ...resto] = dichos(t);
    const nombre = new RegExp(`\\b${NOMBRE_ASISTENTE_TRAPPVEL}\\b`, 'i');
    if (!primero || !nombre.test(primero)) return mal(`no se presentó como ${NOMBRE_ASISTENTE_TRAPPVEL}: «${(primero ?? '').slice(0, 80)}»`);
    if (resto.some((x) => nombre.test(x))) return mal('se volvió a presentar');
    return ok(`se presentó como ${NOMBRE_ASISTENTE_TRAPPVEL} una vez`);
  },
});

/** Los casos de un rol: los de la bandeja de hoy (no pueden empeorar) más los suyos. */
export function casosDelRol(clave: ClaveRolTrappvel): CasoArnes[] {
  const propios = clave === 'mano_derecha' ? [...CASOS_MANO_DERECHA, saludo(comoDueno, 'md-saludo')] : [...CASOS_ASESORA, saludo(comoAsesora, 'av-saludo')];
  return [...CONJUNTO_1, ...CONJUNTO_RESPONSABLE, ...CONJUNTO_PERFIL, ...CONJUNTO_ADJUNTOS, ...propios];
}
