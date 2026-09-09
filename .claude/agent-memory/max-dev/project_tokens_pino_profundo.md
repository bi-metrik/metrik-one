---
name: tokens-pino-profundo
description: PR #601 (sin mergear) tokeniza la paleta de ONE en Pino Profundo; el branding por workspace sigue sin aplicar fuera del sidebar y los workspaces viejos conservan el verde viejo en la base
metadata:
  type: project
---

**PR #601, `feat/tokenizar-paleta-pino`, checks verdes, SIN MERGEAR.** Paso 4 del
despliegue de `cerebro/decisiones/2026-09-07_rediseno-visual-pino-profundo.md`.

**Why:** la paleta y la tipografia de MeTRIK ERAN los defaults de Tailwind y de
Google Fonts, y por eso el producto se veia como cualquier cosa generada con IA.

**How to apply — al escribir color nuevo en `metrik-one`:**

- El color se elige por **ROL**, con las clases de `globals.css`: `acento`,
  `acento-hover`, `acento-claro`, `acento-tinte`, `acento-borde`, `dato-vivo`,
  `tinta`, `tinta-suave`, `alerta`, `advertencia`, `papel`. **Nunca un hex.**
- ⚠️ **`--acento` sobre carbon da 2,24:1** (invisible). Sobre fondo oscuro va
  `acento-claro`. El sidebar tiene `--sidebar-linea`, que nace en Pino 300 y
  `app-shell.tsx` cambia a Pino Profundo si el workspace pone el sidebar claro.
- Las superficies que **no leen `var()`** —PDF de `@react-pdf`, correo HTML,
  atributos de presentacion SVG y props de color de recharts, y
  `global-error.tsx`— importan de `@/lib/marca/paleta`. `paleta.test.ts` lee
  `globals.css` y falla si las dos representaciones se separan.

## ⚠️⚠️ Hallazgo de producto abierto: el branding por workspace no existia fuera del sidebar

`app-shell.tsx` solo sobrescribe `--sidebar-primary` y `--sidebar`. Todo lo demas
estaba en hex fijo, asi que **un workspace con su color propio veia verde MeTRIK
regado por la pantalla**. No era un bug del branding: no habia donde aplicarlo.

El #601 **no cambia ese alcance a proposito** (repintaria el producto entero de
los clientes sin aprobacion), pero deja la via lista: colgar `--acento` de
`branding.colorPrimario` en `brandingStyle` es una linea. Es decision de producto.

**Y un segundo tramo que necesita migracion de datos:** los workspaces que ya
guardaron su marca tienen `#10B981` en `workspaces.color_primario`, asi que su
sidebar sigue en verde viejo hasta que alguien vuelva a guardar.
`esBrandingPorDefecto()` acepta los dos valores para que la barra de progreso de
Configuracion no les regale un punto, pero el dato sigue viejo.

## Lo que quedo fuera del PR, y hay que decirlo al retomar

- **Newsreader esta cargada y sin usar**: no hay superficie marcada como display.
  Que titulos se vuelven editoriales lo deciden Ren/Noor.
- **Sin QA visual**: todo se verifico por medicion y contra el CSS compilado,
  nadie abrio la aplicacion.
- **Los PDF y correos cambian de color al mergear.** Las superficies que ve AFI
  (`/compliance`, `/cert`, `/vinculacion`, el PDF de metodologia de Valida) van
  dentro. Si hay que avisarle a AFI, es antes del merge.
- `icon.svg` solo se recoloreo; los iconos oficiales estan en
  `proyectos/metrik/marca/pino/png-one/` y cambiarlos altera la geometria.

Relacionado: [[vistas-server-only]], [[worktree-git-bloqueado]].
