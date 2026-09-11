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
- **En selects y filtros, `value` es la identidad y `label` el copy.** `automatico` e
  `hibrido` **sí** son valores almacenados (columna `riesgos_controles.clasificacion`), y por
  eso viven en `value=`, que no se toca. ⚠️ **`revision` y `validacion` NO lo son**, contra lo
  que decía el brief y lo que este mismo archivo afirmaba: son `key` de React de un arreglo
  local (`WORKFLOW_ETAPAS`) dentro de un bloque «Próximamente», sin columna en la base, sin
  consumidor y sin comparación. Se ve en dos greps —`grep -rn WORKFLOW_ETAPAS src/` da un
  solo archivo, y la tabla no tiene columna de etapa de ejecución—. **Antes de tratar una
  clave como "valor almacenado", buscar la columna: que se llame `key` no la persiste.**
- `grep` de `=== 'Etiqueta'` en todo `src/`: si hay una comparación por string, la etiqueta
  no se toca y se dice en el reporte.
- ⚠️ **Un importador puede leer por POSICIÓN y volver irrelevante el encabezado.** El de
  Excel de riesgos hace `rows.slice(1)` y `row[0]`, `row[1]`… : las cabeceras del export son
  decorativas. Vale la pena mirarlo, porque decide si acentuar el export es peligroso o gratis.

**Lo que se deja fuera y se declara:** un documento **generado** (la hoja «Instrucciones» de
una plantilla de Excel) no es interfaz, y si su bloque entero está sin tildes de forma
consistente, corregir una sola palabra lo deja peor.

## ⚠️⚠️ Lo que las dos pruebas mecánicas NO ven, y solo aparece en pantalla

QA en pantalla del #613 el mismo día (método en [[capturas-ui-sin-servidor]]): las 35 tildes
salieron bien y ningún selector se rompió, **pero el chequeo del código no podía ver dos cosas**:

- **Una etiqueta corregida deja al descubierto la copia SIN corregir que tiene al lado.** En
  «crear un riesgo», el título de la tarjeta quedó «Descripción de la causa» y la etiqueta del
  campo, 100 px debajo, sigue diciendo «Descripcion \*». Dos ortografías de la misma palabra
  en la misma tarjeta, y ninguna de las dos pruebas mecánicas se queja: cada línea es coherente
  consigo misma. **El barrido de erratas hay que correrlo sobre el RENDER, no sobre el diff.**
- **Un `value` que la pantalla imprime crudo hereda la ortografía de la BASE, no del catálogo.**
  Tres sitios pintan `{control.clasificacion}` con `class="capitalize"`, así que el detalle
  muestra «Automatico» mientras el formulario ya dice «Automático». Corregir el `label` de un
  `<option>` **no alcanza** si en otra pantalla el mismo dato se muestra sin pasar por el
  catálogo. **Al corregir la etiqueta de un enumerado, buscar quién más lo imprime.**

Corolario de método: el detector de erratas debe distinguir **el copy del producto de los
datos ficticios del propio QA** —si no, se reportan como defectos las erratas que uno acaba de
escribir en el fixture—. La atribución fiable no es «¿está en mi fixture?» (una palabra puede
estar en los dos) sino **«¿está escrita literalmente en el `.tsx` de esa pantalla?»**.

⚠️ Y hay etiquetas que **solo se leen al pasar el cursor**: en el detalle del riesgo,
`Catastrófico` vive únicamente en el `title` de cada dimensión. Un extractor que solo mira
nodos de texto la da por ausente. Separar cuerpo / `placeholder` / `title` y afirmar cada uno
por su lado, para no reportar como bug lo que es un tooltip.

## ⚠️⚠️ La eñe NO es una tilde, y por eso se corrige sola

Medido el 2026-09-11 (#629, copy del tutorial de Listas). `anos` sin eñe **no es un acento
faltante: es otra palabra**, y estaba en copy que ve el cliente. Todo `src/lib/tutorials/`
está escrito en **ASCII puro a propósito** (`auditoria`, `obligacion`, `juridica`,
`Convencion`) — o sea que la eñe no se perdió por descuido: **la convención de "sin tildes"
se tragó una letra que no era una tilde**.

**How to apply:** en una corrección de eñe, el cambio es **quirúrgico**. Restaurar de paso
las demás tildes del archivo es otro frente *y además rompe la convención del directorio*.
La regla que separa los dos casos: si quitarle el signo cambia **de palabra** (`año`→`ano`,
`niño`→`nino`), es obligatorio; si solo cambia la prosodia (`auditoría`→`auditoria`), es
decisión de estilo del archivo.

### ⚠️ El barrido de `anos` tiene dos trampas, y la segunda rompe código

- **Falsos positivos por subcadena:** `anos` vive dentro de `humanos`, `hermanos`,
  `colombianos`, `planos`, `manos`. Va con `grep -w`, no con subcadena.
- **⚠️⚠️ Hay `anos` sin eñe que NO se pueden tocar.** `supabase/functions/_shared/cardumen/
  navigate/idioma.ts` tiene `"anos"` en las listas de palabras funcionales ES y PT del
  detector determinista de idioma. El detector **normaliza quitando acentos antes de
  comparar**: ponerle la eñe al token ES haría que **no matchee nunca**, y en PT `anos` es la
  ortografía correcta del portugués. No son copy, son *tokens*. **Antes de corregir una eñe,
  preguntar si la cadena se compara contra algo** — es el mismo criterio de "¿es también un
  valor almacenado?" de más arriba, aplicado a un diccionario en vez de a una columna.

En el #629 el barrido de todo `src/` dio **una sola** ocurrencia en copy. Las otras cuatro
(`ano` en `bogota.test.ts`, `agrupar-por-dia.ts` ×2, `formulario-1668.test.ts`) son
comentarios y nombres de prueba: fuera de alcance, y conviene **declararlo** en vez de
corregirlas por barrer parejo.

### ⚠️⚠️ El instrumento: una alternancia que mezcla `ñ` con `[…]` falla en silencio

Medido el mismo día, y casi cuesta un falso "no hay ocurrencias". Sobre una línea que
**sí** contiene `5 anos`:

```
grep -nE '(año|anio|[^[:alnum:]]ano)s?' archivo   # exit 1  ← NO encuentra nada
grep -nE '[^[:alnum:]]anos'             archivo   # exit 0  ← la encuentra
grep -nE '(año|anos)'                   archivo   # exit 0  ← la encuentra
```

No es cosa de `-i` (falla igual sin él) ni de locale (`en_US.UTF-8`). Es la **combinación**
de una alternativa multibyte (`ñ`) con una expresión de corchetes en la misma ERE.

**How to apply:** en un barrido de ortografía, **nunca un patrón compuesto**. Un `grep`
simple por caso, y **cada uno validado con un control que TENGA que dar resultado**
(aquí: `grep -c 'anos'` = 1). Familia de [[pruebas-por-mutacion]]: un barrido que devuelve
"cero ocurrencias" y un barrido roto se ven exactamente igual.

## Gotchas del guard de Bash (worktree aislado)

- `xargs -a lista.txt python3 …` → **rechazado**. Que el script recorra directorios él mismo.
- `sed -n "${n}p"` con la línea en variable dentro de un `for` → **rechazado**. Imprimir con
  Python.
- `git commit -m … -- ruta1 ruta2` con rutas explícitas → pasa, y es lo correcto cuando el
  árbol tiene archivos de otro frente sin commitear ([[worktree-git-bloqueado]]).

Relacionado: [[capturas-sustenta-landing]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
