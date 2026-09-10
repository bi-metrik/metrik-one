---
name: lexico-plata-vetada
description: "Plata" está vetada en copy público desde 2026-04-21; el rótulo P1 (#614) y el banner de alcance (#616) ya dicen "efectivo", pero quedan ~19 apariciones visibles sin decidir y una de ellas es un IDENTIFICADOR persistido, no copy
metadata:
  type: project
---

**"Plata" es palabra vetada en copy público desde el 2026-04-21** (`cerebro/reglas/lexico-prohibido.md`)
y la pregunta canónica P1 es **"¿Cuánto efectivo tengo?"** (concordancia masculina: «cuán**to**»,
no «cuánta»).

**Why:** el rótulo viejo salía en la **captura del demo publicada en metrik.com.co**, o sea a la vista
de tráfico frío. Por eso el PR **#614** (mergeado 2026-09-10, `22f7055`) es de vitrina, no de higiene.

**How to apply:** en `/numeros` ya no queda la palabra: el rótulo P1 (tarjeta, drill-down, story-mode
y los cuatro comentarios que lo nombraban) por el **#614**, y el banner de alcance por el **#616**.
`grep -rn "plata tengo" src/` da cero, y `numeros-v2-client.tsx` da cero entero. **Lo que sigue
abierto es lo de abajo.**

⚠️ **Se libera de a una y por aprobación explícita de Mauricio, no en barrido.** Las dos veces el
encargo llegó acotado a UNA cadena. El valor de la auditoría es la lista de abajo, no ejecutarla.

## ⚠️ Quedan ~20 apariciones de «plata» en texto VISIBLE, y no todas son copy

El encargo del #614 acotaba el alcance a un rótulo, así que se auditaron y **no se tocaron**. Al
retomarlas, el orden importa porque son tres familias distintas:

1. ✅ **CERRADA en el #616** (`0b9d81d`, 2026-09-10). Era la hermana directa: `numeros-v2-client.tsx`
   línea 160, banner de alcance del modo Rentabilidad Comercial, **en la misma pantalla `/numeros`**.
   Decía *«(cuánta plata tienes, cuánto te deben y cuánto aguantas)»* y ahora dice **«cuánto efectivo
   tienes»**, con lo que la enumeración queda con los **tres `cuánto` en paralelo**. Es P1 con otra
   redacción, así que hereda la forma canónica. Solo se ve con `rentabilidadComercialMode` (HJBC).
   `grep -i plata` sobre ese archivo da **cero**.

2. **⚠️⚠️ Un valor persistido que PARECE copy: `'falta_plata'`.** Es una `CausaRetrocesoFinanciero`
   (`lib/negocios/retroceso-financiero.ts`, `recaudo-cambiado-banner.tsx`) que viaja a la base.
   Renombrarlo **es migración de datos**, no redacción. El `label` de al lado («Al negocio le falta
   plata») sí es copy. **Antes de un barrido de la palabra, separar identificadores de textos**: un
   `sed` sobre «plata» los toca a los dos y el segundo rompe filas históricas.

3. **Copy interno de operación, no vitrina** (conciliación/tesorería, tableros, y los mensajes de
   error de `lib/cobros/anulabilidad.ts`, `lib/cobros/redistribucion.ts`,
   `lib/actions/propuesta-economica-actions.ts`). Sustituir por «dinero» o «recaudo» **sí cambia el
   matiz** — lo que «entró» no es lo mismo que lo que se «reconoce» —, así que se decide en bloque y
   con Mateo, no de a una.

**Falsos positivos que inflan cualquier conteo de «plata»:** `plataforma`, `rol_plataforma`, los
municipios **La Plata** y **Gómez Plata** del catálogo DIVIPOLA, los `.test.ts` y los comentarios
JSX. Sin filtrarlos el grep da 433 y lo visible con sentido de dinero son ~20.

## Cómo se verificó el rótulo (sirve para cualquier cambio de copy en `/numeros`)

`QuestionCard` pinta `{title}` directo y `DrillDownSheet` pinta `{TITLES[questionNumber]}`: los dos
**renderizan en aislamiento** con `renderToStaticMarkup` sin doblar nada (`QuestionCard` no tiene un
solo hook; a `DrillDownSheet` le bastan cuatro props). El arnés fue **temporal y se borró**: una
prueba de copy se pudre con el copy. Se vio **fallar** devolviendo el mapa `TITLES` al valor viejo,
que es lo único que prueba que medía el rótulo y no otra cosa ([[pruebas-por-mutacion]]).

**El #616 subió un piso: `NumerosV2Client` ENTERO también renderiza en aislamiento**, que es lo que
hace verificable cualquier copy de esa pantalla sin levantar servidor ni base. Le bastan **tres
dobles** — `next/navigation` (`useRouter` + `useSearchParams`), `sonner` y `./actions-v2` (por
`getNumeros` y por el `actualizarSaldo` que importa `saldo-dialog`) — más un `NumerosData` completo.
Dos detalles que ahorran el rato de diagnóstico: `showCards` está **hardcodeado en `true`**, así que
lo único que enciende el banner es `rentabilidadComercialMode`; y el fixture se escribe **con todos
los campos**, sin `as unknown as`, porque un fixture que necesita cast ya no habla del mismo tipo que
el componente.

⚠️ **Y por qué ese arnés tampoco se versiona, además de que el copy se pudre:** la afirmación natural
`expect(html).not.toContain('plata')` es una **subcadena**, así que se pondría roja el día que alguien
escriba «**plata**forma» en esa pantalla — el mismo falso positivo que infla el grep, ahora dentro de
una prueba. El control que sí vale es el otro: renderizar con el modo **apagado** y afirmar que el
banner no existe, para que el verde no pueda venir de un render vacío.

Relacionado: [[worktree-git-bloqueado]], [[probar-render-sin-dom]], [[pruebas-por-mutacion]].
