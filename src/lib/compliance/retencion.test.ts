import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { RETENCION_ANIOS, RETENCION_ANIOS_EN_LETRAS } from './retencion';

/**
 * Prueba de contrato del plazo de conservación de datos personales.
 *
 * ── Qué defiende ──────────────────────────────────────────────────────────
 *
 * Que ninguna superficie del repo declare un plazo de conservación distinto
 * del canónico. Nace de un defecto real y repetido: el 2026-09-10 se subió el
 * plazo de cinco a diez años en el texto que firma la contraparte y quedaron
 * en cinco cuatro menciones en tres archivos (los docstrings de arquitectura);
 * el 2026-09-11 apareció una quinta superficie —el copy del tutorial— que
 * tampoco se había movido.
 *
 * Las tres se escaparon del guardián que ya existía en CI
 * (`vinculacion-publica.test.ts`) porque ese guardián mira el texto firmado y
 * nada más. Un control sobre el artefacto legal no ve la prosa que lo explica,
 * y la prosa es la que se lee al construir lo siguiente.
 *
 * ⚠️ Los COMENTARIOS cuentan. Por ahí entraron tres de los cuatro hallazgos.
 *
 * ── Barrido por contenido, no lista de rutas ──────────────────────────────
 *
 * Se eligió barrer el repo entero en vez de enumerar las cinco superficies
 * conocidas, y la razón es medida: de **1.248 archivos** de `src/`,
 * `supabase/` y `scripts/`, solo **siete** contienen una cifra seguida de
 * «años». Cinco son superficies del plazo; los otros dos son el selector de
 * antigüedad del negocio y un dato de demostración. O sea que el barrido
 * amplio cuesta DOS clasificaciones de más y a cambio ve el archivo nuevo,
 * que es justo lo que una lista de rutas no puede ver.
 *
 * La contrapartida está declarada abajo: cada archivo con una cifra de años
 * tiene que estar clasificado en `CLASIFICACION`. Clasificarlo es la decisión;
 * el silencio no. Un archivo nuevo sin entrada hace caer la prueba.
 *
 * ⚠️ Los `*.test.ts` quedan FUERA del barrido a propósito: el guardián de
 * `vinculacion-publica.test.ts` tiene que poder seguir diciendo
 * «cinco (5) años» para hacer su trabajo, y otras dos pruebas usan años en
 * aritmética de fechas. Una prueba no declara un plazo: lo verifica.
 */

const RAIZ = resolve(process.cwd());

/** Árboles que se barren. Cubren lo que se despliega y lo que migra la base. */
const ARBOLES = ['src', 'supabase', 'scripts'];
const EXTENSIONES = /\.(tsx?|sql|mjs)$/;
const ES_PRUEBA = /\.test\.(tsx?|mjs)$/;
const DIRS_IGNORADOS = new Set([
  'node_modules',
  '.next',
  '.claude',
  '.temp',
  '.branches',
  '__fixtures__',
]);

type Clasificacion =
  /**
   * Habla del plazo de conservación. Toda cifra literal suya se juzga contra el
   * canónico, menos las frases de `salvo`.
   *
   * `declara` dice de dónde sale su número:
   * - `'literal'`: lo tiene escrito (prosa, docstring, copy sin interpolar).
   * - `'derivado'`: interpola `RETENCION_ANIOS`, así que NO puede divergir. En
   *   ese caso el barrido de texto no ve ninguna cifra, y lo que se verifica es
   *   que la referencia a la constante siga ahí — si alguien la reemplaza por un
   *   número a mano, el archivo pasa a `'literal'` mal clasificado y la prueba cae.
   */
  | {
      tipo: 'plazo';
      razon: string;
      declara: 'literal' | 'derivado';
      salvo?: { frase: string; razon: string }[];
    }
  /** Sus cifras de años hablan de otra cosa. Ninguna se juzga. */
  | { tipo: 'no-es-plazo'; razon: string };

/**
 * Toda superficie que habla del plazo, más todo archivo del repo que contiene
 * una cifra de años. Medido el 2026-09-11 sobre 1.248 archivos barridos.
 */
