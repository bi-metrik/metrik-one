import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalogo = vi.hoisted(() => ({ actual: null as null | { opera: boolean } }));

vi.mock('@/lib/actions/compliance-tier-catalogo', () => ({
  cargarCatalogoTierVigente: vi.fn(async () => catalogo.actual),
}));

import { clasificarParaGuardar } from './persistencia-consulta';

describe('consulta limpia: tier_opera sale del catálogo (QA 2026-10-12)', () => {
  beforeEach(() => {
    catalogo.actual = null;
  });

  it('con catálogo firmado opera, para que la vigencia sea la de sin_hallazgo', async () => {
    catalogo.actual = { opera: true };
    const c = await clasificarParaGuardar([]);
    expect(c.tier_opera).toBe(true);
    expect(c.tier_sin_clasificar).toBe(false);
  });

  it('con catálogo sin firma no opera (regla C2: nivel más corto)', async () => {
    catalogo.actual = { opera: false };
    expect((await clasificarParaGuardar([])).tier_opera).toBe(false);
  });

  it('sin catálogo queda null', async () => {
    expect((await clasificarParaGuardar([])).tier_opera).toBeNull();
  });
});
