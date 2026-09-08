---
name: pruebas-por-mutacion
description: Una prueba nueva no se cree hasta verla fallar — romper la regla a propósito y exigir que caiga; y el doble tiene que reproducir el defecto, no solo la tabla
metadata:
  type: feedback
---

Una prueba nueva **no vale hasta verla fallar**. Se rompe la regla a propósito y se
exige que la prueba caiga; si no cae, no está probando lo que dice.

**Why:** en este repo ya pasó varias veces que una prueba pasaba **por la razón
equivocada** (el `CLAUDE.md` lo documenta para el motor de Cardumen y para el ranking
de calidad). El caso más caro: un doble que devuelve lo mismo para cualquier tabla
hace pasar la prueba sin que el código filtre nada.

**Confirmado otra vez el 2026-09-02 (PR #491), y las dos mitades importan:**

1. **El doble tiene que reproducir el DEFECTO, no solo la forma de la tabla.** El
   doble del cliente de Supabase **recorta en 1.000 filas** igual que PostgREST y
   honra `.range()`. Sin esa parte, las 8 pruebas de la cola de facturación pasaban
   con el código viejo y no probaban nada. La primera versión del fixture dejaba
   pasar 3 de 8 contra `main`: hubo que reordenar las filas sembradas para que el
   recorte se llevara justo el RUT (una variante) y justo el servicio (otra).
2. **La mutación que NO tumba ninguna prueba delata un hueco de cobertura**, no una
   prueba de más. Se probaron 5 mutaciones del helper de paginación y las 5 cayeron;
   se dejó escrito cuál tumbó cuántas.

**⚠️ Matiz aprendido el 2026-09-04 (PR #529): una mutación que no tumba nada también
puede delatar CÓDIGO MUERTO, y entonces se borra la línea en vez de escribir la prueba.**
Quitar un guard (`tiposPresentes.has(...)`) antes de sumar las horas no rompía ninguna
prueba porque el `map` posterior ya descartaba lo que no estaba en el presupuesto: el
guard no cambiaba ningún resultado observable desde la API pública. Antes de agregar una
prueba para cubrir la mutación huérfana, **preguntarse si el comportamiento es siquiera
observable**; si no lo es, la prueba nueva estaría fijando un detalle interno, y la línea
es una que nadie sabrá si sigue haciendo algo. En los dos casos, dejar escrito en el
docblock cuál mutación no cayó y qué se decidió.

**⚠️ Matiz aprendido el 2026-09-05 (PR #532), que corrige el de arriba: una mutación
huérfana puede volver a tener dueño, y el conteo anotado NO se cita de memoria.**

1. **La línea muerta del #529 revivió.** El guard `tiposPresentes.has(...)` se había
   borrado por no tumbar nada; al agregar `sinPresupuesto`, ese mismo guard pasó a
   decidir si las horas cuentan contra el rubro o salen declaradas fuera — o sea que
   volvió a cambiar un resultado observable, y ahora su mutación cae. **Borrar la línea
   fue correcto entonces y volver a ponerla fue correcto ahora**: lo que decide no es
   la simetría del código sino si el comportamiento es observable desde la API pública.
2. **Los conteos del docblock caducan como cualquier cifra.** Al re-correr las 7
   mutaciones que el #529 dejó anotadas, **dos habían cambiado** (la de reemplazar el
   gasto de mano de obra pasó de 1 a 2 rojas). Y de mis 8 estimaciones nuevas, **tres
   estaban mal** antes de medirlas. Se re-corren TODAS contra el archivo del día, con
   un arnés (`_qa/mutar.py`: sustituye, corre vitest, restaura), y se anota lo medido.
3. **Una prueba escrita desde la INTENCIÓN atrapa el defecto que uno acaba de escribir.**
   La prueba "una enviada manda sobre un borrador" salió roja contra mi primera
   implementación: yo ordenaba `[...enviadas, ...borradores]` como una sola lista, así
   que un borrador nuevo tapaba una enviada vieja. Se corrigió el código, no la prueba.
   Una prueba que solo repite lo que hace el código no habría dicho nada.

**El mismo principio, aplicado a una comparación masiva contra producción
(2026-09-03, PR #524).** Al migrar la tercera copia de la atribución de campaña al
módulo compartido, la premisa era «sobre los datos reales las dos implementaciones
dan lo mismo». Se volcaron los 983 contactos de SOENA y salieron **0 diferencias** —
un verde que no prueba nada por sí solo: puede significar «equivalentes» o puede
significar «el arnés compara mal». **La contraprueba es correr la misma comparación
sobre una entrada donde SÍ deben diferir**: con las filas invertidas, 46 contactos
discrepan. Ese segundo número es el que convierte el cero en evidencia.

Regla derivada: **toda comparación A-vs-B que salga idéntica necesita una entrada
control donde se espere que difiera.** Sin ella es la misma familia del gotcha del
`CLAUDE.md` «una prueba que sale bien puede estar saliendo bien por la razón
contraria».

**How to apply:**
- Para código nuevo: mutar la implementación (script que sustituye una línea, corre
  vitest, restaura) y anotar en el docblock **qué mutación tumbó qué prueba**.
- Para un fix sobre código existente: correr las pruebas nuevas contra la versión
  vieja — `git show origin/main:<archivo> > <archivo>`, correr, restaurar. Si alguna
  pasa, el fixture no reproduce el defecto.
- Para una migración de copia a módulo compartido: copiar la implementación vieja
  **verbatim** dentro del arnés, compararla contra la nueva sobre las filas reales, y
  agregar la entrada control que las separa.
- ⚠️ **La mutación que sobrevive suele apuntar a un hueco que los datos de hoy no
  pueden mostrar.** En el #524 sobrevivió «el conteo de formularios cuenta TODAS las
  interacciones»: en SOENA las 720 son de Meta y las 720 declaran campaña, así que
  ninguna fila real lo delata — pero la pantalla admite WhatsApp, web y manual. Se
  cierra con un caso propio marcado como latente, no se descarta por no reproducirse.
- Todas las listas van en el encabezado del archivo de pruebas, con fecha. Es lo que
  permite que quien lea dentro de seis meses sepa que el verde significa algo.

Relacionado: [[medir-antes-de-construir]], [[techo-postgrest-1000-filas]],
[[cifras-del-brief-caducan]].

## ⚠️⚠️ El ARNÉS también miente, y su fallo se ve igual que un buen resultado

**2026-09-08 (PR #578): el arnés de mutación reportó "ninguna prueba cayó" para las 8
mutaciones, tres veces seguidas y por tres causas distintas.** Ninguna era la que se
estaba buscando:

1. **Se le pasaba a vitest el archivo FUENTE como filtro** (`npx vitest run
   src/lib/x/y.ts`). Ese nombre no casa con `y.test.ts`, así que corría **cero
   pruebas** — y "0 pruebas, 0 fallidas" se imprime parecido a "todo verde".
2. **El grep del resumen no toleraba los códigos de color ANSI** de vitest, así que
   `Tests  4 failed` no matcheaba `Tests +[0-9]+ failed`.
3. **El respaldo se tomó DESPUÉS de una mutación sin revertir.** Un comando compuesto
   con `&&` fue rechazado ENTERO por el guard de Bash, y el `cp` de restauración que
   iba primero nunca corrió. La línea base ya estaba rota, así que las "caídas" que
   reportó eran suyas, no de cada mutación — y los conteos publicados eran falsos.

**How to apply — el arnés lleva sus propias guardas, no se confía:**

- **Comprobar la línea base VERDE antes de mutar.** Si no lo está, abortar: el
  respaldo está contaminado.
- **Abortar si el `sed` no cambió el archivo** (`cmp -s`). Una mutación que no existe
  se reporta como "probada" y suma un renglón falso al docblock.
- **Verificar al final que quedó verde otra vez**, no solo que se copió el respaldo.
- Tras un comando compuesto que el guard rechace, **comprobar el estado del archivo**:
  el rechazo es del comando completo, así que los pasos previos tampoco corrieron.

**Corolario para el reporte:** que las N pruebas caigan contra la versión anterior no
siempre dice algo. Si el cambio agregó un campo al tipo, media suite cae por eso y no
por la decisión. Vale la pena una segunda tanda de mutaciones **con el campo ya puesto**,
sobre la línea que decide, y anotar los dos conteos por separado.

## ⚠️ Una mutación huérfana también puede delatar un FIXTURE que pasa por casualidad

**2026-09-08 (PR #580).** Borrar el criterio de orden «los retenidos van al final» no tumbó
ninguna prueba, y sí había una prueba escrita para eso. No era código muerto ni cobertura
faltante: era **el fixture**. Todos los retenidos estaban sembrados al final, y con esas
filas *ordenar por «listo»* da exactamente el mismo resultado que *ordenar por «retenido»* —
la prueba verde no distinguía los dos criterios. Se rearmó (un retenido primero, un cubierto
sin RUT después) para que los dos órdenes discrepen, y entonces la mutación cayó.

**How to apply:** ante una mutación sin dueño, antes de concluir «código muerto» o «falta una
prueba», preguntarse si **los datos sembrados pueden siquiera separar el criterio mutado del
que queda**. Para cualquier prueba de ORDEN: el fixture necesita al menos un par de filas
donde los dos criterios manden al revés, o solo se está probando el orden de inserción.
