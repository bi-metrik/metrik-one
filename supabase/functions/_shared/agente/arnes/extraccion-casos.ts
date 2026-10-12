// ============================================================
// Arnés del núcleo — los casos de la extracción de una carga (Deno)
// ------------------------------------------------------------
// Uso (la llave llega por GEMINI_API_KEY; nunca se imprime; en el arnés es la de PRUEBAS):
//   deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/extraccion-casos.ts [--n 3] [--esquema completa|compacta|ambas]
// `--esquema ambas` corre los casos con el esquema de hoy y con el compacto (`esquemaCargaCompacta`), intercalados, y
// resume por esquema: aciertos, campos llenos frente a los que el caso exige (`llena`), campos omitidos, ms p50/p90 y
// tokens de salida. Lo que decide encender `agente_config.extraccion_compacta` es: mismos aciertos y mismos llenos, menos ms.
// Cada caso corre la extracción real (`extraccionGemini`, el mismo pedido que producción) y pasa por `validarCarga`. Se
// mira lo que quedaría como sugerido, no el texto. Casos de la prueba del 2026-10-09 (d3260a5a, 69eeff52, dfbd466a) y
// controles de #1074 («no tienen presupuesto» = sin definir; «económico» = duda, no rango). Datos inventados.
// ============================================================

import { instruccionesCarga, omitidosCompacta, validarCarga } from '../bandeja/extraccion.ts';
import { CAMPOS_ARNES } from './conjuntos.ts';
import { extraccionGemini, MODELO_EXTRACCION } from './extraccion-gemini.ts';
import type { MedidaExtraccion } from './extraccion-gemini.ts';

const HOY = '2026-10-09';
const M_RETOMA = 'A listo. Vamos a retomar el viaje a miami. vamos a hacer una nueva cotización';
const M_PAX = 'Quiero que coticemos M1 26 2 ahora para que vayan 2 adultos y un niño de año y medio. Serían 6 noches saliendo desde Bogotá el 19 de noviembre. calcula la fecha de regreso';
const ESCRITO = { destino: 'Miami', ciudad_origen: 'Bogotá', fecha_salida: '2026-11-19', fecha_regreso: '2026-11-25', adultos: 2, ninos: 0, infantes: 1, edades_menores: '1.5' };

type Sug = Record<string, { valor: unknown; como?: string }>;
/** `llena`: los campos que el caso exige llenos (nuevos o iguales a lo que el viaje tiene): mide que no se salte campos. */
export interface CasoExtraccion { id: string; textos: string[]; yaTiene?: Record<string, unknown>; llena?: string[]; fallas(s: Sug, dudas: unknown[]): string[] }

const num = (s: Sug, k: string) => (s[k] === undefined ? undefined : Number(s[k].valor));
const debe = (cond: boolean, falla: string) => (cond ? [] : [falla]);

