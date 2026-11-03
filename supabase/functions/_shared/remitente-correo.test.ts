import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cabeceraMarcaAvisoHtml,
  DIRECCION_AVISOS_CLIENTE,
  dominioPermitido,
  logoParaCorreo,
  remitenteAvisoEtapa,
  remitenteAvisosPorDefecto,
  remitenteCliente,
  remitenteConfigurado,
} from './remitente-correo';

const escapar = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const LOGO = 'https://x.supabase.co/storage/v1/object/public/workspace-logos/w1/logo.jpeg';

describe('dominioPermitido', () => {
  it('metrikone.co y sus subdominios, metrik.com.co solo la raíz', () => {
    expect(dominioPermitido('avisos@metrikone.co')).toBe(true);
    expect(dominioPermitido('avisos@soena.metrikone.co')).toBe(true);
    expect(dominioPermitido('avisos@avisos.metrikone.co')).toBe(true);
    expect(dominioPermitido('Avisos@SOENA.MetrikOne.co')).toBe(true);
    expect(dominioPermitido('facturacion@metrik.com.co')).toBe(true);
    expect(dominioPermitido('x@envios.metrik.com.co')).toBe(false);
    expect(dominioPermitido('avisos@gruposoena.com')).toBe(false);
    // Un dominio que solo TERMINA en el texto permitido no es subdominio.
    expect(dominioPermitido('a@fakemetrikone.co')).toBe(false);
    expect(dominioPermitido('a@metrikone.co.evil.com')).toBe(false);
    expect(dominioPermitido('no-es-correo')).toBe(false);
  });
});

describe('remitenteAvisoEtapa (notificar-etapa)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sin la clave sale de avisos.metrikone.co con el nombre de siempre', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const configExtra of [null, {}, { email_respuesta: 'hola@soena.co' }]) {
      const r = remitenteAvisoEtapa({ marca: 'SOENA', configExtra });
      expect(r).toEqual({ from: 'SOENA (via MeTRIK) <avisos@avisos.metrikone.co>', propio: false });
    }
    expect(espia).not.toHaveBeenCalled();
  });

  it('con la clave válida sale desde el subdominio del workspace', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = remitenteAvisoEtapa({
      marca: 'SOENA',
      configExtra: { remitente_correo: { nombre: 'SOENA Movilidad', direccion: 'Avisos@soena.metrikone.co' } },
    });
    expect(r).toEqual({ from: 'SOENA Movilidad <avisos@soena.metrikone.co>', propio: true });
    expect(espia).not.toHaveBeenCalled();
  });

  it('sin nombre en la clave usa la marca', () => {
    const r = remitenteAvisoEtapa({
      marca: 'SOENA',
      configExtra: { remitente_correo: { direccion: 'avisos@soena.metrikone.co' } },
    });
    expect(r.from).toBe('SOENA <avisos@soena.metrikone.co>');
  });

  it('con la clave en un dominio no permitido la ignora, lo registra y sale el de siempre', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = remitenteAvisoEtapa({
      marca: 'SOENA',
      configExtra: { remitente_correo: { nombre: 'SOENA', direccion: 'avisos@gruposoena.com' } },
      contexto: 'workspace w1',
    });
    expect(r).toEqual({ from: 'SOENA (via MeTRIK) <avisos@avisos.metrikone.co>', propio: false });
    expect(espia).toHaveBeenCalledOnce();
    expect(String(espia.mock.calls[0][0])).toContain('gruposoena.com');
    expect(String(espia.mock.calls[0][0])).toContain('workspace w1');
  });

  it('una clave con forma rara tampoco rompe nada', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const crudo of ['avisos@soena.metrikone.co', { direccion: 42 }, { nombre: 'x' }]) {
      const r = remitenteAvisoEtapa({ marca: 'SOENA', configExtra: { remitente_correo: crudo } });
      expect(r.from).toBe('SOENA (via MeTRIK) <avisos@avisos.metrikone.co>');
    }
    expect(espia).toHaveBeenCalledTimes(3);
  });
});

describe('remitenteAvisosPorDefecto', () => {
  it('el nombre visible de cada envío, la dirección del subdominio de avisos', () => {
    expect(DIRECCION_AVISOS_CLIENTE).toBe('avisos@avisos.metrikone.co');
    expect(remitenteAvisosPorDefecto('Trappvel vía MéTRIK ONE')).toBe('Trappvel vía MéTRIK ONE <avisos@avisos.metrikone.co>');
    expect(remitenteAvisosPorDefecto('  ')).toBe('avisos@avisos.metrikone.co');
    // La dirección por defecto también tiene que pasar la lista de dominios permitidos.
    expect(dominioPermitido(DIRECCION_AVISOS_CLIENTE)).toBe(true);
  });
});

describe('remitenteCliente', () => {
  it('limpia del nombre lo que rompe la cabecera From', () => {
    const r = remitenteCliente({
      configExtra: { remitente_correo: { nombre: 'SOENA <"x">\r\n', direccion: 'a@metrikone.co' } },
      marca: 'SOENA',
      porDefecto: 'X <noreply@metrikone.co>',
    });
    expect(r.from).toBe('SOENA x <a@metrikone.co>');
  });

  it('remitenteConfigurado devuelve null sin la clave, sin registrar nada', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(remitenteConfigurado(null)).toBeNull();
    expect(remitenteConfigurado({ otra: 1 })).toBeNull();
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe('cabeceraMarcaAvisoHtml', () => {
  const textoDeSiempre =
    '<p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">SOENA</p>';

  it('sin remitente propio queda el texto de siempre aunque haya logo', () => {
    expect(cabeceraMarcaAvisoHtml({ marca: 'SOENA', logoUrl: LOGO, propio: false, escapar })).toBe(textoDeSiempre);
  });

  it('con remitente propio y logo, el logo', () => {
    const h = cabeceraMarcaAvisoHtml({ marca: 'SOENA', logoUrl: LOGO, propio: true, escapar });
    expect(h).toContain(`<img src="${LOGO}"`);
    expect(h).toContain('alt="SOENA"');
  });

  it('con remitente propio sin logo (o logo no https), el texto', () => {
    expect(cabeceraMarcaAvisoHtml({ marca: 'SOENA', logoUrl: null, propio: true, escapar })).toBe(textoDeSiempre);
    expect(cabeceraMarcaAvisoHtml({ marca: 'SOENA', logoUrl: 'http://x/l.png', propio: true, escapar })).toBe(textoDeSiempre);
  });

  it('logoParaCorreo solo acepta https sin comillas ni espacios', () => {
    expect(logoParaCorreo(LOGO)).toBe(LOGO);
    expect(logoParaCorreo('javascript:alert(1)')).toBeNull();
    expect(logoParaCorreo('https://x/a" onerror="y')).toBeNull();
    expect(logoParaCorreo(null)).toBeNull();
  });
});
