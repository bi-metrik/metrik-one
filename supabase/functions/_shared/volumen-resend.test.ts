import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  correoAlarmaVolumen,
  diasQueFaltan,
  miles,
  porcentaje,
  whatsappAlarmaVolumen,
} from './alarma-volumen-resend';
import { contarEnviado, type DepsVolumen } from './volumen-resend';
import { filaAvisoEquipo } from './aviso-equipo';

const DATOS = {
  enviados: 40000,
  umbral: 40000,
  incluidos: 50000,
  periodo: '2026-10-01',
  periodoFin: '2026-11-01',
  hoy: '2026-10-26',
};

describe('el correo de la alarma', () => {
  it('asunto, remitente de sistema y destino', () => {
    const c = correoAlarmaVolumen(DATOS);
    expect(c.subject).toBe('Resend: 40.000 correos enviados este mes (de 50.000 incluidos)');
    expect(c.from).toBe('MéTRIK ONE <noreply@metrikone.co>');
    expect(c.to).toBe('mauricio.moreno@metrik.com.co');
    expect(c.idempotencyKey).toBe('resend-volumen:2026-10-01:40000');
  });

  it('el cuerpo lleva cuántos van, el porcentaje, el período, los días que faltan y el costo', () => {
    const { text, html } = correoAlarmaVolumen({ ...DATOS, enviados: 40213 });
    expect(text).toContain('Van 40.213 correos');
    expect(text).toContain('el 80,4% de los 50.000');
    expect(text).toContain('del 1 de octubre de 2026 al 31 de octubre de 2026');
    expect(text).toContain('Faltan 6 días');
    expect(text).toContain('US$0,90 por cada 1.000 correos');
    expect(html).toContain('Faltan 6 días');
  });

  it('singular de un día', () => {
    expect(correoAlarmaVolumen({ ...DATOS, hoy: '2026-10-31' }).text).toContain('Faltan 1 día para');
    expect(whatsappAlarmaVolumen({ ...DATOS, hoy: '2026-10-31' })).toContain('Faltan 1 día para');
  });

  it('cifras', () => {
    expect(miles(45000)).toBe('45.000');
    expect(miles(999)).toBe('999');
    expect(miles(1234567)).toBe('1.234.567');
    expect(porcentaje(45000, 50000)).toBe('90%');
    expect(porcentaje(44750, 50000)).toBe('89,5%');
    expect(diasQueFaltan('2026-10-26', '2026-11-01')).toBe(6);
    expect(diasQueFaltan('2026-11-02', '2026-11-01')).toBe(0);
  });
});

describe('filaAvisoEquipo', () => {
  it('une varios destinos y recorta título y motivo', () => {
    const f = filaAvisoEquipo({
      origen: 'notificar-etapa', workspaceId: 'w', negocioId: 'n', estado: 'enviado',
      destino: ['a@x.co', 'b@x.co'], titulo: 'x'.repeat(400), motivo: null, proveedorId: 'em_1',
    });
    expect(f).toMatchObject({ origen: 'notificar-etapa', workspace_id: 'w', negocio_id: 'n', canal: 'email', destino: 'a@x.co, b@x.co', proveedor_id: 'em_1', motivo: null });
    expect((f.titulo as string).length).toBe(300);
  });
});

// ── contarEnviado: el webhook con la base y Resend de mentira ────────────────

type Llamada = { fn: string; args: Record<string, unknown> };