export const CASOS_EXTRACCION: CasoExtraccion[] = [
  {
    id: 'd3260a5a: «un niño de año y medio», sin hablar de presupuesto', textos: [M_RETOMA, M_PAX],
    llena: ['destino', 'ciudad_origen', 'fecha_salida', 'fecha_regreso', 'adultos', 'infantes', 'edades_menores'],
    fallas: (s) => [
      ...debe(num(s, 'infantes') === 1, `infantes=${s.infantes?.valor ?? '—'}`),
      ...debe((num(s, 'ninos') ?? 0) === 0, `ninos=${s.ninos?.valor}`),
      ...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`),
      ...debe(s.fecha_regreso?.valor === '2026-11-25', `regreso=${s.fecha_regreso?.valor ?? '—'}`),
    ],
  },
  {
    id: '69eeff52: la categoría, con el viaje ya escrito', textos: [M_RETOMA, M_PAX, 'están buscando hoteles 4 estrellas'], yaTiene: ESCRITO,
    fallas: (s) => [
      ...debe(String(s.categoria_hotel?.valor) === '4', `categoria=${s.categoria_hotel?.valor ?? '—'}`),
      ...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`),
    ],
  },
  {
    id: 'dfbd466a: «no tienen nada definido» = sin definir (#1074)', textos: [M_PAX, 'están buscando hoteles 4 estrellas', 'En cuanto al presupuesto, no tienen nada definido por ahora.'], yaTiene: { ...ESCRITO, categoria_hotel: '4' },
    fallas: (s) => debe(s.presupuesto?.valor === 'sin_definir', `presupuesto=${s.presupuesto?.valor ?? '—'}`),
  },
  {
    id: 'la bebé de 8 meses y el hijo de 5', textos: ['van ella, el esposo, la bebé de 8 meses y el hijo de 5 años, salen el 12 de diciembre desde Cali'],
    llena: ['ciudad_origen', 'fecha_salida', 'adultos', 'ninos', 'infantes', 'edades_menores'],
    fallas: (s) => [
      ...debe(num(s, 'adultos') === 2, `adultos=${s.adultos?.valor ?? '—'}`),
      ...debe(num(s, 'ninos') === 1, `ninos=${s.ninos?.valor ?? '—'}`),
      ...debe(num(s, 'infantes') === 1, `infantes=${s.infantes?.valor ?? '—'}`),
      ...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`),
    ],
  },
  {
    id: 'dos niños de 3 y 7', textos: ['viajan 2 adultos y dos niños de 3 y 7 años, 4 noches desde el 2 de enero'],
    llena: ['fecha_salida', 'fecha_regreso', 'adultos', 'ninos', 'edades_menores'],
    fallas: (s) => [...debe(num(s, 'ninos') === 2, `ninos=${s.ninos?.valor ?? '—'}`), ...debe((num(s, 'infantes') ?? 0) === 0, `infantes=${s.infantes?.valor}`)],
  },
  {
    id: '«algo económico» es duda, no rango (#1074)', textos: ['Quieren ir a Cartagena 5 noches desde el 3 de diciembre, algo económico'],
    llena: ['destino', 'fecha_salida', 'fecha_regreso'],
    fallas: (s, dudas) => [...debe(s.presupuesto === undefined, `presupuesto=${s.presupuesto?.valor}`), ...debe(dudas.length > 0, 'sin duda')],
  },
];

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};

if (import.meta.main) {
  const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
  const n = Number(arg('--n') ?? 1);
  const pedido = arg('--esquema') ?? 'completa';
  const esquemas = pedido === 'ambas' ? ['completa', 'compacta'] : [pedido];
  if (esquemas.some((x) => x !== 'completa' && x !== 'compacta')) { console.error('--esquema completa|compacta|ambas'); Deno.exit(2); }
  const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (llave.length < 20) { console.error('sin llave'); Deno.exit(2); }
  const medidas: Record<string, MedidaExtraccion[]> = Object.fromEntries(esquemas.map((x) => [x, []]));
  const cuenta: Record<string, { bien: number; total: number; llenos: number; exigidos: number; omitidos: number; errores: number }> =
    Object.fromEntries(esquemas.map((x) => [x, { bien: 0, total: 0, llenos: 0, exigidos: 0, omitidos: 0, errores: 0 }]));
  for (const c of CASOS_EXTRACCION) {
    const yaTiene = c.yaTiene ?? {};
    for (let k = 0; k < n; k++) {
      // Intercalados: los dos esquemas ven la misma hora de la API.
      for (const esquema of esquemas) {
        const compacta = esquema === 'compacta';
        const extraer = extraccionGemini(llave, medidas[esquema], { compacta });
        const q = cuenta[esquema];
        q.total++;
        let raw: unknown;
        try {
          raw = await extraer({ textos: c.textos, mensajes: '', campos: CAMPOS_ARNES, yaTiene, instrucciones: instruccionesCarga(CAMPOS_ARNES, HOY, yaTiene, {}, undefined, { compacta }) });
        } catch (e) {
          q.errores++;
          console.log(JSON.stringify({ caso: c.id, esquema, error: String(e).slice(0, 120) }));
          continue;
        }
        const v = validarCarga(raw, CAMPOS_ARNES, c.textos, { hoyISO: HOY, yaTiene });
        // Lo que el viaje ya tiene con el mismo valor no es nuevo (como en el resumen de la propuesta).
        const s: Sug = Object.fromEntries(Object.entries(v.sugeridos).filter(([key, x]) => String(yaTiene[key]) !== String(x.valor)));
        const fallas = c.fallas(s, v.dudas);
        const faltan = (c.llena ?? []).filter((slug) => !v.sugeridos[slug]);
        q.exigidos += (c.llena ?? []).length;
        q.llenos += (c.llena ?? []).length - faltan.length;
        const omitidos = compacta ? omitidosCompacta(raw, CAMPOS_ARNES) : [];
        q.omitidos += omitidos.length;
        if (!fallas.length) q.bien++;
        const m = medidas[esquema].at(-1);
        console.log(JSON.stringify({ caso: c.id, esquema, ok: !fallas.length, fallas, faltan, omitidos, ms: m?.ms, salida: m?.salida }));
      }
    }
  }
  for (const esquema of esquemas) {
    const ms = medidas[esquema].filter((x) => x.ok).map((x) => x.ms);
    const sal = medidas[esquema].filter((x) => x.ok).map((x) => x.salida ?? 0);
    const q = cuenta[esquema];
    console.log(JSON.stringify({
      modelo: MODELO_EXTRACCION, esquema, aciertos: `${q.bien}/${q.total}`, llenos: `${q.llenos}/${q.exigidos}`, omitidos: q.omitidos, errores: q.errores,
      ms_p50: pct(ms, 50), ms_p90: pct(ms, 90), salida_p50: pct(sal, 50), salida_p90: pct(sal, 90),
    }));
  }
}
