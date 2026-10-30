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
import { codigosEnTexto } from '../ventas/catalogo-ventas.ts';
import { CLAVE_COMPLEMENTOS, fichaComplementos } from '../ventas/complementos-ventas.ts';
import type { Veredicto } from './calificar.ts';
import type { CasoPublico, PasoCaso } from './conjuntos.ts';
import type { Paso } from '../../modelo-guionado.ts';
import type { Ficha, Modelo } from '../../tipos.ts';

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

/** Lo que salió al cliente en orden (textos y fotos por su id de Chatwoot): `T:<texto>` o `F:<código>`. */
const envios = (e: EscenarioPublico, catalogo: ProductoVenta[]) => [
  ...e.chatwoot.publicados.map((x) => ({ id: x.id, s: `T:${x.salida.texto}` })),
  ...e.chatwoot.fotos.map((x) => ({ id: x.id, s: `F:${catalogo.find((p) => p.fotos?.includes(x.url))?.codigo ?? x.url}` })),
].sort((a, b) => a.id - b.id).map((x) => x.s).filter((x) => !/tomando un poco más/.test(x));
/**
 * Cada foto sale JUSTO después de un texto que nombra su código, sin pie, y ningún texto nombra dos productos cuando hubo
 * fotos (el cliente sabe cuál es cuál). Ronda 3 (Mauricio, 30-oct).
 */
const intercalado = (e: EscenarioPublico, catalogo: ProductoVenta[]): Veredicto => {
  const xs = envios(e, catalogo);
  for (const [i, x] of xs.entries()) {
    if (!x.startsWith('F:')) continue;
    const antes = xs[i - 1] ?? '';
    if (!antes.startsWith('T:') || !antes.includes(x.slice(2))) return no(`la foto de ${x.slice(2)} no va justo después de su texto: ${xs.map((y) => y.slice(0, 40)).join(' → ')}`);
  }
  if (e.chatwoot.fotos.some((f) => f.texto)) return no('una foto salió con pie aunque su texto iba justo antes');
  return ok(`intercalado: ${xs.map((y) => (y.startsWith('F:') ? y : y.slice(0, 18))).join(' → ')}`);
};
const llamadas = (e: EscenarioPublico, nombre: string) => e.almacen.trazas().flatMap((t) => t.herramientas ?? []).filter((h) => h.nombre === nombre);
const propuestas = (e: EscenarioPublico) => e.almacen.trazas().map((t) => t.propuesta).filter((p): p is NonNullable<typeof p> => !!p);
/** Ningún mensaje del bot vuelve a pedir un dato que ya le dieron, ni pide «confirmar la dirección» (el resumen lo es). */
const sinPedirConfirmar = (e: EscenarioPublico): Veredicto => noContiene(e, /confirmas? (la|tu) direcci[oó]n|direcci[oó]n (exacta|tal como)/i);

/** Catálogo de la venta cruzada: el de la consultiva + una caja de herramientas (complemento publicado). */
export const PRODUCTOS_CRUZADA: ProductoVenta[] = [
  ...PRODUCTOS_CONSULTIVA,
  prod(18, 'Caja de herramientas MarcaEjemplo de 19 pulgadas', 89000, { categoria: 'Almacenamiento' }),
];
/** Mapa mínimo de ejemplo: MP-12 → MP-18 (publicado) y MP-99 (no está publicado: se ignora). */
const conMapa = (mapa: Record<string, Array<{ codigo: string; razon: string }>>) => (fs: Ficha[]) =>
  fs.filter((f) => f.clave !== CLAVE_COMPLEMENTOS).concat(fichaComplementos(mapa, 'mapa de ejemplo del arnés'));
