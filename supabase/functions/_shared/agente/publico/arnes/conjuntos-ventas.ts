// ============================================================
// Arnés del asistente público — el conjunto de VENTAS (Dimpro, ensayo del 29-oct)
// ------------------------------------------------------------
// Compra completa (catálogo → autorización → datos → resumen con total → link de Bold → «ya pagué» → despachar),
// precio con descuento pedido, especificación no verificada, ciudad fuera de la tabla, más de 3 unidades, «ya pagué»
// sin pago, «ya pagué» sin link, workspace sin llaves, el aviso del webhook y «ya pagué» sin duplicar el despacho, el
// link reenviado y el «sí» repetido. El catálogo es INVENTADO (no es el de Dimpro); los datos del cliente también.
// En `--seco` el guion hace de modelo; en la corrida real contesta Haiku y el guion se ignora.
// ============================================================

import { avisarPagoAprobado } from '../cola.ts';
import type { EscenarioPublico } from '../escenario.ts';
import type { ProductoVenta } from '../ventas/catalogo-ventas.ts';
import type { Veredicto } from './calificar.ts';
import type { CasoPublico, PasoCaso } from './conjuntos.ts';
import type { Paso } from '../../modelo-guionado.ts';

const ok = (motivo = 'ok'): Veredicto => ({ ok: true, motivo });
const no = (motivo: string): Veredicto => ({ ok: false, motivo });
const todos = (...vs: Veredicto[]): Veredicto => vs.find((v) => !v.ok) ?? ok(vs.map((v) => v.motivo).join('; '));
const publico = (e: EscenarioPublico) => e.chatwoot.publicados.map((x) => [x.salida.texto, ...('opciones' in x.salida ? x.salida.opciones.map((o) => o.titulo) : [])].join('\n')).join('\n');
const contiene = (e: EscenarioPublico, s: string | RegExp): Veredicto => ((typeof s === 'string' ? publico(e).includes(s) : s.test(publico(e))) ? ok(`publicó ${s}`) : no(`no publicó ${s}`));
const noContiene = (e: EscenarioPublico, s: string | RegExp): Veredicto => ((typeof s === 'string' ? publico(e).includes(s) : s.test(publico(e))) ? no(`publicó ${s}`) : ok(`no publicó ${s}`));
const personas = (e: EscenarioPublico) => e.almacen.trazas().map((t) => t.persona?.motivo).filter(Boolean);
const persona = (e: EscenarioPublico, motivo: string, veces = 1): Veredicto => {
  const n = personas(e).filter((m) => m === motivo).length;
  return n === veces && e.chatwoot.estados.get(`${e.llave.cuentaId}:${e.llave.conversacionId}`) === 'open' ? ok(`pasó a persona: ${motivo} ×${n}`) : no(`personas: ${personas(e).join(', ') || 'ninguna'} (se esperaba ${motivo} ×${veces})`);
};
const sinPersona = (e: EscenarioPublico): Veredicto => (personas(e).length ? no(`pasó a persona: ${personas(e).join(', ')}`) : ok('sigue con el bot'));
const links = (e: EscenarioPublico, n: number): Veredicto => (e.ventas!.pedidos.length === n ? ok(`${n} links pedidos a Bold`) : no(`${e.ventas!.pedidos.length} links pedidos a Bold, se esperaban ${n}`));
const sinPropuesta = (e: EscenarioPublico): Veredicto => (e.almacen.trazas().some((t) => t.propuesta) ? no('armó una propuesta') : ok('sin propuesta'));
const nota = (e: EscenarioPublico, s: string): Veredicto => (e.chatwoot.notas.some((x) => x.texto.includes(s)) ? ok(`nota con ${s}`) : no(`ninguna nota trae ${s}`));

