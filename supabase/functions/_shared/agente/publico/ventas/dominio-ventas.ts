// ============================================================
// Asistente público — el dominio de VENTAS (Dimpro, ensayo con conocidos del 29-oct)
// ------------------------------------------------------------
// El mismo asistente público (cola, consentimientos, candados, Chatwoot), con un producto que es un SKU del catálogo de
// Ferretería de ONE en vez de una experiencia. Se elige con `config_extra.bot_conversacional.chatwoot.dominio = 'ventas'`.
//
//   · `ver_catalogo`      lectura. Busca en ONE por texto libre («taladro», «bomba 1 HP») o por código MP-xx, con el
//                         `uso` del cliente si ya lo dijo. Venta consultiva (Mauricio, 29-oct): nunca más de 3 productos;
//                         con más coincidencias y sin uso devuelve `preguntar_uso` y los tipos, no una lista. Precio de
//                         la publicación activa; la ficha partida en verificado y «según el catálogo del fabricante».
//                         Las fotos de lo que la respuesta nombra las manda el código (`fotos-ventas.ts`, `cola.ts`).
//   · `consultar_reglas`  lectura. Las políticas `pol.*` del reglamento (despacho, recoger, pago, garantía…).
//   · `proponer` (acción `compra`). Exige la autorización `general`. El código arma el resumen con el TOTAL (precio ×
//     cantidad + flete de la tabla del reglamento) desde el catálogo y lo que el cliente escribió DESPUÉS del «sí»
//     (nombre, celular, dirección). Más de 3 unidades o una zona fuera de la tabla: no propone, manda a persona.
//   · confirmar la propuesta (toque o «sí», con su huella) = crear el link de pago con la pasarela del workspace y
//     guardarlo (`ferreteria_links_bold`). Una huella, un link: el «sí» repetido devuelve el mismo. Sin llaves, o si Bold
//     no lo crea: no hay link inventado; pasa a persona con `pago_no_disponible`.
//   · `generar_link_pago` cierre. Reenvía el link de la compra confirmada (lo crea si faltó). Sin compra confirmada, no.
//   · `verificar_pago`    cierre. Le pregunta a Bold por el link (`GET /online/link/v1/{id}`). Solo `PAID` confirma; la
//                         palabra del cliente no. Pagado: confirma y pasa a persona con `despachar` (una sola vez por link,
//                         compartida con el aviso del webhook).
//   · `pasar_a_persona`, `respuesta_fija` como en el dominio de experiencias, con los motivos de ventas.
// La venta en ONE NO la escribe el asistente: la registra el webhook de Bold del workspace (fuente única).
// ============================================================

import { RF_AUTORIZACION, estadoAutorizacion, salidaAutorizacion, textoFijo } from '../autorizacion.ts';
import { pesos } from '../catalogo.ts';
import {
  BOT_PUBLICO, PASAR_A_PERSONA, RESPUESTA_FIJA, RF_PERSONA_POR_QUE, RF_PRECIO_AUTORIZADO, RF_TARJETA, dichoTras, motivosYaPasados, porQueYaSalio,
  textoTrasAutorizacion, ultimoFuePorQue, volvioDePersona,
} from '../dominio.ts';
import { respuestaFija } from '../../reglamento.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, Hechos, Propuesta, Reglamento, ResultadoHerramienta } from '../../tipos.ts';
import type { FilaPublica, MotivoPersona, TrazaPublica } from '../tipos.ts';
import { MAX_SUGERENCIAS, productoParaModelo, sugerirProductos, productoPorCodigo, tablaFlete, totalPedido, zonaFlete } from './catalogo-ventas.ts';
import type { ProductoVenta } from './catalogo-ventas.ts';
import type { LinkGuardado, PuertosVentas } from './puertos-ventas.ts';

export const GENERAR_LINK_PAGO = 'generar_link_pago';
export const VERIFICAR_PAGO = 'verificar_pago';
/** Los cierres de ventas cuya salida escribe el código (no el modelo): no pasan por la lista blanca ni la guarda de plata. */
export const CIERRES_DEL_CODIGO_VENTAS = [GENERAR_LINK_PAGO, VERIFICAR_PAGO];
export const MAX_UNIDADES = 3;
export const TOPE_VER_CATALOGO_VENTAS = 1500;
/** El dominio del link de Bold: entra a la lista blanca cuando el modelo repite el link (SIN VERIFICAR en el sandbox). */
export const ENLACES_VENTAS = ['https://checkout.bold.co'];

