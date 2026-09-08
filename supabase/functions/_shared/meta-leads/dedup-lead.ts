/**
 * ¿A qué contacto pertenece este lead? — la política de enganche del webhook.
 *
 * ⚠️ **La regla de QUIÉN choca vive en SQL** (`buscar_contacto_duplicado`,
 * migración `20260902000007` y su reemplazo `20260908000001`): normaliza
 * teléfonos con formatos distintos, correos con mayúsculas y handles con arroba,
 * y lo hace indexado, sin traerse el workspace a memoria. Este módulo no la
 * reimplementa: recibe los candidatos y decide **qué hacer con ellos**, que es
 * una pregunta distinta y solo del webhook (la pantalla del directorio, con la
 * misma respuesta de la base, bloquea y le muestra el contacto a un humano).
 *
 * Está aparte del `index.ts` por una razón práctica: `index.ts` toca `Deno.env`
 * y la red, así que ningún check de CI lo puede colectar. Un módulo puro sí
 * (`vitest.config.ts` recoge `supabase/functions/**\/*.test.ts`), y esta es
 * justo la regla que no se puede verificar razonando: cada rama decide si una
 * persona termina con una ficha o con dos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * El agujero que cierra (medido el 2026-09-07 contra producción)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La regla anterior, cuando el teléfono coincidía y el correo declarado DIFERÍA
 * del contacto hallado, concluía "dos personas, un teléfono": creaba ficha nueva
 * y marcaba la interacción `posible_duplicado`. La intención era legítima —en
 * SOENA **17 teléfonos los comparten 39 contactos** (familias, y el intermediario
 * que radica), y fusionar por número borraría a una de las dos personas—. Pero
 * ignoraba el NOMBRE, que llegaba en el mismo formulario:
 *
 *   · Las **6** interacciones marcadas `posible_duplicado` desde el 2026-08-02
 *     eran la misma persona con un segundo correo, las 6. Hubo que fusionarlas
 *     a mano (BEATRIZ DAJUD, SILVIA CARDONA, DIEGO LÓPEZ, JOSÉ EDUARDO CORREDOR,
 *     FERNANDO ALBARRACIN, DIANA LUCIA OCHOA).
 *   · De los **17 grupos que comparten teléfono, CERO tienen el nombre repetido**.
 *
 * O sea: la regla nunca separó a nadie que hubiera que separar, y creó seis
 * fichas repetidas. Ahora el nombre desempata.
 *
 * ⚠️ **Enganchar, NO fusionar.** Cuando el nombre coincide, el lead se cuelga
 * del contacto que ya existe y **no se toca ni un campo** de ese contacto: el
 * correo que no cabe (`contactos.email` ya está ocupado) va a
 * `custom_data.emails_alternos` vía `registrar_email_alterno`, con la misma
 * convención que `fusionar_contactos` usa para lo que el ganador no pudo
 * heredar. Fusionar borra una ficha; esto no borra nada.
 *
 * ⚠️ **Y se marca `posible_duplicado` igual, aunque haya enganchado.** Agrupar
 * bien no quita que un humano deba confirmar que el segundo correo es de la
 * misma persona. La marca se ve en el directorio (chip "Posible duplicado") y en
 * la ficha del contacto.
 *
 * ⚠️ **El falso positivo que esto puede crear, dicho con todas las letras:**
 * padre e hijo con el MISMO nombre completo compartiendo el celular quedan como
 * un solo contacto. Es recuperable —queda un contacto con dos negocios, no se
 * borra nada, y la interacción queda marcada— y es mucho menos grave que el
 * duplicado silencioso, que es lo que veníamos pagando. Por la misma razón un
 * nombre de una sola palabra ("DIEGO", "JOSÉ") SÍ cuenta como nombre: 25 de los
 * 809 leads de SOENA llegan así, y no engancharlos garantizaría el duplicado que
 * este módulo existe para evitar. Lo que NO se hace nunca es deducir identidad
 * del nombre SOLO: sin teléfono, correo ni handle no hay enganche posible.
 */

