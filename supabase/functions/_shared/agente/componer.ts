// ============================================================
// Asistentes MeTRIK — el componedor (spec 2026-10-26 asistentes-roles-y-funciones, §2.6)
// ------------------------------------------------------------
// Arma el `Dominio` del turno con SOLO las herramientas de las funciones del rol que la empresa tiene prendidas (la
// intersección la hace la RPC `asistente_resolver_rol`, o el mapa por cargo de ONE), más las comunes. Cada llamada va
// al motor dueño de esa herramienta (el `Dominio` de hoy: `one`, `publico`), que no cambia.
//
//   · Lo que no está declarado no existe para el modelo: el núcleo ya rechaza lo no declarado (`nucleo.ts`, «No existe la
//     herramienta»; acciones fuera de la lista, `accion_desconocida`). El componedor lo repite en `leer`, `proponer` y
//     `cerrar` por si alguien lo llama directo.
//   · Segunda llave en `ejecutar`: una propuesta cuya acción no es de una función del rol no se ejecuta (lanza), aunque
//     alguien la haya armado por fuera.
//   · El reglamento del turno (`reglamentoDelTurno`) lleva solo las fichas de esas funciones, la lista de temas de esas
//     funciones y la respuesta de fuera de tema armada por el código con lo que el rol sí hace.
//   · Una clave desconocida, sin motor o sin lo que requiere queda fuera y en el log: nunca abre nada.
// El núcleo no cambia de lógica: solo recibe otro `Dominio` y otro `Reglamento`.
// ============================================================

import { CATALOGO } from './funciones/catalogo.ts';
import type { Catalogo } from './funciones/catalogo.ts';
import type { Funcion, FuncionPrendida, MotorId } from './funciones/tipos.ts';
import type { DeclaracionHerramienta, Dominio, Ficha, Propuesta, RegistroConversacion, Reglamento } from './tipos.ts';

export interface OpcionesComponer {
  /** Los motores disponibles en este canal, por id (el orden manda en el orden de las herramientas). */
  motores: Record<MotorId, Dominio>;
  /** Las funciones del turno (ya intersecadas con las prendidas), con sus parámetros. Las comunes se agregan solas. */
  funciones: Array<string | FuncionPrendida>;
  catalogo?: Catalogo;
  /**
   * Por motor: qué propiedades de `datos` de `proponer` usa cada acción (ONE: `DATOS_POR_ACCION_ONE`). Sin esto, van
   * todas las del motor.
   */
  datosPorAccion?: Record<MotorId, Record<string, string[]>>;
  /**
   * El motor que prepara los adjuntos (baja, guarda y LEE cada foto o PDF) cuando hay más de uno que sabe hacerlo. Uno
   * solo: dos preparadores bajarían el mismo archivo dos veces y la última lectura pisaría a la otra en la fila. Sin
   * esto, el principal (el primero que aporta algo) si lo hace; si no, el primero que lo hace.
   */
  adjuntos?: MotorId;
  log?: (m: string) => void;
}

export interface Composicion {
  dominio: Dominio;
  /** Las funciones que quedaron (comunes incluidas), en el orden del catálogo de entrada. */
  funciones: Funcion[];
  parametros: Record<string, Record<string, unknown>>;
  /** Las que se pidieron y no entraron, con el motivo. */
  descartadas: Array<{ clave: string; motivo: string }>;
  /** Herramientas que una función dice tomar de un motor y el motor no declara (error de código: la prueba exige []). */
  errores: string[];
  /** Herramienta → función dueña. */
  duenas: Record<string, string>;
  /** Los nombres declarados: lecturas, cierres y acciones. */
  declaradas: { lecturas: string[]; cierres: string[]; acciones: string[] };
  /** Los motores de este canal (las fichas solo son «de una función» si la función toma algo de alguno de ellos). */
  motores: MotorId[];
}

type Tipo = 'lecturas' | 'acciones' | 'cierres';

const nombresDe = (d: Dominio, t: Tipo): string[] =>
  t === 'acciones' ? d.acciones : (t === 'lecturas' ? d.lecturas : d.cierres ?? []).map((x) => x.name);

