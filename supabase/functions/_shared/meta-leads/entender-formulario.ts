// ============================================================
// Entender un formulario de Meta que nadie configuró a mano
// ------------------------------------------------------------
// `config_extra.meta_leads.field_map` dice qué campo del formulario es el
// nombre, cuál el teléfono y cuál el correo, con los nombres EXACTOS. Está
// escrito a mano por workspace, y el formulario lo edita otra persona en otra
// herramienta. En agosto de 2026 un formulario nuevo empezó a mandar
// `nombre_completo` y `correo_electrónico` donde el mapa esperaba `full_name` y
// `email`: 97 leads con el contacto vacío durante dos semanas, sin síntoma.
//
// La red por parecido (PR #497) cubre el caso conocido: 'nombre_completo'
// contiene 'nombre', 'número_de_teléfono' contiene 'tel'. No cubre el
// desconocido: "¿A qué número te escribimos?" no contiene ninguno de los dos.
//
// ⚠️ **El modelo NO va en el camino del lead. Va una vez, por formulario.**
//
// Esta es la decisión de diseño que sostiene todo lo demás. El webhook mira
// primero si ya hay un mapa guardado para ese `form_id`; si lo hay, resuelve sin
// modelo y sin latencia. Solo un `form_id` que el workspace nunca ha visto llega
// hasta aquí. Son unos pocos al año, no uno por lead. Consecuencias:
//
//   · el camino caliente sigue siendo determinista y auditable;
//   · lo que el modelo decidió queda ESCRITO, así que se puede leer, corregir a
//     mano y explicar. Un modelo consultado en cada lead decide en secreto y
//     puede decidir distinto dos veces con la misma entrada;
//   · si el modelo está caído, el lead entra igual por la red por parecido. El
//     webhook nunca depende de que el modelo esté arriba.
//
// ⚠️ **Solo salen los NOMBRES de los campos, nunca los valores.** El valor de un
// campo es el teléfono, el correo y el nombre de una persona real. Para decidir
// que `numero_whatsapp` es el teléfono no hace falta ver el número de nadie, y
// mandarlo sería sacar datos personales de clientes a un tercero sin motivo.
// Esta es una regla del módulo, no un detalle de implementación: la firma de
// `entenderFormulario` recibe `string[]`, y no un objeto de campos, justamente
// para que no se pueda romper por descuido.
// ============================================================

/** Los papeles que ONE necesita reconocer en cualquier formulario de Meta. */
export interface MapaFormulario {
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  /** Campo que dice si el lead es persona natural o jurídica. */
  tipo_persona: string | null;
  /** Campo que describe lo que el lead quiere (en SOENA, marca-línea-modelo del
   *  vehículo). Lo consume el nombre del negocio al convertir la interacción. */
  descripcion: string | null;
}

/** Lo que se guarda en `config_extra`: el mapa más de dónde salió. */
export interface MapaGuardado extends MapaFormulario {
  _origen: {
    modelo: string;
    creado_en: string;
    /** Los campos que traía el formulario cuando se aprendió. Si el formulario
     *  cambia, esto es lo que permite ver que el mapa quedó viejo. */
    campos: string[];
  };
}

// `gemini-3.1-flash-lite` es el que ya usan `parse-ve-docs` y `serialize` en este
// repo con esta misma API key. La tarea (poner cinco etiquetas sobre una lista de
// nombres de campo) no necesita más.
//
// No se toca la configuración de "thinking": en la familia 3.x se controla con
// `thinking_level` y no con el `thinkingBudget` numérico de la 2.5, que en 3.x se
// ignora en silencio (esa confusión ya costó una corrección en
// `src/lib/ai/extract-fields.ts`). A una llamada por formulario nuevo, el ahorro
// no compensa el riesgo de escribir un parámetro que no aplica.
const MODELO = 'gemini-3.1-flash-lite';

// Corto a propósito. Esto corre después del 200 a Meta, dentro de waitUntil, así
// que no retrasa la respuesta; pero un worker esperando un modelo colgado tampoco
// sirve de nada cuando la red por parecido está lista para responder ya.
const TIMEOUT_MS = 15_000;

const INSTRUCCION = `Eres un clasificador de campos de formularios de Meta Lead Ads.

Recibes la lista de NOMBRES de los campos de un formulario. No ves valores.
Devuelves qué nombre de la lista cumple cada papel:

- nombre: el nombre de la persona que llenó el formulario.
- email: su correo electrónico.
- telefono: el número al que se le puede llamar o escribir por WhatsApp.
- tipo_persona: si declara ser persona natural o jurídica (empresa).
- descripcion: qué producto, servicio o modelo le interesa.

Reglas:
- Cada valor debe ser un nombre COPIADO EXACTO de la lista, carácter por carácter.
- Si ningún campo cumple un papel, ese papel va en null. No inventes ni fuerces.
- Un campo solo puede cumplir un papel. Ante la duda, el papel más específico.
- Los formularios pueden estar en español, inglés o mezclados, y los nombres
  suelen venir en minúsculas con guiones bajos y a veces con la pregunta entera.`;