/** Una fila de las que devuelve `buscar_contacto_duplicado`. */
export interface CandidatoContacto {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  usuario_whatsapp: string | null;
  /** Por cuál de las tres llaves chocó. */
  motivo: string;
}

/** Las tres llaves con las que se puede preguntar. */
export interface LlavesDedup {
  telefono?: string | null;
  email?: string | null;
  usuarioWhatsapp?: string | null;
}

/**
 * La consulta, inyectada. El webhook pasa la que llama la RPC; las pruebas
 * pasan una que devuelve filas de producción. Puede lanzar: un fallo al
 * comprobar NO es permiso para crear (ver el `dedup:` del webhook).
 */
export type BuscarCandidatos = (llaves: LlavesDedup) => Promise<CandidatoContacto[]>;

/** Lo que el formulario declaró, ya extraído del `field_data`. */
export interface DatosDelLead {
  nombre: string | null;
  email: string | null;
  /** Teléfono ya validado por `telefono_utilizable`, o null si no era teléfono. */
  telefono: string | null;
  /** Handle, cuando lo que llegó en el campo de teléfono no era un teléfono. */
  usuarioWhatsapp: string | null;
}

export interface DecisionDedup {
  /** null = no hay a quién colgarlo: hay que crear el contacto. */
  contactoId: string | null;
  /** Estado con el que nace la interacción. */
  estado: 'nueva' | 'posible_duplicado';
  /**
   * Correo declarado que no cabe en el contacto enganchado. Se guarda en
   * `custom_data.emails_alternos`; null cuando no hay nada que guardar.
   */
  emailAlterno: string | null;
  /** Llave por la que se resolvió. Solo para el registro (`console`). */
  motivo: 'email' | 'telefono' | 'usuario_whatsapp' | null;
}

/**
 * El marcador que pone el webhook cuando el formulario no trae nombre.
 * **No es un nombre y no puede desempatar nada**: dos leads sin nombre con el
 * mismo teléfono se parecerían entre sí y engancharían a ciegas. `fusionar_contactos`
 * ya trata este valor igual (cede ante cualquier nombre de verdad).
 */
const MARCADOR_SIN_NOMBRE = 'lead sin nombre';

/**
 * Nombre reducido a lo comparable: sin tildes, en minúsculas y con los espacios
 * colapsados. `null` si no queda nada o si es el marcador.
 *
 * Los nombres llegan de dos sitios que nunca coinciden en formato: Meta los
 * manda como los teclea la persona ("José  Eduardo   Corredor") y el directorio
 * los guarda en MAYÚSCULAS y sin tilde si quien los escribió no la puso.
 */
export function nombreComparable(valor: string | null | undefined): string | null {
  const base = (valor ?? '')
    .normalize('NFD')
    // Marcas diacríticas combinantes: cubre las cinco vocales y la eñe, que es
    // todo el español. Se hace por rango Unicode y no con una tabla de
    // reemplazos para que no haya una lista que mantener.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || base === MARCADOR_SIN_NOMBRE) return null;
  return base;
}

/** Normaliza un correo para compararlo: minúsculas y sin espacios de borde. */
export function emailComparable(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim().toLowerCase();
  return t.length ? t : null;
}

/** ¿Estos dos nombres son el mismo? Dos nombres ausentes NO son el mismo. */
export function mismoNombre(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = nombreComparable(a);
  return na !== null && na === nombreComparable(b);
}

/**
 * De varios dueños de la misma llave, el que corresponde al lead.
 *
 * Un teléfono compartido tiene varios candidatos y la base los devuelve del más
 * antiguo al más nuevo. Sin este paso, un lead del hijo —que YA tiene ficha— se
 * compara siempre contra la ficha de la madre (la más antigua del grupo), el
 * nombre no coincide y entra una tercera ficha. El grupo más grande de
 * producción tiene 5 contactos.
 *
 * Sin nombre que coincida, se devuelve el primero: exactamente lo que devolvía
 * la función cuando traía una sola fila.
 */
