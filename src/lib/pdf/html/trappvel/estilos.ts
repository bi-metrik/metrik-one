/**
 * Estilos de la propuesta de Trappvel: el sistema visual del formato que mandó Edgar Alarcón el
 * 2026-10-14 (`proyectos/trappvel/clarity/docs/entrada/formato-edgar/`, carta, Inter + Poppins),
 * decisión de Mauricio del 2026-10-27. Colores y medidas sacados del PDF de Edgar por muestreo de
 * píxeles (110 ppp): rosa #e6197a, morado #7b2fbe, turquesa #1ca2b8, tinta #1f2340, gris #6b7088,
 * tarjetas #fdf2f7 con borde #f7dce9, líneas #ece7ef y la banda del pie #1b1f3b → #1e2e5c.
 *
 * Se prueban por contenido en `plantilla.test.ts` (saltos de hoja: `.nobr`, `.sh`, `.tf`).
 */

export const CSS_PROPUESTA = `
@page { size: Letter; margin: 6mm 9mm 14mm; }
:root { --ink:#1f2340; --mute:#6b7088; --line:#ece7ef; --rosa:#e6197a; --morado:#7b2fbe; --tq:#1ca2b8; --suave:#fdf2f7; --borde:#f7dce9; --navy:#1b1f3b; --grad:linear-gradient(90deg,#e6197a,#8a2cb5 50%,#1ca2b8); --e:#1a93a8; --r:#e6197a; --p:#7b2fbe; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; font-family: Inter, sans-serif; color: var(--ink); font-size: 8.3pt; line-height: 1.5; }
h1,h2,h3,.pop { font-family: Poppins, Inter, sans-serif; }
h2 { font: 700 15.7pt/1.1 Poppins, sans-serif; margin: 0; color: var(--ink); letter-spacing: -.1px; }
h3 { font: 700 10.5pt/1.25 Poppins, sans-serif; margin: 0 0 1.5mm; color: var(--ink); }
.sec { margin-top: 3.8mm; }
.nobr { break-inside: avoid; }
.muted { color: var(--mute); }
.small { font-size: 7.6pt; }
.money { font-variant-numeric: tabular-nums; white-space: nowrap; }
.caps { font: 700 6.8pt Inter, sans-serif; letter-spacing: 1.6px; text-transform: uppercase; color: var(--rosa); }
.tag { display:inline-block; font: 800 6.4pt/1.3 Inter, sans-serif; letter-spacing: 1px; text-transform: uppercase; padding: .7mm 2mm; border-radius: 1mm; color:#fff; }
.tE { background: var(--e); } .tR { background: var(--r); } .tP { background: var(--p); } .tN { background: var(--ink); }
.cE { color: var(--e); } .cR { color: var(--r); } .cP { color: var(--p); } .cN { color: var(--ink); }
.al { display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; min-width: 5.6mm; height: 3.6mm; padding: 0 1.1mm; border-radius: 1.8mm; font: 700 6pt/1 Inter, sans-serif; letter-spacing: .2px; margin-right: 1.2mm; overflow: hidden; vertical-align: -.6mm; }
.ic { width: 3.6mm; height: 3.6mm; vertical-align: -0.7mm; }
.sinfoto { background: linear-gradient(135deg,#e6197a,#8a2cb5 55%,#1ca2b8); }

/* Encabezado de la primera hoja */
.top { display:flex; justify-content:space-between; align-items:center; height: 9mm; margin-bottom: 3mm; }
.top .k { font: 600 7.4pt Inter, sans-serif; letter-spacing: 2.2px; text-transform: uppercase; color: var(--mute); }
.top .k i { display:inline-block; width:1.9mm; height:1.9mm; border-radius:50%; background: var(--rosa); margin-right: 3mm; vertical-align: .25mm; }
.top img { height: 8.8mm; display:block; }
.top b.pop { font-size: 15pt; color: var(--ink); }

/* Portada: con imagen aprobada del destino, ESA sola a todo lo ancho, con sombra para el título, el
   rótulo «Imagen ilustrativa» y el crédito siempre a la vista (regla de fotos del 2026-10-29). Sin
   ella, la de siempre: el collage con la banda oscura. Nunca la banda de colores. */
.hero { position:relative; height: 57mm; border-radius: 3.7mm; overflow:hidden; background: linear-gradient(120deg,#1b1f3b,#3b2a6b 60%,#1e2e5c); }
.hero .fotos { position:absolute; inset:0; display:grid; gap: .5mm; }
.hero .fotos div { background-size: cover; background-position: center; }
.hero::after { content:""; position:absolute; inset:0; background: linear-gradient(90deg, rgba(27,31,59,.6) 0%, rgba(27,31,59,.3) 55%, rgba(27,31,59,.08) 100%), linear-gradient(rgba(27,31,59,0) 45%, rgba(27,31,59,.3)); }
.hero .foto { position:absolute; inset:0; background-size: cover; background-position: center; }
.hero.confoto::after { background: linear-gradient(rgba(27,31,59,0) 30%, rgba(27,31,59,.72) 100%), linear-gradient(90deg, rgba(27,31,59,.62) 0%, rgba(27,31,59,.3) 60%, rgba(27,31,59,.15) 100%); }
.hero .ilustrativa { position:absolute; top: 2.8mm; right: 3.4mm; z-index:2; font: 600 6.2pt/1.2 Inter, sans-serif; letter-spacing: .4px; color:#fff; background: rgba(27,31,59,.5); padding: .6mm 2mm; border-radius: 1mm; }
.hero .ilustrativa.credito { top: 7.4mm; font-size: 5.4pt; background: rgba(27,31,59,.35); }
.hero .in { position:absolute; left: 7.8mm; right: 10mm; bottom: 7mm; z-index:1; color:#fff; }
.hero.conaviso .in { bottom: 14.5mm; }
.hero .dt { font: 700 8.6pt Inter, sans-serif; letter-spacing: 2.6px; text-transform: uppercase; color: #fff; opacity: .92; }
.hero h1 { font: 700 30pt/1.07 Poppins, sans-serif; margin: 1.6mm 0 1.6mm; letter-spacing: -.3px; }
.hero h1.largo { font-size: 23pt; }
.hero .sub { font-size: 9.6pt; opacity: .95; }
.aviso { position:relative; z-index:2; margin: -8.8mm 3.9mm 0; background:#fff; border: 1px solid var(--line); border-radius: 2.8mm; box-shadow: 0 1.2mm 3.5mm rgba(31,35,64,.12); padding: 3.2mm 5mm 3.4mm 16.5mm; }
.aviso .ok { position:absolute; left: 4.4mm; top: 50%; transform: translateY(-50%); width: 8.2mm; height: 8.2mm; border-radius: 50%; background: linear-gradient(135deg,#e6197a,#8a2cb5); display:flex; align-items:center; justify-content:center; }
.aviso .ok .ic { width: 4.4mm; height: 4.4mm; color:#fff; vertical-align: 0; }
.aviso b { display:block; font: 700 10.4pt/1.35 Inter, sans-serif; color: var(--ink); }
.aviso p { margin: .6mm 0 0; font-size: 8.5pt; color: var(--mute); line-height: 1.45; }
.facts { display:grid; gap: 3.2mm; margin-top: 3.4mm; }
.facts div { background: var(--suave); border: 1px solid var(--borde); border-radius: 3.2mm; padding: 3.3mm 4mm 3.7mm; font: 600 9.6pt/1.42 Inter, sans-serif; color: var(--ink); }
.facts b { display:block; font: 700 6.6pt Inter, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: var(--rosa); margin-bottom: 1.6mm; }
.viajeros { display:grid; grid-template-columns: 1fr 1fr; gap: 2.6mm 3.2mm; margin-top: 2.6mm; }
.vj { display:flex; align-items:center; gap: 3mm; border: 1px solid var(--line); border-radius: 6.5mm; height: 11.2mm; padding: 0 4mm 0 1.8mm; }
.vj i { flex:none; width: 8.3mm; height: 8.3mm; border-radius: 50%; background: linear-gradient(135deg,#e6197a,#1ca2b8); color:#fff; font: 700 8pt Inter, sans-serif; font-style: normal; display:flex; align-items:center; justify-content:center; }
.vj b { font: 700 8.3pt Inter, sans-serif; }

/* Encabezado de sección: cuadro degradado con el ícono, título y bajada */
.sh { display:flex; align-items:center; gap: 3.3mm; margin: 0 0 2.6mm; break-after: avoid; }
.sh .sq { width: 10.6mm; height: 10.6mm; border-radius: 2.3mm; background: linear-gradient(135deg,#e6197a,#8a2cb5); display:flex; align-items:center; justify-content:center; flex: none; }
.sh .sq .ic { width: 5.4mm; height: 5.4mm; color:#fff; vertical-align: 0; }
.sh .st { font: 600 8.3pt/1.35 Inter, sans-serif; color: var(--mute); margin-top: .4mm; }

/* Vuelos y tren: una tarjeta por trayecto */
.vc { border: 1px solid var(--line); border-radius: 2.8mm; padding: 2.7mm 5.5mm 2.7mm 6mm; margin-bottom: 1.8mm; break-inside: avoid; }
.vc .fila { display:grid; grid-template-columns: 39mm 25mm 1fr 25mm 26mm; align-items:center; }
.vc .quien { display:flex; align-items:center; flex-wrap: wrap; gap: 1.2mm 2.4mm; }
.vc .bd { display:inline-block; font: 800 6.6pt/1.3 Inter, sans-serif; letter-spacing: 1px; text-transform: uppercase; padding: 1.3mm 2.4mm; border-radius: 1mm; }
.vc .num { font: 700 9.3pt Inter, sans-serif; color: var(--ink); }
.vc .tags { display:flex; gap: 1mm; flex-wrap: wrap; width: 100%; }
.vc .pt { text-align:center; line-height: 1.25; }
.vc .pt .cod { font: 700 13.5pt/1.15 Poppins, sans-serif; color: var(--ink); }
.vc .pt .cod.largo { font-size: 9.5pt; }
.vc .pt .h { font: 700 9.75pt Inter, sans-serif; color: var(--rosa); margin-top: .5mm; }
.vc .pt .f { font: 500 7.5pt Inter, sans-serif; color: var(--mute); margin-top: .3mm; }
.vc .linea { padding: 0 2mm; text-align:center; }
.vc .linea .l { font: 600 7.5pt Inter, sans-serif; color: var(--mute); margin-bottom: .8mm; min-height: 3mm; }
.vc .linea .b { position: relative; height: .6mm; border-radius: .3mm; background: var(--grad); margin-right: 2mm; }
.vc .linea .b .ic { position:absolute; right: -2.4mm; top: -1.5mm; width: 3.4mm; height: 3.4mm; color: #7b2fbe; transform: rotate(90deg); }
.vc .der { text-align:center; line-height: 1.3; }
.vc .der .k { font: 500 7.5pt Inter, sans-serif; color: var(--mute); }
.vc .der .v { font: 800 8.6pt Inter, sans-serif; color: var(--ink); }
.vc .nota { font-size: 7.1pt; color: var(--mute); margin-top: 1.6mm; line-height: 1.4; }

/* Hospedaje: grilla de dos columnas */
.hg { display:grid; grid-template-columns: 1fr 1fr; gap: 3.7mm; margin-bottom: 3mm; break-inside: avoid; }
.hc { border: 1px solid var(--line); border-radius: 2.8mm; overflow: hidden; display:flex; flex-direction: column; break-inside: avoid; }
.hc .img { height: 25mm; background-size: cover; background-position: center; position: relative; }
.hc .img .tags { position:absolute; top: 2.4mm; left: 3.2mm; display:flex; gap: 1mm; flex-wrap: wrap; }
.hc .img .stars { position:absolute; left: 3.2mm; bottom: 3mm; background: rgba(31,35,64,.8); border-radius: 1.4mm; padding: .5mm 2.4mm; color: #ffc53d; font-size: 7.4pt; letter-spacing: 1.4px; }
.hc .b { padding: 2.8mm 3.7mm 2mm; }
.hc .b > .tags { display:flex; gap: 1mm; flex-wrap: wrap; margin-bottom: 1.6mm; }
.hc .n { font: 700 10.5pt/1.25 Poppins, sans-serif; color: var(--ink); }
.hc .zona { margin: .5mm 0 1.6mm; }
.kv { display:flex; justify-content: space-between; gap: 3mm; border-top: 1px dashed var(--line); padding: .7mm 0; font-size: 7.7pt; line-height: 1.45; }
.kv span:first-child { color: var(--mute); white-space: nowrap; }
.kv span:last-child { font-weight: 700; text-align: right; }
.hc .pie { margin-top: auto; background: #fafafc; border-top: 1px solid var(--line); padding: 2.3mm 3.7mm 2.5mm; font-size: 7.5pt; color: var(--mute); line-height: 1.45; }

/* Traslados: filas */
table { width: 100%; border-collapse: collapse; font-size: 7.7pt; }
td { border-bottom: 1px solid #f3eff5; padding: 1.3mm 1.6mm; vertical-align: top; line-height: 1.45; }
th { text-align:left; font: 700 6.6pt Inter, sans-serif; letter-spacing: 1.4px; text-transform: uppercase; color: var(--rosa); padding: 1.3mm 1.6mm; border-bottom: 1px solid #f3eff5; }
td.r, th.r { text-align: right; }
.tr { border-top: 1px solid #f3eff5; }
.tr.fija { table-layout: fixed; }
.tr.sigue { border-top: 0; }
.tr td:first-child { font-weight: 700; }
.tr td.est { text-align:right; font-weight: 700; color: var(--morado); white-space: nowrap; }
tr { break-inside: avoid; }
thead { display: table-header-group; }

/* Itinerario día a día: línea de tiempo */
.pill { text-align:center; margin: 2.4mm 0 2.6mm; position: relative; break-after: avoid; }
.pill::before { content:""; position:absolute; left:0; right:0; top: 50%; border-top: 1px solid #f1d6e3; }
.pill span { position: relative; display:inline-block; background: linear-gradient(90deg,#e6197a,#7b2fbe); color:#fff; font: 800 8.6pt Inter, sans-serif; letter-spacing: 2.6px; text-transform: uppercase; padding: 1.9mm 6.2mm; border-radius: 5mm; }
.pill span .ic { width: 3.4mm; height: 3.4mm; color: #fff; margin-right: 1.8mm; vertical-align: -.6mm; }
.day { display:grid; grid-template-columns: 15.2mm 1fr; column-gap: 5.3mm; padding-bottom: 2.6mm; position: relative; break-inside: avoid; }
.day::before { content:""; position:absolute; left: 6.9mm; top: 17.4mm; bottom: 2mm; width: .7mm; border-radius: .35mm; background: linear-gradient(#a879d6, rgba(190,153,223,.15)); }
.day .dn { width: 15.2mm; height: 15.2mm; border-radius: 50%; background: linear-gradient(150deg,#e6197a 0%,#8a2cb5 48%,#3f7fbd 100%); box-shadow: 0 1.3mm 3.4mm rgba(230,25,122,.3); color:#fff; font: 700 15pt/1 Poppins, sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.day .dn small { font: 800 5.4pt Inter, sans-serif; letter-spacing: 1px; margin-bottom: .6mm; opacity: .95; }
.day .dn.rango { font-size: 10.5pt; letter-spacing: -.2px; }
.day .df { font: 700 7.85pt Inter, sans-serif; letter-spacing: 1.6px; text-transform: uppercase; color: var(--rosa); margin-top: .4mm; }
.day .t { font: 600 12.8pt/1.3 Poppins, sans-serif; color: var(--ink); margin: .5mm 0 2mm; }
.day .cuerpo.foto { display:grid; grid-template-columns: 39.7mm 1fr; gap: 4.4mm; align-items: start; }
.day .ph { height: 25.8mm; border-radius: 2.3mm; background-size: cover; background-position: center; box-shadow: 0 1.2mm 3mm rgba(31,35,64,.18); }
.ev { display:grid; grid-template-columns: 17mm 1fr; margin-bottom: 1.2mm; font-size: 8.25pt; line-height: 1.5; }
.ev .h { font-weight: 700; color: var(--morado); white-space: nowrap; }
.chips { display:flex; flex-wrap: wrap; gap: 1.6mm 2mm; margin-top: 1.2mm; }
.chip { display:inline-block; border-radius: 4mm; padding: 1mm 3mm; font: 700 7.4pt/1.4 Inter, sans-serif; background: #f4ecfb; border: 1px solid #e4d3f5; color: #5d2496; }

/* Planes opcionales: tarjetas como las del hospedaje */
.opcs { display:grid; grid-template-columns: repeat(4,1fr); gap: 3mm; }
.oc { border:1px solid var(--line); border-radius: 2.8mm; overflow:hidden; font-size: 7.7pt; break-inside: avoid; display:flex; flex-direction:column; }
.oc .img { height: 25mm; background-size:cover; background-position:center; position:relative; }
.oc .where { position:absolute; left: 2.4mm; bottom: 2.4mm; background: rgba(31,35,64,.8); color:#fff; border-radius: 1.4mm; padding: .5mm 2mm; font: 700 6.2pt Inter, sans-serif; letter-spacing: 1px; text-transform: uppercase; }
.oc .b { padding: 2.6mm 3mm; display:flex; flex-direction:column; flex:1; line-height:1.4; }
.oc .n { font: 700 9pt/1.25 Poppins, sans-serif; color: var(--ink); margin-bottom: .8mm; }
.oc .foot { margin-top:auto; padding-top: 1.6mm; display:flex; justify-content:space-between; align-items:baseline; border-top: 1px dashed var(--line); }
.oc .pr { font: 800 8.6pt Inter, sans-serif; color: var(--rosa); }

/* Información útil y términos: tarjetas con título rosa en versalitas */
.cards { display:grid; gap: 3.7mm; }
.card { border: 1px solid var(--line); border-radius: 3.2mm; padding: 3.3mm 4.4mm 2.6mm; break-inside: avoid; }
.card > .caps { display:block; font-size: 7.9pt; letter-spacing: 1.8px; margin-bottom: 2mm; }
.card ul { margin: 0; padding-left: 4mm; font-size: 7.8pt; line-height: 1.42; }
.card li { margin-bottom: .6mm; }
.card.dos ul { columns: 2; column-gap: 8mm; }
.card.dos li { break-inside: avoid; }

/* La hoja de precios */
.tarifas { display:grid; gap: 3.7mm; }
.tf { border: 1px solid var(--line); border-radius: 3.2mm; padding: 3.8mm 4.6mm 2.6mm; position: relative; break-inside: avoid; }
.tf.rec { border: 2px solid var(--rosa); box-shadow: 0 1.2mm 4mm rgba(230,25,122,.16); }
.tf .badge { position:absolute; top: -2.6mm; right: 4mm; background: linear-gradient(90deg,#e6197a,#7b2fbe); border-radius: 3mm; padding: .7mm 2.6mm; }
.tf .name { font: 700 12pt Poppins, sans-serif; }
.tf .price { font: 700 19pt/1.15 Poppins, sans-serif; margin: 1.6mm 0 0; color: var(--ink); letter-spacing: -.3px; }
.tf .pp { font-size: 7.6pt; color: var(--mute); margin-bottom: 1.5mm; }
.tf .row { border-top: 1px dashed var(--line); padding: 1.3mm 0; font-size: 7.9pt; line-height: 1.45; }
.tf .row b { display:block; font: 700 6.4pt Inter, sans-serif; letter-spacing: 1.4px; text-transform: uppercase; color: var(--mute); margin-bottom: .3mm; }
.stars { color: #e3a21a; letter-spacing: .5px; font-size: 7.5pt; }
.cta { margin-top: 3.2mm; background: linear-gradient(90deg,#1b1f3b,#1e2e5c); color:#fff; border-radius: 3.2mm; padding: 3.3mm 6mm; display:grid; grid-template-columns: 1.15fr 1fr; gap: 5mm; align-items:center; break-inside: avoid; }
.cta.solo { grid-template-columns: 1fr; }
.cta .caps { color: #ff8fc0; }
.ctt { font: 700 12.5pt/1.25 Poppins, sans-serif; margin: 1.2mm 0 1.4mm; }
.btns { display:flex; flex-direction:column; gap: 2mm; }
.btn { display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:#fff; border-radius: 2mm; padding: 2.4mm 4mm; font-size: 8pt; }
.btn b { font: 800 8.6pt Inter, sans-serif; }
.bE { background: var(--e); } .bR { background: var(--r); } .bP { background: var(--p); } .bN { background: #3b4170; }
.pagos .tot td { font: 700 9pt Poppins, sans-serif; color: var(--ink); border-bottom: 0; }
.pagos td.r { font-weight: 700; }
.pagos td, .pagos th { padding-top: 1mm; padding-bottom: 1mm; }
.sign { margin-top: 3mm; display:flex; justify-content: space-between; align-items: flex-end; break-inside: avoid; }
.sign b.pop { font: 700 10.5pt Poppins, sans-serif; color: var(--ink); }
.credits { font-size: 6.4pt; color: var(--mute); margin-top: 4mm; line-height: 1.35; }
.sign .credits { flex: 1; margin: 0 5mm; text-align: right; align-self: flex-end; }

/* Fotos extra de la biblioteca: en el MISMO recuadro (mismo alto), principal 2/3 y extras 1/3. */
.img.mosaico { display:grid; grid-template-columns: 2fr 1fr; gap: .6mm; background: #fff; }
.img.mosaico.n1 { grid-template-rows: 1fr; }
.img.mosaico.n2 { grid-template-rows: 1fr 1fr; }
.img.mosaico .m0 { grid-row: 1 / -1; background-size: cover; background-position: center; }
.img.mosaico .mx { background-size: cover; background-position: center; }
.img.fila { display:grid; grid-template-rows: 1fr; gap: .6mm; background: #fff; }
.img.fila .mx { background-size: cover; background-position: center; }

/*
 * La versión compacta (QA del #1359): solo se imprime si ahorra una hoja (\`imprimirHtmlAPdf\`,
 * \`alternativa\`). Los días libres seguidos ya vienen juntos; aquí, un poco menos de aire.
 */
.compacto .sec { margin-top: 2.6mm; }
.compacto .day { padding-bottom: 1.4mm; }
.compacto .day .t { margin: .3mm 0 1.2mm; }
.compacto .day .cuerpo.foto { grid-template-columns: 30mm 1fr; }
.compacto .day .ph { height: 18mm; }
.compacto .cta { padding: 2.6mm 6mm; }
.compacto .btns { gap: 1.4mm; }
.compacto .card { padding: 2.6mm 4.4mm 2mm; }
.compacto .sh { margin-bottom: 1.8mm; }
.compacto .sh .sq { width: 8.6mm; height: 8.6mm; }
.compacto .tf { padding: 3.2mm 4.6mm 2mm; }
.compacto .tf .row { padding: .9mm 0; }
.compacto .btn { padding: 1.7mm 4mm; }
.compacto .sign { margin-top: 2mm; }
`

