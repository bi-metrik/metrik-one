import { describe, expect, it } from 'vitest';
import {
  base64DeBytes,
  correoAnterior,
  procesarEnvio,
  type ContextoEnvio,
  type CorreoSaliente,
  type DatosPagador,
  type EnvioFila,
  type PrevioEnvio,
  type PuertosEnvio,
  type RespuestaCorreo,
} from './enviar-factura-cuota-flujo.ts';

const envioBase = (e: Partial<EnvioFila> = {}): EnvioFila => ({
  id: 'e1',
  workspace_id: 'ws-metrik',
  factura_cuota_id: 'f1',
  plan_cobro_cuota_id: 'q1',
  numero: 'FE-7',
  pdf_sha256: 'p'.repeat(64),
  xml_sha256: 'x'.repeat(64),
  estado: 'pendiente',
  intentos: 0,
  aviso_campana_at: null,
  correo_enviado_at: null,
  created_at: '2026-10-28T15:00:00Z',
  ...e,
});

const ctxBase = (c: Partial<ContextoEnvio> = {}): ContextoEnvio => ({
  vigente: true,
  pdfPath: 'ws/facturas/p.pdf',
  xmlPath: 'ws/facturas/x.xml',
  cuota: { numero: 3, monto: 150000 },
  totalCuotas: 12,
  contratos: [
    { id: 'sc', estado: 'activo', vigente_desde: '2026-09-23', workspace_pagador_id: 'ws-cda', aceptante_designado_id: 'des', servicio_slug: 'valida-cda-licencia' },
  ],
  ...c,
});

const pagadorBase = (d: Partial<DatosPagador> = {}): DatosPagador => ({
  slug: 'cda',
  servicio: 'Valida',
  empresa: { nombre: 'CDA S.A.S.', correo: 'fe@cda.co' },
  correoDesignado: 'ana@cda.co',
  ...d,
});

function doble(o: {
  envio?: EnvioFila | null;
  ctx?: ContextoEnvio;
  pagador?: DatosPagador;
  previos?: PrevioEnvio[];
  correo?: RespuestaCorreo;
  campanaFalla?: boolean;
} = {}) {
  const guardado: Record<string, unknown>[] = [];
  const campanas: Parameters<PuertosEnvio['avisarCampana']>[0][] = [];
  const correos: CorreoSaliente[] = [];
  const equipo: string[] = [];
  const p: PuertosEnvio = {
    ahora: () => '2026-10-28T16:00:00.000Z',
    tomar: async () => (o.envio === undefined ? envioBase() : o.envio),
    contexto: async () => o.ctx ?? ctxBase(),
    pagador: async () => o.pagador ?? pagadorBase(),
    previos: async () => o.previos ?? [],
    avisarCampana: async (c) => {
      if (o.campanaFalla) throw new Error('notificaciones caída');
      campanas.push(c);
    },
    descargarBase64: async (path) => `b64:${path}`,
    enviarCorreo: async (m) => {
      correos.push(m);
      return o.correo ?? { ok: true, id: 'rs_1' };
    },
    guardar: async (_id, c) => {
      guardado.push(c);
    },
    avisarEquipo: async ({ envioId }) => {
      equipo.push(envioId);
    },
  };
  const final = () => Object.assign({}, ...guardado);
  return { p, guardado, campanas, correos, equipo, final };
}