export function elegirCandidato(
  candidatos: CandidatoContacto[],
  nombre: string | null | undefined,
): CandidatoContacto | null {
  return candidatos.find((c) => mismoNombre(c.nombre, nombre)) ?? candidatos[0] ?? null;
}

/**
 * Decide sobre una llave que **puede estar compartida** (el teléfono y el
 * handle lo están; el correo no). Devuelve null si esa llave no encontró a
 * nadie, para que quien llama pase a la siguiente.
 */
function decidirConLlaveCompartida(
  candidatos: CandidatoContacto[],
  datos: DatosDelLead,
  motivo: 'telefono' | 'usuario_whatsapp',
): DecisionDedup | null {
  const elegido = elegirCandidato(candidatos, datos.nombre);
  if (!elegido) return null;

  const emailLead = emailComparable(datos.email);
  const emailContacto = emailComparable(elegido.email);
  // Solo hay conflicto si los DOS lados declararon correo y son distintos. Que
  // el contacto no tenga correo, o que el lead no lo traiga, no es evidencia de
  // nada: se engancha, como se venía haciendo.
  const correoDifiere = Boolean(emailLead && emailContacto && emailLead !== emailContacto);

  if (!correoDifiere) {
    return { contactoId: elegido.id, estado: 'nueva', emailAlterno: null, motivo };
  }

  // Mismo teléfono, mismo nombre, otro correo → una persona con dos correos.
  if (mismoNombre(elegido.nombre, datos.nombre)) {
    return {
      contactoId: elegido.id,
      estado: 'posible_duplicado',
      emailAlterno: datos.email,
      motivo,
    };
  }

  // Mismo teléfono, nombre distinto → dos personas compartiendo un número. Se
  // crea aparte y se marca, que es el comportamiento que este módulo conserva a
  // propósito: es el caso de las 17 familias.
  return { contactoId: null, estado: 'posible_duplicado', emailAlterno: null, motivo };
}

/**
 * ¿Este lead es de alguien que ya está en el directorio?
 *
 * Orden de las llaves: **correo, teléfono, handle**. El correo primero porque
 * identifica a una persona mejor que el teléfono, que se comparte entre familia
 * y empresa; el handle último porque hoy lo tienen 10 contactos de 1.129, pero
 * para 4 de ellos es el ÚNICO dato: sin esta llave el guardián no tiene con qué
 * compararlos y los deja pasar siempre.
 *
 * Cada llave se consulta solo si la anterior no resolvió, así que el caso normal
 * (el correo empata) sigue costando una consulta.
 */
export async function resolverContactoDelLead(
  datos: DatosDelLead,
  buscar: BuscarCandidatos,
): Promise<DecisionDedup> {
  if (emailComparable(datos.email)) {
    const elegido = elegirCandidato(await buscar({ email: datos.email }), datos.nombre);
    if (elegido) {
      return { contactoId: elegido.id, estado: 'nueva', emailAlterno: null, motivo: 'email' };
    }
  }

  if (datos.telefono) {
    const d = decidirConLlaveCompartida(await buscar({ telefono: datos.telefono }), datos, 'telefono');
    if (d) return d;
  }

  if (datos.usuarioWhatsapp) {
    const d = decidirConLlaveCompartida(
      await buscar({ usuarioWhatsapp: datos.usuarioWhatsapp }),
      datos,
      'usuario_whatsapp',
    );
    if (d) return d;
  }

  // Sin ninguna de las tres llaves no hay con qué comparar: se crea. Deducir la
  // persona del nombre suelto juntaría gente distinta — en este workspace hay
  // fichas que son un solo nombre de pila y dos "DIEGO" que no son el mismo.
  return { contactoId: null, estado: 'nueva', emailAlterno: null, motivo: null };
}
