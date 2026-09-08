/**
 * Pruebas de la política de enganche del webhook de Meta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * De dónde salen los datos
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Los contactos y los leads de estos casos son **filas reales de producción**,
 * leídas el 2026-09-07 del workspace de SOENA (`7dea141d…`). Los seis primeros
 * son las seis interacciones que quedaron marcadas `posible_duplicado` desde el
 * 2026-08-02 y que hubo que fusionar a mano; los cinco del teléfono 3208684813
 * son el grupo más grande que comparte un número. Van copiados con su fecha para
 * que el día que la base cambie se vea que la prueba envejeció, en vez de
 * parecer un defecto.
 *
 * El doble de la base (`baseFalsa`) **reproduce la búsqueda de
 * `buscar_contacto_duplicado`**, no solo la forma de la tabla: normaliza el
 * teléfono a los últimos 10 dígitos, el correo a minúsculas y el handle sin
 * arroba, y devuelve los candidatos **del más antiguo al más nuevo, hasta 10**.
 * Sin esa parte, el caso del teléfono compartido pasaría sin probar nada. El
 * cuerpo de SQL de verdad se verificó aparte, contra producción, comparando la
 * función desplegada con la nueva sobre estas mismas entradas (12 casos: 10
 * idénticos y 2 —los del handle— que difieren a propósito, que son los que
 * convierten los 10 iguales en evidencia).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Mutaciones corridas el 2026-09-07 sobre `dedup-lead.ts` (todas cayeron)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Números MEDIDOS con un arnés que sustituye la línea, corre vitest y restaura
 * (no estimados: de las 8 estimaciones previas, 7 estaban mal). Anotado aquí
 * para que quien lea dentro de seis meses sepa que el verde significa algo:
 *
 *   1. `mismoNombre` devolviendo siempre `false`             → 10 rojas
 *   2. `mismoNombre` devolviendo siempre `true`              →  6 rojas
 *   3. `nombreComparable` sin quitar diacríticos             →  2 rojas
 *   4. `nombreComparable` sin colapsar espacios              →  1 roja
 *   5. el marcador "Lead sin nombre" contando como nombre     →  2 rojas
 *   6. `elegirCandidato` devolviendo siempre `candidatos[0]` →  2 rojas
 *   7. `correoDifiere` sin exigir que el contacto tenga correo →  1 roja
 *   8. el orden de las llaves (teléfono antes que correo)    →  2 rojas
 *
 * Ninguna sobrevivió, así que no hay hueco de cobertura anotado. Si al re-correr
 * alguna deja de caer, la prueba que la atrapaba envejeció: se mide de nuevo,
 * no se copia este bloque.
 */
import { describe, it, expect } from 'vitest';
import {
  resolverContactoDelLead,
  elegirCandidato,
  nombreComparable,
  mismoNombre,
  type CandidatoContacto,
  type DatosDelLead,
  type LlavesDedup,
} from './dedup-lead';

// ── Contactos reales de SOENA (leídos el 2026-09-07) ──────────────────────
interface FilaContacto extends CandidatoContacto {
  created_at: string;
}

function contacto(
  id: string,
  nombre: string,
  telefono: string | null,
  email: string | null,
  created_at: string,
  usuario_whatsapp: string | null = null,
): FilaContacto {
  return { id, nombre, telefono, email, usuario_whatsapp, motivo: '', created_at };
}

const CONTACTOS: FilaContacto[] = [
  // Los seis que el webhook duplicó: el nombre es idéntico y el correo no.
  contacto('c253f439', 'BEATRIZ ELENA DAJUD-FERNANDEZ', '+573016970315', 'bdajud@yahoo.com', '2026-07-31'),
  contacto('bf7686ef', 'SILVIA CARDONA', '+573012764832', 'silviaecardonaa@hotmail.com', '2026-08-07'),
  contacto('dda8434c', 'DIEGO LOPEZ', '+573115125974', 'carolbravo10@hotmail.com', '2026-08-13'),
  contacto('3e5e2379', 'JOSÉ EDUARDO CORREDOR TORRES', '+573138707778', 'ecorredort@yahoo.es', '2026-08-04'),
  contacto('bdd9e5ba', 'FERNANDO ALBARRACIN', '+573138327403', 'fernandoalbarracincp@hotmail.com', '2026-07-23'),
  contacto('f9ce82ba', 'DIANA LUCIA OCHOA MONTOYA', '+573122073558', 'diana8a2011@icloud.com', '2026-08-19'),

  // El grupo más grande que comparte un teléfono: cinco personas distintas.
  contacto('19d9c69b', 'JORGE BASTÓ', '3208684813', 'jorjea@msn.com', '2026-04-07'),
  contacto('8390f073', 'DIANA GONZALEZ', '3208684813', null, '2026-07-30T10:00:00Z'),
  contacto('3bb321f0', 'LAURA BELTRAN', '3208684813', null, '2026-07-30T11:00:00Z'),
  contacto('678c00a8', 'RICARDO ANDRES OLIER', '3208684813', null, '2026-07-30T12:00:00Z'),
  contacto('64f45551', 'FABIAN PARRA', '3208684813', null, '2026-07-30T13:00:00Z'),

  // Contactos cuyo ÚNICO dato es el usuario de WhatsApp.
  contacto('3f7fcff1', 'JUAN DAVID MORENO GOMEZ', null, null, '2026-08-08', '@juandavidmoreno'),
  contacto('37ed758f', 'GLORIA BEATRIZ SERNA', null, null, '2026-08-26', '@beatrixes'),
];

