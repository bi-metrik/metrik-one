---
name: retencion-control-en-ci
description: El plazo de diez anios ya se vigila en CI en los dos repos (one #634, valida #38, ambos mergeados el 2026-09-11) — el hallazgo abierto del expediente KYC a cinco anios, por que interpolar la constante deja la superficie invisible a un extractor de texto, y que metrik-valida ahora SI tiene CI
metadata:
  type: project
---

Estado al **2026-09-11**, los dos PR mergeados. Reemplaza la parte de "ningun check de CI
vigila esto" de [[valida-privacidad-v13]], que quedo caduca.

- **metrik-one #634** (`1e3a2625`): `src/lib/compliance/retencion.ts` (constante unica con el
  fundamento legal) + `retencion.test.ts`.
- **metrik-valida #38** (`7479f0bb`): `lib/docs/retencion-publicada.test.ts` + el workflow
  `Pruebas`.
- El script de la torre quedo **solo para el cruce entre repos**, con las 5 superficies
  intactas, y aprendio a seguir la constante (abajo).

## ⚠️⚠️ Hallazgo ABIERTO: el expediente KYC se retiene CINCO anios

`metrik-valida`, `app/api/v1/kyc/expedientes/[expediente_id]/decision/route.ts:10` →
`const RETENCION_ANIOS = 5`. **Ese es el codigo que escribe `data_retention_until`** cuando el
oficial cierra un expediente, mientras la contraparte firma en metrik-one que *«el expediente
se conserva diez (10) anios … durante ese plazo no se puede borrar, ni siquiera a peticion
tuya»*. `consultas` si se migro a diez (`0027`); `expedientes_kyc` nunca.

Lo mismo en `scripts/guia-flujo-ccbf.tsx` (calcula y narra cinco, "regla dura Lucia") y en
`db/maintenance/dedup_entradas_stale.sql` (comentario). **No se toco**: decide que fecha legal
se escribe sobre expedientes reales, y no corrige los ya cerrados. Declarado como
`hallazgo-abierto` en la prueba, **escalado a Emilio el 2026-09-11**.

**How to apply:** si alguien pide "alinear el plazo", eso son dos decisiones, no una — el
valor hacia adelante, y que se hace con los expedientes ya cerrados con fecha corta.

## ⚠️⚠️ Interpolar la constante deja la superficie INVISIBLE a un extractor de texto

Al pasar tres superficies de metrik-one de `'… 10 años'` a `` `… ${RETENCION_ANIOS} años` ``, el
script de la torre paso a **exit 2, "sin plazo declarado"** en la primera de ellas. O sea que
mejorar el codigo rompio el control, y el sintoma se parece a un archivo vacio.

- El arreglo: si el texto no trae cifra pero **menciona `RETENCION_ANIOS`**, el script resuelve
  el valor leyendo `git show origin/main:src/lib/compliance/retencion.ts`. Asi la mutacion
  `CANONICO=5` sigue sacando **las 5 en rojo** (2 por constante, 3 por literal) en vez de
  debilitarse a 3.
- **How to apply:** al centralizar un literal que algun grep externo vigila, **correr ese grep
  despues**. La ganancia (la superficie ya no puede divergir) se paga con que deja de ser
  legible desde afuera.

## Lista de rutas vs. barrido: la cifra que decide

Medido, y por eso se eligio barrido en los dos repos:

- **metrik-one:** de **1.248** archivos (`src/`, `supabase/`, `scripts/`) solo **siete** traen
  una cifra de anios. Barrer todo cuesta **dos** clasificaciones de mas.
- **metrik-valida:** de **199** archivos, **18**. Y el encargo hablaba de "dos superficies":
  las que declaran el plazo son **nueve** (landing, guia del integrador, consulta, historial,
  diccionario x2, spec OpenAPI, privacidad x2). **Una lista a mano habria cubierto 2 de 9.**

El modelo en los dos: un `CLASIFICACION` por ruta donde cada archivo con cifra es `plazo`,
`no-es-plazo`, `historico` o `hallazgo-abierto`, **con su razon**. Clasificarlo es la decision,
el silencio no — el idioma que ya usaba `alcance-publicado.test.ts`.

⚠️ **Los `*.test.ts` quedan fuera del barrido a proposito:** el guardian del #621 tiene que
poder seguir diciendo `'cinco (5) años'` para funcionar.

## Tres trampas que las pruebas cierran, y que costaria reinventar

1. **La prueba FIJA el canonico en diez.** Si solo comparara las superficies contra la
   constante, mover la constante dejaria todo verde: detectaria divergencia, no un valor
   equivocado. Verificado: `RETENCION_ANIOS = 5` tumba **tres** casos.
2. **Un caso exige que cada superficie siga diciendo el plazo.** Sin el, un regex roto y una
   superficie sana se ven identicos en verde.
3. **El normalizador quita el ` * ` de inicio de linea.** Los docstrings se parten donde caiga
   y tres de los cuatro hallazgos historicos vivian ahi. ⚠️ Ojo: eso hace que aparezca la
   retorica *«dentro de tres años nadie puede decir…»* de `vinculacion-publica.ts`, que es la
   exclusion por frase (no por archivo: si la frase se reescribe, la cifra vuelve a juzgarse).

⚠️ **Al validar por mutacion, confirmar que la mutacion ENTRO.** El primer intento no aplico
(el literal estaba partido en dos lineas del docstring) y la prueba salio **verde**: un verde
que no probaba nada. Lo delato el `grep` de confirmacion, no la prueba ([[pruebas-por-mutacion]]).

## metrik-valida ya tiene CI (antes no tenia NADA)

No existia `.github/` en ese repo: `npm test` corria solo si alguien se acordaba, y `main`
despliega a produccion en el acto. El #38 agrega `.github/workflows/pruebas.yml` →
`npm ci` + `npx tsc --noEmit` + `npm test`, check **"Tipos y pruebas"**. Baseline medido antes
de agregarlo: **158 pruebas, 0 fallos** (163 con las nuevas), asi que nacio verde.

**How to apply:** ya se puede exigir verde en un PR de Valida; antes "los checks" ahi eran
solo Vercel. Y el runner es `tsx --test "lib/**/*.test.ts"`: **una prueba fuera de `lib/` no
la recoge nadie**.

## ⚠️ Dos superficies de Valida escriben «10 anos» SIN eñe

`app/historial/page.tsx` y `lib/openapi/spec.ts`. El extractor viejo de la torre pedia `años`
con eñe, asi que le eran invisibles — confirma que el punto ciego no era teorico. Los dos
regex (el del script y el de las pruebas) aceptan ahora `a[ñn]os`.

Relacionado: [[valida-privacidad-v13]], [[cambio-solo-de-tildes]],
[[publicar-otro-repo-desde-worktree-aislado]], [[medir-antes-de-construir]].
