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
import { CORTES_VENTAS } from '../config.ts';
import type { EscenarioPublico } from '../escenario.ts';
import type { ProductoVenta } from '../ventas/catalogo-ventas.ts';
import type { Veredicto } from './calificar.ts';
import type { CasoPublico, PasoCaso } from './conjuntos.ts';
import type { Paso } from '../../modelo-guionado.ts';
import type { Modelo } from '../../tipos.ts';

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

/** Catálogo INVENTADO con fotos para la venta consultiva (no es de Dimpro): cinco taladros y una pulidora. */
const FOTO = (sku: string) => `https://ejemplo.supabase.co/storage/v1/object/public/ferreteria-fotos/prueba/${sku}/1.jpg`;
const prod = (n: number, titulo: string, precio: number, o: Partial<ProductoVenta> = {}): ProductoVenta => ({
  publicacionId: `00000000-0000-4000-9000-0000000001${String(n).padStart(2, '0')}`, codigo: `MP-${String(n).padStart(2, '0')}`, sku: `EJ-${n}`,
  titulo, nombre: titulo, marca: 'MarcaEjemplo', categoria: 'Herramientas', etiquetas: [], precio, ficha: [], fotos: [FOTO(`EJ-${n}`)], ...o,
});
export const PRODUCTOS_CONSULTIVA: ProductoVenta[] = [
  prod(11, 'Taladro percutor inalámbrico MarcaEjemplo 20V', 320000, { ficha: [{ etiqueta: 'Batería', valor: '20V 2.0Ah', verificado: true }] }),
  prod(12, 'Taladro MarcaEjemplo de 13 mm 550 W', 125000, { ficha: [{ etiqueta: 'Potencia', valor: '550 W', verificado: true }], fotos: [] }),
  prod(13, 'Taladro magnético MarcaEjemplo de 28 mm', 1900000, { etiquetas: ['metalmecánica', 'estructuras metálicas'] }),
  prod(14, 'Taladro magnético MarcaEjemplo de 40 mm 1200W', 2300000, { etiquetas: ['metalmecánica', 'estructuras metálicas'] }),
  prod(15, 'Taladro magnético MarcaEjemplo TLM de 32 mm', 2100000, { etiquetas: ['metalmecánica'] }),
  prod(16, 'Rotomartillo MarcaEjemplo SDS-Plus 26 mm', 345000, { etiquetas: ['taladro percutor', 'concreto'] }),
  prod(17, 'Pulidora angular MarcaEjemplo 4-1/2" 720 W', 133000),
];
const fotos = (e: EscenarioPublico) => e.chatwoot.fotos;
const codigosPublicados = (e: EscenarioPublico) => [...new Set([...publico(e).matchAll(/MP-\d+/g)].map((m) => m[0]))];
/** Los textos que publicó el bot (sin el aviso de demora), en orden. */
const respuestas = (e: EscenarioPublico) => e.chatwoot.publicados.map((x) => x.salida.texto).filter((t) => !/tomando un poco más/.test(t));
/** Ningún mensaje del bot trae dos preguntas. */
const unaPregunta = (e: EscenarioPublico): Veredicto => {
  const dos = respuestas(e).find((t) => (t.match(/\?/g) ?? []).length > 1);
  return dos ? no(`dos preguntas en un mensaje: «${dos.slice(0, 120)}»`) : ok('una pregunta por mensaje');
};
const sinAvisoDemora = (e: EscenarioPublico): Veredicto => (publico(e).includes('tomando un poco más') ? no('salió el aviso de demora') : ok('sin aviso de demora'));
const sinPromesaDeFoto = (e: EscenarioPublico): Veredicto => noContiene(e, /el sistema te (env[ií]a|manda)|si ya la recibiste/i);
/** El modelo tarda `ms` en cada llamado (un turno normal de ventas, 7-13 s en Messenger). */
const lento = (m: Modelo, ms: number): Modelo => ({ async llamar(p) { await new Promise((r) => setTimeout(r, ms)); return m.llamar(p); } });

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
  // ── Venta consultiva (Mauricio, 29-oct): pregunta de uso, máximo 3 sugerencias y fotos ──
  {
    id: 'v-consultiva-pregunta-uso', conjunto: 'ventas', titulo: '«Quiero un taladro»: el catálogo no devuelve lista; UNA pregunta, por el tipo (de mano o magnético), sin productos ni fotos',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'Hola, quiero un taladro' }],
    guion: [VC({ buscar: 'taladro' }), R('¡Claro! ¿Lo buscas de mano o magnético, para perforar estructura metálica?', 'producto')],
    esperado: (e) => {
      const h = e.almacen.trazas().flatMap((t) => t.herramientas ?? []).find((x) => x.nombre === 'ver_catalogo');
      const d = h?.datos as { productos?: unknown[]; preguntar_uso?: boolean; tipos?: string[]; pregunta?: string } | undefined;
      return todos(
        d?.preguntar_uso === true && d.productos?.length === 0 ? ok('ver_catalogo pide preguntar el uso, sin productos') : no(`ver_catalogo devolvió ${JSON.stringify(d).slice(0, 120)}`),
        d?.tipos?.includes('Taladro magnético') ? ok('trae los tipos') : no('sin los tipos'),
        /de mano o magnético/.test(d?.pregunta ?? '') ? ok('trae la pregunta por el tipo') : no(`pregunta: ${d?.pregunta}`),
        codigosPublicados(e).length === 0 ? ok('no listó productos') : no(`listó ${codigosPublicados(e).join(', ')}`),
        fotos(e).length === 0 ? ok('sin fotos') : no('mandó fotos'), contiene(e, /de mano/i), unaPregunta(e), sinPersona(e),
      );
    },
  },
  {
    id: 'v-consultiva-metal-de-cable', conjunto: 'ventas', titulo: '«Para metal y de cable» (Messenger 29-oct): solo el de mano; ni magnéticos de $2 M ni relleno hasta 3',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'Hola, quiero un taladro' }, { escribe: 'Es para metal y prefiero cable' }],
    guion: [
      VC({ buscar: 'taladro' }), R('¡Claro! ¿Lo buscas de mano o magnético, para perforar estructura metálica?', 'producto'),
      VC({ buscar: 'taladro', uso: 'metal, de cable' }), R('Para metal y de cable te sirve este:\nMP-12 Taladro de 13 mm, $125.000: de mano, 550 W, para uso general.\n¿Te sirve?', 'producto'),
    ],
    esperado: (e) => {
      const hs = e.almacen.trazas().flatMap((t) => t.herramientas ?? []).filter((x) => x.nombre === 'ver_catalogo');
      const cods = hs.flatMap((h) => ((h.datos as { productos?: Array<{ codigo: string }> } | undefined)?.productos ?? []).map((p) => p.codigo));
      return todos(
        !cods.some((c) => ['MP-13', 'MP-14', 'MP-15', 'MP-16'].includes(c)) ? ok(`catálogo: ${cods.join(', ') || '—'}`) : no(`el catálogo devolvió ${cods.join(', ')}`),
        noContiene(e, /MP-1[3-6]/), contiene(e, 'MP-12'), unaPregunta(e),
        // MP-12 no tiene foto: ninguna sale.
        fotos(e).length === 0 ? ok('sin fotos') : no(`fotos: ${fotos(e).map((f) => f.texto).join(' | ')}`),
      );
    },
  },
  {
    id: 'v-consultiva-sugiere-con-fotos', conjunto: 'ventas', titulo: '«Taladro para estructura metálica»: los magnéticos, máximo 3, con una foto por producto y la razón sin muletilla',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'Necesito un taladro para perforar estructura metálica' }],
    guion: [
      VC({ buscar: 'taladro', uso: 'estructura metálica' }),
      R('Te sirven estos:\nMP-13 Taladro magnético 28 mm, $1.900.000: magnético, se fija a la estructura.\nMP-14 Taladro magnético 40 mm, $2.300.000: perfora más grueso.\nMP-15 Taladro magnético 32 mm, $2.100.000: intermedio.\n¿Cuál te sirve más?', 'producto'),
    ],
    esperado: (e) => {
      const h = e.almacen.trazas().flatMap((t) => t.herramientas ?? []).find((x) => x.nombre === 'ver_catalogo');
      const cods = ((h?.datos as { productos?: Array<{ codigo: string }> } | undefined)?.productos ?? []).map((p) => p.codigo);
      const muletilla = (publico(e).match(/según el catálogo del fabricante/gi) ?? []).length;
      return todos(
        cods.length > 0 && cods.every((c) => ['MP-13', 'MP-14', 'MP-15'].includes(c)) ? ok(`catálogo: ${cods.join(', ')}`) : no(`catálogo devolvió ${cods.join(', ')}`),
        codigosPublicados(e).length <= 3 ? ok('≤ 3 productos en la respuesta') : no(`${codigosPublicados(e).length} productos en la respuesta`),
        fotos(e).length > 0 && fotos(e).length === codigosPublicados(e).length ? ok('una foto por producto nombrado') : no(`fotos: ${fotos(e).map((f) => f.texto).join(' | ')}`),
        fotos(e).every((f) => f.url.includes('/ferreteria-fotos/')) ? ok('URLs del catálogo') : no('una foto fuera del catálogo'),
        muletilla <= 1 ? ok('«según el catálogo del fabricante» a lo sumo una vez') : no(`«según el catálogo del fabricante» ×${muletilla}`),
        unaPregunta(e),
      );
    },
  },
  {
    id: 'v-saludo-tras-pausa', conjunto: 'ventas', titulo: '«Hola» dos horas después de hablar de taladros (Messenger 29-oct): saluda y pregunta qué busca, sin suponer el producto',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }, { escribe: 'Hola', despuesMs: 2 * 3600 * 1000 }],
    guion: [VC({ codigo: 'MP-12' }), R('El MP-12 Taladro de 13 mm vale $125.000. ¿Te sirve?', 'precio'), R('¡Hola! ¿Qué estás buscando hoy?', 'saludo')],
    esperado: (e) => {
      const ultimo = respuestas(e).at(-1) ?? '';
      return todos(
        !/de nuevo/i.test(ultimo) ? ok('no dice «de nuevo»') : no(`dijo: ${ultimo}`),
        !/taladro|rotomartillo|MP-\d+|concreto|inal[aá]mbrico/i.test(ultimo) ? ok('no supone el producto') : no(`supuso el producto: ${ultimo}`),
        (ultimo.match(/\?/g) ?? []).length === 1 ? ok('una pregunta') : no(`preguntas en «${ultimo}»`),
      );
    },
  },
  {
    id: 'v-foto-no-hay', conjunto: 'ventas', titulo: '«¿Tienes foto?» de un producto sin foto: dice que no tiene; nunca «el sistema te envía»',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }, { escribe: 'Tienes foto?' }],
    guion: [VC({ codigo: 'MP-12' }), R('El MP-12 Taladro de 13 mm vale $125.000. ¿Te sirve?', 'precio'), R('Del MP-12 no tengo foto por ahora. Es de mano, 550 W. ¿Te sirve?', 'producto')],
    esperado: (e) => todos(fotos(e).length === 0 ? ok('sin fotos') : no('mandó foto'), contiene(e, /no tengo foto/i), sinPromesaDeFoto(e), sinPersona(e)),
  },
  {
    id: 'v-foto-reenvia', conjunto: 'ventas', titulo: '«¿Tienes foto?» de un producto con foto ya enviada: la reenvía, aunque no vuelva a leer el catálogo',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuánto vale el MP-13?' }, { escribe: 'Tienes foto?' }],
    guion: [VC({ codigo: 'MP-13' }), R('El MP-13 Taladro magnético de 28 mm vale $1.900.000. ¿Te sirve?', 'precio'), R('Claro, aquí está el MP-13.', 'producto')],
    esperado: (e) => todos(
      fotos(e).length === 2 && fotos(e).every((f) => f.texto.startsWith('MP-13')) ? ok('2 fotos del MP-13: la primera y la pedida') : no(`fotos: ${fotos(e).map((f) => f.texto).join(' | ')}`),
      sinPromesaDeFoto(e),
    ),
  },
  {
    id: 'v-sin-aviso-turno-normal', conjunto: 'ventas', titulo: 'Un turno normal de ventas (el modelo tarda) no saca el aviso de demora con los cortes de ventas',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    // Los cortes de ventas a escala 1:50 (20 s → 400 ms) y un modelo de «12 s» (240 ms por llamado). Con los de Sabor
    // (5 s → 100 ms) el aviso saldría.
    config: { corte1Ms: CORTES_VENTAS.corte1Ms / 50, corteTotalMs: CORTES_VENTAS.corteTotalMs / 50 },
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }],
    guion: [VC({ codigo: 'MP-12' }), R('El MP-12 Taladro de 13 mm vale $125.000. ¿Te sirve?', 'precio')],
    envolver: (m) => lento(m, 120),
    esperado: (e) => todos(sinAvisoDemora(e), contiene(e, 'MP-12'), e.almacen.trazas().some((t) => t.demora) ? no('marcado con demora') : ok('sin demora')),
  },
  {
    id: 'v-consultiva-sin-foto', conjunto: 'ventas', titulo: 'Producto sin foto: solo el texto',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }],
    guion: [VC({ codigo: 'MP-12' }), R('El MP-12 Taladro 13 mm vale $125.000: 550 W. ¿Te sirve?', 'precio')],
    esperado: (e) => todos(contiene(e, 'MP-12'), fotos(e).length === 0 ? ok('sin fotos') : no('mandó foto'), e.almacen.trazas().some((t) => t.fotos?.length) ? no('anotó fotos') : ok('sin fotos en la traza')),
  },
  {
    id: 'v-consultiva-foto-falla', conjunto: 'ventas', titulo: 'La foto falla al bajarla o subirla: el texto sale igual y la traza lo anota',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ hacer: (e) => { e.chatwoot.fotosQueFallan.add(FOTO('EJ-13')); } }, { escribe: 'muéstrame el MP-13' }],
    guion: [VC({ codigo: 'MP-13' }), R('Este es el MP-13 Taladro magnético 28 mm, a $1.900.000. ¿Te sirve?', 'producto')],
    esperado: (e) => {
      const f = e.almacen.trazas().flatMap((t) => t.fotos ?? []);
      // El texto con el código (la redacción la escoge el modelo: «Este es…», «Claro, aquí está…»).
      return todos(contiene(e, 'MP-13'), fotos(e).length === 0 ? ok('ninguna foto publicada') : no('publicó la foto'),
        f.length === 1 && !f[0].ok && f[0].codigo === 'MP-13' ? ok('traza: foto fallida') : no(`traza: ${JSON.stringify(f)}`), sinPersona(e));
    },
  },
  {
    id: 'v-consultiva-mas-de-3', conjunto: 'ventas', titulo: 'La respuesta nombra 4 productos: la guarda la devuelve y sale la de 3',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'taladro magnético para estructura' }],
    guion: [
      // Lee 4 productos en dos búsquedas del mismo llamado (el verificador ya ataja un código que no leyó; el tope es de
      // 3 llamados por turno): lo que ataja aquí es la guarda de las 3.
      { varias: [VC({ buscar: 'taladro magnético', uso: 'estructura' }), VC({ codigo: 'MP-16' })] },
      R('Tengo MP-13, MP-14, MP-15 y MP-16. ¿Cuál te sirve más?', 'producto'),
      R('Te sirven MP-13 (28 mm), MP-14 (40 mm) y MP-15 (32 mm). ¿Cuál te sirve más?', 'producto'),
    ],
    esperado: (e) => todos(
      codigosPublicados(e).length === 3 ? ok('salieron 3') : no(`salieron ${codigosPublicados(e).join(', ')}`), noContiene(e, 'MP-16'),
      fotos(e).length === 3 ? ok('3 fotos') : no(`${fotos(e).length} fotos`),
    ),
  },
  {
    id: 'v-consultiva-foto-no-se-repite', conjunto: 'ventas', titulo: 'La foto de un producto no se repite en la conversación, salvo que pida verla',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    // La segunda pregunta se contesta con el nombre (con Haiku real, «¿qué capacidad tiene?» a veces pasa a persona por
    // duda_abierta y la conversación queda con el equipo: el caso no medía eso).
    pasos: [{ escribe: '¿cuánto vale el MP-13?' }, { escribe: '¿y el MP-13 es magnético?' }, { escribe: 'mándame la foto del MP-13 otra vez' }],
    guion: [
      VC({ codigo: 'MP-13' }), R('El MP-13 vale $1.900.000.', 'precio'),
      VC({ codigo: 'MP-13' }), R('Sí, el MP-13 es un taladro magnético de 28 mm.', 'especificaciones'),
      VC({ codigo: 'MP-13' }), R('Claro, este es el MP-13.', 'producto'),
    ],
    esperado: (e) => (fotos(e).length === 2 ? ok('2 fotos: la primera y la pedida') : no(`${fotos(e).length} fotos`)),
  },
  // ── Messenger por Chatwoot (30-oct, en vivo): el botón tocado llega como TEXTO con su título, sin el id ──
  {
    id: 'v-messenger-toque-como-texto', conjunto: 'ventas', titulo: 'Messenger: «Sí, enviar link» llega como texto (respuesta rápida): confirma el pedido y sale el link',
    canal: 'otro', ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos.slice(0, 2), { escribe: 'Sí' }, HASTA_RESUMEN.pasos[3], { escribe: 'Sí, enviar link' }],
    guion: HASTA_RESUMEN.guion,
    esperado: (e) => todos(links(e, 1), contiene(e, 'https://checkout.bold.co/LNK_PRUEBA1'), contiene(e, 'Total: $265.000'), noContiene(e, 'sigue esperando tu toque')),
  },
  {
    id: 'v-messenger-toque-variantes', conjunto: 'ventas', titulo: 'Messenger: el título con otras mayúsculas, sin tilde y con signos también es el toque; un solo link aunque lo escriba dos veces',
    canal: 'otro', ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos.slice(0, 2), { escribe: 'Sí' }, HASTA_RESUMEN.pasos[3], { escribe: '  si,  ENVIAR link!! ' }, { escribe: 'Sí, enviar link' }],
    guion: HASTA_RESUMEN.guion,
    esperado: (e) => todos(links(e, 1), contiene(e, 'https://checkout.bold.co/LNK_PRUEBA1'), noContiene(e, 'LNK_PRUEBA2')),
  },
  {
    id: 'v-messenger-corregir-como-texto', conjunto: 'ventas', titulo: 'Messenger: «Corregir» como texto es el «no» de la propuesta: no hay link y pregunta qué corrige',
    canal: 'otro', ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos.slice(0, 2), { escribe: 'Sí' }, HASTA_RESUMEN.pasos[3], { escribe: 'Corregir' }],
    guion: HASTA_RESUMEN.guion,
    esperado: (e) => todos(links(e, 0), contiene(e, 'Dale, dime qué corrijo.')),
  },
  {
    id: 'v-botones-del-modelo-chocan', conjunto: 'ventas', titulo: 'El modelo no puede sacar sus propios «Sí, enviar link / Corregir» con el pedido vigente: esos botones se quitan',
    canal: 'otro', ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos.slice(0, 2), { escribe: 'Sí' }, HASTA_RESUMEN.pasos[3], { escribe: '¿y el flete cuánto es?' }],
    guion: [...HASTA_RESUMEN.guion, { name: 'responder', args: { tema: 'compra', texto: 'El flete ya va incluido en el total del resumen.', opciones: ['Sí, enviar link', 'Corregir'] } }],
    esperado: (e) => {
      const ultimo = e.chatwoot.publicados.at(-1)?.salida;
      const ops = ultimo && 'opciones' in ultimo ? ultimo.opciones : [];
      return todos(
        ops.every((o) => !o.id.startsWith('ag|c|')) ? ok('sin botones del modelo que copian la propuesta') : no(`botones del modelo: ${ops.map((o) => o.titulo).join(' | ')}`),
        e.almacen.trazas().some((t) => t.candados?.some((c) => c.candado === 'botones_de_la_propuesta')) ? ok('candado anotado') : no('sin candado'),
      );
    },
  },
  {
    id: 'v-link-sin-compra', conjunto: 'ventas', titulo: 'Pide el link sin compra confirmada: no hay link',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [{ escribe: 'mándame el link de pago del taladro' }],
    guion: [REENVIAR, R('Primero armamos tu pedido. ¿Lo quieres con despacho en Bogotá o lo recoges?', 'compra')],
    esperado: (e) => todos(links(e, 0), noContiene(e, /LNK_/), sinPersona(e)),
  },
];