// ── El doble de la base: la misma búsqueda que hace la RPC ────────────────
function tel10(v: string | null): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  if (!d) return null;
  return d.length >= 10 ? d.slice(-10) : d;
}
function wa(v: string | null): string | null {
  const t = (v ?? '').trim().replace(/^@+/, '').trim().toLowerCase();
  return t.length ? t : null;
}
function mail(v: string | null): string | null {
  const t = (v ?? '').trim().toLowerCase();
  return t.length ? t : null;
}

/**
 * Registra con qué llaves se preguntó y responde como la función de SQL:
 * teléfono normalizado a 10 dígitos, correo en minúsculas, handle sin arroba;
 * orden por `created_at` ascendente y techo de 10 filas.
 */
function baseFalsa(filas: FilaContacto[] = CONTACTOS) {
  const llamadas: LlavesDedup[] = [];
  const buscar = (llaves: LlavesDedup): Promise<CandidatoContacto[]> => {
    llamadas.push(llaves);
    const t = tel10(llaves.telefono ?? null);
    const m = mail(llaves.email ?? null);
    const w = wa(llaves.usuarioWhatsapp ?? null);
    const encontrados = filas
      .filter((c) =>
        (t !== null && c.telefono !== null && tel10(c.telefono) === t) ||
        (m !== null && mail(c.email) === m) ||
        (w !== null && wa(c.usuario_whatsapp) === w))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
      .slice(0, 10)
      .map((c) => ({
        ...c,
        motivo: t !== null && c.telefono !== null && tel10(c.telefono) === t
          ? 'telefono'
          : m !== null && mail(c.email) === m
            ? 'email'
            : 'usuario_whatsapp',
      }));
    return Promise.resolve(encontrados);
  };
  return { buscar, llamadas };
}

