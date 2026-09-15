---
name: render-bloque-datos-aislado
description: BloqueDatos SÍ se renderiza con renderToStaticMarkup usando 4 dobles; React SSR emite `inputMode` en camelCase y una prueba estática no puede ejercitar un rechazo que nace de un evento
metadata:
  type: reference
---

`BloqueDatos` —el componente más grande del detalle de negocio— **se deja renderizar en
aislamiento** con `renderToStaticMarkup` en el entorno `node` de vitest, sin DOM.
Precedente: `src/app/(app)/negocios/[id]/bloques/bloque-datos-numero-render.test.ts` (#736).

Hacen falta **cuatro** dobles, y ninguno más:

```ts
vi.mock('../../negocio-v2-actions', () => ({
  actualizarBloqueData: async () => ({ error: null }),
  marcarBloqueCompleto: async () => ({ error: null }),
  consultarRetornoDeCorreccion: async () => ({ aviso: null, etapa: null }),
}))
vi.mock('@/lib/actions/documento-actions', () => ({
  extraerCampoDesdeImagen: async () => ({ ok: true }),
  subirImagenClipboard: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/epayco-actions', () => ({ consultarEpayco: async () => ({ success: false }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
```

Todo lo demás que importa (Radix `InfoTooltip`, lucide, los helpers de `lib/negocios`,
`lib/dian/seccionales`, `lib/afi/template-mapping`) resuelve solo. `instancia` solo aporta
`data`: `{ id, data } as unknown as ...` alcanza.

⚠️ **React SSR emite los atributos DOM que no son HTML estándar en camelCase.** Buscar
`inputmode="decimal"` en el HTML da falso negativo; lo que sale es `inputMode="decimal"`.
Costó una corrida.

⚠️ **Una prueba estática mide el PRIMER render y nada más.** Un rechazo que nace de un
`change` (el aviso en rojo, el guardado frenado) **no se puede afirmar acá**: el estado
arranca vacío y no hay eventos. Lo que SÍ pinta —y es lo que vale— es la forma del input:
`type="text" inputMode="decimal"` en vez de `type="number"`. Esa mutación no la mata
ninguna prueba pura, por buena que sea la del parser. Para ejercitar el evento hace falta
la vía viva de [[qa-pantalla-viva-cdp]].

El archivo va en `.ts` (no `.tsx`): el `include` de `vitest.config.ts` es
`src/**/*.test.ts` y renombrar lo saca de la suite en silencio.