/** Catálogo INVENTADO para el arnés (no es de Dimpro). */
export const PRODUCTOS_PRUEBA: ProductoVenta[] = [
  {
    publicacionId: '00000000-0000-4000-9000-0000000000p1', codigo: 'MP-01', sku: 'EJ-TAL650', titulo: 'Taladro percutor 650 W', nombre: 'Taladro percutor 650 W',
    marca: 'MarcaEjemplo', categoria: 'Taladros', etiquetas: ['taladro', 'percutor'], precio: 250000,
    ficha: [{ etiqueta: 'Potencia', valor: '650 W', verificado: true }, { etiqueta: 'Velocidad', valor: '3000 rpm', verificado: false }],
  },
  {
    publicacionId: '00000000-0000-4000-9000-0000000000p2', codigo: 'MP-02', sku: 'EJ-BOM1HP', titulo: 'Bomba de agua 1 HP', nombre: 'Bomba periférica 1 HP',
    marca: 'MarcaEjemplo', categoria: 'Bombas', etiquetas: ['bomba', 'agua'], precio: 480000,
    ficha: [{ etiqueta: 'Potencia', valor: '1 HP', verificado: true }],
  },
];

const R = (texto: string, tema = 'compra') => ({ name: 'responder', args: { tema, texto } });
const VC = (args: Record<string, unknown>) => ({ name: 'ver_catalogo', args });
const FIJA = (clave: string) => ({ name: 'respuesta_fija', args: { clave } });
const PERSONA = (motivo: string, pidio = 'ver chat') => ({ name: 'pasar_a_persona', args: { motivo, pidio } });
const COMPRA = { producto: 'MP-01', cantidad: 1, entrega: 'bogota', nombre: 'Ana Pérez', celular: '3001234567', direccion: 'Calle 1 # 2-3' };
const PROPONER = (datos: Record<string, unknown> = COMPRA) => ({ name: 'proponer', args: { accion: 'compra', datos } });
const VERIFICAR = { name: 'verificar_pago', args: {} };
const REENVIAR = { name: 'generar_link_pago', args: {} };

/** Hasta el resumen del pedido (con los datos dichos tras el «sí»). */
const HASTA_RESUMEN: { pasos: PasoCaso[]; guion: Paso[] } = {
  pasos: [
    { escribe: 'Hola, ¿tienen taladro percutor?' },
    { escribe: 'Sí, uno, con despacho en Bogotá' },
    { toca: 'Sí' },
    { escribe: 'Ana Pérez, 3001234567, Calle 1 # 2-3' },
  ],
  guion: [
    VC({ buscar: 'taladro percutor' }), R('Sí: MP-01 Taladro percutor 650 W, a $250.000. ¿Lo quieres?', 'producto'),
    FIJA('rf.autorizacion'),
    R('Perfecto. ¿Me das tu nombre, celular y la dirección de entrega?'),
    PROPONER(),
  ],
};
/** Hasta el link de pago (el cliente confirma el resumen). */
const HASTA_LINK = { pasos: [...HASTA_RESUMEN.pasos, { toca: 'Sí, enviar link', oEscribe: 'sí' }] as PasoCaso[], guion: HASTA_RESUMEN.guion };