export const RF_LINK_PAGO = 'rf.link_pago';
export const RF_PAGO_CONFIRMADO = 'rf.pago_confirmado';
export const RF_PAGO_YA_CONFIRMADO = 'rf.pago_ya_confirmado';
export const RF_PAGO_PENDIENTE = 'rf.pago_pendiente';

/** Los motivos que el modelo puede usar. `pago_no_disponible` y `despachar` los pone el código. */
export const MOTIVOS_VENTAS: MotivoPersona[] = [
  'pide_persona', 'queja', 'pago', 'no_entiende', 'menor', 'crisis', 'abuso', 'duda_abierta', 'datos', 'falla',
  'fuera_de_zona', 'cantidad', 'factura', 'garantia', 'no_en_catalogo',
];
const REPETIBLES: MotivoPersona[] = ['pide_persona', 'datos', 'crisis', 'duda_abierta', 'pago'];
export const FIJAS_VENTAS = [RF_AUTORIZACION, RF_TARJETA, RF_PERSONA_POR_QUE, RF_PRECIO_AUTORIZADO] as const;

/** Las claves de `consultar_reglas` en ventas. Una sin ficha devuelve `sin_dato`. */
export const CLAVES_REGLAS_VENTAS = ['despacho_bogota', 'recoger', 'fuera_de_bogota', 'pago', 'garantia', 'cambios', 'factura'] as const;

export interface OpcionesDominioVentas {
  reglamento: Reglamento;
  ahoraMs: () => number;
  vars: Record<string, string>;
  puertos: PuertosVentas;
  /** Una sola vez por clave (tomar_candado): la confirmación de un pago la hace el webhook o «ya pagué», no los dos. */
  unaVez: (clave: string) => Promise<boolean>;
  fallar?: () => boolean;
}

/** Una compra confirmada de la conversación: sus datos (los de la propuesta) y el link, si ya salió. */
export interface CompraConfirmada {
  huella: string;
  datos: Record<string, unknown>;
  link: { referencia: string; url: string; monto: number } | null;
}

/** Las compras confirmadas, en orden (la traza de la ejecución y la propuesta con la misma huella). Pura. */
export function comprasConfirmadas(filas: FilaPublica[]): CompraConfirmada[] {
  const props = new Map<string, Record<string, unknown>>();
  const out: CompraConfirmada[] = [];
  for (const f of filas) {
    const t = f.traza as TrazaPublica | null;
    if (t?.propuesta?.accion === 'compra') props.set(t.propuesta.huella, t.propuesta.datos);
    const e = t?.ejecucion;
    if (e?.accion === 'compra' && e.resultado === 'ejecutada' && props.has(e.huella)) {
      const l = (e.escrituras ?? []).find((x) => x.tipo === 'link_pago') as { referencia?: string; url?: string; monto?: number } | undefined;
      out.push({ huella: e.huella, datos: props.get(e.huella)!, link: l?.referencia && l.url ? { referencia: l.referencia, url: l.url, monto: Number(l.monto) } : null });
    }
    // El reenvío por `generar_link_pago` también deja el link en la traza.
    for (const h of t?.herramientas ?? []) {
      const d = h.datos as { huella?: string; referencia?: string; url?: string; monto?: number } | null;
      if (h.ok && h.nombre === GENERAR_LINK_PAGO && d?.huella && d.referencia && d.url) {
        const c = out.find((x) => x.huella === d.huella);
        if (c && !c.link) c.link = { referencia: d.referencia, url: d.url, monto: Number(d.monto) };
      }
    }
  }
  return out;
}