function dobles(opts: {
  conteo: { data?: unknown; error?: { message: string } | null } | (() => never);
  resend?: { status: number; body: unknown } | 'red';
  whatsapp?: () => Promise<void>;
}) {
  const rpcs: Llamada[] = [];
  const inserts: Record<string, unknown>[] = [];
  const fetches: { url: string; init: RequestInit }[] = [];
  const svc = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === 'resend_contar_enviado') {
        if (typeof opts.conteo === 'function') return opts.conteo();
        return Promise.resolve({ data: opts.conteo.data ?? null, error: opts.conteo.error ?? null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (t: string) => ({
      insert: (fila: Record<string, unknown>) => {
        inserts.push({ tabla: t, ...fila });
        return Promise.resolve({ error: null });
      },
    }),
  };
  const fetchDoble = (async (url: RequestInfo | URL, init?: RequestInit) => {
    fetches.push({ url: String(url), init: init ?? {} });
    if (opts.resend === 'red') throw new Error('timeout');
    const r = opts.resend ?? { status: 200, body: { id: 'em_alarma' } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  const whatsapp = vi.fn(opts.whatsapp ?? (() => Promise.resolve()));
  const deps: DepsVolumen = { svc, llaveResend: 're_x', hoy: () => '2026-10-26', fetch: fetchDoble, whatsapp };
  return { deps, rpcs, inserts, fetches, whatsapp };
}

const CRUZA = { contado: true, periodo: '2026-10-01', periodo_fin: '2026-11-01', enviados: 40000, incluidos: 50000, umbral_cruzado: 40000 };

describe('contarEnviado', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sin umbral cruzado: cuenta y no manda nada', async () => {
    const d = dobles({ conteo: { data: [{ ...CRUZA, enviados: 123, umbral_cruzado: null }] } });
    expect(await contarEnviado(d.deps, 'msg_1')).toEqual({ contado: true, umbral: null, alarma: null });
    expect(d.rpcs).toEqual([{ fn: 'resend_contar_enviado', args: { p_svix_id: 'msg_1' } }]);
    expect(d.fetches).toHaveLength(0);
    expect(d.whatsapp).not.toHaveBeenCalled();
  });

  it('un svix-id repetido no cuenta ni avisa', async () => {
    const d = dobles({ conteo: { data: [{ contado: false, periodo: null, periodo_fin: null, enviados: null, incluidos: null, umbral_cruzado: null }] } });
    expect(await contarEnviado(d.deps, 'msg_1')).toEqual({ contado: false, razon: 'repetido' });
    expect(d.fetches).toHaveLength(0);
  });

  it('al cruzar: manda el correo con llave de idempotencia, deja traza y el WhatsApp', async () => {
    const d = dobles({ conteo: { data: [CRUZA] } });
    expect(await contarEnviado(d.deps, 'msg_1')).toEqual({ contado: true, umbral: 40000, alarma: 'enviada' });
    expect(d.fetches).toHaveLength(1);
    const headers = d.fetches[0].init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('resend-volumen:2026-10-01:40000');
    const cuerpo = JSON.parse(String(d.fetches[0].init.body));
    expect(cuerpo.to).toEqual(['mauricio.moreno@metrik.com.co']);
    expect(cuerpo.subject).toBe('Resend: 40.000 correos enviados este mes (de 50.000 incluidos)');
    expect(d.inserts).toEqual([
      expect.objectContaining({ tabla: 'avisos_equipo', origen: 'resend-volumen', workspace_id: null, estado: 'enviado', proveedor_id: 'em_alarma' }),
    ]);
    expect(d.whatsapp).toHaveBeenCalledOnce();
    expect(d.rpcs.map((r) => r.fn)).toEqual(['resend_contar_enviado']);
  });

  it('si el correo no sale: traza fallida, desmarca el umbral y no manda WhatsApp', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = dobles({ conteo: { data: [CRUZA] }, resend: { status: 500, body: { message: 'caido' } } });
    expect(await contarEnviado(d.deps, 'msg_1')).toEqual({ contado: true, umbral: 40000, alarma: 'fallida' });
    expect(d.inserts[0]).toMatchObject({ estado: 'fallido' });
    expect(d.rpcs[1]).toEqual({ fn: 'resend_volumen_desmarcar', args: { p_periodo: '2026-10-01', p_umbral: 40000 } });
    expect(d.whatsapp).not.toHaveBeenCalled();
  });

  it('un fallo de red al mandar tampoco lanza', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = dobles({ conteo: { data: [CRUZA] }, resend: 'red' });
    expect(await contarEnviado(d.deps, 'msg_1')).toMatchObject({ alarma: 'fallida' });
  });

  it('un WhatsApp que lanza no tumba nada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = dobles({ conteo: { data: [CRUZA] }, whatsapp: () => Promise.reject(new Error('meta')) });
    expect(await contarEnviado(d.deps, 'msg_1')).toMatchObject({ alarma: 'enviada' });
  });

  it('nunca lanza: error de la RPC, RPC que revienta, o sin svix-id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await contarEnviado(dobles({ conteo: { error: { message: 'x' } } }).deps, 'msg_1')).toEqual({ contado: false, razon: 'error' });
    expect(await contarEnviado(dobles({ conteo: () => { throw new Error('boom'); } }).deps, 'msg_1')).toEqual({ contado: false, razon: 'error' });
    const d = dobles({ conteo: { data: [CRUZA] } });
    expect(await contarEnviado(d.deps, '')).toEqual({ contado: false, razon: 'sin_svix_id' });
    expect(d.rpcs).toHaveLength(0);
  });

  it('sin RESEND_API_KEY: no intenta el POST y desmarca', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = dobles({ conteo: { data: [CRUZA] } });
    expect(await contarEnviado({ ...d.deps, llaveResend: '' }, 'msg_1')).toMatchObject({ alarma: 'fallida' });
    expect(d.fetches).toHaveLength(0);
    expect(d.inserts[0]).toMatchObject({ motivo: 'sin_resend_api_key' });
  });
});
