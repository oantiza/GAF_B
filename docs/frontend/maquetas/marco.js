/* Maquetas del sistema de diseño propuesto: el marco común (menú y barra) y un trazador de líneas.
   No es código de la aplicación: solo pinta las maquetas de esta carpeta. */

const MENU = [
  { titulo: "Mercado", entradas: ["Mercado"] },
  { titulo: "Activos", entradas: ["Buscador", "Comparador"] },
  { titulo: "Propuestas", entradas: ["Diseño", "Análisis", "Informes", "Guardadas"] },
  { titulo: "Clientes", entradas: ["Carteras de clientes", "Posiciones"] },
  { titulo: "Planificación", entradas: ["Jubilación", "Planes y EPSV"] }
];

/** Monta el menú y la barra alrededor del contenido de `<main>`. */
function montarMarco({ activa, migas }) {
  const principal = document.querySelector("main");
  const marco = document.createElement("div");
  marco.className = "marco";
  const grupos = MENU.map((grupo) => `
    <div class="menu__grupo">
      <div class="menu__titulo">${grupo.titulo}</div>
      ${grupo.entradas.map((entrada) => `<a class="menu__enlace" href="#"${entrada === activa ? ' aria-current="page"' : ""}><i></i>${entrada}</a>`).join("")}
    </div>`).join("");
  marco.innerHTML = `
    <nav class="menu" aria-label="Secciones">
      <div class="menu__marca"><span class="menu__sello">IPB</span><span>Independent<small>Private Bankers</small></span></div>
      ${grupos}
      <div class="menu__separador"></div>
      <div class="menu__grupo"><div class="menu__titulo">Datos</div>
        <a class="menu__enlace" href="#"><i></i>Salud del catálogo</a><a class="menu__enlace" href="#"><i></i>Sistema</a></div>
    </nav>
    <div>
      <header class="barra">
        <span class="barra__migas">${migas.slice(0, -1).map((miga) => `${miga} / `).join("")}<b>${migas[migas.length - 1]}</b></span>
        <span class="barra__hueco"></span>
        <span class="barra__propuesta">Propuesta en curso · <b>Familia García</b> · 8 posiciones</span>
        <span class="barra__interruptor"><i></i>Modo cliente</span>
        <span>Marta Ruiz</span>
      </header>
    </div>`;
  principal.replaceWith(marco);
  marco.lastElementChild.appendChild(principal);
}

/** Una serie de aspecto real y siempre igual: paseo con deriva, sembrado. */
function serie(semilla, puntos, deriva, ruido, inicio = 100) {
  let estado = semilla;
  const azar = () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296 - 0.5;
  };
  const valores = [inicio];
  for (let i = 1; i < puntos; i += 1) valores.push(valores[i - 1] * (1 + deriva + azar() * ruido));
  return valores;
}

/** Fija el último valor de una serie reescalando su recorrido: la línea acaba donde dice la cifra. */
function acabarEn(valores, final) {
  const ultimo = valores[valores.length - 1];
  const primero = valores[0];
  return valores.map((valor, i) => valor + (final - ultimo) * (i / (valores.length - 1)) + 0 * primero);
}

/**
 * Dibuja un gráfico de líneas en un `<svg class="grafico">`.
 * series: [{ valores, color, trazos, rotulo }] · ejeX: rótulos repartidos · formato: (valor) => texto
 */
function dibujarLineas(svg, { series, ejeX, formato, alto = 260, pasos = 4, escalon = false }) {
  const ancho = svg.clientWidth || 760;
  const margen = { arriba: 12, derecha: 104, abajo: 26, izquierda: 56 };
  svg.setAttribute("viewBox", `0 0 ${ancho} ${alto}`);
  svg.setAttribute("height", alto);
  const todos = series.flatMap((s) => s.valores);
  /* Marcas redondas: el paso es 1, 2 o 5 por una potencia de diez. */
  const crudo = (Math.max(...todos) - Math.min(...todos)) / pasos;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 5, 10].map((m) => m * potencia).find((m) => m >= crudo);
  const min = Math.floor(Math.min(...todos) / paso) * paso;
  const max = Math.ceil(Math.max(...todos) / paso) * paso;
  pasos = Math.round((max - min) / paso);
  /* El eje reserva el ancho de su rótulo más largo. */
  margen.izquierda = Math.max(40, Math.max(formato(min).length, formato(max).length) * 6.4 + 14);
  const x = (i, n) => margen.izquierda + (i / (n - 1)) * (ancho - margen.izquierda - margen.derecha);
  const y = (valor) => margen.arriba + (1 - (valor - min) / (max - min)) * (alto - margen.arriba - margen.abajo);
  let dentro = "";
  for (let i = 0; i <= pasos; i += 1) {
    const valor = min + ((max - min) * i) / pasos;
    dentro += `<line x1="${margen.izquierda}" x2="${ancho - margen.derecha}" y1="${y(valor)}" y2="${y(valor)}" stroke="var(--grafico-rejilla)" stroke-width="1"/>`;
    dentro += `<text x="${margen.izquierda - 8}" y="${y(valor) + 4}" text-anchor="end">${formato(valor)}</text>`;
  }
  ejeX.forEach((rotulo, i) => {
    dentro += `<text x="${x(i, ejeX.length)}" y="${alto - 6}" text-anchor="${i === 0 ? "start" : i === ejeX.length - 1 ? "end" : "middle"}">${rotulo}</text>`;
  });
  const finales = [];
  series.forEach((s) => {
    const n = s.valores.length;
    let camino = "";
    s.valores.forEach((valor, i) => {
      if (i === 0) camino += `M${x(0, n)},${y(valor)}`;
      else if (escalon && s.escalon) camino += `H${x(i, n)}V${y(valor)}`;
      else camino += `L${x(i, n)},${y(valor)}`;
    });
    dentro += `<path d="${camino}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.trazos ? ' stroke-dasharray="5 4"' : ""}/>`;
    finales.push({ y: y(s.valores[n - 1]), x: x(n - 1, n), s });
  });
  /* Etiquetas directas al final de cada línea, separadas si se pisan. */
  finales.sort((a, b) => a.y - b.y);
  for (let i = 1; i < finales.length; i += 1) if (finales[i].y - finales[i - 1].y < 30) finales[i].y = finales[i - 1].y + 30;
  finales.forEach(({ x: fx, y: fy, s }) => {
    dentro += `<circle cx="${fx}" cy="${y(s.valores[s.valores.length - 1])}" r="4" fill="${s.color}" stroke="var(--papel)" stroke-width="2"/>`;
    dentro += `<text class="rotulo-de-serie" x="${fx + 10}" y="${fy - 2}">${s.rotulo}</text>`;
    dentro += `<text x="${fx + 10}" y="${fy + 12}">${s.apunte ?? ""}</text>`;
  });
  svg.innerHTML = dentro;
}
