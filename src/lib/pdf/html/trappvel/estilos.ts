/**
 * Estilos e iconos de la propuesta de Trappvel, copiados del prototipo aprobado (v5,
 * `proyectos/trappvel/clarity/qa/2026-10-13_prueba-europa/ideal/doc.html`). No se reescriben
 * a mano: si el prototipo cambia, se vuelve a copiar. Lo único cambiado es el fondo del
 * encabezado de la primera hoja, que ahora llega por la foto de la portada.
 */

export const CSS_PROPUESTA = `
@page { size: A4; margin: 11mm 12mm 16mm; }
:root { --ink:#1f1a2b; --mute:#6a6478; --line:#e6e1ec; --soft:#f4f0f7; --navy:#2b1840; --acc:#e63380; --tq:#1fa7bd; --grad:linear-gradient(90deg,#e63380,#8b4fa0 55%,#1fa7bd); --e:#1a93a8; --r:#e63380; --p:#7a4fa8; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; font-family: Inter, sans-serif; color: var(--ink); font-size: 9.6pt; line-height: 1.45; }
h1,h2,h3,.mont { font-family: Montserrat, sans-serif; }
h2 { font-size: 17pt; margin: 0 0 2mm; color: var(--navy); letter-spacing: -.2px; }
h2 + .lead { color: var(--mute); margin: 0 0 5mm; font-size: 10pt; }
h3 { font-size: 11.5pt; margin: 0 0 1.5mm; color: var(--navy); }
.sec { margin-top: 7mm; }
.nobr { break-inside: avoid; }
.kicker { font: 600 7.5pt Montserrat, sans-serif; letter-spacing: 1.6px; text-transform: uppercase; color: var(--acc); }
.muted { color: var(--mute); }
.small { font-size: 8.2pt; }
.money { font-variant-numeric: tabular-nums; white-space: nowrap; }
.tag { display:inline-block; font: 700 6.8pt Montserrat, sans-serif; letter-spacing: .8px; text-transform: uppercase; padding: .6mm 2mm; border-radius: 1mm; color:#fff; }
.tE { background: var(--e); } .tR { background: var(--r); } .tP { background: var(--p); }
.cE { color: var(--e); } .cR { color: var(--r); } .cP { color: var(--p); }

/* Portada */
.cover { width: 210mm; height: 297mm; position: relative; overflow: hidden; color: #fff; background: var(--navy); }
.cover .mosaic { position:absolute; inset:0 0 auto 0; height: 168mm; display:grid; grid-template-columns: 1.3fr 1fr; grid-template-rows: 1fr 1fr; gap: 1.2mm; }
.cover .mosaic div { background-size: cover; background-position: center; position: relative; }
.cover .mosaic div:first-child { grid-row: span 2; }
.cover .mosaic span { position:absolute; left: 3mm; bottom: 2.5mm; font: 600 6.5pt Montserrat; letter-spacing: 1.2px; text-transform: uppercase; text-shadow: 0 0 4px rgba(0,0,0,.7); }
.cover .shade { position:absolute; left:0; right:0; top: 120mm; height: 50mm; background: linear-gradient(transparent, var(--navy)); }
.cover .body { position:absolute; left: 16mm; right: 16mm; top: 150mm; }
.cover .brand { position:absolute; top: 11mm; left: 15mm; } .cover .brand img { height: 10mm; display:block; filter: drop-shadow(0 0 2.5mm rgba(0,0,0,.55)); }
.cover::after { content:""; position:absolute; left:0; right:0; bottom:0; height: 2.5mm; background: var(--grad); }
.gbar { height: 1.2mm; width: 28mm; background: var(--grad); border-radius: 1mm; margin-bottom: 3mm; }
.cover .code { position:absolute; top: 13mm; right: 16mm; font: 600 8pt Montserrat; letter-spacing: 1px; text-shadow: 0 0 6px rgba(0,0,0,.6); }
.cover h1 { font-size: 27pt; line-height: 1.08; margin: 3mm 0 3mm; letter-spacing: -.5px; }
.cover .para { font-size: 10.5pt; opacity: .9; max-width: 160mm; margin: 0; }
.cover .facts { display:grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 8mm; border-top: 1px solid rgba(255,255,255,.25); padding-top: 4mm; }
.cover .facts b { display:block; font: 600 6.8pt Montserrat; letter-spacing: 1.3px; text-transform: uppercase; opacity: .7; margin-bottom: 1mm; }
.cover .facts div { font-size: 9.5pt; }
.cover .who { position:absolute; left:16mm; right:16mm; bottom: 12mm; display:flex; justify-content: space-between; font-size: 8.3pt; opacity: .85; }

/* Ruta */
.route { display:flex; align-items: stretch; margin: 4mm 0 6mm; }
.stop { flex: 1; text-align: center; position: relative; }
.stop .dot { width: 9mm; height: 9mm; border-radius: 50%; margin: 0 auto 1.5mm; background: var(--navy); color:#fff; font: 700 8pt Montserrat; display:flex; align-items:center; justify-content:center; }
.stop.home .dot { background: #fff; color: var(--navy); border: 2px solid var(--navy); }
.stop .city { font: 700 9.5pt Montserrat; color: var(--navy); }
.stop .when { font-size: 7.8pt; color: var(--mute); }
.leg { flex: .9; display:flex; flex-direction: column; align-items:center; justify-content: flex-start; padding-top: 2mm; }
.leg .bar { width: 100%; border-top: 2px dashed #9fb0bd; margin-bottom: 1mm; }
.leg .bar.train { border-top: 3px solid #9fb0bd; }
.leg .ico { font-size: 11pt; line-height: 1; }
.leg .lbl { font-size: 7.2pt; color: var(--mute); text-align:center; line-height: 1.25; }
.photo-row { display:grid; grid-template-columns: repeat(4,1fr); gap: 2mm; margin-bottom: 6mm; }
.photo-row div { height: 30mm; border-radius: 1.5mm; background-size: cover; background-position: center; }

/* Tarifas */
.tarifas { display:grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
.tf { border: 1px solid var(--line); border-radius: 2.5mm; padding: 4mm 4mm 3mm; position: relative; }
.tf.rec { border: 2px solid var(--r); box-shadow: 0 1mm 4mm rgba(230,51,128,.18); }
.tf .name { font: 800 12pt Montserrat; }
.tf .badge { position:absolute; top: -3mm; right: 4mm; }
.tf .price { font: 800 17pt Montserrat; margin: 2mm 0 0; letter-spacing: -.4px; }
.tf .pp { font-size: 7.8pt; color: var(--mute); margin-bottom: 3mm; }
.tf .row { border-top: 1px solid var(--line); padding: 1.6mm 0; font-size: 8.4pt; }
.tf .row b { display:block; font: 600 6.6pt Montserrat; letter-spacing: 1px; text-transform: uppercase; color: var(--mute); }
.stars { color: #c9962a; letter-spacing: .5px; font-size: 7.5pt; }
.flag { font-size: 7.6pt; color: #9a3412; }
.igual { margin-top: 5mm; background: var(--soft); border-radius: 2.5mm; padding: 4mm 5mm; }
.igual ul { margin: 1mm 0 0; padding-left: 4.5mm; columns: 2; column-gap: 8mm; }
.igual li { margin-bottom: 1mm; break-inside: avoid; }

/* Día a día */
.day { display:grid; grid-template-columns: 22mm 1fr; gap: 4mm; padding: 2.6mm 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
.day .d { font: 800 15pt Montserrat; color: var(--navy); line-height: 1; }
.day .d small { display:block; font: 600 7pt Montserrat; letter-spacing: 1px; text-transform: uppercase; color: var(--mute); margin-top: 1mm; }
.day .t { font: 700 10pt Montserrat; color: var(--navy); margin-bottom: .8mm; }
.day .t .city { color: var(--acc); font-weight: 600; font-size: 8pt; letter-spacing: 1px; text-transform: uppercase; margin-left: 2mm; }
.ev { display:grid; grid-template-columns: 12mm 5mm 1fr; gap: 1mm; font-size: 8.8pt; margin: .5mm 0; }
.ev .h { color: var(--mute); font-variant-numeric: tabular-nums; }
.ev .i { text-align:center; }
.opt3 { display:grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; margin-top: 1mm; font-size: 7.9pt; }
.opt3 div { background: var(--soft); border-radius: 1.2mm; padding: 1.2mm 2mm; }
.free { color: var(--mute); font-style: italic; font-size: 8.6pt; }
.warnbox { background: #fdeef5; border-left: 3px solid var(--acc); padding: 1.5mm 3mm; font-size: 8.2pt; margin-top: 1mm; }

/* Hoteles */
.cityhead { display:flex; justify-content: space-between; align-items: baseline; margin: 3.5mm 0 1.8mm; border-bottom: 2px solid var(--navy); padding-bottom: 1mm; }
.cityhead .mont { font: 800 13pt Montserrat; color: var(--navy); }
.hotels { display:grid; grid-template-columns: repeat(3,1fr); gap: 3mm; break-inside: avoid; }
.hc { border: 1px solid var(--line); border-radius: 2mm; overflow: hidden; font-size: 8.2pt; }
.hc.rec { border: 2px solid var(--r); }
.hc .img { height: 42mm; background-size: cover; background-position: center; position: relative; }
.hc .img .tag { position:absolute; top: 2mm; left: 2mm; }
.hc .img .zone { position:absolute; bottom: 0; left:0; right:0; padding: 4mm 2mm 1mm; font-size: 6.6pt; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,.65)); }
.hc .b { padding: 1.8mm 2.5mm 2mm; line-height: 1.35; }
.hc .n { font: 700 9.2pt Montserrat; color: var(--navy); line-height: 1.2; }
.hc .p { font: 800 10pt Montserrat; margin-top: 1.2mm; }
.hc .ok { color: #2f6b47; } .hc .no { color: #9a3412; }

/* Tablas */
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
th { text-align:left; font: 600 6.8pt Montserrat; letter-spacing: 1px; text-transform: uppercase; color: var(--mute); border-bottom: 1.5px solid var(--navy); padding: 1.5mm 1.5mm; }
td { border-bottom: 1px solid var(--line); padding: 1.8mm 1.5mm; vertical-align: top; }
td.r, th.r { text-align: right; }
tr.sub td { background: var(--soft); font: 700 8pt Montserrat; color: var(--navy); }
.fl { font: 700 8.5pt Montserrat; }
.two { display:grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.pay { display:grid; grid-template-columns: repeat(3,1fr); gap: 3mm; margin: 3mm 0 4mm; }
.pay div { background: var(--soft); border-radius: 2mm; padding: 3mm; }
.pay .v { font: 800 13pt Montserrat; color: var(--navy); }
.list li { margin-bottom: 1.2mm; }
.sign { margin-top: 8mm; display:flex; justify-content: space-between; align-items: flex-end; }
.credits { font-size: 6.6pt; color: var(--mute); margin-top: 6mm; line-height: 1.35; }
.ic { width: 3.6mm; height: 3.6mm; vertical-align: -0.7mm; color: var(--navy); }
.leg .ic { width: 4.5mm; height: 4.5mm; color: #7d909e; }
.ev .i .ic { color: var(--acc); }
td .ic { color: var(--acc); margin-right: .8mm; }
.cover .mosaic span { left:auto; bottom:auto; right: 3mm; top: 3mm; }
.cover .mosaic div:first-child span { top: 26mm; left: 16mm; right: auto; }
.cover .mosaic div:nth-child(2) span { top: auto; bottom: 3mm; }
.opcs { display:grid; grid-template-columns: repeat(4,1fr); gap: 3mm; }
.oc { border:1px solid var(--line); border-radius:2mm; overflow:hidden; font-size:8pt; break-inside: avoid; display:flex; flex-direction:column; }
.oc .img { height: 30mm; background-size:cover; background-position:center; position:relative; }
.oc .where { position:absolute; left:0; right:0; bottom:0; padding: 4mm 2mm 1mm; color:#fff; font: 600 6.5pt Montserrat; letter-spacing:1px; text-transform:uppercase; background: linear-gradient(transparent, rgba(0,0,0,.65)); }
.oc .b { padding: 2mm 2.4mm; display:flex; flex-direction:column; flex:1; line-height:1.35; }
.oc .n { font: 700 9pt Montserrat; color: var(--navy); margin-bottom: .8mm; }
.oc .foot { margin-top:auto; padding-top: 1.5mm; display:flex; justify-content:space-between; align-items:baseline; }
.oc .pr { font: 800 9pt Montserrat; color: var(--acc); }
.cta { margin-top: 5mm; background: var(--navy); color:#fff; border-radius: 3mm; padding: 5mm 6mm; display:grid; grid-template-columns: 1.15fr 1fr; gap: 5mm; align-items:center; break-inside: avoid; }
.ctt { font: 700 12.5pt Montserrat; line-height:1.25; margin: 1.5mm 0 2mm; }
.btns { display:flex; flex-direction:column; gap: 2mm; }
.btn { display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:#fff; border-radius: 2mm; padding: 2.6mm 4mm; font-size: 8.2pt; }
.btn b { font: 800 9.5pt Montserrat; }
.bE { background: var(--e); } .bR { background: var(--r); box-shadow: 0 0 0 1.2px #fff inset; } .bP { background: var(--p); }
.hls { display:grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 2mm; }
.hl { border-radius: 3mm; overflow:hidden; background: var(--soft); break-inside: avoid; }
.hl .img { height: 62mm; background-size: cover; position: relative; }
.hl .ct { position:absolute; left: 3mm; top: 3mm; background: rgba(43,24,64,.82); color:#fff; font: 700 6.8pt Montserrat; letter-spacing: 1.2px; text-transform: uppercase; padding: 1mm 2.2mm; border-radius: 1mm; }
.hl .tx { padding: 3mm 4mm 4mm; border-top: 1.2mm solid; border-image: var(--grad) 1; }
.hl h3 { font-size: 12.5pt; margin-bottom: 1mm; }
.hl p { margin: 0; font-size: 9pt; color: var(--ink); }

/* v5 · estilo Edgar: denso, corrido */
.list { break-inside: avoid; }
.brk { break-before: page; margin-top: 0; }
.top { display:flex; justify-content:space-between; align-items:center; margin-bottom: 3mm; }
.top .k { font: 600 7.2pt Montserrat; letter-spacing: 1.8px; text-transform: uppercase; color: var(--mute); }
.top .k i { display:inline-block; width:1.8mm; height:1.8mm; border-radius:50%; background: var(--acc); margin-right: 1.8mm; vertical-align: .2mm; }
.top img { height: 9mm; }
.hero { position:relative; height: 66mm; border-radius: 3mm; overflow:hidden; background: var(--navy) center 55%/cover; }
.hero::after { content:""; position:absolute; inset:0; background: linear-gradient(90deg, rgba(43,24,64,.88) 0%, rgba(43,24,64,.55) 55%, rgba(43,24,64,.05) 100%); }
.hero .in { position:absolute; left: 7mm; right: 40mm; bottom: 6mm; z-index:1; color:#fff; }
.hero .dt { font: 700 7.5pt Montserrat; letter-spacing: 1.6px; text-transform: uppercase; color:#ff9cc6; }
.hero h1 { font-size: 23pt; line-height: 1.08; margin: 1.5mm 0 2mm; letter-spacing: -.4px; }
.hero .sub { font-size: 9.5pt; opacity: .92; }
.hero .ph { position:absolute; right: 3mm; bottom: 2.5mm; z-index:1; font: 600 6pt Montserrat; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,.85); }
.facts5 { display:grid; grid-template-columns: repeat(4,1fr); gap: 2.5mm; margin: 3.5mm 0 0; }
.facts5 div { background: #fdf0f6; border: 1px solid #f7d3e4; border-radius: 2mm; padding: 2.4mm 3mm; font: 600 8.8pt Montserrat; color: var(--navy); line-height: 1.3; }
.facts5 b { display:block; font: 700 6.4pt Montserrat; letter-spacing: 1.3px; text-transform: uppercase; color: var(--acc); margin-bottom: .8mm; }
.intro { font-size: 10pt; margin: 4mm 0 0; }
.sh { display:flex; align-items:center; gap: 3mm; margin: 0 0 3mm; break-after: avoid; }
.sh .sq { width: 10mm; height: 10mm; border-radius: 2.2mm; background: linear-gradient(135deg,#e63380,#8b4fa0); display:flex; align-items:center; justify-content:center; flex: none; }
.sh .sq .ic { width: 5.2mm; height: 5.2mm; color:#fff; vertical-align: 0; }
.sh h2 { margin: 0; font-size: 15.5pt; }
.sh .st { font-size: 8.4pt; color: var(--mute); margin-top: .3mm; }
.route { margin: 3mm 0 4mm; padding: 3mm 2mm; background: var(--soft); border-radius: 2.5mm; }
.hls { grid-template-columns: 1fr 1fr; gap: 2.5mm; margin-top: 0; }
.hl { display:grid; grid-template-columns: 36mm 1fr; background: #fff; border: 1px solid var(--line); border-radius: 2.5mm; }
.hl .img { height: auto; min-height: 40mm; background-position: center; }
.hl .ct { white-space: nowrap; left: 1.5mm; top: auto; bottom: 1.5mm; font-size: 5.6pt; padding: .7mm 1.5mm; letter-spacing: .8px; }
.hl .tx { border-top: 0; border-left: 1mm solid; border-image: linear-gradient(#e63380,#8b4fa0,#1fa7bd) 1; padding: 2.4mm 3mm; }
.hl h3 { font-size: 10.5pt; }
.hl p { font-size: 8.8pt; line-height: 1.38; }
/* Día a día con línea de tiempo */
.day { grid-template-columns: 13mm 1fr; gap: 3.5mm; padding: 1.4mm 0; border-bottom: 0; position: relative; }
.day::before { content:""; position:absolute; left: 6.25mm; top: 0; bottom: 0; width: .5mm; background: #d9c6e6; }
.day .d { width: 13mm; height: 13mm; border-radius: 50%; background: linear-gradient(135deg,#e63380,#8b4fa0); color:#fff; font: 800 12.5pt Montserrat; display:flex; flex-direction:column; align-items:center; justify-content:center; position: relative; z-index: 1; }
.day .d small { color: #fff; opacity: .9; font-size: 4.9pt; letter-spacing: .3px; margin-top: .4mm; }
.day .t { font-size: 10.5pt; margin-top: .8mm; }
.pill { text-align:center; margin: 2.5mm 0 1.5mm; position: relative; break-after: avoid; }
.pill::before { content:""; position:absolute; left:0; right:0; top: 50%; border-top: 1px solid var(--line); }
.pill span { position: relative; display:inline-block; background: linear-gradient(90deg,#e63380,#8b4fa0); color:#fff; font: 700 7.2pt Montserrat; letter-spacing: 2px; text-transform: uppercase; padding: 1.2mm 5mm; border-radius: 5mm; }
/* Hoteles más compactos */
.hc .img { height: 29mm; }
.cityhead { margin: 2.5mm 0 1.6mm; border-bottom-width: 1.5px; }
.cityhead .mont { font-size: 11.5pt; }
.oc .img { height: 25mm; }
.credits { margin-top: 4mm; }
.sign { margin-top: 5mm; }
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
<symbol id="pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></symbol>
</defs></svg>`
