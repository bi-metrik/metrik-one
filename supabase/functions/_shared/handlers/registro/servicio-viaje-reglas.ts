// ============================================================
// Pago a un proveedor del viaje por el bot (F3, Vera C12) — decisiones puras.
//
// Tras escoger el negocio, si su línea tiene `servicios_viaje.activo`, el bot pregunta «¿De qué
// servicio?» (o propone el que cuadra con el monto), luego el medio de pago, y pide la foto. Las
// reglas de pago son LAS MISMAS de la pantalla (`../../reglas-pago.ts`, copia exacta con guarda de
// CI): el bot nunca deja «Pagada» una fila que en pantalla quedaría «Esperando a Edgar».
//
// Este módulo no toca red ni base para poder probarlo en vitest (el handler arrastra `Deno.env`).
// ============================================================

import { formatCOP } from '../../wa-format.ts';

export interface ServicioPendiente {
  id: string;
  nombre: string;
  /** Lo que falta pagarle al proveedor. */
  falta: number;
}

export interface ServicioLeido {
  id: string;
  nombre: string;
  estado: string;
  costo_cotizado: number | string | null;
  valor_por_pagar: number | string | null;
}

/** Servicios que van y a los que les falta pago, en el orden del viaje. */
export function serviciosPendientes(
  servicios: readonly ServicioLeido[],
  pagadoPorServicio: Readonly<Record<string, number>>,
): ServicioPendiente[] {
  const out: ServicioPendiente[] = [];
  for (const s of servicios) {
    if (s.estado === 'cancelado') continue;
    const aPagar = Number(s.valor_por_pagar ?? s.costo_cotizado) || 0;
    const falta = Math.round(aPagar - (pagadoPorServicio[s.id] ?? 0));
    if (falta > 0) out.push({ id: s.id, nombre: s.nombre, falta });
  }
  return out;
}

/** El servicio que el bot propone: el ÚNICO al que le falta exactamente ese monto. */
export function servicioPropuesto(pendientes: readonly ServicioPendiente[], monto: number): ServicioPendiente | null {
  const m = Math.round(Number(monto) || 0);
  const iguales = pendientes.filter(p => p.falta === m);
  return iguales.length === 1 ? iguales[0] : null;
}

export const ID_SERVICIO = 'srv:';
export const ID_MEDIO = 'med:';
export const ID_OTRO_SERVICIO = 'srv_lista';
export const ID_NINGUNO = 'srv_ninguno';
/** Cuántos servicios caben en la lista numerada. */
export const MAX_SERVICIOS_LISTA = 8;

export interface OpcionViaje {
  id: string;
  label: string;
}

/** La lista «¿De qué servicio?»: pendientes con lo que falta, y la salida «no es de un servicio». */
export function opcionesDeServicio(pendientes: readonly ServicioPendiente[]): OpcionViaje[] {
  const ops = pendientes.slice(0, MAX_SERVICIOS_LISTA).map(p => ({
    id: `${ID_SERVICIO}${p.id}`,
    label: `${p.nombre} · falta ${formatCOP(p.falta)}`,
  }));
  ops.push({ id: ID_NINGUNO, label: 'Ninguno: es otro gasto del viaje' });
  return ops;
}

export function textoPropuesta(p: ServicioPendiente, monto: number): string {
  return `¿Es el pago de ${p.nombre} por ${formatCOP(monto)}?`;
}

/** Botones de la propuesta (títulos de 20 caracteres o menos, límite de WhatsApp). */
export function botonesPropuesta(p: ServicioPendiente): OpcionViaje[] {
  return [
    { id: `${ID_SERVICIO}${p.id}`, label: 'Sí' },
    { id: ID_OTRO_SERVICIO, label: 'Es otro servicio' },
  ];
}

/** Mensaje de confirmación del pago: qué se va a registrar y, si aplica, que esperará a Edgar. */
export function textoConfirmacionPago(args: {
  negocio: string;
  servicio: string;
  monto: number;
  medio: string;
  esperando: readonly string[];
}): string {
  let msg = `📁 *${args.negocio}*\n🧾 ${args.servicio}\n💰 ${formatCOP(args.monto)} con ${args.medio}`;
  if (args.esperando.length > 0) msg += `\n⏳ Quedará esperando a Edgar: ${args.esperando.join(' ')}`;
  return msg;
}

/** Lo que dice el bot después de registrar. */
export function textoPagoRegistrado(args: { servicio: string; monto: number; esperando: readonly string[] }): string {
  const base = `✅ Pago de ${formatCOP(args.monto)} registrado en ${args.servicio}.`;
  return args.esperando.length > 0 ? `${base}\n⏳ Quedó esperando a Edgar: ${args.esperando.join(' ')}` : base;
}