const noExiste = (nombre: string) => `No existe la herramienta «${nombre}».`;

export function componerDominio(o: OpcionesComponer): Composicion {
  const catalogo = o.catalogo ?? CATALOGO;
  const log = o.log ?? ((m: string) => console.warn(`[componer] ${m}`));
  const descartadas: Composicion['descartadas'] = [];
  const parametros: Record<string, Record<string, unknown>> = {};

  // 1. Las pedidas que existen en el catálogo (sin repetir) más las comunes.
  const pedidas: Funcion[] = [];
  for (const x of o.funciones) {
    const clave = typeof x === 'string' ? x : x.funcion;
    const f = catalogo[clave];
    if (!f) {
      descartadas.push({ clave, motivo: 'no está en el catálogo del código' });
      continue;
    }
    if (f.comun || pedidas.includes(f)) continue;
    pedidas.push(f);
    parametros[clave] = typeof x === 'string' ? {} : (x.parametros ?? {});
  }
  // 2. Sin motor: una función que no toma nada de los motores de este canal (y no es un permiso sin herramientas).
  let quedan = pedidas.filter((f) => {
    const motores = Object.keys(f.herramientas);
    if (motores.length && !motores.some((m) => o.motores[m])) {
      descartadas.push({ clave: f.clave, motivo: `sin motor en este canal (${motores.join(', ')})` });
      return false;
    }
    return true;
  });
  // 3. Lo que requiere (hasta que no cambie: quitar una puede dejar sin requisito a otra).
  for (let cambio = true; cambio;) {
    cambio = false;
    const claves = new Set(quedan.map((f) => f.clave));
    quedan = quedan.filter((f) => {
      const falta = (f.requiere ?? []).filter((r) => !claves.has(r));
      if (falta.length) {
        descartadas.push({ clave: f.clave, motivo: `requiere ${falta.join(', ')}` });
        cambio = true;
        return false;
      }
      return true;
    });
  }
  const comunes = Object.values(catalogo).filter((f) => f.comun);
  const funciones = [...comunes, ...quedan];
  for (const f of comunes) parametros[f.clave] ??= {};
  for (const d of descartadas) log(`función fuera del turno: ${d.clave} (${d.motivo})`);

  // 4. Herramienta → función dueña y motor.
  const duenas: Record<string, string> = {};
  const motorDe: Record<string, MotorId> = {};
  const errores: string[] = [];
  for (const f of funciones) {
    for (const [m, h] of Object.entries(f.herramientas)) {
      const motor = o.motores[m];
      if (!motor || !h) continue;
      for (const t of ['lecturas', 'acciones', 'cierres'] as Tipo[]) {
        for (const nombre of h[t] ?? []) {
          if (!nombresDe(motor, t).includes(nombre)) {
            errores.push(`${f.clave}: el motor ${m} no declara ${t.slice(0, -1)} «${nombre}»`);
            continue;
          }
          if (duenas[nombre] && duenas[nombre] !== f.clave) {
            errores.push(`«${nombre}» es de ${duenas[nombre]} y de ${f.clave}`);
            continue;
          }
          duenas[nombre] = f.clave;
          motorDe[nombre] = m;
        }
      }
    }
  }
  for (const e of errores) log(e);

  // 5. Los motores que aportan algo. El primero es el principal (el `bot` de la traza y las banderas del dominio).
  const ids = Object.keys(o.motores);
  const usados = ids.filter((m) => Object.values(motorDe).includes(m));
  const principal = o.motores[usados[0] ?? ids[0]];
  const deUsados = <K extends keyof Dominio>(k: K) => usados.map((m) => o.motores[m]).filter((d) => d[k] !== undefined);

  const filtrar = (t: 'lecturas' | 'cierres'): DeclaracionHerramienta[] =>
    ids.flatMap((m) => (t === 'lecturas' ? o.motores[m].lecturas : o.motores[m].cierres ?? []).filter((x) => motorDe[x.name] === m));
  const lecturas = filtrar('lecturas');
  const cierres = filtrar('cierres');
  const acciones = ids.flatMap((m) => o.motores[m].acciones.filter((a) => motorDe[a] === m));

  const datosProponer: Record<string, unknown> = {};
  for (const m of usados) {
    const propias = acciones.filter((a) => motorDe[a] === m);
    if (!propias.length) continue;
    const mapa = o.datosPorAccion?.[m];
    const usar = mapa ? new Set(propias.flatMap((a) => mapa[a] ?? [])) : null;
    for (const [k, v] of Object.entries(o.motores[m].datosProponer)) {
      if (usar && !usar.has(k)) continue;
      // Dos motores con la misma propiedad (`texto`: anotar en un viaje y una actividad): una sola, con las dos
      // descripciones (cada una dice para qué acción es). Con tipos distintos no se puede: queda la primera y el log.
      datosProponer[k] = k in datosProponer ? unirPropiedad(k, datosProponer[k], v, log) : v;
    }
  }

  const motorDeAccion = (p: Propuesta) => (motorDe[p.accion] ? o.motores[motorDe[p.accion]] : null);
  // Un solo preparador de adjuntos (ver `adjuntos` arriba).
  const preparadores = usados.filter((m) => o.motores[m].prepararTurno);
  const preparador = o.adjuntos && preparadores.includes(o.adjuntos) ? o.adjuntos
    : preparadores.includes(usados[0]) ? usados[0] : preparadores[0];
  const deAdjuntos = preparador ? o.motores[preparador] : null;
  const ventanaAdjuntosMs = principal.ventanaAdjuntosMs ?? deAdjuntos?.ventanaAdjuntosMs;
  // Si los motores no dicen lo mismo de cuándo vence una propuesta, se dice por acción (la del motor dueño).
  const vencen = new Set(usados.map((m) => o.motores[m].propuestaVenceConRespuesta === true));

  const dominio: Dominio = {
    bot: principal.bot,
    ...(principal.reenvios ? { reenvios: principal.reenvios } : {}),
    ...(principal.propuestaVenceConRespuesta !== undefined ? { propuestaVenceConRespuesta: principal.propuestaVenceConRespuesta } : {}),
    ...(ventanaAdjuntosMs !== undefined ? { ventanaAdjuntosMs } : {}),
    ...(vencen.size > 1 ? { venceConRespuesta: (accion: string) => (motorDe[accion] ? o.motores[motorDe[accion]] : principal).propuestaVenceConRespuesta === true } : {}),
    ...(deUsados('topesResultado').length ? { topesResultado: Object.assign({}, ...deUsados('topesResultado').map((d) => d.topesResultado)) } : {}),
    lecturas,
    acciones,
    datosProponer,
    ...(cierres.length ? { cierres } : {}),
    async leer(nombre, args, ctx) {
      const m = lecturas.some((l) => l.name === nombre) ? motorDe[nombre] : undefined;
      if (!m) return { ok: false, datos: null, error: noExiste(nombre) };
      return await o.motores[m].leer(nombre, args, ctx);
    },
    async proponer(accion, datos, ctx) {
      const m = acciones.includes(accion) ? motorDe[accion] : undefined;
      if (!m) return { ok: false, error: `Acción desconocida. Usa una de: ${acciones.join(', ')}.`, candado: 'accion_desconocida' };
      return await o.motores[m].proponer(accion, datos, ctx);
    },
    async ejecutar(p, ctx) {
      // Segunda llave: la acción tiene que ser de una función del rol de ESTE turno.
      const m = acciones.includes(p.accion) ? motorDe[p.accion] : undefined;
      if (!m) throw new Error(`la acción «${p.accion}» no es de ninguna función de este rol: no se ejecuta`);
      return await o.motores[m].ejecutar(p, ctx);
    },
    ...(cierres.length ? {
      async cerrar(nombre: string, args: Record<string, unknown>, ctx: Parameters<NonNullable<Dominio['cerrar']>>[2]) {
        const m = cierres.some((c) => c.name === nombre) ? motorDe[nombre] : undefined;
        const motor = m ? o.motores[m] : undefined;
        if (!motor?.cerrar) return { ok: false as const, error: noExiste(nombre), candado: 'cierre_desconocido' };
        return await motor.cerrar(nombre, args, ctx);
      },
    } : {}),
    ...(deUsados('trasEjecutar').length ? {
      async trasEjecutar(p: Propuesta, h, huella, ctx) {
        const m = motorDeAccion(p);
        return m?.trasEjecutar ? await m.trasEjecutar(p, h, huella, ctx) : null;
      },
    } as Pick<Dominio, 'trasEjecutar'> : {}),
    ...(deUsados('sigueVigente').length ? {
      sigueVigente(p: Propuesta, ctx) {
        const m = motorDeAccion(p);
        return m?.sigueVigente ? m.sigueVigente(p, ctx) : true;
      },
    } as Pick<Dominio, 'sigueVigente'> : {}),
    ...(deAdjuntos?.prepararTurno ? { prepararTurno: (ctx) => deAdjuntos.prepararTurno!(ctx) } as Pick<Dominio, 'prepararTurno'> : {}),
    ...(deUsados('estado').length ? {
      async estado(ctx) {
        return (await Promise.all(deUsados('estado').map((d) => d.estado!(ctx)))).flat();
      },
    } as Pick<Dominio, 'estado'> : {}),
    ...(deUsados('registros').length ? {
      async registros(ctx) {
        const rs = await Promise.all(deUsados('registros').map((d) => d.registros!(ctx)));
        if (rs.includes('error')) return 'error';
        return (rs as RegistroConversacion[][]).flat();
      },
    } as Pick<Dominio, 'registros'> : {}),
    ...(deUsados('revisarRespuesta').length ? {
      revisarRespuesta(s, ctx) {
        for (const d of deUsados('revisarRespuesta')) {
          const e = d.revisarRespuesta!(s, ctx);
          if (e) return e;
        }
        return null;
      },
    } as Pick<Dominio, 'revisarRespuesta'> : {}),
    ...(deUsados('revisarTextoPropuesta').length ? {
      revisarTextoPropuesta(texto: string, p: Propuesta) {
        const m = motorDeAccion(p);
        return m?.revisarTextoPropuesta ? m.revisarTextoPropuesta(texto, p) : null;
      },
    } as Pick<Dominio, 'revisarTextoPropuesta'> : {}),
  };

  return {
    dominio, funciones, parametros, descartadas, errores, duenas, motores: ids,
    declaradas: { lecturas: lecturas.map((x) => x.name), cierres: cierres.map((x) => x.name), acciones },
  };
}