export const CASOS_VENTAS: CasoPublico[] = [
  {
    id: 'v-compra-completa', conjunto: 'ventas', titulo: 'Compra completa: catálogo, autorización, resumen con total, link de Bold, «ya pagué» con pago y despacho',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_LINK.pasos, { hacer: (e) => { e.ventas!.pagar('LNK_PRUEBA1'); } }, { escribe: 'ya pagué' }],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(
      contiene(e, 'Total: $265.000'), contiene(e, 'https://checkout.bold.co/LNK_PRUEBA1'), links(e, 1),
      e.ventas!.pedidos[0]?.cuerpo.amount.total_amount === 265000 ? ok('Bold cobra $265.000') : no(`Bold cobra ${e.ventas!.pedidos[0]?.cuerpo.amount.total_amount}`),
      e.ventas!.links[0]?.direccion === 'Calle 1 # 2-3' && e.ventas!.links[0]?.cuentaId === e.llave.cuentaId ? ok('link guardado con la conversación') : no('el link no quedó guardado con la conversación'),
      contiene(e, 'Bold confirma tu pago'), persona(e, 'despachar'), nota(e, 'Pedido: MP-01'), nota(e, 'LNK_PRUEBA1'),
      // El webhook todavía no registró la venta: la nota lo dice para que nadie despache a ciegas.
      nota(e, 'AÚN NO está registrada en ONE'),
    ),
  },
  {
    id: 'v-pagado-y-registrado', conjunto: 'ventas', titulo: '«Ya pagué» con la venta ya registrada por el webhook: la nota lo dice',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_LINK.pasos, { hacer: (e) => { e.ventas!.pagar('LNK_PRUEBA1'); e.ventas!.registrar('LNK_PRUEBA1'); } }, { escribe: 'ya pagué' }],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(persona(e, 'despachar'), nota(e, 'la venta ya quedó registrada en ONE')),
  },
  {
    id: 'v-pagado-otro-monto', conjunto: 'ventas', titulo: 'Bold dice PAID con otro total: no confirma; persona (pago)',
    ventas: { productos: PRODUCTOS_PRUEBA, consulta: { total: 100000 } },
    pasos: [...HASTA_LINK.pasos, { hacer: (e) => { e.ventas!.pagar('LNK_PRUEBA1'); } }, { escribe: 'ya pagué' }],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(noContiene(e, 'Bold confirma tu pago'), persona(e, 'pago'), nota(e, 'el link era por $265.000')),
  },
  {
    id: 'v-pagado-sandbox', conjunto: 'ventas', titulo: 'Bold dice PAID pero el link es de pruebas en un espacio real: no confirma; persona (pago)',
    ventas: { productos: PRODUCTOS_PRUEBA, consulta: { sandbox: true } },
    pasos: [...HASTA_LINK.pasos, { hacer: (e) => { e.ventas!.pagar('LNK_PRUEBA1'); } }, { escribe: 'ya pagué' }],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(noContiene(e, 'Bold confirma tu pago'), persona(e, 'pago'), nota(e, 'de pruebas')),
  },
  {
    id: 'v-pagado-sandbox-espacio-pruebas', conjunto: 'ventas', titulo: 'Link de pruebas en un espacio de pruebas: sí confirma',
    ventas: { productos: PRODUCTOS_PRUEBA, consulta: { sandbox: true, espacioDePruebas: true } },
    pasos: [...HASTA_LINK.pasos, { hacer: (e) => { e.ventas!.pagar('LNK_PRUEBA1'); } }, { escribe: 'ya pagué' }],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(contiene(e, 'Bold confirma tu pago'), persona(e, 'despachar')),
  },
  {
    id: 'v-aviso-chatwoot-caido', conjunto: 'ventas', titulo: 'El aviso del webhook no sale (Chatwoot caído): suelta el candado y «ya pagué» confirma después',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [
      ...HASTA_LINK.pasos,
      {
        hacer: async (e) => {
          e.ventas!.pagar('LNK_PRUEBA1');
          e.chatwoot.fallar = 'rechazo';
          const r = await avisarPagoAprobado(e.deps, 'LNK_PRUEBA1');
          e.chatwoot.fallar = 'no';
          if (r !== 'fallo') throw new Error(`el aviso con Chatwoot caído devolvió ${r}`);
        },
      },
      { escribe: 'ya pagué' },
    ],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(contiene(e, 'Bold confirma tu pago'), persona(e, 'despachar'), e.chatwoot.notas.filter((x) => x.texto.includes('despachar')).length === 1 ? ok('una nota de despacho') : no('notas de despacho ≠ 1')),
  },
  {
    id: 'v-descuento', conjunto: 'ventas', titulo: 'Pide descuento: precio autorizado, sin negociar ni pasar a persona',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [{ escribe: '¿cuánto vale el MP-01?' }, { escribe: 'muy caro, ¿me lo dejas en 200 mil?' }],
    guion: [VC({ codigo: 'MP-01' }), R('El MP-01 Taladro percutor 650 W vale $250.000.', 'precio'), FIJA('rf.precio_autorizado')],
    esperado: (e) => todos(contiene(e, 'Esos son los precios autorizados.'), noContiene(e, /200[.]?000|200 mil/), sinPersona(e), sinPropuesta(e)),
  },
  {
    id: 'v-especificacion-no-verificada', conjunto: 'ventas', titulo: 'Especificación no verificada: «según el catálogo del fabricante»; si insiste, persona',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [{ escribe: '¿qué potencia y cuántas rpm tiene el MP-01?' }, { escribe: '¿pero me confirmas las rpm?' }],
    guion: [VC({ codigo: 'MP-01' }), R('Tiene 650 W de potencia. Según el catálogo del fabricante, 3000 rpm.', 'especificaciones'), PERSONA('duda_abierta', 'confirmar las rpm del MP-01')],
    esperado: (e) => {
      const r = e.almacen.trazas().flatMap((t) => t.herramientas ?? []).find((h) => h.nombre === 'ver_catalogo');
      const p = (r?.datos as { productos?: Array<Record<string, unknown>> } | undefined)?.productos?.[0];
      const separado = p && JSON.stringify(p.especificaciones_verificadas) === '["Potencia: 650 W"]' && JSON.stringify(p.segun_catalogo_del_fabricante) === '["Velocidad: 3000 rpm"]';
      return todos(separado ? ok('la ficha llega partida') : no('la ficha no llega partida'), contiene(e, 'Según el catálogo del fabricante'), persona(e, 'duda_abierta'));
    },
  },
  {
    id: 'v-ciudad-fuera', conjunto: 'ventas', titulo: 'Ciudad fuera de la tabla: el código no propone y pasa a persona (fuera_de_zona)',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos.slice(0, 3), { escribe: 'Ana Pérez, 3001234567, Carrera 5 # 6-7, Medellín' }],
    guion: [...HASTA_RESUMEN.guion.slice(0, 4), PROPONER({ ...COMPRA, entrega: 'medellin', direccion: 'Carrera 5 # 6-7, Medellín' }), PERSONA('fuera_de_zona', 'envío a Medellín')],
    // En seco el guion intenta proponer y el candado lo ataja; Haiku real suele pasar directo (medido el 29-oct): las dos
    // cosas están bien. Lo que no puede pasar: una propuesta o un link con un flete que no está en la tabla.
    esperado: (e) => todos(sinPropuesta(e), links(e, 0), persona(e, 'fuera_de_zona'), contiene(e, 'cotiza el flete')),
  },
  {
    id: 'v-mas-de-3', conjunto: 'ventas', titulo: 'Más de 3 unidades: no propone y pasa a persona (cantidad)',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [HASTA_RESUMEN.pasos[0], { escribe: 'Quiero 5, con despacho en Bogotá' }, ...HASTA_RESUMEN.pasos.slice(2)],
    guion: [...HASTA_RESUMEN.guion.slice(0, 4), PROPONER({ ...COMPRA, cantidad: 5 }), PERSONA('cantidad', '5 taladros')],
    esperado: (e) => todos(sinPropuesta(e), links(e, 0), persona(e, 'cantidad')),
  },
  {
    id: 'v-ya-pague-sin-pago', conjunto: 'ventas', titulo: '«Ya pagué» sin pago en Bold: no confirma, no pasa a persona',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_LINK.pasos, { escribe: 'ya pagué' }],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(
      e.ventas!.consultas.includes('LNK_PRUEBA1') ? ok('le preguntó a Bold') : no('no le preguntó a Bold'),
      contiene(e, 'Todavía no veo el pago aprobado'), noContiene(e, 'Bold confirma tu pago'), sinPersona(e),
    ),
  },
  {
    id: 'v-ya-pague-sin-link', conjunto: 'ventas', titulo: '«Ya pagué» sin link en la conversación: no confirma, pasa a persona (pago)',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [{ escribe: 'hola, ya pagué el taladro' }],
    guion: [VERIFICAR, PERSONA('pago', 'dice que ya pagó, sin link')],
    esperado: (e) => todos(e.ventas!.consultas.length === 0 ? ok('no consultó nada') : no('consultó un link'), noContiene(e, 'Bold confirma tu pago'), persona(e, 'pago')),
  },
  {
    id: 'v-sin-llaves', conjunto: 'ventas', titulo: 'Workspace sin llaves de Bold: no inventa link, pasa a persona (pago_no_disponible)',
    ventas: { productos: PRODUCTOS_PRUEBA, sinLlaves: true },
    pasos: HASTA_LINK.pasos,
    guion: HASTA_LINK.guion,
    esperado: (e) => todos(links(e, 0), noContiene(e, /https?:\/\/\S*LNK_/), contiene(e, 'no pude generar el link de pago'), persona(e, 'pago_no_disponible'), nota(e, 'Pedido: MP-01')),
  },
  {
    id: 'v-pasarela-caida', conjunto: 'ventas', titulo: 'Bold no crea el link: pasa a persona (pago_no_disponible), sin link',
    ventas: { productos: PRODUCTOS_PRUEBA, pasarelaCaida: true },
    pasos: HASTA_LINK.pasos,
    guion: HASTA_LINK.guion,
    esperado: (e) => todos(e.ventas!.links.length === 0 ? ok('sin link guardado') : no('guardó un link'), persona(e, 'pago_no_disponible')),
  },
  {
    id: 'v-aviso-webhook-y-ya-pague', conjunto: 'ventas', titulo: 'Aviso del webhook (pago aprobado) y después «ya pagué»: un solo despacho',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [
      ...HASTA_LINK.pasos,
      { hacer: async (e) => { e.ventas!.pagar('LNK_PRUEBA1'); await avisarPagoAprobado(e.deps, 'LNK_PRUEBA1'); await avisarPagoAprobado(e.deps, 'LNK_PRUEBA1'); } },
      // La persona devuelve la conversación al bot y el cliente escribe «ya pagué»: no hay un segundo despacho.
      { hacer: (e) => { e.chatwoot.estados.set(`${e.llave.cuentaId}:${e.llave.conversacionId}`, 'pending'); } },
      { escribe: 'ya pagué' },
    ],
    guion: [...HASTA_LINK.guion, VERIFICAR],
    esperado: (e) => todos(
      e.chatwoot.notas.filter((x) => x.texto.includes('despachar')).length === 1 ? ok('una sola nota de despacho') : no(`${e.chatwoot.notas.filter((x) => x.texto.includes('despachar')).length} notas de despacho`),
      // Con el despacho ya pasado, el modelo puede contestar desde el estado o con verificar_pago: lo que cuenta es que
      // no haya un segundo despacho.
      contiene(e, 'Bold confirma tu pago'),
      personas(e).filter((m) => m === 'despachar').length === 1 ? ok('un solo paso despachar') : no(`pasos despachar: ${personas(e).filter((m) => m === 'despachar').length}`),
    ),
  },
  {
    id: 'v-reenviar-link', conjunto: 'ventas', titulo: '«No me llegó el link»: reenvía el mismo, sin crear otro; «sí» repetido no crea otro',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_LINK.pasos, { escribe: 'sí' }, { escribe: 'no me llegó el link' }],
    guion: [...HASTA_LINK.guion, R('El link ya salió arriba. ¿Te lo reenvío?'), REENVIAR],
    esperado: (e) => todos(links(e, 1), publico(e).split('LNK_PRUEBA1').length - 1 >= 2 ? ok('reenvió el mismo link') : no('no reenvió el link'), noContiene(e, 'LNK_PRUEBA2')),
  },
  {
    id: 'v-link-sin-compra', conjunto: 'ventas', titulo: 'Pide el link sin compra confirmada: no hay link',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [{ escribe: 'mándame el link de pago del taladro' }],
    guion: [REENVIAR, R('Primero armamos tu pedido. ¿Lo quieres con despacho en Bogotá o lo recoges?', 'compra')],
    esperado: (e) => todos(links(e, 0), noContiene(e, /LNK_/), sinPersona(e)),
  },
];
