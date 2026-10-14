import { describe, expect, it } from 'vitest';
import { origenDesdeCabeceras } from './origen-tenant';

const cab = (m: Record<string, string>) => (n: string) => m[n] ?? null;

describe('origenDesdeCabeceras', () => {
  it('usa el slug del middleware aunque el host no traiga el subdominio', () => {
    expect(origenDesdeCabeceras(cab({ 'x-tenant-slug': 'alma-afi', host: 'metrik-one.vercel.app' }), 'metrikone.co'))
      .toBe('https://alma-afi.metrikone.co');
  });
  it('sin slug cae al host de la petición', () => {
    expect(origenDesdeCabeceras(cab({ 'x-forwarded-host': 'alma-afi.metrikone.co', 'x-forwarded-proto': 'https' }), 'metrikone.co'))
      .toBe('https://alma-afi.metrikone.co');
    expect(origenDesdeCabeceras(cab({ host: 'localhost:3000' }), 'localhost:3000')).toBe('http://localhost:3000');
  });
  it('ignora un slug con caracteres raros', () => {
    expect(origenDesdeCabeceras(cab({ 'x-tenant-slug': 'evil.com/x', host: 'a.metrikone.co' }), 'metrikone.co'))
      .toBe('https://a.metrikone.co');
  });
});
