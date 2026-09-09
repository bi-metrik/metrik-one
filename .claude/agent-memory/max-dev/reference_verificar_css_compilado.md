---
name: verificar-css-compilado
description: Un cambio de estilos se verifica contra el CSS que sale del build, no contra el codigo fuente; un @theme mal declarado deja cada clase sin efecto y el build igual sale verde
metadata:
  type: reference
---

Tras `npm run build`, el CSS vive en `.next/static/chunks/*.css`. Ahi se
comprueba lo que de verdad se sirve:

```bash
CSS=$(find .next -name "*.css" -path "*static*" | head -1)
grep -o "\.text-acento{[^}]*}" "$CSS"          # .text-acento{color:var(--acento)}
grep -o "\-\-acento:[^;]*;" "$CSS"             # --acento:#0e5c43;
grep -o "\-\-default-font-family:[^;]*;" "$CSS"
grep -ho "@font-face{[^}]*}" .next/static/chunks/*.css   # familias y rangos de peso
```

**Why:** si el `@theme` de Tailwind quedara mal declarado, **cada clase nueva no
generaria ninguna regla**, la pantalla se veria igual que antes y `tsc`, lint,
pruebas y build saldrian los cuatro en verde. Es la version de estilos del
"pantalla sana que miente" que el CLAUDE.md del repo documenta varias veces: el
codigo fuente dice la intencion, el CSS compilado dice el hecho.

**How to apply:**

- **Siempre con un control**: buscar tambien una utilidad inventada
  (`grep -c "\.text-pinoinventado"`) y exigir 0. Sin el, un grep que resuelve mal
  el escape da "encontrado" para todo y la verificacion pasa sola.
- ⚠️ **`.bg-acento\/15{background-color:var(--acento)}` NO es un modificador de
  opacidad roto.** Tailwind 4 emite el color solido como respaldo y a
  continuacion un `@supports (color:color-mix(in lab, red, red))` con el
  `color-mix` real. Un `grep -o` toma la primera coincidencia y **parece** que se
  perdio la opacidad. Hay que mirar el contexto (`grep -o ".\{80\}patron.\{260\}"`).
  Lo mismo aplica a un `color-mix` puesto a mano en `:root`: el build lo envuelve
  igual, con `var(--acento)` de respaldo.
- Los `@font-face` de `next/font` **no estan en el chunk principal**: hay que
  barrer `.next/static/chunks/*.css`. Y `--font-sans` declarado en `@theme
  inline` no aparece como variable propia — se sustituye dentro de
  `--default-font-family`, que es lo que hay que buscar.

Relacionado: [[tokens-pino-profundo]], [[pruebas-por-mutacion]].