const CLASIFICACION: Record<string, Clasificacion> = {
  'src/lib/compliance/retencion.ts': {
    tipo: 'plazo',
    declara: 'literal',
    razon: 'la fuente única. Su docstring escribe el plazo y su fundamento legal.',
  },
  'src/lib/compliance/vinculacion-publica.ts': {
    tipo: 'plazo',
    declara: 'derivado',
    razon: 'el texto de conservación que FIRMA la contraparte. Es el artefacto legal.',
    salvo: [
      {
        // ⚠️ Exclusión explícita, con su razón escrita porque sin ella alguien la
        // "corrige" y falsea el argumento. Esta frase NO declara un plazo: explica
        // por qué se guarda `texto_version` junto con la aceptación —que dentro de
        // unos años nadie pueda decir QUÉ aceptó esta persona—. El "tres" es
        // retórico, no normativo. Si la frase se reescribe, el recorte deja de
        // aplicar y la cifra vuelve a juzgarse, que es el comportamiento correcto.
        frase: 'dentro de tres años nadie puede decir',
        razon: 'retórica sobre por qué se versiona el texto; no es un plazo',
      },
    ],
  },
  'src/lib/compliance/vinculacion.ts': {
    tipo: 'plazo',
    declara: 'derivado',
    razon:
      'docstring de arquitectura (por qué el dato no se copia a ONE) + copy del estado del expediente.',
  },
  'src/lib/actions/compliance-vinculacion.ts': {
    tipo: 'plazo',
    declara: 'literal',
    razon:
      'docstring de arquitectura + la advertencia de lo que implica invitar a una contraparte.',
  },
  'src/lib/compliance/solicitud-vinculacion.ts': {
    tipo: 'plazo',
    declara: 'literal',
    razon:
      'docstring que explica por qué no se invita a cualquiera: la empresa queda conservando expedientes.',
  },
  'src/lib/tutorials/_shared.ts': {
    tipo: 'plazo',
    declara: 'derivado',
    razon:
      'copy del historial auditable. La frase se autodescribe como «Soporte de auditoria SARLAFT», ' +
      'o sea que ES la bitácora que la política publicada de Valida declara en el mismo plazo.',
  },
  'src/app/(onboarding)/onboarding/page.tsx': {
    tipo: 'no-es-plazo',
    razon:
      'las cuatro cifras son los rangos de ANTIGÜEDAD del negocio en el onboarding («1 a 3 años»).',
  },
  'supabase/seed.sql': {
    tipo: 'no-es-plazo',
    razon:
      'dato de demostración: la vigencia de un dominio comprado («Dominio altiplano.co — 2 años»).',
  },
};

const NUMEROS_EN_LETRAS: Record<string, number> = {
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  quince: 15,
  veinte: 20,
};

/**
 * Una cifra de años en cualquiera de sus formas: `10 años`, `diez años`,
 * `diez (10) años`.
 *
 * ⚠️ Acepta `anos` sin eñe. Un plazo mal escrito sigue siendo un plazo
 * declarado, y el control cruzado de la torre tiene justo ese punto ciego:
 * lo que no lleva eñe no lo ve, así que «sin plazo declarado» puede querer
 * decir «está mal escrito».
 */
const CIFRA_DE_ANIOS = new RegExp(
  `(\\d+|${Object.keys(NUMEROS_EN_LETRAS).join('|')})\\s*(?:\\(\\s*(\\d+)\\s*\\))?\\s+a[ñn]os`,
  'gi',
);

/**
 * Una cifra de años escrita solo en código: `const RETENCION_ANIOS = 10`.
 *
 * ⚠️ `CIFRA_DE_ANIOS` exige la palabra «años» detrás del número, así que una
 * constante desnuda le es invisible. Es el mismo punto ciego un piso más
 * abajo: un guardián que lee prosa no lee código. En Valida ese hueco sí
 * mordía —la constante era la que escribía la fecha de borrado en la base— y
 * por eso el detector nació allá el 2026-09-11. Acá se porta para que los dos
 * gemelos vigilen igual y no haya que acordarse de cuál sabe menos.
 *
 * Hoy el barrido encuentra exactamente una: la canónica de `retencion.ts`.
 */
const CONSTANTE_DE_ANIOS =
  /\b[A-Z][A-Z0-9_]*(?:ANIOS|ANOS|A[NÑ]OS|YEARS)[A-Z0-9_]*\s*[:=]\s*(\d+)/g;

/**
 * Deja el archivo en una sola línea y sin los marcadores de comentario.
 *
 * ⚠️ Quitar el ` * ` del inicio de línea NO es cosmético: los docstrings se
 * parten donde caiga, y sin esto una declaración envuelta («retención de\n *
 * diez años») pasa invisible. Tres de los cuatro hallazgos históricos vivían
 * justo en docstrings.
 */
function normalizar(texto: string): string {
  return texto.replace(/^[ \t]*(?:\*|\/\/|--)[ \t]?/gm, '').replace(/\s+/g, ' ');
}

function archivosBarridos(): string[] {
  const salida: string[] = [];
  const caminar = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      if (DIRS_IGNORADOS.has(entrada)) continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) caminar(ruta);
      else if (EXTENSIONES.test(entrada) && !ES_PRUEBA.test(entrada)) salida.push(ruta);
    }
  };
  for (const base of ARBOLES) {
    const dir = join(RAIZ, base);
    if (existsSync(dir)) caminar(dir);
  }
  return salida;
}