/** Los símbolos SVG que usa el documento (`<use href="#plane"/>`). */
export const ICONOS_PROPUESTA = `<svg width="0" height="0" style="position:absolute"><defs>
<symbol id="plane" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" fill="currentColor"/></symbol>
<symbol id="train" viewBox="0 0 24 24"><path d="M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h12v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-4-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM11 10H6V6h5zm5.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-7h-5V6h5z" fill="currentColor"/></symbol>
<symbol id="van" viewBox="0 0 24 24"><path d="M3 6h11l4 4h3v6h-2a2.5 2.5 0 0 1-5 0H9a2.5 2.5 0 0 1-5 0H3zm2 2v3h4V8zm6 0v3h5l-3-3z" fill="currentColor"/></symbol>
<symbol id="bed" viewBox="0 0 24 24"><path d="M3 7v12h2v-3h14v3h2v-7a3 3 0 0 0-3-3h-7v5H5V7zm4 1a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" fill="currentColor"/></symbol>
<symbol id="tk" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4zm11 0v2h2V7zm0 4v2h2v-2zm0 4v2h2v-2z" fill="currentColor"/></symbol>
<symbol id="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></symbol>
<symbol id="bag" viewBox="0 0 24 24"><path d="M9 3h6v3h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3zm2 2v1h2V5z" fill="currentColor"/></symbol>
<symbol id="cal" viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5z" fill="currentColor"/></symbol>
<symbol id="star" viewBox="0 0 24 24"><path d="M12 2l3 6.6 7.2.7-5.4 4.8 1.6 7.1L12 17.6 5.6 21.2l1.6-7.1L1.8 9.3 9 8.6z" fill="currentColor"/></symbol>
<symbol id="tag" viewBox="0 0 24 24"><path d="M3 3h8l10 10-8 8L3 11zm4 2.5A1.5 1.5 0 1 0 7 8.5a1.5 1.5 0 0 0 0-3z" fill="currentColor"/></symbol>
<symbol id="doc" viewBox="0 0 24 24"><path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5zM7 12v2h10v-2zm0 4v2h7v-2z" fill="currentColor"/></symbol>
<symbol id="info" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v2h-2zm0 4h2v6h-2z" fill="currentColor"/></symbol>
<symbol id="pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></symbol>
</defs></svg>`
