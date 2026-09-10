---
name: cambio-solo-de-tildes
description: Cómo probar que un cambio de ortografía tocó SOLO texto visible — la equivalencia sin acentos no basta, hace falta el chequeo de zonas de identidad; y el plural en -ciones no lleva tilde
metadata:
  type: reference
---

Para un PR que solo corrige tildes (o cualquier cambio puramente ortográfico) hacen falta
**dos** pruebas mecánicas, no una. Medido el 2026-09-10 en el PR #613 (módulo compliance,
31 líneas, 35 caracteres).

## 1. Equivalencia sin acentos: prueba que no se coló otra cosa

Volcar el diff (`git diff -U0 -- src/ > x.txt`) y comprobar que **quitarle los acentos a
cada línea nueva reproduce la vieja byte a byte**, y que hay el mismo número de líneas `-`
que `+`. Si se cambió un `className`, un identificador o se añadió/borró una línea, falla.

```python
strip = lambda s: "".join(c for c in unicodedata.normalize("NFD", s)
                          if unicodedata.category(c) != "Mn")
assert strip(nueva) == vieja
```

## 2. ⚠️⚠️ Zonas de identidad: la prueba 1 NO dice DÓNDE cayó la tilde

**Este es el hueco y se descubrió porque el control pasó debiendo fallar.** Al inyectar
`value="automático"` como mutación de control, la prueba 1 **siguió en verde**: quitarle el
acento a `automático` también reproduce `automatico`. O sea que la prueba 1 no distingue una
tilde en el copy de una tilde dentro de un `value=` — que sí rompería el dato almacenado.

Se cierra con un segundo chequeo: **ningún carácter acentuado dentro de `value=`, `value:`,
`key:`, `key=`, `className`, `href`, `from '…'`, `id=`, `name=`** en los archivos tocados.
En el #613 fueron 553 zonas revisadas, cero acentos. Ahí sí, la mutación `value="automático"`
cae.

**Los dos instrumentos se validan por mutación, cada uno con la suya**
([[pruebas-por-mutacion]]): un `className` distinto tumba el 1; una tilde en un `value` tumba
el 2. Un control que pasa cuando debía fallar es la señal de que el instrumento mide otra cosa.

## Barrer las erratas sin ir a ojo

Un detector que extrae **solo texto visible** (nodos JSX `>texto<`, atributos
`label`/`placeholder`/`title`/`alt`, props de copy `label:`/`descripcion:`, claves numéricas
`5: 'Texto'`, argumentos de `toast.*`) y le aplica la **regla general**, no una lista curada:

> singulares en `-ción` / `-sión` llevan tilde; **los plurales en `-ciones` / `-siones` NO.**

⚠️ El plural fue el único falso positivo, y sale caro porque suena a errata: `Operaciones`,
`Historial de ejecuciones`, `acciones`, `revisiones` **ya estaban bien**. Sí la conservan
`categoría → categorías` y `día → días` (hiato). Una lista curada sola se queda corta: se
escapaban `Clasificacion` e `Hibrido` hasta que entró la regla.

## Antes de tocar una etiqueta: ¿es también un valor almacenado?

Tres comprobaciones que en el #613 salieron todas limpias:

- **Mapas de etiqueta suelen ser `Record<number, …>`** (`5: { label: 'Catastrofico' }`): el
  valor va por clave numérica, la etiqueta es puro display. Y **el consumidor manda**: la
  importación de Excel resolvía el impacto con `parseInt`, nunca por etiqueta.
- **En selects y filtros, `value` es la identidad y `label` el copy.** `revision`,
  `validacion`, `automatico`, `hibrido` **sí** son valores almacenados — y por eso viven en
  `key:`/`value=`, que no se tocan; solo cambia el texto que los acompaña.
- `grep` de `=== 'Etiqueta'` en todo `src/`: si hay una comparación por string, la etiqueta
  no se toca y se dice en el reporte.

**Lo que se deja fuera y se declara:** un documento **generado** (la hoja «Instrucciones» de
una plantilla de Excel) no es interfaz, y si su bloque entero está sin tildes de forma
consistente, corregir una sola palabra lo deja peor.

## Gotchas del guard de Bash (worktree aislado)

- `xargs -a lista.txt python3 …` → **rechazado**. Que el script recorra directorios él mismo.
- `sed -n "${n}p"` con la línea en variable dentro de un `for` → **rechazado**. Imprimir con
  Python.
- `git commit -m … -- ruta1 ruta2` con rutas explícitas → pasa, y es lo correcto cuando el
  árbol tiene archivos de otro frente sin commitear ([[worktree-git-bloqueado]]).

Relacionado: [[capturas-sustenta-landing]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