/** Cifras de años que el archivo declara, ya descontadas las frases excluidas. */
function cifrasDeclaradas(ruta: string, salvo: { frase: string }[] = []) {
  let texto = normalizar(readFileSync(join(RAIZ, ruta), 'utf-8'));
  for (const { frase } of salvo) texto = texto.split(frase).join(' ');
  const cifras: { literal: string; valores: number[] }[] = [];
  for (const m of texto.matchAll(CIFRA_DE_ANIOS)) {
    const bruto = m[1].toLowerCase();
    const valores = [/^\d+$/.test(bruto) ? Number(bruto) : NUMEROS_EN_LETRAS[bruto]];
    if (m[2]) valores.push(Number(m[2]));
    cifras.push({ literal: m[0], valores });
  }
  for (const m of texto.matchAll(CONSTANTE_DE_ANIOS)) {
    cifras.push({ literal: m[0], valores: [Number(m[1])] });
  }
  return cifras;
}

describe('plazo de conservación de datos personales', () => {
  it('el plazo canónico son diez (10) años, y cambiarlo exige tocar esta prueba', () => {
    // ⚠️ Pin deliberado. Si la prueba solo comparara las superficies contra la
    // constante, mover la constante dejaría todo en verde y el control no
    // probaría nada: detectaría divergencia entre superficies, no un valor
    // equivocado. Fundamento: Ley 962 de 2005 art. 28, al que remiten la
    // Resolución 2328 de 2025 de Supertransporte (art. 5.6.11.4) y la Circular
    // Externa 100-000016 de 2020 de Supersociedades (num. 5.5). Fijado por
    // Emilio el 2026-09-10.
    expect(RETENCION_ANIOS).toBe(10);
    expect(RETENCION_ANIOS_EN_LETRAS).toBe('diez');
  });

  it('ninguna superficie declara un plazo distinto del canónico', () => {
    const fallos: string[] = [];
    for (const [ruta, clase] of Object.entries(CLASIFICACION)) {
      if (clase.tipo !== 'plazo') continue;
      for (const cifra of cifrasDeclaradas(ruta, clase.salvo)) {
        if (cifra.valores.every((v) => v === RETENCION_ANIOS)) continue;
        fallos.push(`${ruta}: "${cifra.literal}" (canónico: ${RETENCION_ANIOS})`);
      }
    }
    expect(
      fallos,
      'Estas superficies declaran un plazo de conservación que no es el canónico.\n  ' +
        fallos.join('\n  '),
    ).toEqual([]);
  });

  it('cada superficie del plazo sigue diciéndolo: con el número o con la constante', () => {
    // Sin esto el barrido puede quedar vacío y pasar igual: un regex roto y una
    // superficie sana se ven idénticos en verde. Familia del falso verde.
    const fallos: string[] = [];
    for (const [ruta, clase] of Object.entries(CLASIFICACION)) {
      if (clase.tipo !== 'plazo') continue;
      const fuente = readFileSync(join(RAIZ, ruta), 'utf-8');
      if (clase.declara === 'derivado') {
        if (!fuente.includes('RETENCION_ANIOS')) {
          fallos.push(`${ruta}: dice derivar de la constante y ya no la referencia`);
        }
        continue;
      }
      const canonicas = cifrasDeclaradas(ruta, clase.salvo).filter((c) =>
        c.valores.every((v) => v === RETENCION_ANIOS),
      );
      if (canonicas.length === 0) fallos.push(`${ruta}: ya no escribe el plazo`);
    }
    expect(
      fallos,
      'Estas superficies dejaron de declarar el plazo. O se borró el texto, o el barrido dejó de verlo.\n  ' +
        fallos.join('\n  '),
    ).toEqual([]);
  });

  it('cada exclusión declarada sigue existiendo en su archivo', () => {
    // Una exclusión que ya no recorta nada es deuda que envejece en silencio, y
    // además taparía la cifra del día que alguien reescriba esa frase.
    const fallos: string[] = [];
    for (const [ruta, clase] of Object.entries(CLASIFICACION)) {
      if (clase.tipo !== 'plazo' || !clase.salvo) continue;
      const texto = normalizar(readFileSync(join(RAIZ, ruta), 'utf-8'));
      for (const { frase } of clase.salvo) {
        if (!texto.includes(frase)) fallos.push(`${ruta}: "${frase}"`);
      }
    }
    expect(
      fallos,
      'Exclusiones que ya no aplican; hay que quitarlas.\n  ' + fallos.join('\n  '),
    ).toEqual([]);
  });

  it('ningún archivo del repo declara una cifra de años sin estar clasificado', () => {
    const sinClasificar: string[] = [];
    for (const absoluta of archivosBarridos()) {
      const ruta = relative(RAIZ, absoluta).split('\\').join('/');
      if (ruta in CLASIFICACION) continue;
      const [cifra] = cifrasDeclaradas(ruta);
      if (cifra) sinClasificar.push(`${ruta}: "${cifra.literal}"`);
    }
    expect(
      sinClasificar,
      'Estos archivos declaran una cifra de años —en prosa o en una constante— y\n' +
        'nadie dijo si es el plazo de conservación.\n' +
        'Clasifícalos en CLASIFICACION como "plazo" o "no-es-plazo", con su razón:\n  ' +
        sinClasificar.join('\n  '),
    ).toEqual([]);
  });
});