const MAPA_EJEMPLO = { 'MP-12': [{ codigo: 'MP-99', razon: 'no publicado' }, { codigo: 'MP-18', razon: 'para guardar el taladro, las brocas y el cargador' }] };
/** Veces que el bot ofreció algo más (el complemento por su código o la pregunta abierta). */
const ofertas = (e: EscenarioPublico, codigo: string) => respuestas(e).filter((t) => t.includes(codigo) || /algo m[aá]s/i.test(t)).length;

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
    // Con Haiku real, antes de la autorización puede venir la venta cruzada (ronda 3): «No, nada más» la cierra.
    { hastaAutorizacion: ['Sí, uno, con despacho en Bogotá', 'No, nada más, solo el taladro', 'Sí, lo quiero, uno, con despacho en Bogotá'] },
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
    id: 'v-consultiva-sugiere-con-fotos', conjunto: 'ventas', titulo: '«Taladro para estructura metálica»: los magnéticos, uno o dos, con una foto por producto y la razón sin muletilla',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'Necesito un taladro para perforar estructura metálica' }],
    guion: [
      VC({ buscar: 'taladro', uso: 'estructura metálica' }),
      R('Para estructura te recomiendo:\nMP-13 Taladro magnético 28 mm, $1.900.000: magnético, se fija a la estructura.\nMP-14 Taladro magnético 40 mm, $2.300.000: perfora más grueso.\n¿Cuál te sirve más?', 'producto'),
    ],
    esperado: (e) => {
      const h = e.almacen.trazas().flatMap((t) => t.herramientas ?? []).find((x) => x.nombre === 'ver_catalogo');
      const cods = ((h?.datos as { productos?: Array<{ codigo: string }> } | undefined)?.productos ?? []).map((p) => p.codigo);
      const muletilla = (publico(e).match(/según el catálogo del fabricante/gi) ?? []).length;
      return todos(
        cods.length > 0 && cods.every((c) => ['MP-13', 'MP-14', 'MP-15'].includes(c)) ? ok(`catálogo: ${cods.join(', ')}`) : no(`catálogo devolvió ${cods.join(', ')}`),
        cods.length <= 2 ? ok('el catálogo recomienda uno o dos') : no(`el catálogo devolvió ${cods.length}`),
        codigosPublicados(e).length <= 2 ? ok('≤ 2 productos en la respuesta') : no(`${codigosPublicados(e).length} productos en la respuesta`),
        fotos(e).length > 0 && fotos(e).length === codigosPublicados(e).length ? ok('una foto por producto nombrado') : no(`fotos: ${fotos(e).map((f) => f.texto).join(' | ')}`),
        fotos(e).every((f) => f.url.includes('/ferreteria-fotos/')) ? ok('URLs del catálogo') : no('una foto fuera del catálogo'),
        muletilla <= 1 ? ok('«según el catálogo del fabricante» a lo sumo una vez') : no(`«según el catálogo del fabricante» ×${muletilla}`),
        unaPregunta(e),
      );
    },
  },
  {
    id: 'v-preguntas-primero', conjunto: 'ventas', titulo: '«Taladro para la casa, económico» (Messenger 30-oct): primero cable o inalámbrico, sin productos; la pregunta hecha no se repite',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'Busco un taladro para la casa, algo económico' }, { escribe: 'me da igual' }, { escribe: 'hasta 200 mil' }],
    guion: [
      VC({ buscar: 'taladro', uso: 'hogar, económico' }),
      R('¿Lo prefieres con cable o inalámbrico?', 'producto'),
      // El modelo no pasa `energia`: el código no repite la pregunta y sigue con el presupuesto.
      VC({ buscar: 'taladro', uso: 'hogar, económico' }),
      R('¿Tienes un tope de presupuesto para esto?', 'producto'),
      VC({ buscar: 'taladro', uso: 'hogar, económico', energia: 'cualquiera', presupuesto: 200000 }),
      R('Para la casa te recomiendo:\nMP-12 Taladro 13 mm, $125.000: 550 W, para tareas sencillas.\n¿Te sirve?', 'producto'),
    ],
    esperado: (e) => {
      const vc = e.almacen.trazas().flatMap((t) => t.herramientas ?? []).filter((x) => x.nombre === 'ver_catalogo').map((x) => x.datos as { falta?: string; productos?: Array<{ codigo: string }> });
      return todos(
        vc[0]?.falta === 'energia' && !vc[0].productos?.length ? ok('1.ª: cable o inalámbrico, sin productos') : no(`1.ª: ${JSON.stringify(vc[0]).slice(0, 120)}`),
        vc[1]?.falta === 'presupuesto' ? ok('2.ª: el presupuesto (no repite la de cable)') : no(`2.ª: ${JSON.stringify(vc[1]).slice(0, 120)}`),
        vc[2]?.productos?.map((p) => p.codigo).join() === 'MP-12' ? ok('3.ª: el que cabe en 200 mil') : no(`3.ª: ${JSON.stringify(vc[2]).slice(0, 160)}`),
        respuestas(e).slice(0, 2).every((t) => !/MP-\d+/.test(t)) ? ok('las preguntas sin productos') : no(`respuestas: ${respuestas(e).join(' | ')}`),
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
      fotos(e).length === 2 && fotos(e).every((f) => f.url === FOTO('EJ-13')) ? ok('2 fotos del MP-13: la primera y la pedida') : no(`fotos: ${fotos(e).map((f) => f.url).join(' | ')}`),
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
    soloSeco: true,
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'taladro magnético para estructura' }],
    guion: [
      // Lee 4 productos en dos búsquedas del mismo llamado (el verificador ya ataja un código que no leyó; el tope es de
      // 3 llamados por turno): lo que ataja aquí es la guarda de las 3.
      { varias: [VC({ buscar: 'taladro magnético', uso: 'estructura' }), VC({ codigo: 'MP-15' }), VC({ codigo: 'MP-16' })] },
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
      // Ningún mensaje del bot trae botones de conversación con los títulos de la propuesta. En seco el guion los manda y
      // el candado los quita; Haiku real casi nunca los manda (entonces no hay candado y está bien).
      const copias = e.chatwoot.publicados.flatMap((x) => ('opciones' in x.salida ? x.salida.opciones : []))
        .filter((o) => o.id.startsWith('ag|c|') && /^(s[ií], enviar link|corregir)$/i.test(o.titulo.trim()));
      return copias.length ? no(`botones del modelo: ${copias.map((o) => o.titulo).join(' | ')}`) : ok('sin botones del modelo que copian la propuesta');
    },
  },
  // ── Ronda 3 (Mauricio, 30-oct): cada producto con su foto, la dirección, el «sí» escrito, el tope y la venta cruzada ──
  {
    id: 'v-r3-intercalado', conjunto: 'ventas', titulo: '«Algo para la casa»: cada producto en su mensaje y su foto justo después; el que no tiene foto, solo texto; la pregunta al final',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: 'Vi que tienen publicado un taladro. Estoy buscando algo para la casa.' }],
    guion: [
      { varias: [VC({ codigo: 'MP-11' }), VC({ codigo: 'MP-12' }), VC({ codigo: 'MP-16' })] },
      // El texto real del 30-oct: un solo párrafo, sin saltos de línea.
      R('Para la casa te sugiero estos: MP-12 Taladro de 13 mm, 550 W, $125.000. Es de mano y sirve para uso general. MP-11 Taladro percutor inalámbrico 20V, $320.000. Es inalámbrico, con batería. MP-16 Rotomartillo SDS-Plus 26 mm, $345.000. Es para perforar concreto. ¿Cuál te sirve más?', 'producto'),
    ],
    esperado: (e) => {
      const xs = envios(e, PRODUCTOS_CONSULTIVA);
      const nombrados = codigosPublicados(e);
      return todos(
        intercalado(e, PRODUCTOS_CONSULTIVA),
        // Con más de un producto y alguna foto, cada producto en su propio mensaje.
        nombrados.length < 2 || !e.chatwoot.fotos.length || respuestas(e).every((t) => codigosEnTexto(t).length <= 1) ? ok('un producto por mensaje') : no(`un mensaje nombra varios: ${respuestas(e).find((t) => codigosEnTexto(t).length > 1)?.slice(0, 120)}`),
        // La pregunta de cierre, si salió aparte, va de última.
        !xs.length || xs.at(-1)!.startsWith('T:') ? ok('cierra con texto') : no('lo último fue una foto'),
        unaPregunta(e),
      );
    },
  },
  {
    // SOLO SECO: el guion fuerza el texto mezclado; con Haiku real el texto es otro y el caso no aplica.
    id: 'v-r3-formato-roto', conjunto: 'ventas', titulo: 'El texto mezcla productos («el MP-11 es mejor que el MP-13»): sale entero y las fotos con su pie, sin perder nada',
    soloSeco: true,
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuál es mejor, el MP-11 o el MP-13?' }],
    guion: [{ varias: [VC({ codigo: 'MP-11' }), VC({ codigo: 'MP-13' })] }, R('El MP-11 es mejor que el MP-13 para la casa: el MP-13 es magnético, para estructura. ¿Te sirve el MP-11?', 'producto')],
    // Solo seco: el guion fuerza el formato roto (con Haiku real el texto es otro).
    esperado: (e) => {
      const xs = envios(e, PRODUCTOS_CONSULTIVA);
      return todos(
        e.chatwoot.publicados.filter((x) => !/tomando/.test(x.salida.texto)).length === 1 ? ok('un solo texto') : no(`${e.chatwoot.publicados.length} textos`),
        e.chatwoot.fotos.length === 2 && e.chatwoot.fotos.every((f) => /^MP-1[13] · /.test(f.texto)) ? ok('2 fotos con su pie') : no(`fotos: ${e.chatwoot.fotos.map((f) => f.texto).join(' | ')}`),
        xs[0]?.startsWith('T:') ? ok('el texto primero') : no('una foto antes del texto'),
      );
    },
  },
  {
    id: 'v-r3-foto-falla-en-medio', conjunto: 'ventas', titulo: 'Tres productos, la foto del segundo falla al subir: los textos salen todos y en orden, la traza la anota',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ hacer: (e) => { e.chatwoot.fotosQueFallan.add(FOTO('EJ-14')); } }, { escribe: 'taladro para estructura metálica' }],
    guion: [
      // Tres leídos por código (la recomendación da dos como mucho; aquí se mide el envío de tres).
      { varias: [VC({ codigo: 'MP-13' }), VC({ codigo: 'MP-14' }), VC({ codigo: 'MP-15' })] },
      R('Te sirven estos:\nMP-13 Taladro magnético 28 mm, $1.900.000: se fija a la estructura.\nMP-14 Taladro magnético 40 mm, $2.300.000: perfora más grueso.\nMP-15 Taladro magnético 32 mm, $2.100.000: intermedio.\n¿Cuál te sirve más?', 'producto'),
    ],
    esperado: (e) => {
      const xs = envios(e, PRODUCTOS_CONSULTIVA);
      const f = e.almacen.trazas().flatMap((t) => t.fotos ?? []);
      const ranuras = e.almacen.filas.filter((x) => x.direccion === 'saliente' && x.turno_id).map((x) => `${x.turno_id}|${x.ranura}`);
      return todos(
        // Cada texto de producto va seguido de su foto, menos el del MP-14 (la que falló); los tres textos salen; cierra
        // con texto. El orden de los productos lo escoge el modelo (con Haiku real cambia).
        // Con el modelo real nombra uno o dos (MAX_RECOMENDADOS); con el guion, los tres.
        xs.some((x) => x.startsWith('T:MP-14')) && xs.filter((x) => /^T:MP-1[345]/.test(x)).length >= 2
          && xs.every((x, i) => !/^T:MP-1[35]/.test(x) || xs[i + 1] === `F:${x.slice(2, 7)}`)
          && !xs.includes('F:MP-14') && xs.at(-1)!.startsWith('T:') ? ok('orden: cada texto con su foto; el MP-14 sin foto') : no(`orden: ${xs.map((x) => x.slice(0, 9)).join(' → ')}`),
        f.find((x) => x.codigo === 'MP-14' && !x.ok) ? ok('traza: la foto del MP-14 falló') : no(`traza: ${JSON.stringify(f)}`),
        new Set(ranuras).size === ranuras.length ? ok('una ranura por envío') : no('ranuras repetidas'),
      );
    },
  },
  {
    id: 'v-r3-un-producto', conjunto: 'ventas', titulo: 'Un solo producto con foto: su texto, su foto y la pregunta (aparte, después de la foto)',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuánto vale el MP-13?' }],
    guion: [VC({ codigo: 'MP-13' }), R('El MP-13 Taladro magnético de 28 mm vale $1.900.000: se fija a la estructura. ¿Te sirve?', 'precio')],
    esperado: (e) => {
      const xs = envios(e, PRODUCTOS_CONSULTIVA);
      return todos(intercalado(e, PRODUCTOS_CONSULTIVA), xs.some((x) => x === 'F:MP-13') ? ok('salió la foto') : no('sin foto'), xs.at(-1)?.startsWith('T:') ? ok('la pregunta al final') : no(`orden: ${xs.join(' → ')}`));
    },
  },
  {
    id: 'v-r3-no-repite', conjunto: 'ventas', titulo: '«Repite todo el tiempo la referencia»: tras presentarlo, el código y el nombre no vuelven; dato llano; lo que no está, a una persona (sin «lo dejamos anotado»)',
    ventas: { productos: PRODUCTOS_CONSULTIVA },
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }, { escribe: '¿Cuáles son las especificaciones de ese taladro?' }, { escribe: '¿Viene con accesorios?' }],
    guion: [
      VC({ codigo: 'MP-12' }), R('El MP-12 Taladro MarcaEjemplo de 13 mm vale $125.000. ¿Te sirve?', 'precio'),
      R('Tiene 550 W y mandril de 13 mm.', 'especificaciones'),
      R('Eso no lo tengo en la ficha. ¿Quieres que te pase con alguien del equipo para que te lo confirme?', 'especificaciones'),
    ],
    esperado: (e) => {
      const rs = respuestas(e);
      const despues = rs.slice(1);
      return todos(
        despues.every((t) => !/MP-12/.test(t)) ? ok('el código no vuelve') : no(`repite el código: ${despues.find((t) => /MP-12/.test(t))}`),
        despues.every((t) => !/Taladro MarcaEjemplo de 13 mm/i.test(t)) ? ok('el nombre completo no vuelve') : no('repite el nombre completo'),
        noContiene(e, /tengo verificado/i), noContiene(e, /(dejamos|dejo) anotado|lo anoto/i),
        // Si hablan de 550 W en el tercer mensaje, repitió las specs que ya dio.
        !/550/.test(rs[2] ?? '') ? ok('no repite las specs al hablar de accesorios') : no(`repite specs: ${rs[2]}`),
      );
    },
  },
  {
    id: 'v-r3-direccion-dos-mensajes', conjunto: 'ventas', titulo: 'La dirección en dos mensajes, con abreviaturas («Cl», «#», «bis») y el barrio aparte: proponer sale válido y se muestra el resumen',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [
      { escribe: 'Hola, ¿tienen taladro percutor?' },
      { hastaAutorizacion: ['Sí, ese, uno, con despacho en Bogotá', 'No, nada más, solo el taladro', 'Sí, lo quiero con despacho en Bogotá'] },
      { toca: 'Sí', oEscribe: 'Sí' },
      { escribe: 'Ana Pérez' }, { escribe: '3001234567' },
      { escribe: 'Cl 31 B bis # 98 12' },
      { escribe: 'Santa Lucía, Kennedy.\nCerca a la iglesia Santa Lucía.' },
    ],
    guion: [
      VC({ buscar: 'taladro percutor' }), R('Sí: MP-01 Taladro percutor 650 W, a $250.000. ¿Lo quieres?', 'producto'),
      FIJA('rf.autorizacion'),
      R('Perfecto. ¿Me das tu nombre completo?'), R('¿Y tu celular?'), R('¿Cuál es la dirección de entrega en Bogotá, con el barrio?'),
      // El modelo agrega «Bogotá» y «barrio» (como en vivo): ahora pasa.
      R('¿En qué barrio queda?'),
      PROPONER({ ...COMPRA, direccion: 'Cl 31 B bis # 98 12, barrio Santa Lucía, Kennedy, cerca a la iglesia Santa Lucía, Bogotá' }),
    ],
    esperado: (e) => {
      const ps = propuestas(e);
      const malos = llamadas(e, 'proponer').filter((h) => !h.ok).map((h) => String(h.error ?? ''));
      return todos(
        ps.length >= 1 && /98\s*-?\s*12/.test(String(ps.at(-1)!.datos.direccion ?? '')) ? ok(`propuesta con «${ps.at(-1)!.datos.direccion}»`) : no(`sin propuesta válida; errores: ${malos.join(' | ').slice(0, 300)}`),
        contiene(e, 'Revisa tu pedido:'), sinPedirConfirmar(e),
        // Después de la dirección no le vuelve a pedir la dirección.
        respuestas(e).filter((t) => /direcci[oó]n/i.test(t) && /\?/.test(t) && !/Autorizas/.test(t)).length <= 1 ? ok('la dirección se pidió una vez') : no('volvió a pedir la dirección'),
      );
    },
  },
  {
    id: 'v-r3-direccion-sin-barrio', conjunto: 'ventas', titulo: 'La dirección sola, sin barrio (y el modelo agrega «Bogotá»): proponer sale válido',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [
      { escribe: 'Hola, ¿tienen taladro percutor?' },
      { hastaAutorizacion: ['Sí, ese, uno, con despacho en Bogotá', 'No, nada más, solo el taladro', 'Sí, lo quiero con despacho en Bogotá'] },
      { toca: 'Sí', oEscribe: 'Sí' },
      { escribe: 'Ana Pérez, 3001234567, Cra 7 # 45-10 apto 301' },
    ],
    guion: [
      VC({ buscar: 'taladro percutor' }), R('Sí: MP-01 Taladro percutor 650 W, a $250.000. ¿Lo quieres?', 'producto'),
      FIJA('rf.autorizacion'),
      R('Perfecto. ¿Me das tu nombre, celular y la dirección de entrega?'),
      PROPONER({ ...COMPRA, direccion: 'Carrera 7 # 45-10 apartamento 301, Bogotá' }),
    ],
    esperado: (e) => todos(propuestas(e).length >= 1 ? ok('propuesta') : no(`sin propuesta: ${llamadas(e, 'proponer').map((h) => h.error).join(' | ').slice(0, 300)}`), sinPedirConfirmar(e)),
  },
  {
    // SOLO SECO: el guion fuerza los `datos` rotos; con Haiku real el caso no aplica.
    id: 'v-r3-datos-texto-roto', conjunto: 'ventas', titulo: '`datos` como texto con JSON roto: el error dice eso (no «el producto no es un código»); el tope pasa a persona sin pedir repetir',
    soloSeco: true,
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos.slice(0, 3), { escribe: 'Ana Pérez, 3001234567, Calle 1 # 2-3' }],
    guion: [
      ...HASTA_RESUMEN.guion.slice(0, 3),
      { name: 'proponer', args: { accion: 'compra', datos: "{\"producto\":\"MP-01\",'entrega':'bogota'}" } },
      { name: 'proponer', args: { accion: 'compra', datos: { celular: '3001234567', cantidad: 1 } } },
      { name: 'proponer', args: { accion: 'compra', datos: { celular: '3001234567', cantidad: 1 } } },
    ],
    // Solo seco: el guion fuerza los errores.
    esperado: (e) => {
      const errs = llamadas(e, 'proponer').map((h) => String(h.error ?? ''));
      return todos(
        /no es un objeto JSON/.test(errs[0] ?? '') ? ok('error de datos mal formados') : no(`error: ${errs[0]}`),
        /Faltan campos en `datos`: producto/.test(errs[1] ?? '') && /entrega/.test(errs[1] ?? '') && /nombre/.test(errs[1] ?? '') ? ok('dice qué falta') : no(`error: ${errs[1]}`),
        noContiene(e, /escribes de nuevo/i), persona(e, 'falla'), nota(e, 'no logré armar el pedido'),
      );
    },
  },
  {
    id: 'v-r3-si-escrito', conjunto: 'ventas', titulo: 'El cliente acepta el resumen con palabras («dale, mándalo»): confirmar_compra y sale el link; nunca «sigue esperando tu toque»',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [...HASTA_RESUMEN.pasos, { escribe: 'Dale, mándame el link' }],
    guion: [...HASTA_RESUMEN.guion, { name: 'confirmar_compra', args: {} }],
    esperado: (e) => todos(links(e, 1), contiene(e, 'https://checkout.bold.co/LNK_PRUEBA1'), noContiene(e, 'sigue esperando tu toque')),
  },
  {
    id: 'v-r3-si-escrito-sin-pedido', conjunto: 'ventas', titulo: 'confirmar_compra sin pedido esperando: el candado lo ataja y no hay link',
    ventas: { productos: PRODUCTOS_PRUEBA },
    pasos: [{ escribe: 'listo, mándame el link' }],
    guion: [{ name: 'confirmar_compra', args: {} }, R('Primero armamos tu pedido. ¿Qué producto quieres?', 'compra')],
    esperado: (e) => todos(links(e, 0), noContiene(e, /LNK_/)),
  },
  // Venta cruzada (Mauricio, 30-oct): una vez, del mapa, solo lo publicado.
  {
    id: 'v-r3-cruzada-aceptada', conjunto: 'ventas', titulo: 'Escoge el MP-12: ofrece el MP-18 del mapa (el MP-99 no está publicado) con su foto; acepta; una sola oferta',
    ventas: { productos: PRODUCTOS_CRUZADA }, fichas: conMapa(MAPA_EJEMPLO),
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }, { escribe: 'Listo, me lo llevo' }, { escribe: 'Sí, agrégala' }],
    guion: [
      VC({ codigo: 'MP-12' }), R('El MP-12 Taladro de 13 mm vale $125.000. ¿Te sirve?', 'precio'),
      { name: 'ver_complementos', args: { codigo: 'MP-12' } },
      R('¿Te sirve también esta?\nMP-18 Caja de herramientas de 19 pulgadas, $89.000: para guardar el taladro, las brocas y el cargador.\n¿La agrego?', 'compra'),
      R('Listo. Van en dos pedidos: primero el taladro. ¿Lo quieres con despacho en Bogotá o lo recoges?', 'compra'),
    ],
    esperado: (e) => {
      const vc = llamadas(e, 'ver_complementos').filter((h) => h.ok);
      const d = vc[0]?.datos as { complementos?: Array<{ codigo: string }> } | undefined;
      return todos(
        vc.length === 1 ? ok('ver_complementos una vez') : no(`ver_complementos ×${vc.length}`),
        d?.complementos?.map((c) => c.codigo).join(',') === 'MP-18' ? ok('solo el publicado (MP-18)') : no(`complementos: ${JSON.stringify(d?.complementos)}`),
        contiene(e, 'MP-18'), e.chatwoot.fotos.some((f) => f.url === FOTO('EJ-18')) ? ok('foto del complemento') : no('sin foto del MP-18'),
        intercalado(e, PRODUCTOS_CRUZADA), ofertas(e, 'MP-18') <= 2 ? ok('una oferta') : no(`ofertas: ${ofertas(e, 'MP-18')}`), noContiene(e, /aprovecha|últimas unidades|solo hoy/i),
      );
    },
  },
  {
    id: 'v-r3-cruzada-rechazada', conjunto: 'ventas', titulo: 'Rechaza el complemento: sigue con la compra sin insistir (no vuelve a ofrecer)',
    ventas: { productos: PRODUCTOS_CRUZADA }, fichas: conMapa(MAPA_EJEMPLO),
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }, { escribe: 'Listo, me lo llevo' }, { escribe: 'No, gracias' }, { escribe: 'Con despacho en Bogotá, uno' }],
    guion: [
      VC({ codigo: 'MP-12' }), R('El MP-12 Taladro de 13 mm vale $125.000. ¿Te sirve?', 'precio'),
      { name: 'ver_complementos', args: { codigo: 'MP-12' } },
      R('¿Te sirve también esta?\nMP-18 Caja de herramientas de 19 pulgadas, $89.000: para guardar el taladro.\n¿La agrego?', 'compra'),
      R('Listo. ¿Lo quieres con despacho en Bogotá o lo recoges?', 'compra'),
      FIJA('rf.autorizacion'),
    ],
    esperado: (e) => {
      const tras = respuestas(e).slice(respuestas(e).findIndex((t) => t.includes('MP-18')) + 1);
      return todos(
        tras.every((t) => !t.includes('MP-18') && !/algo m[aá]s/i.test(t)) ? ok('no insiste') : no(`insiste: ${tras.find((t) => t.includes('MP-18') || /algo m[aá]s/i.test(t))}`),
        llamadas(e, 'ver_complementos').filter((h) => h.ok && !(h.datos as { ya_ofrecido?: boolean }).ya_ofrecido).length <= 1 ? ok('una oferta') : no('dos ofertas'),
      );
    },
  },
  {
    id: 'v-r3-cruzada-ignorada', conjunto: 'ventas', titulo: 'Ignora la oferta y pregunta otra cosa: le contesta y no vuelve a ofrecer',
    ventas: { productos: PRODUCTOS_CRUZADA }, fichas: conMapa(MAPA_EJEMPLO),
    pasos: [{ escribe: '¿cuánto vale el MP-12?' }, { escribe: 'Listo, me lo llevo' }, { escribe: '¿Y hacen envíos en Bogotá?' }, { escribe: 'Perfecto, uno con despacho' }],
    guion: [
      VC({ codigo: 'MP-12' }), R('El MP-12 Taladro de 13 mm vale $125.000. ¿Te sirve?', 'precio'),
      { name: 'ver_complementos', args: { codigo: 'MP-12' } },
      R('¿Te sirve también esta?\nMP-18 Caja de herramientas de 19 pulgadas, $89.000: para guardar el taladro.\n¿La agrego?', 'compra'),
      { name: 'consultar_reglas', args: { clave: 'despacho_bogota' } }, R('Sí, hacemos despachos en Bogotá urbana. ¿Lo quieres con despacho?', 'politicas'),
      FIJA('rf.autorizacion'),
    ],
    esperado: (e) => {
      const tras = respuestas(e).slice(respuestas(e).findIndex((t) => t.includes('MP-18')) + 1);
      return tras.every((t) => !t.includes('MP-18') && !/algo m[aá]s/i.test(t)) ? ok('no vuelve a ofrecer') : no(`vuelve a ofrecer: ${tras.find((t) => t.includes('MP-18'))}`);
    },
  },
  {
    id: 'v-r3-cruzada-sin-mapa', conjunto: 'ventas', titulo: 'Sin complemento en el mapa: pregunta abierta «¿Necesitas algo más…?», una sola vez',
    ventas: { productos: PRODUCTOS_CRUZADA },
    pasos: [{ escribe: '¿cuánto vale el MP-13?' }, { escribe: 'Listo, me lo llevo' }, { escribe: 'No, solo eso' }],
    guion: [
      VC({ codigo: 'MP-13' }), R('El MP-13 Taladro magnético de 28 mm vale $1.900.000. ¿Te sirve?', 'precio'),
      { name: 'ver_complementos', args: { codigo: 'MP-13' } }, R('¿Necesitas algo más para ese trabajo?', 'compra'),
      R('Listo. ¿Lo quieres con despacho en Bogotá o lo recoges?', 'compra'),
    ],
    esperado: (e) => {
      const d = llamadas(e, 'ver_complementos')[0]?.datos as { complementos?: unknown[] } | undefined;
      return todos(
        d && d.complementos?.length === 0 ? ok('sin complementos') : no(`ver_complementos: ${JSON.stringify(d)}`),
        contiene(e, /algo m[aá]s/i), respuestas(e).filter((t) => /algo m[aá]s/i.test(t)).length === 1 ? ok('una vez') : no('pregunta más de una vez'),
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
