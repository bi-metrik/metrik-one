# Cómo grabar las 20 notas de voz reales

Las notas reales reemplazan a las sintéticas (`sinteticos/*.sintetico.ogg`). La voz sintética no trae el acento ni el ruido que nos hace fallar, así que la decisión de prender las pistas se toma con estas notas.

## Quién graba

- Tres personas, cada una con voz distinta (spec §6.2-f): por ejemplo, Mauricio y dos personas más. Ojalá una mujer y un hombre, y alguien que hable rápido.
- Nadie lee su propio nombre ni datos reales: los guiones son inventados y se leen tal cual.
- Quien graba firma el permiso de abajo antes de grabar.

## Qué se lee

- El texto de cada guion está en `guiones.ts`, campo `texto`.
- Las marcas `{n:…}`, `{c:…}`, `{k:…}` no se leen: se lee lo de adentro.
- Si la marca trae `|`, se lee lo de después de la barra. Por ejemplo, `{k:I1 26 5|i uno veintiséis cinco}` se lee «i uno veintiséis cinco».
- Las condiciones de cada guion (`condiciones`) dicen cómo grabarlo:
  - `ruido: 'calle'`: en la calle o con la ventana abierta a una calle con tráfico.
  - `ruido: 'obra'`: cerca de algo que golpee, taladre o pite. Una obra de verdad es lo mejor.
  - `ruido: 'salon'`: con un secador de pelo prendido o en un sitio con gente hablando.
  - `rapido: true`: leerlo rápido, como quien manda la nota con afán.
  - `corte`: decir el texto, empezar a decir la cola (`corte`) y soltar el botón a mitad de palabra.

## Cómo se graba

- Con el botón de nota de voz de WhatsApp, en el celular, como lo haría un usuario. No con una grabadora ni con micrófono externo.
- Se manda la nota a un chat propio (por ejemplo, «Mensajes para mí») y se descarga desde WhatsApp Web, o se exporta desde el celular.
- El formato es el de WhatsApp: OGG/Opus (`.ogg` u `.opus`). No se convierte ni se limpia el ruido.

## Dónde se ponen

- En `supabase/functions/_shared/agente/arnes/audios/reales/`, con el id del guion de nombre: `imp-01.ogg`, `lau-02.ogg`, `sab-06.ogg`. Si el archivo viene como `.opus`, solo se le cambia la extensión.
- La corrida usa la real si existe, y si no la sintética (`--fuente auto`). Con `--fuente reales` exige que estén las 20.
- En `reales/manifiesto.json` se anota quién grabó cada una, con un alias y no con el nombre: `{ "imp-01": { "voz": "A", "fecha": "2026-10-30", "permiso": "permiso-A" } }`.

## Permiso escrito de quien graba

Antes de grabar, cada persona firma este texto, con fecha. El documento firmado se guarda en el Drive de MéTRIK, carpeta del frente de asistentes, y no en el repositorio. En el repositorio solo queda el alias (`permiso-A`).

> Autorizo a METRIK IA S.A.S. a guardar en su repositorio de código y a usar las notas de voz que grabo leyendo guiones inventados, solo para probar y mejorar la transcripción de sus asistentes. Sé que mi voz queda en esas grabaciones. Las notas no traen datos reales míos ni de terceros. Puedo pedir que se borren escribiendo a mauricio.moreno@metrik.com.co.
>
> Nombre, documento, firma y fecha.

Si alguien pide que se borren sus notas, se quitan de `reales/` y se vuelven a grabar con otra voz.
