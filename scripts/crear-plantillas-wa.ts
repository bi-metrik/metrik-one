/**
 * Crea en Meta las plantillas de las alertas proactivas de `wa-alerts`.
 *
 * Por que existe, y por que NO es una lista de curls en un documento: el orden de
 * `params` en el secreto `WA_ALERT_TEMPLATES` tiene que ser exactamente el orden de los
 * `{{n}}` del cuerpo aprobado. Si se desincronizan, la alerta sale con los valores en las
 * casillas equivocadas —un saldo donde va la fecha— y Meta la entrega igual, porque para
 * Meta son tres cadenas en orden. Aqui las dos cosas se DERIVAN de la misma definicion,
 * asi que no pueden discrepar. El JSON del secreto lo imprime este script; no se teclea.
 *
 * Uso:
 *   npx tsx scripts/crear-plantillas-wa.ts <WABA_ID>            # ensayo, no escribe
 *   npx tsx scripts/crear-plantillas-wa.ts <WABA_ID> --commit   # crea las que falten
 *   npx tsx scripts/crear-plantillas-wa.ts --registro           # solo el JSON del secreto
 *
 * Necesita `WHATSAPP_ACCESS_TOKEN` en el entorno (esta en `.credentials.md`, y es el
 * mismo token del bot: `whatsapp_business_management` alcanza para crear plantillas).
 *
 * ⚠️ El WABA id no esta en `.credentials.md` ni en el repo, y con este token NO se puede
 * enumerar (falta `business_management`). Se lee en Meta Business Manager → WhatsApp
 * Manager → Configuracion. Vale la pena pasarselo a Kaori la primera vez que se use.
 *
 * Es idempotente: consulta lo que ya existe y solo crea lo que falta. Una plantilla ya
 * aprobada no se toca —editarla la manda de vuelta a revision— y una rechazada se reporta
 * en vez de reintentarse, porque reintentar la misma copy rechazada gasta cuota de
 * creacion sin cambiar nada.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// `quiet`: dotenv escribe sus avisos a STDOUT, y la salida de `--registro` esta pensada
// para tubearse a `supabase secrets set`. Una linea de mas ahi carga el secreto con basura
// adelante — la misma familia del `\n` que tumbo Realtime en agosto.
config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const META_API_VERSION = 'v21.0';

/** Un parametro del cuerpo. El `sample` es obligatorio para Meta y ademas es lo que un
 *  revisor humano ve: un sample que no se parece al uso real puede pausar la plantilla. */
interface Param {
  /** Nombre con el que el codigo lo publica (`variables` de `enviarAlerta`). */
  nombre: string;
  sample: string;
}

interface Definicion {
  /** La llave del secreto: tiene que ser el `intent` que pasa `enviarAlerta`. */
  intent: string;
  name: string;
  lang: string;
  /** Cuerpo con `{{1}}`, `{{2}}`... en el MISMO orden que `params`. */
  body: string;
  params: Param[];
}