interface RespuestaGemini {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Le pregunta al modelo qué es cada campo del formulario.
 *
 * Devuelve `null` ante cualquier problema (sin API key, error de red, timeout,
 * respuesta que no es el JSON esperado). **Nunca lanza**: quien llama está en el
 * camino de un lead, y un lead que no entra es peor que un mapa que no se
 * aprendió. El que llama cae a la red por parecido y vuelve a intentarlo con el
 * siguiente lead del mismo formulario.
 */
export async function entenderFormulario(
  camposDelFormulario: string[],
): Promise<{ mapa: MapaFormulario; modelo: string } | null> {
  const campos = camposDelFormulario.filter((c) => typeof c === 'string' && c.trim());
  if (!campos.length) return null;

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) {
    console.warn('[meta-leads] GEMINI_API_KEY no esta en el entorno: no se entiende el formulario');
    return null;
  }

  // El esquema obliga la forma de la respuesta. Sin él, el modelo devuelve prosa
  // alrededor del JSON la mitad de las veces y hay que parsearla a mano.
  const papeles = ['nombre', 'email', 'telefono', 'tipo_persona', 'descripcion'] as const;
  const propiedades: Record<string, { type: string; nullable: boolean }> = {};
  for (const p of papeles) propiedades[p] = { type: 'string', nullable: true };

  const cuerpo = {
    contents: [{
      role: 'user',
      parts: [{ text: `Campos del formulario:\n${campos.map((c) => `- ${c}`).join('\n')}` }],
    }],
    systemInstruction: { parts: [{ text: INSTRUCCION }] },
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: propiedades, required: [...papeles] },
    },
  };

  let texto: string;
  try {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(cuerpo),
          signal: control.signal,
        },
      );
      if (!res.ok) {
        console.error(`[meta-leads] Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return null;
      }
      const data = await res.json() as RespuestaGemini;
      texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    } finally {
      clearTimeout(reloj);
    }
  } catch (e) {
    console.error('[meta-leads] Gemini no respondio:', e instanceof Error ? e.message : e);
    return null;
  }

  let crudo: Record<string, unknown>;
  try {
    crudo = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    console.error('[meta-leads] Gemini devolvio algo que no es JSON:', texto.slice(0, 300));
    return null;
  }

  return { mapa: validarContraElFormulario(crudo, campos), modelo: MODELO };
}

/**
 * Se queda solo con lo que el modelo pudo haber sabido.
 *
 * ⚠️ Esto no es paranoia de estilo: sin este filtro, un campo alucinado se
 * GUARDA en la configuración del workspace y a partir de ahí el formulario queda
 * roto para siempre, en silencio y sin que nadie lo relacione con el modelo. Un
 * nombre que no está en la lista no puede resolver nada, así que se descarta.
 *
 * El emparejamiento tolera diferencias de mayúsculas y de espacios porque el
 * modelo a veces normaliza al copiar; se devuelve SIEMPRE el nombre original del
 * formulario, no el que escribió el modelo.
 */
export function validarContraElFormulario(
  crudo: Record<string, unknown>,
  campos: string[],
): MapaFormulario {
  const porClave = new Map(campos.map((c) => [c.trim().toLowerCase(), c]));
  const resolver = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const encontrado = porClave.get(v.trim().toLowerCase());
    if (!encontrado) {
      if (v.trim()) console.warn(`[meta-leads] el modelo invento el campo "${v}": descartado`);
      return null;
    }
    return encontrado;
  };

  const mapa: MapaFormulario = {
    nombre: resolver(crudo.nombre),
    email: resolver(crudo.email),
    telefono: resolver(crudo.telefono),
    tipo_persona: resolver(crudo.tipo_persona),
    descripcion: resolver(crudo.descripcion),
  };

  // Un campo no puede cumplir dos papeles: si el modelo repite uno, gana el
  // primero en este orden y los demás quedan vacíos. Dejar el mismo campo como
  // nombre Y como teléfono garantiza que uno de los dos quede mal.
  const visto = new Set<string>();
  for (const papel of ['nombre', 'email', 'telefono', 'tipo_persona', 'descripcion'] as const) {
    const v = mapa[papel];
    if (!v) continue;
    if (visto.has(v)) {
      console.warn(`[meta-leads] el modelo uso "${v}" para dos papeles: se descarta en ${papel}`);
      mapa[papel] = null;
    } else {
      visto.add(v);
    }
  }

  return mapa;
}
