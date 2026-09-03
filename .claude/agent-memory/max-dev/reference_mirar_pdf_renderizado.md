---
name: mirar-pdf-renderizado
description: Cómo generar y MIRAR de verdad un PDF de @react-pdf desde un worktree aislado, sin poppler ni sudo — y cómo probar que otro PDF no cambió, byte a byte
metadata:
  type: reference
---

Para un encargo de diseño de PDF, «lo revisé» solo vale si se vio la página. Lo que
funcionó el 2026-09-03 (PR #522, plantilla de cotización Termotech), de punta a punta:

**1. Renderizar.** No hay `tsx` en el repo, pero sí `vitest`, que transpila TSX y resuelve
el alias `@`. El arnés es un `*.test.ts` temporal dentro de `src/` que llama
`renderToBuffer(createElement(Componente, props))` y escribe a disco. Se borra antes de
commitear. (Los componentes son `.tsx` pero el arnés es `.test.ts` porque el `include` de
`vitest.config.ts` solo recoge `.test.ts`; con `createElement` no hace falta JSX.)

**2. Rasterizar.** `pdftoppm` **no está instalado y no hay sudo** (`apt-get` falla con
lock de dpkg), ni PyMuPDF (`pip` bloqueado por PEP 668). Lo que sí sirve:

```
mkdir -p _qa/rast && cd _qa/rast && npm init -y && npm install pdf-to-img
```

`pdf-to-img` trae pdfjs + `@napi-rs/canvas` con binarios precompilados: 4 paquetes, 3 s,
sin compilar nada. ⚠️ **Instalarlo en un prefijo aparte**, nunca en el `node_modules`
symlinkeado del repo principal — se contaminaría el repo de todos.

**3. Mirar.** La herramienta **Read lee PNG directo**. Con `scale: 2` el texto de 7 pt se
lee bien. Borrar `_qa/rast/node_modules` antes de `npm run build` y antes de commitear.

Esto encontró tres defectos que ninguna prueba habría visto: separación silábica inglesa
sobre palabras españolas, una caja con borde cortada al pie de página, y una fila
desbordada sobre la columna vecina.

## Probar que OTRO PDF no cambió, byte a byte

Cuando el encargo dice «los demás siguen viendo exactamente el PDF de hoy», eso se mide:

```
git show origin/main:src/lib/pdf/<comp>.tsx > src/lib/pdf/_comp-main.tsx
```

y se renderiza **el de main y el de la rama en el mismo proceso**, con las mismas props.
Difieren siempre en `/CreationDate`, `/ModDate` y `/ID`: se normalizan con regex. Dos
resguardos que hacen válida la comparación, y sin los cuales no prueba nada:

- **control**: dos renders del MISMO componente tienen que diferir **sin** normalizar
  (`expect(a.equals(b)).toBe(false)`) y coincidir **con** normalizar. Si no, el
  normalizador podría estar borrando el contenido.
- **mutación**: cambiar un `fontSize` en 0,01 pt y ver el test en rojo antes de creerle.

Y pasarle al componente viejo **también las props nuevas**: es la única forma de
comprobar que las ignora.

## Gotchas de react-pdf que costaron una vuelta

- **`fixed` en un `<View>` de la tabla repite la cabecera en cada página**, y deja de
  repetirla cuando el contenedor termina. Es la respuesta a «el encabezado debe repetirse
  entre páginas». `wrap={false}` por fila evita que una fila se parta.
- **`hyphenationCallback` es prop de `<Text>`**, no solo global. `Font.registerHyphenationCallback`
  es GLOBAL del proceso y cambiaría todos los demás PDF de la app: en un encargo que
  promete no tocar los otros formatos, la versión global está prohibida.
- **Apagar la separación silábica del todo desborda**: un token de 49 caracteres se sale
  sobre la columna vecina. La regla correcta es «entera salvo que no quepa».
- `opacity` sí funciona en `View`/`Image` (marca de agua), y `<Text render={({pageNumber,
  totalPages}) => …} fixed>` da el «N de M» del pie.

Relacionado: [[medicion-sin-mcp-supabase]], [[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