// ── Las plantillas ────────────────────────────────────────────────────────────────────
// Copy espejo de `docs/wa-templates.md`. Sin emojis y sin CTA promocional.
//
// ⚠️ Esa convencion NO alcanza, y se midio: el 2026-09-02 se crearon las seis pidiendo
// `UTILITY` y Meta le puso MARKETING a tres en el momento de crearlas. Con grupo de
// control (mismo autor, misma WABA, mismo dia, tres pasaron y tres no) lo que las separa
// NO es el CTA —`push_saldo` dice "Respondeme con el monto" y paso— sino DE QUE HABLAN:
// Utility aguanta cuando el mensaje es sobre un REGISTRO CONCRETO DEL DESTINATARIO que
// cambio de estado, y se cae cuando es un agregado, una meta, un pipeline o un tercero.
// Por eso los tres cuerpos reclasificados se reescribieron como novedad de la cuenta y
// se les quito la meta ("de la meta"), el lenguaje de pipeline ("en venta") y el CTA.
// Es inferencia sobre tres casos, no politica publicada de Meta: la mejor evidencia
// disponible, no una garantia. Al escribir una plantilla nueva, aplicar la misma regla.
//
// ⚠️ Y una plantilla NO puede empezar ni terminar en `{{n}}` (Meta la rechaza con
// "Las variables no pueden estar al principio ni al final de la plantilla"). Por eso los
// tres cierran con texto. Lo comprueba `validar()` antes de hablar con Meta.
const PLANTILLAS: Definicion[] = [
  {
    intent: 'W25',
    name: 'metrik_alerta_saldo_vencido',
    lang: 'es_CO',
    body: 'Hola, el negocio {{1}} ({{2}}) tiene un saldo vencido de {{3}} con {{4}} dias de antiguedad.\n\nRevisalo en MeTRIK ONE.',
    params: [
      { nombre: 'codigo', sample: 'A1 26 1' },
      { nombre: 'negocio', sample: 'Clarity Express AFI' },
      { nombre: 'saldo', sample: '$1.750.000' },
      { nombre: 'dias', sample: '42' },
    ],
  },
  {
    intent: 'W33',
    name: 'metrik_alerta_push_saldo',
    lang: 'es_CO',
    body: 'Hola {{1}}, tu saldo del banco tiene {{2}} dias sin actualizar.\n\nRespondeme con el monto y lo registro.',
    params: [
      { nombre: 'nombre', sample: 'Mauricio' },
      { nombre: 'dias', sample: '9' },
    ],
  },
  {
    // Hermana de la anterior y no la misma con `dias = 0`: "nunca registraste saldo" y
    // "lleva 0 dias sin actualizar" no son la misma frase, y la segunda no se entiende.
    intent: 'W33_sin_saldo',
    name: 'metrik_alerta_sin_saldo',
    lang: 'es_CO',
    body: 'Hola {{1}}, aun no has registrado tu saldo bancario.\n\nRespondeme con el monto y lo registro.',
    params: [{ nombre: 'nombre', sample: 'Mauricio' }],
  },
  {
    intent: 'stale_opps',
    name: 'metrik_alerta_negocios_estancados',
    lang: 'es_CO',
    body: 'Actualizacion de tu cuenta en MeTRIK ONE: {{1}} negocios no registran movimiento. Son: {{2}}. Corte de hoy.',
    params: [
      { nombre: 'cuantos', sample: '3' },
      { nombre: 'detalle', sample: 'Kaeser, Textiles del Norte, Happy Nails' },
    ],
  },
  {
    intent: 'recaudo_check',
    name: 'metrik_alerta_recaudo_bajo',
    lang: 'es_CO',
    body: 'Actualizacion de tu cuenta en MeTRIK ONE. Vas en {{1}} del recaudo del mes: {{2}} de {{3}}. Corte de hoy.',
    params: [
      { nombre: 'pct', sample: '38%' },
      { nombre: 'cobrado', sample: '$4.200.000' },
      { nombre: 'meta', sample: '$11.000.000' },
    ],
  },
  {
    // No es una alerta de cron: reacciona a un mensaje. Va al admin, y la ventana que
    // importa es la DEL ADMIN, no la del desconocido que acaba de escribir.
    intent: 'numero_desconocido',
    name: 'metrik_alerta_numero_desconocido',
    lang: 'es_CO',
    body: 'Aviso de tu cuenta en MeTRIK ONE: se recibio un mensaje de {{1}} que no corresponde a ningun contacto registrado.\n\nContenido: {{2}}. Queda sin asignar.',
    params: [
      { nombre: 'telefono', sample: '+573001234567' },
      { nombre: 'mensaje', sample: 'Buenas, quiero informacion' },
    ],
  },
];

// ── Comprobaciones de la definicion, antes de hablar con Meta ─────────────────────────
// Un `{{3}}` en un cuerpo de dos parametros lo rechaza Meta con un error generico, y un
// `{{2}}` que falta NO lo rechaza: crea una plantilla que ignora un valor en silencio.
function validar(d: Definicion): string[] {
  const fallas: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) {
    fallas.push(`nombre invalido "${d.name}": Meta solo acepta minusculas, digitos y guion bajo`);
  }
  const encontrados = [...d.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const esperados = d.params.map((_, i) => i + 1);
  if (encontrados.join(',') !== esperados.join(',')) {
    fallas.push(
      `los {{n}} del cuerpo son [${encontrados.join(', ')}] y los params son [${esperados.join(', ')}]: ` +
      'tienen que ser correlativos desde 1 y en el mismo orden',
    );
  }
  // Meta rechaza el cuerpo que empieza o termina en variable. El error que devuelve es un
  // `(#100)` generico con el texto de la regla, asi que sin esta comprobacion se descubre
  // recien al crear la plantilla —y para entonces ya se gasto un intento de la tanda.
  const cuerpo = d.body.trim();
  if (/^\{\{\d+\}\}/.test(cuerpo)) {
    fallas.push('el cuerpo EMPIEZA con una variable, y Meta no lo acepta: antepone texto');
  }
  if (/\{\{\d+\}\}$/.test(cuerpo)) {
    fallas.push('el cuerpo TERMINA en una variable, y Meta no lo acepta: cierra con texto');
  }
  for (const p of d.params) {
    if (!p.sample.trim()) fallas.push(`el param "${p.nombre}" no tiene sample, y Meta lo exige`);
  }
  return fallas;
}