function lead(nombre: string | null, email: string | null, telefono: string | null, usuarioWhatsapp: string | null = null): DatosDelLead {
  return { nombre, email, telefono, usuarioWhatsapp };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('mismo teléfono + mismo nombre + correo distinto → engancha y marca', () => {
  // Los seis leads reales, tal como llegaron de Meta (nombre como lo teclearon,
  // con tildes y minúsculas donde las pusieron).
  const CASOS: Array<{ caso: string; lead: DatosDelLead; contacto: string }> = [
    { caso: 'BEATRIZ', lead: lead('Beatriz Elena Dajud-Fernandez', 'bdajud@gmail.com', '+573016970315'), contacto: 'c253f439' },
    { caso: 'SILVIA', lead: lead('Silvia Cardona', 'silviaecardona@hotmail.com', '+573012764832'), contacto: 'bf7686ef' },
    { caso: 'DIEGO', lead: lead('Diego López', 'carolinabernalbravo@gmail.com', '+573115125974'), contacto: 'dda8434c' },
    { caso: 'JOSÉ EDUARDO', lead: lead('José Eduardo Corredor Torres', 'ecorredor@gmail.com', '+573138707778'), contacto: '3e5e2379' },
    { caso: 'FERNANDO', lead: lead('Fernando Albarracin', 'sandrapajont@gmail.com', '+573138327403'), contacto: 'bdd9e5ba' },
    { caso: 'DIANA', lead: lead('Diana Lucia Ochoa Montoya', 'diana8a2011@hotmail.com', '+573122073558'), contacto: 'f9ce82ba' },
  ];

  for (const { caso, lead: datos, contacto: esperado } of CASOS) {
    it(`${caso}: se cuelga del contacto que ya existe, no crea otro`, async () => {
      const { buscar } = baseFalsa();
      const d = await resolverContactoDelLead(datos, buscar);
      expect(d.contactoId).toBe(esperado);
      // Aunque haya enganchado: un humano confirma que el segundo correo es suyo.
      expect(d.estado).toBe('posible_duplicado');
      // Y el correo que no cabe en el contacto no se pierde.
      expect(d.emailAlterno).toBe(datos.email);
      expect(d.motivo).toBe('telefono');
    });
  }
});

describe('mismo teléfono + nombre distinto → dos personas, un número', () => {
  it('crea ficha aparte y marca la interacción (comportamiento que se conserva)', async () => {
    const { buscar } = baseFalsa();
    // Alguien nuevo del grupo del 3208684813, con correo propio.
    const d = await resolverContactoDelLead(
      lead('Marcela Otero', 'marcela.otero@gmail.com', '3208684813'),
      buscar,
    );
    expect(d.contactoId).toBeNull();
    expect(d.estado).toBe('posible_duplicado');
    expect(d.emailAlterno).toBeNull();
  });

  it('sin correo declarado engancha al más antiguo, como antes', async () => {
    // No es un caso hipotético al revés: los 809 leads de Meta de SOENA traen
    // correo. Esta prueba fija que la rama sin correo NO cambió de comportamiento.
    const { buscar } = baseFalsa();
    const d = await resolverContactoDelLead(lead('Marcela Otero', null, '3208684813'), buscar);
    expect(d.contactoId).toBe('19d9c69b');
    expect(d.estado).toBe('nueva');
  });

  it('el contacto sin correo no cuenta como conflicto', async () => {
    // LAURA BELTRAN no tiene correo: que el lead traiga uno no es evidencia de
    // que sean dos personas.
    const { buscar } = baseFalsa();
    const d = await resolverContactoDelLead(
      lead('Laura Beltran', 'laura.beltran@gmail.com', '3208684813'),
      buscar,
    );
    expect(d.contactoId).toBe('3bb321f0');
    expect(d.estado).toBe('nueva');
    expect(d.emailAlterno).toBeNull();
  });
});

describe('el correo manda sobre el teléfono', () => {
  it('mismo correo → engancha sin marcar nada', async () => {
    const { buscar, llamadas } = baseFalsa();
    const d = await resolverContactoDelLead(
      lead('DIANA LUCIA OCHOA MONTOYA', 'diana8a2011@icloud.com', '+573122073558'),
      buscar,
    );
    expect(d.contactoId).toBe('f9ce82ba');
    expect(d.estado).toBe('nueva');
    expect(d.motivo).toBe('email');
    // Una sola consulta: si el correo resuelve, no se pregunta por teléfono.
    expect(llamadas).toEqual([{ email: 'diana8a2011@icloud.com' }]);
  });

  it('el correo en MAYÚSCULAS y con espacios es el mismo correo', async () => {
    const { buscar } = baseFalsa();
    const d = await resolverContactoDelLead(
      lead('Dora Salazar', '  DIANA8A2011@ICLOUD.COM ', null),
      buscar,
    );
    expect(d.contactoId).toBe('f9ce82ba');
    expect(d.estado).toBe('nueva');
  });
});

describe('usuario de WhatsApp como tercera llave', () => {
  it('handle que ya existe → engancha', async () => {
    const { buscar, llamadas } = baseFalsa();
    const d = await resolverContactoDelLead(
      lead('Juan David Moreno Gomez', null, null, '@juandavidmoreno'),
      buscar,
    );
    expect(d.contactoId).toBe('3f7fcff1');
    expect(d.estado).toBe('nueva');
    expect(d.motivo).toBe('usuario_whatsapp');
    expect(llamadas).toEqual([{ usuarioWhatsapp: '@juandavidmoreno' }]);
  });

  it('handle nuevo → crea', async () => {
    const { buscar } = baseFalsa();
    const d = await resolverContactoDelLead(lead('Alguien Nuevo', null, null, '@nadie_de_estos'), buscar);
    expect(d.contactoId).toBeNull();
    expect(d.estado).toBe('nueva');
    expect(d.motivo).toBeNull();
  });

  it('handle repetido con correo distinto y mismo nombre → engancha y marca', async () => {
    // Latente: hoy ningún handle está repetido en producción. La pantalla y el
    // formulario sí lo admiten, así que la rama existe y se prueba aquí.
    const { buscar } = baseFalsa([
      ...CONTACTOS,
      contacto('aaa11111', 'GLORIA BEATRIZ SERNA', null, 'gloria.serna@gmail.com', '2026-08-20', '@beatrixes'),
    ]);
    const d = await resolverContactoDelLead(
      lead('Gloria Beatriz Serna', 'gbserna@hotmail.com', null, 'beatrixes'),
      buscar,
    );
    expect(d.contactoId).toBe('aaa11111');
    expect(d.estado).toBe('posible_duplicado');
    expect(d.emailAlterno).toBe('gbserna@hotmail.com');
  });
});

describe('un lead sin ninguna de las tres llaves', () => {
  it('crea, no revienta y no consulta la base', async () => {
    const { buscar, llamadas } = baseFalsa();
    const d = await resolverContactoDelLead(lead('Persona Sin Datos', null, null, null), buscar);
    expect(d.contactoId).toBeNull();
    expect(d.estado).toBe('nueva');
    expect(d.emailAlterno).toBeNull();
    expect(llamadas).toEqual([]);
  });

  it('el nombre suelto NUNCA engancha', async () => {
    // Hay fichas que son un solo nombre de pila y dos "DIEGO" que no son el
    // mismo. Agrupar por nombre sin ninguna llave junta gente distinta.
    const { buscar } = baseFalsa();
    const d = await resolverContactoDelLead(lead('JORGE BASTÓ', null, null, null), buscar);
    expect(d.contactoId).toBeNull();
  });

  it('el error de la consulta se propaga: no es permiso para crear', async () => {
    const explota = () => Promise.reject(new Error('dedup: timeout'));
    await expect(
      resolverContactoDelLead(lead('Alguien', 'a@b.com', '3001234567'), explota),
    ).rejects.toThrow(/timeout/);
  });
});

describe('el marcador "Lead sin nombre" no es un nombre', () => {
  it('dos leads sin nombre con el mismo teléfono y correos distintos NO se enganchan', async () => {
    const { buscar } = baseFalsa([
      ...CONTACTOS,
      contacto('bbb22222', 'LEAD SIN NOMBRE', '3001112233', 'uno@gmail.com', '2026-08-01'),
    ]);
    const d = await resolverContactoDelLead(lead('Lead sin nombre', 'otro@gmail.com', '3001112233'), buscar);
    expect(d.contactoId).toBeNull();
    expect(d.estado).toBe('posible_duplicado');
  });
});

describe('nombreComparable', () => {
  it('las tildes y los espacios dobles no cambian el nombre', () => {
    expect(mismoNombre('José  Eduardo   Corredor Torres', 'JOSE EDUARDO CORREDOR TORRES')).toBe(true);
    expect(mismoNombre('  Diego López ', 'DIEGO LOPEZ')).toBe(true);
    expect(mismoNombre('Muñoz Peña', 'MUNOZ PENA')).toBe(true);
  });

  it('nombres distintos siguen siendo distintos', () => {
    expect(mismoNombre('JORGE BASTÓ', 'LAURA BELTRAN')).toBe(false);
    // Un apellido de más es otra persona hasta que alguien diga lo contrario.
    expect(mismoNombre('DIEGO LOPEZ', 'DIEGO LOPEZ RUIZ')).toBe(false);
  });

  it('dos ausencias no son una coincidencia', () => {
    expect(nombreComparable(null)).toBeNull();
    expect(nombreComparable('   ')).toBeNull();
    expect(nombreComparable('Lead sin nombre')).toBeNull();
    expect(mismoNombre(null, null)).toBe(false);
    expect(mismoNombre('', '')).toBe(false);
  });
});

describe('elegirCandidato', () => {
  const grupo = CONTACTOS.filter((c) => c.telefono === '3208684813');

  it('entre los dueños de un teléfono compartido elige a la persona del lead', () => {
    // Sin esto, un lead de LAURA se compararía contra JORGE (el más antiguo) y
    // entraría una sexta ficha en un grupo que ya tiene cinco.
    expect(elegirCandidato(grupo, 'Laura Beltran')?.id).toBe('3bb321f0');
    expect(elegirCandidato(grupo, 'Fabian Parra')?.id).toBe('64f45551');
  });

  it('sin nombre que coincida devuelve el más antiguo, como antes', () => {
    expect(elegirCandidato(grupo, 'Alguien Que No Está')?.id).toBe('19d9c69b');
    expect(elegirCandidato(grupo, null)?.id).toBe('19d9c69b');
  });

  it('sin candidatos devuelve null', () => {
    expect(elegirCandidato([], 'Laura Beltran')).toBeNull();
  });
});