describe('enviar-factura-cuota: el flujo', () => {
  it('normal: campana a la persona designada y correo con los dos adjuntos', async () => {
    const d = doble();
    const r = await procesarEnvio('e1', d.p);
    expect(r).toEqual({ estado: 'enviado', resendId: 'rs_1' });
    expect(d.campanas).toHaveLength(1);
    expect(d.campanas[0]).toMatchObject({ workspacePagadorId: 'ws-cda', destinatarios: ['des'], cuotaId: 'q1', reemplazo: false });
    const m = d.correos[0];
    expect(m.from).toBe('MéTRIK · Facturación <facturacion@metrik.com.co>');
    expect(m.to).toEqual(['fe@cda.co']);
    expect(m.cc).toEqual(['ana@cda.co']);
    expect(m.bcc).toEqual(['mauricio.moreno@metrik.com.co']);
    expect(m.replyTo).toBe('mauricio.moreno@metrik.com.co');
    expect(m.idempotencyKey).toBe('factura-cuota/e1');
    expect(m.subject).toBe('Factura FE-7 · cuota 3 de 12 de Valida');
    expect(m.attachments).toEqual([
      { filename: 'FE-7.pdf', content: 'b64:ws/facturas/p.pdf' },
      { filename: 'FE-7.xml', content: 'b64:ws/facturas/x.xml' },
    ]);
    expect(d.final()).toMatchObject({
      estado: 'enviado',
      resend_id: 'rs_1',
      destinos: 'para: fe@cda.co, cc: ana@cda.co',
      correo_enviado_at: '2026-10-28T16:00:00.000Z',
      aviso_campana_at: '2026-10-28T16:00:00.000Z',
      tomado_at: null,
    });
  });

  it('sin XML: la campana sale y el correo queda omitido', async () => {
    const d = doble({ envio: envioBase({ xml_sha256: null }) });
    expect(await procesarEnvio('e1', d.p)).toEqual({ estado: 'omitido', motivo: 'sin_xml', campana: true });
    expect(d.campanas).toHaveLength(1);
    expect(d.correos).toHaveLength(0);
    expect(d.final()).toMatchObject({ estado: 'omitido', motivo: 'sin_xml' });
  });

  it('reintento con la campana ya hecha: no la repite', async () => {
    const d = doble({ envio: envioBase({ aviso_campana_at: '2026-10-28T15:01:00Z', estado: 'fallido', intentos: 1 }) });
    expect((await procesarEnvio('e1', d.p)).estado).toBe('enviado');
    expect(d.campanas).toHaveLength(0);
  });

  it('con un correo anterior enviado: reenvío y campana como reemplazo', async () => {
    const previos: PrevioEnvio[] = [
      { id: 'e0', numero: 'FE-6', estado: 'enviado', aviso_campana_at: '2026-10-27T15:00:00Z', correo_enviado_at: '2026-10-27T15:00:05Z', created_at: '2026-10-27T15:00:00Z' },
    ];
    const d = doble({ previos });
    await procesarEnvio('e1', d.p);
    expect(d.campanas[0].reemplazo).toBe(true);
    expect(d.correos[0].subject).toBe('Factura FE-7 (reenvío) · cuota 3 de 12 de Valida');
    expect(d.correos[0].text).toContain('Tome esta en lugar de la factura FE-6 que le enviamos el 27 de octubre de 2026.');
  });

  it('un envío anterior solo con PDF (correo omitido) no convierte el correo en reenvío', () => {
    expect(correoAnterior([
      { id: 'e0', numero: 'FE-7', estado: 'omitido', aviso_campana_at: 'x', correo_enviado_at: null, created_at: 'x' },
    ])).toBeNull();
    // Un correo rebotado no le llegó: tampoco es «el que le enviamos».
    expect(correoAnterior([
      { id: 'e0', numero: 'FE-7', estado: 'rebotado', aviso_campana_at: 'x', correo_enviado_at: '2026-10-27T15:00:00Z', created_at: 'x' },
    ])).toBeNull();
  });

  it('sin correo fiscal va a la persona designada; sin ninguno, omitido sin reintento', async () => {
    const a = doble({ pagador: pagadorBase({ empresa: { nombre: 'X', correo: null } }) });
    await procesarEnvio('e1', a.p);
    expect(a.correos[0].to).toEqual(['ana@cda.co']);
    expect(a.correos[0].cc).toEqual([]);

    const b = doble({ pagador: pagadorBase({ empresa: { nombre: 'X', correo: null }, correoDesignado: null }) });
    expect(await procesarEnvio('e1', b.p)).toMatchObject({ estado: 'omitido', motivo: 'sin_destinatario' });
  });

  it('sin contrato, sin pagador o factura reemplazada: omitido, sin campana ni correo', async () => {
    const sinContrato = doble({ ctx: ctxBase({ contratos: [] }) });
    expect(await procesarEnvio('e1', sinContrato.p)).toMatchObject({ estado: 'omitido', motivo: 'sin_contrato' });
    const sinPagador = doble({ ctx: ctxBase({ contratos: [{ ...ctxBase().contratos[0], workspace_pagador_id: null }] }) });
    expect(await procesarEnvio('e1', sinPagador.p)).toMatchObject({ estado: 'omitido', motivo: 'sin_pagador' });
    const reemplazada = doble({ ctx: ctxBase({ vigente: false }) });
    expect(await procesarEnvio('e1', reemplazada.p)).toMatchObject({ estado: 'omitido', motivo: 'reemplazada' });
    for (const d of [sinContrato, sinPagador, reemplazada]) {
      expect(d.campanas).toHaveLength(0);
      expect(d.correos).toHaveLength(0);
    }
  });

  it('sin persona designada: no hay campana, el correo sí sale al correo fiscal', async () => {
    const d = doble({
      ctx: ctxBase({ contratos: [{ ...ctxBase().contratos[0], aceptante_designado_id: null }] }),
      pagador: pagadorBase({ correoDesignado: null }),
    });
    expect((await procesarEnvio('e1', d.p)).estado).toBe('enviado');
    expect(d.campanas).toHaveLength(0);
    expect(d.correos[0].to).toEqual(['fe@cda.co']);
  });

  it('Resend falla: fallido con intentos + 1; al tercero avisa al equipo', async () => {
    const uno = doble({ correo: { ok: false, error: 'resend_500' } });
    expect(await procesarEnvio('e1', uno.p)).toEqual({ estado: 'fallido', error: 'resend_500', intentos: 1 });
    expect(uno.final()).toMatchObject({ estado: 'fallido', intentos: 1, ultimo_error: 'resend_500', tomado_at: null });
    expect(uno.equipo).toHaveLength(0);

    const tres = doble({ envio: envioBase({ estado: 'fallido', intentos: 2 }), correo: { ok: false, error: 'resend_500' } });
    expect(await procesarEnvio('e1', tres.p)).toMatchObject({ estado: 'fallido', intentos: 3 });
    expect(tres.equipo).toEqual(['e1']);
  });

  it('si la campana falla no se manda el correo en ese intento', async () => {
    const d = doble({ campanaFalla: true });
    expect(await procesarEnvio('e1', d.p)).toMatchObject({ estado: 'fallido', intentos: 1 });
    expect(d.correos).toHaveLength(0);
  });

  it('fila no disponible (ya enviada, tomada o agotada): no hace nada', async () => {
    const d = doble({ envio: null });
    expect(await procesarEnvio('e1', d.p)).toEqual({ estado: 'no_disponible' });
    expect(d.guardado).toHaveLength(0);
  });

  it('base64 por tramos da lo mismo que Buffer', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(base64DeBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