function payloadDeCreacion(d: Definicion) {
  return {
    name: d.name,
    language: d.lang,
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: d.body,
        // ⚠️ `body_text` es un arreglo DENTRO de un arreglo: la lista externa es de
        // ejemplos, la interna son los valores de un ejemplo. Verificado contra la doc
        // de Meta, no de memoria — escrito plano, Meta lo rechaza sin decir por que.
        example: { body_text: [d.params.map((p) => p.sample)] },
      },
    ],
  };
}

/** El secreto, derivado de las mismas definiciones. Nunca se teclea aparte. */
function registro(defs: Definicion[]): string {
  const obj: Record<string, { name: string; lang: string; params: string[] }> = {};
  for (const d of defs) obj[d.intent] = { name: d.name, lang: d.lang, params: d.params.map((p) => p.nombre) };
  return JSON.stringify(obj, null, 2);
}

async function main() {
  const waba = process.argv[2];
  const commit = process.argv.includes('--commit');
  const soloRegistro = process.argv.includes('--registro');
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  // El JSON del secreto se puede pedir sin WABA y sin token: hace falta al cargarlo, que
  // es un paso posterior a la aprobacion y puede hacerlo alguien que no tenga el token.
  if (soloRegistro) {
    const malas = PLANTILLAS.flatMap((d) => validar(d).map((f) => `  ${d.name}: ${f}`));
    if (malas.length) {
      console.error('Definiciones invalidas:\n' + malas.join('\n'));
      process.exit(1);
    }
    console.log(registro(PLANTILLAS));
    return;
  }

  if (!waba || waba.startsWith('--')) {
    console.error('Falta el WABA id.\n  npx tsx scripts/crear-plantillas-wa.ts <WABA_ID> [--commit]');
    process.exit(1);
  }
  if (!token) {
    console.error('Falta WHATSAPP_ACCESS_TOKEN en el entorno (esta en .credentials.md).');
    process.exit(1);
  }

  // Se valida TODO antes de crear nada: media tanda creada y media no es el peor estado,
  // porque la segunda corrida tiene que adivinar donde se quedo.
  const malas = PLANTILLAS.flatMap((d) => validar(d).map((f) => `  ${d.name}: ${f}`));
  if (malas.length) {
    console.error('Definiciones invalidas, no se creo nada:\n' + malas.join('\n'));
    process.exit(1);
  }

  const base = `https://graph.facebook.com/${META_API_VERSION}/${waba}/message_templates`;
  const auth = { Authorization: `Bearer ${token}` };

  const res = await fetch(`${base}?limit=500&fields=name,language,status,category`, { headers: auth });
  const cuerpo = await res.json();
  if (!res.ok) {
    // El error de Meta se muestra entero: "(#3) Application does not have the capability"
    // suele significar que el id no es un WABA, y "(#200)" que al token le falta permiso.
    console.error(`No se pudo listar lo que ya existe: ${JSON.stringify(cuerpo?.error ?? cuerpo)}`);
    process.exit(1);
  }
  const existentes = new Map<string, string>(
    (cuerpo.data ?? []).map((t: { name: string; language: string; status: string }) => [`${t.name}|${t.language}`, t.status]),
  );
  console.log(`Meta ya tiene ${existentes.size} plantillas en esta cuenta.\n`);

  const creadas: Definicion[] = [];
  for (const d of PLANTILLAS) {
    const estado = existentes.get(`${d.name}|${d.lang}`);
    if (estado) {
      const nota = estado === 'REJECTED'
        ? ' — RECHAZADA: hay que corregir la copy en Meta, reintentarla igual no cambia nada'
        : '';
      console.log(`= ${d.name} (${d.lang}) ya existe [${estado}]${nota}`);
      continue;
    }
    if (!commit) {
      console.log(`+ ${d.name} (${d.lang}) se crearia — ${d.params.length} variable(s): ${d.params.map((p) => p.nombre).join(', ')}`);
      creadas.push(d);
      continue;
    }
    const r = await fetch(base, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadDeCreacion(d)),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error(`x ${d.name}: ${JSON.stringify(j?.error ?? j)}`);
      continue;
    }
    console.log(`+ ${d.name} creada [${j.status ?? 'PENDING'}] id=${j.id}`);
    creadas.push(d);
  }

  console.log(
    commit
      ? `\nCreadas ${creadas.length}. Utility suele aprobarse entre 1 y 24 h; el estado se consulta volviendo a correr esto.`
      : `\nEnsayo: se crearian ${creadas.length}. Agrega --commit para hacerlo.`,
  );

  console.log('\n── WA_ALERT_TEMPLATES ─────────────────────────────────────────────');
  console.log('Cargarlo SOLO con las plantillas ya APROBADAS: una declarada y no aprobada');
  console.log('hace que Meta rechace el envio, y hoy ese aviso al menos sale como texto.\n');
  console.log(registro(PLANTILLAS));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