/** Una propiedad de `datos` que dos motores declaran: las dos descripciones en una (mismo tipo). Pura. */
function unirPropiedad(k: string, a: unknown, b: unknown, log: (m: string) => void): unknown {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const x = a as { type?: unknown; description?: unknown };
  const y = b as { type?: unknown; description?: unknown };
  if (JSON.stringify(x.type) !== JSON.stringify(y.type)) {
    log(`la propiedad «${k}» de proponer tiene tipos distintos en dos motores: queda la del primero`);
    return a;
  }
  const d = [x.description, y.description].filter((s): s is string => typeof s === 'string' && s.length > 0);
  return { ...x, ...y, ...(d.length ? { description: d.join(' ') } : {}) };
}

// ── El reglamento del turno ──────────────────────────────────────────────────

/** «a», «a y b», «a, b y c». Pura. */
export function enumerar(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`;
}

/** Lo que el rol sí hace, en el orden de sus funciones (las líneas `queHace` que no están vacías). Pura. */
export function loQueHace(c: Pick<Composicion, 'funciones'>): string[] {
  return c.funciones.map((f) => f.queHace).filter(Boolean);
}

/** La respuesta de fuera de tema armada con lo que el rol sí hace (§2.6, punto 3). Pura. */
export function textoFueraDeTema(c: Pick<Composicion, 'funciones'>): string {
  const hace = loQueHace(c);
  return hace.length ? `Eso no lo manejo por aquí. Te ayudo a ${enumerar(hace)}.` : 'Eso no lo manejo por aquí.';
}

export interface OpcionesReglamento {
  catalogo?: Catalogo;
  /**
   * Reescrituras de fichas de prosa que nombran todo lo que hace el bot (el perfil, `alc.temas`, la ayuda), por clave:
   * se aplican solo si el turno quedó SIN alguna función dueña de una ficha o un tema de este reglamento. Con todas las
   * funciones (el dueño de ONE hoy), el reglamento sale idéntico salvo `rf.fuera_de_tema`.
   */
  reescribir?: Record<string, (hace: string[], f: Ficha) => Ficha>;
}

/**
 * El reglamento del turno (§2.6, punto 2): sin las fichas de funciones que no están, sin las `con_herramienta` de
 * herramientas que no se declararon, con los temas de las funciones que están y con `rf.fuera_de_tema` del código. Una
 * ficha que no es de ninguna función del catálogo va siempre. La huella se vuelve a calcular aparte (si hace falta). Pura.
 */
export function fichasDelTurno(fichas: Ficha[], c: Composicion, o: OpcionesReglamento = {}): Ficha[] {
  const catalogo = o.catalogo ?? CATALOGO;
  const presentes = new Set(c.funciones.map((f) => f.clave));
  const duenasFicha = new Map<string, string[]>();
  const duenasTema = new Map<string, string[]>();
  // Solo cuentan las funciones de los motores de este canal: una ficha de Sabor que se llame como una de ONE no es de ONE.
  const relevantes = Object.values(catalogo).filter((f) => f.comun || Object.keys(f.herramientas).some((m) => c.motores.includes(m)));
  for (const f of relevantes) {
    for (const k of f.fichas) duenasFicha.set(k, [...(duenasFicha.get(k) ?? []), f.clave]);
    for (const t of f.temas ?? []) duenasTema.set(t, [...(duenasTema.get(t) ?? []), f.clave]);
  }
  const va = (duenas: string[] | undefined) => !duenas || duenas.some((d) => presentes.has(d));
  const declaradas = new Set([...c.declaradas.lecturas, ...c.declaradas.cierres, ...(c.declaradas.acciones.length ? ['proponer'] : [])]);

  let faltaAlguna = false;
  const quedan = fichas.filter((f) => {
    if (!va(duenasFicha.get(f.clave))) { faltaAlguna = true; return false; }
    if (f.carga === 'con_herramienta' && (f.herramientas ?? []).length && !(f.herramientas ?? []).some((h) => declaradas.has(h))) return false;
    return true;
  });
  const hace = loQueHace(c);
  return quedan.map((f) => {
    let g = f;
    if (g.clave === 'alc.temas' && Array.isArray(g.valores?.temas)) {
      const temas = (g.valores!.temas as unknown[]).map(String);
      const siguen = temas.filter((t) => va(duenasTema.get(t)));
      if (siguen.length !== temas.length) {
        faltaAlguna = true;
        g = { ...g, valores: { ...g.valores, temas: siguen } };
      }
    }
    // Sin ninguna línea de lo que hace (funciones que no la declaran), se deja la del reglamento.
    if (g.clave === 'rf.fuera_de_tema' && g.tipo === 'respuesta_fija' && hace.length) g = { ...g, hacer: textoFueraDeTema(c) };
    return g;
  }).map((f) => (faltaAlguna && o.reescribir?.[f.clave] ? o.reescribir[f.clave](hace, f) : f));
}

/** El reglamento del turno con su huella de siempre (`id` y `version` de la versión publicada). */
export async function reglamentoDelTurno(r: Reglamento, c: Composicion, o: OpcionesReglamento & { huella?: (f: Ficha[]) => Promise<string> } = {}): Promise<Reglamento> {
  const fichas = fichasDelTurno(r.fichas, c, o);
  const igual = fichas.length === r.fichas.length && fichas.every((f, i) => f === r.fichas[i]);
  if (igual) return r;
  return { ...r, fichas, huella: o.huella ? await o.huella(fichas) : r.huella };
}
