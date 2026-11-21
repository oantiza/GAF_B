"""Genera data/visor.html: visor local autocontenido de la base de datos.

Los datos van embebidos en el HTML (no necesita servidor ni conexión):
tabla comparativa ordenable + buscador + ficha completa por fondo.
Se regenera con `python main.py visor` tras cada update.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from core.informe import divisa_del_vl

log = logging.getLogger("fondosdb.visor")


def datos_para_script(fondos: dict) -> str:
    """JSON que se puede meter tal cual en `<script>const DATOS = …;</script>`.

    `json.dumps` no escapa `</`: un nombre con `</script>` cerraba el bloque y
    lo que siguiera se ejecutaba como HTML; y `<!--` cambia cómo el navegador
    busca el cierre del script (auditoría 16-10, CRIT-07). En el JSON un `<`
    solo puede ir dentro de una cadena, donde `\\u003c` es el mismo carácter
    para JS y para JSON: escapándolos todos no queda ni `</` ni `<!--`.
    """
    return json.dumps(fondos, ensure_ascii=False).replace("<", "\\u003c")


def genera(base: Path) -> Path:
    funds_dir = base / "data" / "funds"
    fondos = {}
    for ruta in sorted(funds_dir.glob("*.json")):
        try:
            fondos[ruta.stem] = json.loads(ruta.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning("visor: no puedo leer %s: %s", ruta.name, e)
    if not fondos:
        raise RuntimeError("No hay fondos en data/funds/: ejecuta antes 'update'.")

    destino = base / "data" / "visor.html"
    # La divisa del VL se decide aquí, con la misma regla que el informe
    # (`core.informe.divisa_del_vl`, revisión de la cuarta pasada, MEN-E).
    divisas = {str((d.get("meta") or {}).get("isin") or isin): divisa_del_vl(d)
               for isin, d in fondos.items() if isinstance(d, dict)}
    html = PLANTILLA.replace("__DIVISAS_VL__", datos_para_script(divisas))
    html = html.replace("__DATOS__", datos_para_script(fondos))
    html = html.replace("__FECHA__", dt.datetime.now().strftime("%d-%m-%Y %H:%M"))
    destino.write_text(html, encoding="utf-8")
    log.info("visor generado: %s (%d fondos, %.1f MB)",
             destino, len(fondos), destino.stat().st_size / 1e6)
    return destino


PLANTILLA = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>FondosDB — visor</title>
<style>
  :root { --bg:#f7f7f5; --panel:#fff; --tinta:#1c1c1c; --suave:#6b6b6b;
          --linea:#e3e3df; --acento:#0b6e4f; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--tinta); }
  header { padding:14px 22px; background:var(--panel); border-bottom:1px solid var(--linea);
           display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; } header small { color:var(--suave); }
  #buscar { margin-left:auto; padding:7px 12px; border:1px solid var(--linea);
            border-radius:8px; min-width:260px; font-size:14px; }
  main { display:grid; grid-template-columns: minmax(0,1fr) 480px; gap:0; }
  #lista { overflow:auto; max-height:calc(100vh - 64px); }
  table { border-collapse:collapse; width:100%; background:var(--panel); }
  th,td { padding:7px 10px; border-bottom:1px solid var(--linea); text-align:right;
          white-space:nowrap; }
  th:first-child,td:first-child, th:nth-child(2),td:nth-child(2) { text-align:left; }
  th { position:sticky; top:0; background:#efefeb; cursor:pointer; user-select:none; }
  tbody tr { cursor:pointer; } tbody tr:hover { background:#f0f6f3; }
  tbody tr.activa { background:#e2efe9; }
  td.nombre { max-width:330px; overflow:hidden; text-overflow:ellipsis; }
  #ficha { border-left:1px solid var(--linea); background:var(--panel);
           overflow:auto; max-height:calc(100vh - 64px); padding:16px 20px; }
  #ficha h2 { margin:0 0 2px; font-size:17px; } #ficha .sub { color:var(--suave); margin-bottom:12px; }
  details { margin:6px 0; border:1px solid var(--linea); border-radius:8px; padding:6px 10px; }
  summary { cursor:pointer; font-weight:600; color:var(--acento); }
  .kv { display:grid; grid-template-columns: minmax(140px,46%) 1fr; gap:2px 10px; margin:6px 0; }
  .kv .k { color:var(--suave); } .kv .v { text-align:right; font-variant-numeric:tabular-nums; }
  .vacio { color:#bbb; }
  .chip { display:inline-block; background:#eef2ee; border-radius:10px; padding:1px 8px;
          margin:1px; font-size:12px; }
  @media (max-width:1000px){ main{grid-template-columns:1fr;} #ficha{border-left:none;} }
</style>
</head>
<body>
<header>
  <h1>FondosDB</h1>
  <small id="resumen"></small>
  <small>generado __FECHA__</small>
  <input id="buscar" placeholder="Filtrar por nombre, ISIN, categoría…">
</header>
<main>
  <div id="lista"><table id="tabla">
    <thead><tr id="cabecera"></tr></thead><tbody id="cuerpo"></tbody>
  </table></div>
  <aside id="ficha"><p class="vacio">Selecciona un fondo de la tabla.</p></aside>
</main>
<script>
const DATOS = __DATOS__;
const DIVISAS_VL = __DIVISAS_VL__;

const g = (o, ruta) => ruta.split('.').reduce((a,k)=> (a&&typeof a==='object')?a[k]:undefined, o);
// Todo lo que entra en innerHTML pasa por esc(): los datos son raspados.
const esc = v => String(v ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => (v===null||v===undefined||v==='')?null:(typeof v==='number'?v:parseFloat(v));
const f2 = v => { const n=num(v); return n===null?'·':n.toLocaleString('es-ES',{maximumFractionDigits:2}); };
const fpct = v => { const n=num(v); return n===null?'·':n.toLocaleString('es-ES',{maximumFractionDigits:2})+'%'; };

const COLS = [
  ['ISIN',        d=>g(d,'meta.isin')||'',                          v=>v],
  ['Nombre',      d=>g(d,'identificacion.nombre')||'',              v=>v],
  ['Tipo',        d=>g(d,'identificacion.tipo')||'',                v=>v],
  ['Categoría',   d=>g(d,'identificacion.categoria_morningstar')||'',v=>v],
  ['TER%',        d=>num(g(d,'costes.ter_pct')),                    fpct],
  ['VL',          d=>num(g(d,'valoracion.vl')),                     f2],
  // la divisa del VL, con la regla de core.informe.divisa_del_vl
  ['Divisa',      d=>DIVISAS_VL[g(d,'meta.isin')]||'', v=>v],
  ['★',           d=>num(g(d,'rating.estrellas.overall')),          v=>v??'·'],
  ['Rent 1a%',    d=>num(g(d,'rentabilidad.trailing_pct.1a.fondo')),fpct],
  ['Rent 3a%',    d=>num(g(d,'rentabilidad.trailing_pct.3a_anualizada.fondo')),fpct],
  ['Rent 5a%',    d=>num(g(d,'rentabilidad.trailing_pct.5a_anualizada.fondo')),fpct],
  ['Vol 3a%',     d=>num(g(d,'riesgo.volatilidad_pct.3a.fondo')),   fpct],
  ['Sharpe 3a',   d=>num(g(d,'riesgo.sharpe.3a.fondo')),            f2],
  ['SRI',         d=>num(g(d,'riesgo.sri_kid_1a7')),                v=>v??'·'],
  ['Patrim. M',   d=>num(g(d,'valoracion.patrimonio_fondo_meur')),  f2],
  ['Fuentes',     d=>Object.values(g(d,'meta.fuentes')||{}).flat().filter((x,i,a)=>a.indexOf(x)===i).join(','), v=>v],
];

let ordenCol = 0, ordenAsc = true, filtro = '';

function filas() {
  const txt = filtro.toLowerCase();
  let out = Object.values(DATOS).filter(d => {
    if (!txt) return true;
    return JSON.stringify([g(d,'meta.isin'),g(d,'identificacion.nombre'),
      g(d,'identificacion.categoria_morningstar'),g(d,'identificacion.gestora')])
      .toLowerCase().includes(txt);
  });
  out.sort((a,b) => {
    const va = COLS[ordenCol][1](a), vb = COLS[ordenCol][1](b);
    if (va===null||va===undefined||va==='') return 1;
    if (vb===null||vb===undefined||vb==='') return -1;
    const c = (typeof va==='number' && typeof vb==='number') ? va-vb
            : String(va).localeCompare(String(vb),'es');
    return ordenAsc ? c : -c;
  });
  return out;
}

function pinta() {
  const cab = document.getElementById('cabecera');
  cab.innerHTML = COLS.map(([t],i) =>
    `<th data-i="${i}">${esc(t)}${i===ordenCol?(ordenAsc?' ▲':' ▼'):''}</th>`).join('');
  cab.querySelectorAll('th').forEach(th => th.onclick = () => {
    const i = +th.dataset.i;
    if (i===ordenCol) ordenAsc = !ordenAsc; else { ordenCol = i; ordenAsc = true; }
    pinta();
  });
  const cuerpo = document.getElementById('cuerpo');
  const fs = filas();
  cuerpo.innerHTML = fs.map(d => {
    const isin = g(d,'meta.isin');
    return `<tr data-isin="${esc(isin)}">` + COLS.map(([_,get,fmt],i) => {
      const v = fmt(get(d));
      const cls = i===1 ? ' class="nombre"' : '';
      return `<td${cls} title="${esc(v)}">${v===null?'·':esc(v)}</td>`;
    }).join('') + '</tr>';
  }).join('');
  cuerpo.querySelectorAll('tr').forEach(tr => tr.onclick = () => {
    cuerpo.querySelectorAll('tr').forEach(x=>x.classList.remove('activa'));
    tr.classList.add('activa');
    ficha(tr.dataset.isin);
  });
  document.getElementById('resumen').textContent =
    `${fs.length} de ${Object.keys(DATOS).length} fondos`;
}

const NOMBRES_BLOQUE = {identificacion:'Identificación', valoracion:'Valoración y patrimonio',
  costes:'Costes', rentabilidad:'Rentabilidad', riesgo:'Riesgo', rating:'Rating',
  cartera:'Cartera', esg:'ESG / Sostenibilidad', gestion:'Gestión y gestora',
  distribuciones:'Distribuciones', documentos:'Documentos', meta:'Metadatos'};

function ficha(isin) {
  const d = DATOS[isin];
  const el = document.getElementById('ficha');
  const nombre = g(d,'identificacion.nombre')||isin;
  let h = `<h2>${esc(nombre)}</h2><div class="sub">${esc(isin)} · ${esc(g(d,'identificacion.gestora')||'')} · ${esc(g(d,'identificacion.categoria_morningstar')||'')}</div>`;
  const orden = ['identificacion','valoracion','costes','rentabilidad','riesgo',
                 'rating','cartera','esg','gestion','distribuciones','documentos','meta'];
  for (const bloque of orden) {
    if (!(bloque in d)) continue;
    h += `<details ${['identificacion','costes','rentabilidad'].includes(bloque)?'open':''}>
          <summary>${esc(NOMBRES_BLOQUE[bloque]||bloque)}</summary>${render(d[bloque])}</details>`;
  }
  el.innerHTML = h;
}

function render(v, nivel=0) {
  if (v === null || v === undefined) return '<span class="vacio">·</span>';
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="vacio">—</span>';
    if (typeof v[0] === 'object') {
      const filasT = v.slice(0, 60);
      const cols = [...new Set(filasT.flatMap(o=>Object.keys(o||{})))];
      return `<table style="font-size:12px">${'<tr>'+cols.map(c=>`<th>${esc(c)}</th>`).join('')+'</tr>'}
        ${filasT.map(o=>'<tr>'+cols.map(c=>`<td>${o&&o[c]!==null&&o[c]!==undefined?(typeof o[c]==='number'?f2(o[c]):esc(o[c])):'·'}</td>`).join('')+'</tr>').join('')}</table>
        ${v.length>60?`<div class="vacio">… y ${v.length-60} más</div>`:''}`;
    }
    return v.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
  }
  if (typeof v === 'object') {
    const entradas = Object.entries(v).filter(([,x]) => x!==null && x!==undefined &&
      !(typeof x==='object' && !Array.isArray(x) && !Object.keys(x).length));
    if (!entradas.length) return '<span class="vacio">—</span>';
    const simples = entradas.filter(([,x]) => typeof x !== 'object');
    const complejas = entradas.filter(([,x]) => typeof x === 'object');
    let h = '';
    if (simples.length) {
      h += '<div class="kv">' + simples.map(([k,x]) =>
        `<span class="k">${esc(k)}</span><span class="v">${typeof x==='number'?f2(x):esc(x)}</span>`).join('') + '</div>';
    }
    for (const [k,x] of complejas) {
      h += nivel < 2
        ? `<details><summary>${esc(k)}</summary>${render(x, nivel+1)}</details>`
        : `<div class="kv"><span class="k">${esc(k)}</span><span class="v"></span></div>` + render(x, nivel+1);
    }
    return h;
  }
  return esc(v);
}

document.getElementById('buscar').oninput = e => { filtro = e.target.value; pinta(); };
pinta();
const primera = document.querySelector('#cuerpo tr');
if (primera) primera.click();
</script>
</body>
</html>
"""