/** El bloque del medio de la nota a persona en ventas: el pedido, el link y la autorización. Pura. */
export function bloqueNotaVentas(p: { filas: FilaPublica[]; compra: Record<string, unknown> | null }): string[] {
  const ultima = comprasConfirmadas(p.filas).at(-1) ?? null;
  const c = p.compra ?? ultima?.datos ?? null;
  const g = estadoAutorizacion(p.filas, 'general');
  const aut = g.estado === 'si' ? `sí (versión ${g.evento.texto_version}, ${g.at.slice(0, 16).replace('T', ' ')} UTC)` : g.estado === 'no' ? 'dijo que no: no se tomaron datos' : g.estado === 'pedida' ? 'pedida, sin respuesta' : 'no pedida';
  const pedido = c
    ? `${c.codigo ?? '?'} ${c.producto ?? ''} × ${c.cantidad ?? '?'} · ${c.zona_nombre ?? c.zona ?? '?'} (flete ${pesos(Number(c.flete ?? 0))}) · total ${pesos(Number(c.total ?? 0))}`
    : 'sin pedido confirmado';
  const entrega = c ? `${c.nombre ?? '?'} · Cel. ${c.celular ?? '?'}${c.direccion ? ` · ${c.direccion}` : ''}` : null;
  return [
    `Pedido: ${pedido}`,
    ...(entrega ? [`Entrega: ${entrega}`] : []),
    ...(ultima?.link ? [`Link de Bold: ${ultima.link.referencia} (${pesos(ultima.link.monto)})`] : []),
    `Autorización de datos: ${aut}`,
  ];
}

const digitos = (s: string) => s.replace(/\D/g, '');

export function dominioVentas(o: OpcionesDominioVentas): Dominio {
  const r = o.reglamento;
  const claves: string[] = [...CLAVES_REGLAS_VENTAS];
  const caida = () => { if (o.fallar?.()) throw new Error('herramienta caída (simulada)'); };
  const filasDe = (ctx: ContextoDominio) => ctx.conversacion as FilaPublica[];
  const fija = (clave: string, vars: Record<string, string> = {}) => textoFijo(r, clave, { ...o.vars, ...vars });

  /** El link de una compra confirmada: el guardado con su huella o uno nuevo con la pasarela del workspace. */
  async function asegurarLink(huella: string, datos: Record<string, unknown>, ctx: ContextoDominio): Promise<{ ok: true; link: LinkGuardado } | { ok: false; motivo: string }> {
    const ya = await o.puertos.linkPorHuella(huella);
    if (ya) return { ok: true, link: ya };
    const pasarela = await o.puertos.pasarela();
    if (!pasarela) return { ok: false, motivo: 'el workspace no tiene llaves de Bold en la bóveda' };
    const [cuenta, conv] = ctx.phone.split(':').map(Number);
    const filas = filasDe(ctx);
    const venceAt = new Date(o.ahoraMs() + tablaFlete(r).venceHoras * 3600_000).toISOString();
    const monto = Number(datos.total);
    const res = await pasarela.crearLink({ pagoId: huella, monto, venceAt, descripcion: `${datos.codigo} ${String(datos.producto ?? '')} x${datos.cantidad}` });
    if (!res.ok) return { ok: false, motivo: `Bold no creó el link: ${res.error}` };
    try {
      const link = await o.puertos.guardarLink({
        referencia: res.referencia, url: res.url, huella, publicacionId: String(datos.publicacion_id), cantidad: Number(datos.cantidad),
        precioUnitario: Number(datos.precio_unitario), flete: Number(datos.flete), monto, zona: String(datos.zona), ruta: datos.ruta === 'recoge' ? 'recoge' : 'despacho',
        compradorNombre: String(datos.nombre), compradorTelefono: String(datos.celular), direccion: datos.direccion ? String(datos.direccion) : null,
        cuentaId: cuenta, conversacionId: conv, canal: filas[0]?.canal ?? 'otro', venceAt,
      });
      return { ok: true, link };
    } catch (e) {
      // Sin la fila el webhook no reconocería el pago: el link no se entrega.
      return { ok: false, motivo: `no se pudo guardar el link ${res.referencia}: ${String((e as Error).message).slice(0, 120)}` };
    }
  }

  const lecturas: DeclaracionHerramienta[] = [
    {
      name: 'ver_catalogo',
      description: `Busca en el catálogo de productos publicados: por texto libre (\`buscar\`, p. ej. «taladro», «bomba 1 HP») o por el código de la publicación (\`codigo\`, p. ej. MP-12). Pasa en \`uso\` para qué lo quiere el cliente, si ya lo dijo (p. ej. «metal, de cable», «concreto», «hogar», «inalámbrico», «estructura metálica»). Devuelve como máximo ${MAX_SUGERENCIAS} productos, los que mejor encajan, con código, producto, marca, precio, las especificaciones VERIFICADAS (las puedes afirmar) y las que son «según el catálogo del fabricante» (si las dices, dilo así; si el cliente insiste en que se las confirmes, pasa a persona con duda_abierta). Si hay más de ${MAX_SUGERENCIAS} y no pasaste \`uso\`, no devuelve productos sino \`preguntar_uso\` con los tipos que hay: haz UNA pregunta de uso y, con la respuesta, vuelve a llamarla con \`buscar\` y \`uso\`. Úsala antes de decir cualquier precio o dato de un producto. El precio es el publicado: nunca lo calcules, redondees ni negocies. Si no aparece lo que pide, no ofrezcas otro como si fuera el mismo: pasa a persona con no_en_catalogo. Las fotos de los productos que nombres con su código las manda el sistema: no pegues links de fotos.`,
      parameters: {
        type: 'object',
        properties: {
          buscar: { type: 'string', description: 'Lo que busca el cliente, con sus palabras (el tipo de producto).' },
          codigo: { type: 'string', description: 'El código MP-xx, si lo dio.' },
          uso: { type: 'string', description: 'Para qué lo va a usar, si ya lo dijo (material, lugar, inalámbrico o de cable…). Vacío si no lo ha dicho.' },
        },
        required: [],
      },
    },
    {
      name: 'consultar_reglas',
      description: `Las políticas publicadas, por clave: ${claves.join(', ')}. Si devuelve \`sin_dato\`, no adivines: pasa a persona con duda_abierta.`,
      parameters: { type: 'object', properties: { clave: { type: 'string', enum: claves } }, required: ['clave'] },
    },
  ];

  const cierres: DeclaracionHerramienta[] = [
    {
      name: PASAR_A_PERSONA,
      description: 'Pasa la conversación a una persona del equipo. El sistema arma la nota, pone la etiqueta y le dice al cliente qué sigue. Motivos: fuera_de_zona (entrega fuera de la tabla de flete: la persona cotiza el flete), cantidad (más de 3 unidades), factura (factura a nombre de empresa o con datos especiales), garantia (garantía, cambio o devolución), no_en_catalogo (producto que no está en el catálogo), pago (soporte de pago, doble cobro, un link vencido), pide_persona, queja, no_entiende, menor, crisis, abuso, duda_abierta (pregunta que el catálogo y las reglas no contestan), datos (borrar datos o revocar la autorización), falla.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: MOTIVOS_VENTAS },
          pidio: { type: 'string', description: 'En una línea, qué pidió el cliente (sin datos de tarjeta).' },
        },
        required: ['motivo', 'pidio'],
      },
    },
    {
      name: RESPUESTA_FIJA,
      description: `Manda una respuesta fija, tal cual la escribe el sistema. ${RF_AUTORIZACION}: antes de pedir nombre, celular o dirección (pide la autorización con Sí / No; es la ÚNICA forma de pedirla). ${RF_TARJETA}: si escribe o pide escribir datos de tarjeta. ${RF_PERSONA_POR_QUE}: si pide una persona sin decir para qué (una sola vez por conversación). ${RF_PRECIO_AUTORIZADO}: si pregunta por qué ese precio, dice que está caro o pide un descuento o una rebaja (no negocies).`,
      parameters: { type: 'object', properties: { clave: { type: 'string', enum: [...FIJAS_VENTAS] } }, required: ['clave'] },
    },
    {
      name: GENERAR_LINK_PAGO,
      description: 'Reenvía el link de pago de la compra que el cliente YA confirmó (si dice que no le llegó o lo perdió). El link y el monto los pone el sistema. Sin una compra confirmada no hay link: arma la compra con proponer.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: VERIFICAR_PAGO,
      description: 'Cuando el cliente dice que ya pagó: le pregunta a Bold si el pago del link quedó aprobado. Solo lo que diga Bold cuenta; nunca confirmes un pago por lo que diga el cliente ni por un pantallazo.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ];

  return {
    bot: BOT_PUBLICO,
    // Una propuesta de compra vence con cualquier otro mensaje del bot: un «sí» viejo no crea un link.
    propuestaVenceConRespuesta: true,
    topesResultado: { ver_catalogo: TOPE_VER_CATALOGO_VENTAS },
    lecturas,
    acciones: ['compra'],
    datosProponer: {
      producto: { type: 'string', description: 'el código MP-xx de ver_catalogo' },
      cantidad: { type: 'integer', description: 'unidades (1 a 3)' },
      entrega: { type: 'string', description: 'la zona de entrega de la tabla de flete (consultar_reglas: despacho_bogota o recoger)' },
      nombre: { type: 'string', description: 'como lo escribió el cliente después de autorizar' },
      celular: { type: 'string' },
      direccion: { type: 'string', description: 'la dirección de entrega (no hace falta si recoge)' },
    },
    cierres,

    async leer(nombre, args): Promise<ResultadoHerramienta> {
      caida();
      if (nombre === 'ver_catalogo') {
        const ps = await o.puertos.catalogo();
        if (!ps.length) return { ok: false, datos: null, error: 'No hay productos publicados. No inventes: pasar_a_persona con motivo falla.' };
        const sug = sugerirProductos(ps, { buscar: args.buscar ? String(args.buscar) : null, codigo: args.codigo ? String(args.codigo) : null, uso: args.uso ? String(args.uso) : null });
        if (sug.tipo === 'preguntar') {
          return {
            ok: true,
            datos: {
              productos: [], coincidencias: sug.coincidencias, preguntar_uso: true, tipos: sug.tipos,
              que_hacer: `Hay ${sug.coincidencias} productos que coinciden. No los listes: hazle UNA pregunta de uso para saber cuál le sirve (para qué material o trabajo, en casa u obra, inalámbrico o de cable; según los tipos que hay). Con su respuesta, vuelve a llamar ver_catalogo con buscar y uso, y sugiere como máximo ${MAX_SUGERENCIAS}.`,
            },
          };
        }
        if (!sug.productos.length) return { ok: true, datos: { productos: [], nota: 'No está en el catálogo. No ofrezcas otro como si fuera el mismo: si lo quiere, pasar_a_persona con motivo no_en_catalogo.' } };
        if (sug.tipo === 'codigo') return { ok: true, datos: { productos: sug.productos.map(productoParaModelo) } };
        return {
          ok: true,
          datos: {
            productos: sug.productos.map(productoParaModelo), coincidencias: sug.coincidencias,
            nota: `Sugiere como máximo estos ${sug.productos.length}, cada uno con su código, nombre corto, precio y una razón de una línea que salga del nombre o de las especificaciones verificadas. No nombres otros productos.`,
          },
        };
      }
      if (nombre === 'consultar_reglas') {
        const clave = String(args.clave ?? '');
        if (!claves.includes(clave)) return { ok: false, datos: null, error: `Clave desconocida. Usa una de: ${claves.join(', ')}.` };
        const p = r.fichas.find((f) => f.clave === `pol.${clave}`);
        if (!p) return { ok: true, datos: { clave, sin_dato: true, que_hacer: 'No hay ficha: pasar_a_persona con motivo duda_abierta. No adivines.' } };
        return { ok: true, datos: { clave, politica: p.hacer } };
      }
      return { ok: false, datos: null, error: `No existe la herramienta «${nombre}».` };
    },

    async proponer(accion, datos, ctx) {
      if (accion !== 'compra') return { ok: false, error: 'La única acción es compra.', candado: 'accion_desconocida' };
      const filas = filasDe(ctx);
      const aut = estadoAutorizacion(filas, 'general');
      if (aut.estado !== 'si') {
        return { ok: false, error: `Falta la autorización de datos (${aut.estado === 'no' ? 'dijo que no: no tomes datos y ofrece una persona' : 'pídela con respuesta_fija rf.autorizacion antes de tomar nombre, celular o dirección'}).`, candado: 'sin_autorizacion' };
      }
      const ps = await o.puertos.catalogo();
      const prod: ProductoVenta | null = productoPorCodigo(ps, String(datos.producto ?? ''));
      if (!prod) return { ok: false, error: 'El producto no es un código de ver_catalogo. Búscalo primero; si no está, pasar_a_persona con no_en_catalogo.', candado: 'producto_invalido' };
      const cantidad = Number(datos.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1) return { ok: false, error: 'La cantidad tiene que ser un número entero de unidades.', candado: 'cantidad_invalida' };
      if (cantidad > MAX_UNIDADES) return { ok: false, error: `Más de ${MAX_UNIDADES} unidades no las vendo por aquí: pasar_a_persona con motivo cantidad.`, candado: 'cantidad_mayor' };
      const tabla = tablaFlete(r);
      const zona = zonaFlete(tabla, String(datos.entrega ?? ''));
      if (!zona) return { ok: false, error: `Esa entrega no está en la tabla de flete (${tabla.zonas.map((z) => z.id).join(', ') || 'vacía'}): no cotices el flete; pasar_a_persona con motivo fuera_de_zona.`, candado: 'zona_fuera_de_tabla' };
      const tras = textoTrasAutorizacion(filas, aut.at);
      const campos = { nombre: String(datos.nombre ?? '').trim(), celular: String(datos.celular ?? '').trim(), direccion: String(datos.direccion ?? '').trim() };
      const faltan: string[] = [];
      if (!campos.nombre || !dichoTras('nombre', campos.nombre, tras)) faltan.push('nombre');
      if (!campos.celular || !dichoTras('telefono', campos.celular, tras)) faltan.push('celular');
      if (zona.ruta === 'despacho' && (!campos.direccion || !dichoTras('nombre', campos.direccion, tras))) faltan.push('dirección');
      if (faltan.length) return { ok: false, error: `Falta ${faltan.join(', ')} escrito por el cliente después de autorizar (lo que dijo antes no cuenta). Pídelo.`, candado: 'dato_sin_autorizacion' };
      const total = totalPedido(prod.precio, cantidad, zona.flete);
      const producto = prod.titulo || prod.nombre;
      const resumen = [
        'Revisa tu pedido:',
        `• ${prod.codigo} · ${producto}`,
        `• ${cantidad} × ${pesos(prod.precio)}`,
        `• ${zona.nombre}: ${zona.flete > 0 ? `flete ${pesos(zona.flete)}` : 'sin flete'}`,
        `• Total: ${pesos(total)}`,
        `• ${campos.nombre} · Cel. ${digitos(campos.celular)}${zona.ruta === 'despacho' ? ` · ${campos.direccion}` : ''}`,
        'Si está bien, te envío el link de pago de Bold. ¿Está bien?',
      ].join('\n');
      const propuesta: Propuesta = {
        accion: 'compra',
        datos: {
          publicacion_id: prod.publicacionId, codigo: prod.codigo, producto, precio_unitario: prod.precio, cantidad, zona: zona.id, zona_nombre: zona.nombre,
          ruta: zona.ruta, flete: zona.flete, total, nombre: campos.nombre, celular: digitos(campos.celular), ...(zona.ruta === 'despacho' ? { direccion: campos.direccion } : {}),
        },
        resumen, si: 'Sí, enviar link', no: 'Corregir',
      };
      return { ok: true, propuesta };
    },

    async ejecutar(p, ctx): Promise<Hechos> {
      // La huella la trae la propuesta guardada que confirma el núcleo (una vez por huella, con su candado).
      const huella = String((p as Propuesta & { huella?: string }).huella ?? '');
      if (!huella) throw new Error('propuesta sin huella');
      const r1 = await asegurarLink(huella, p.datos, ctx);
      if (!r1.ok) {
        console.error(`[asistente-ventas] sin link de pago: ${r1.motivo}`);
        return {
          lineas: [fija('rf.persona.pago_no_disponible') || fija('rf.persona')],
          escrituras: [{ tipo: 'persona', motivo: 'pago_no_disponible', datos: { ...p.datos, error: r1.motivo } }],
        };
      }
      const l = r1.link;
      return {
        lineas: [fija(RF_LINK_PAGO, { url: l.url, total: pesos(l.monto) })],
        escrituras: [{ tipo: 'link_pago', huella, referencia: l.referencia, url: l.url, monto: l.monto }],
      };
    },

    async estado(ctx) {
      const filas = filasDe(ctx);
      const g = estadoAutorizacion(filas, 'general');
      const pasados = motivosYaPasados(filas);
      const compras = comprasConfirmadas(filas);
      const lineaG = g.estado === 'si' ? 'sí (puedes pedir nombre, celular y dirección)'
        : g.estado === 'no' ? 'dijo que no: no tomes datos personales; sigue informando y ofrece una persona'
          : g.estado === 'pedida' ? 'pedida, sin respuesta: no pidas datos personales'
            : 'no pedida: antes de pedir nombre, celular o dirección, llama respuesta_fija rf.autorizacion';
      const u = compras.at(-1);
      return [
        `Autorización de datos para la compra: ${lineaG}.`,
        ...(u ? [`Compra confirmada: ${u.datos.codigo} × ${u.datos.cantidad}, total ${pesos(Number(u.datos.total))}; ${u.link ? 'el link de pago ya salió (si dice que pagó: verificar_pago; si no le llegó: generar_link_pago)' : 'sin link de pago'}.`] : []),
        ...(pasados.includes('despachar') ? ['El pago ya está confirmado y el despacho lo tiene el equipo: no vuelvas a verificar ni a pedir el pago.'] : []),
        ...(pasados.length ? [`Ya pasó a persona por: ${[...new Set(pasados)].join(', ')}.`] : []),
        ...(!pasados.length && porQueYaSalio(filas) ? [ultimoFuePorQue(filas)
          ? 'Tu último mensaje fue la pregunta de para qué quiere una persona. Si pide algo que resuelves, contéstalo y ofrécele otra vez pasar con una persona. Si insiste: pasar_a_persona motivo pide_persona.'
          : 'Ya le preguntaste por qué quiere una persona: no lo vuelvas a preguntar.'] : []),
      ];
    },

    async cerrar(nombre, args, ctx) {
      const filas = filasDe(ctx);
      if (nombre === PASAR_A_PERSONA) {
        const motivo = String(args.motivo ?? '') as MotivoPersona;
        if (!MOTIVOS_VENTAS.includes(motivo)) return { ok: false, error: `Motivo desconocido. Usa uno de: ${MOTIVOS_VENTAS.join(', ')}.`, candado: 'motivo_desconocido' };
        if (!REPETIBLES.includes(motivo) && motivosYaPasados(filas).includes(motivo)) {
          return { ok: false, error: `Esta conversación ya pasó a persona por «${motivo}»: atiéndela tú.`, candado: 'motivo_repetido' };
        }
        const texto = (motivo === 'duda_abierta' ? respuestaFija(r, 'rf.duda_abierta') : '') || respuestaFija(r, `rf.persona.${motivo}`) || respuestaFija(r, 'rf.persona');
        return { ok: true, salidas: [{ tipo: 'texto', texto }], datos: { motivo }, privado: { persona: { motivo, pidio: String(args.pidio ?? '').slice(0, 200) } } };
      }
      if (nombre === RESPUESTA_FIJA) {
        const clave = String(args.clave ?? '');
        if (clave === RF_AUTORIZACION) {
          if (estadoAutorizacion(filas, 'general').estado === 'si') return { ok: false, error: 'Ya autorizó: sigue con los datos que falten.', candado: 'ya_autorizo' };
          return { ok: true, salidas: [salidaAutorizacion(r, 'general', o.vars)], privado: { pide_autorizacion: 'general' } };
        }
        if (clave === RF_TARJETA) return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, RF_TARJETA) }], privado: { enmascarar: true } };
        if (clave === RF_PERSONA_POR_QUE) {
          if (volvioDePersona(filas) || porQueYaSalio(filas)) return { ok: false, error: 'No vuelvas a preguntar por qué: si pide una persona, pasar_a_persona motivo pide_persona.', candado: 'persona_por_que_repetida' };
          return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, RF_PERSONA_POR_QUE) }] };
        }
        if (clave === RF_PRECIO_AUTORIZADO) {
          const texto = respuestaFija(r, RF_PRECIO_AUTORIZADO);
          if (!texto) return { ok: false, error: 'Sin ese texto: di que ese es el precio publicado, sin negociar.', candado: 'fija_sin_texto' };
          return { ok: true, salidas: [{ tipo: 'texto', texto }] };
        }
        return { ok: false, error: `Usa una de: ${FIJAS_VENTAS.join(', ')}.`, candado: 'fija_desconocida' };
      }
      if (nombre === GENERAR_LINK_PAGO) {
        const u = comprasConfirmadas(filas).at(-1);
        if (!u) return { ok: false, error: 'No hay una compra confirmada: arma la compra con proponer y espera a que el cliente la confirme. No escribas un link.', candado: 'sin_compra_confirmada' };
        const r1 = await asegurarLink(u.huella, u.datos, ctx);
        if (!r1.ok) {
          return { ok: true, salidas: [{ tipo: 'texto', texto: fija('rf.persona.pago_no_disponible') || fija('rf.persona') }], datos: { sin_link: true }, privado: { persona: { motivo: 'pago_no_disponible', pidio: `reenviar el link de pago (${r1.motivo})` } } };
        }
        const l = r1.link;
        return { ok: true, salidas: [{ tipo: 'texto', texto: fija(RF_LINK_PAGO, { url: l.url, total: pesos(l.monto) }) }], datos: { huella: u.huella, referencia: l.referencia, url: l.url, monto: l.monto } };
      }
      if (nombre === VERIFICAR_PAGO) {
        const u = comprasConfirmadas(filas).at(-1);
        const ref = u?.link?.referencia ?? (u ? (await o.puertos.linkPorHuella(u.huella))?.referencia : null);
        if (!u || !ref) return { ok: false, error: 'En esta conversación no hay un link de pago: no confirmes ningún pago. Si dice que pagó otra cosa, pasar_a_persona motivo pago.', candado: 'sin_link' };
        const e = await o.puertos.consultarLink(ref);
        if (e === null || e === 'sin_llaves') {
          return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, 'rf.persona.pago') || respuestaFija(r, 'rf.persona') }], datos: { referencia: ref, estado: 'sin_respuesta' }, privado: { persona: { motivo: 'pago', pidio: 'dice que ya pagó; Bold no respondió al verificar' } } };
        }
        if (e.estado === 'PAID') {
          // Lo que dice Bold tiene que ser ESTE pago: el total del link, de producción (un link de pruebas solo vale en un
          // espacio de pruebas). Si no cuadra, lo revisa una persona; no se confirma nada.
          const link = await o.puertos.linkPorReferencia(ref);
          const montoLink = link?.monto ?? u.link?.monto ?? Number(u.datos.total);
          const raro = e.sandbox && !e.espacioDePruebas ? 'Bold dice que el link es de pruebas'
            : e.total === null ? 'Bold no devolvió el total cobrado'
              : Math.round(e.total) !== Math.round(montoLink) ? `Bold cobró ${pesos(e.total)} y el link era por ${pesos(montoLink)}` : null;
          if (raro) {
            return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, 'rf.persona.pago') || respuestaFija(r, 'rf.persona') }], datos: { referencia: ref, estado: 'PAID', revisar: true }, privado: { persona: { motivo: 'pago', pidio: `dice que ya pagó; ${raro}: revisar antes de despachar` } } };
          }
          const enOne = link?.registro === 'registrada' ? 'la venta ya quedó registrada en ONE' : 'la venta AÚN NO está registrada en ONE: revisar el webhook de Bold antes de despachar';
          const primera = !motivosYaPasados(filas).includes('despachar') && await o.unaVez(claveConfirmacionPago(ctx.workspaceId, ref));
          if (!primera) return { ok: true, salidas: [{ tipo: 'texto', texto: fija(RF_PAGO_YA_CONFIRMADO) }], datos: { referencia: ref, estado: 'PAID' } };
          return { ok: true, salidas: [{ tipo: 'texto', texto: fija(RF_PAGO_CONFIRMADO) }], datos: { referencia: ref, estado: 'PAID' }, privado: { persona: { motivo: 'despachar', pidio: `pagó el pedido (Bold: PAID, ${pesos(montoLink)}); ${enOne}` } } };
        }
        if (['ACTIVE', 'PROCESSING', 'PENDING', ''].includes(e.estado)) {
          return { ok: true, salidas: [{ tipo: 'texto', texto: fija(RF_PAGO_PENDIENTE) }], datos: { referencia: ref, estado: e.estado || 'ACTIVE' } };
        }
        // Vencido, rechazado o cancelado: una persona revisa y, si hace falta, manda otro link.
        return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, 'rf.persona.pago') || respuestaFija(r, 'rf.persona') }], datos: { referencia: ref, estado: e.estado }, privado: { persona: { motivo: 'pago', pidio: `dice que ya pagó; el link en Bold está ${e.estado}` } } };
      }
      return { ok: false, error: `No existe «${nombre}».`, candado: 'cierre_desconocido' };
    },
  };
}

/** La clave de «una sola vez» de la confirmación de un pago (la comparten `verificar_pago` y el aviso del webhook). */
export function claveConfirmacionPago(workspaceId: string, referencia: string): string {
  return `ventas:pago:${workspaceId}:${referencia}`;
}
