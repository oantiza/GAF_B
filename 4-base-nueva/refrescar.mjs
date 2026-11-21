/**
 * 4-base-nueva/refrescar.mjs — refresca los datos de la base nueva, de la fuente a la nube.
 *
 *   node 4-base-nueva/refrescar.mjs                 # precios y rendimiento, hasta el emulador
 *   node 4-base-nueva/refrescar.mjs --completo      # todas las familias caducadas: pueden ser horas
 *   node 4-base-nueva/refrescar.mjs --sin-extractor # reaprovecha lo ya exportado
 *   node 4-base-nueva/refrescar.mjs --sin-firds     # sin el completo semanal de FIRDS (identidad)
 *   node 4-base-nueva/refrescar.mjs --sube          # además sube el catálogo a la nube
 *   node 4-base-nueva/refrescar.mjs --solo-listado  # solo quién entra por igualar al proveedor: no escribe nada
 *
 * Sin `--sube` no sale del ordenador. Con él sube SOLO el catálogo: las carteras y las
 * retrocesiones las edita Óscar en la nube, y la copia local las pisaría.
 *
 * Se para en el primer paso que falle y no sube nada si la base no valida entera o si se han
 * perdido instrumentos o métricas: un fallo de la fuente no debe vaciar lo que ve un cliente. Si no valida,
 * tampoco se guarda en disco: el volcado sigue siendo el último bueno.
 *
 * El escritor no borra nunca, así que un recuento no puede bajar: lo que dice si la fuente ha fallado es cuántos
 * instrumentos NO ha vuelto a escribir esta pasada. Se nombran siempre, y si pasan del 1 % `--sube` se para hasta
 * que se le diga `--admite-instrumentos-sin-reescribir`: lo que hay de ellos es de una pasada anterior y subiría
 * como vigente.
 *
 * Y antes de subir dice quién entra y quién sale del cálculo por igualar al proveedor (decisiones 55 y
 * 91), respecto a la última subida: esa regla se evalúa sola al leer, y sin esto las cifras de una
 * cartera cambiarían de golpe sin que nadie lo haya decidido. Si cambia alguien, `--sube` se para
 * hasta que se le diga `--admite-cambios-en-el-calculo`, igual que con los cierres mezclados. La lista con la que
 * se compara solo se guarda al subir: un refresco que no sube no gasta esa puerta.
 *
 * Hace falta el emulador de la base nueva en marcha (`node 4-base-nueva/arrancar.mjs`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const EXTRACTOR = join(RAIZ, '1-extractor');
const PLATAFORMA = join(RAIZ, '2-plataforma-datos');
const EMULADOR = 'http://127.0.0.1:8092/v1/projects/bdb-gestor-de-activos/databases/(default)/documents';
const PUERTA_LOCAL = { BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES' };
const PUERTA_NUBE = { BDB_SUBIDA_A_LA_NUBE: 'SI_ENTIENDO_QUE_ESCRIBE_EN_LA_NUBE' };
/** Lo que se tolera perder de una pasada a otra. Un fondo que se retira es normal; muchos, no. */
export const PERDIDA_ADMITIDA = 0.01;

const bandera = (nombre) => process.argv.includes(`--${nombre}`);

function paso(titulo, comando, argumentos, cwd, entorno = {}, bastaCon = undefined) {
  console.log(`\n=== ${titulo} ===`);
  const r = spawnSync(comando, argumentos, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, ...entorno }
  });
  const salida = r.stdout ?? '';
  console.log(salida.split('\n').slice(-12).join('\n'));
  if (r.status !== 0 && !(bastaCon !== undefined && salida.includes(bastaCon))) {
    console.error(`\nPARADO en «${titulo}» (salida ${r.status}). No se ha subido nada a la nube.`);
    process.exit(2);
  }
  return salida;
}

/** Por debajo de esto, los fondos no miden al mismo cierre y compararlos engaña. */
export const CIERRE_COMUN_MINIMO = 0.95;

/**
 * Si los cierres mensuales están repartidos. Pasa en los primeros días del mes: los fondos que aún
 * no han publicado su último valor cierran en el mes anterior (188 de 703 el 02-11-2026).
 */
export function cierreMezclado(cierres, minimo = CIERRE_COMUN_MINIMO) {
  const cuenta = new Map();
  for (const cierre of cierres) cuenta.set(cierre, (cuenta.get(cierre) ?? 0) + 1);
  if (cuenta.size === 0) return undefined;
  const [comun, veces] = [...cuenta].sort((a, b) => b[1] - a[1])[0];
  const reparto = Object.fromEntries([...cuenta].sort());
  return veces / cierres.length < minimo ? { comun, reparto } : undefined;
}

/** Los cierres de las métricas mensuales del emulador. */
async function cierresMensuales() {
  const respuesta = await fetch(`${EMULADOR}:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'computed', allDescendants: true }],
        select: { fields: [{ fieldPath: 'as_of' }, { fieldPath: 'frequency' }] }
      }
    })
  });
  if (!respuesta.ok) throw new Error(`el emulador contesto ${respuesta.status} al leer los cierres`);
  return (await respuesta.json())
    .map((fila) => fila.document?.fields)
    .filter((campos) => campos?.frequency?.stringValue === 'MONTHLY')
    .map((campos) => campos.as_of?.stringValue ?? 'sin fecha');
}

/** Cuántos documentos de un grupo hay en el emulador. */
async function cuenta(grupo) {
  const respuesta = await fetch(`${EMULADOR}:runAggregationQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: grupo, allDescendants: true }] },
        aggregations: [{ alias: 'n', count: {} }]
      }
    })
  });
  if (!respuesta.ok) throw new Error(`el emulador contesto ${respuesta.status} al contar ${grupo}`);
  const [fila] = await respuesta.json();
  return Number(fila.result.aggregateFields.n.integerValue);
}

const fotografia = async () => ({
  instruments: await cuenta('instruments'),
  computed: await cuenta('computed'),
  price_series: await cuenta('price_series')
});

/** Lo que se ha perdido por encima de lo admitido. Vacío: se puede seguir. */
export function perdidas(antes, despues, admitida = PERDIDA_ADMITIDA) {
  return Object.keys(antes)
    .filter((grupo) => despues[grupo] < antes[grupo] * (1 - admitida))
    .map((grupo) => `${grupo}: de ${antes[grupo]} a ${despues[grupo]}`);
}

/** Las raíces de los instrumentos del emulador, con el momento en que se escribió cada una. */
async function raicesDeLosInstrumentos() {
  const respuesta = await fetch(`${EMULADOR}:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'instruments' }],
        select: { fields: [{ fieldPath: 'updated_at' }, { fieldPath: 'identity.name' }] }
      }
    })
  });
  if (!respuesta.ok) throw new Error(`el emulador contesto ${respuesta.status} al leer las raices`);
  return (await respuesta.json())
    .filter((fila) => fila.document)
    .map(({ document }) => ({
      id: document.name.split('/').pop(),
      nombre: document.fields?.identity?.mapValue?.fields?.name?.stringValue ?? '',
      escrito: document.fields?.updated_at?.stringValue ?? document.fields?.updated_at?.timestampValue
    }));
}

/**
 * Los instrumentos que esta pasada no ha vuelto a escribir (auditoría del 16-11-2026, PLA-1): su raíz lleva el
 * momento de la pasada que la escribió, y es anterior a `inicio`. Una raíz sin fecha cuenta como no escrita.
 *
 * Es la comprobación que `perdidas` no puede hacer: el escritor no borra nunca, así que si la fuente deja de dar un
 * instrumento sus documentos se quedan, el recuento no baja y lo viejo subiría como vigente.
 */
export function sinReescribir(raices, inicio) {
  const corte = Date.parse(inicio);
  return raices.filter((raiz) => !(Date.parse(raiz.escrito ?? '') >= corte));
}

/** Si los que no se han vuelto a escribir pasan de lo que se admite perder. */
export function sonDemasiados(viejos, total, admitida = PERDIDA_ADMITIDA) {
  return viejos > total * admitida;
}

/** Lo que se dice de ellos en la salida. Vacío si se han escrito todos. */
export function textoDeLosNoReescritos(viejos, total, cuantos = 15) {
  if (viejos.length === 0) return '';
  const lineas = [
    `AVISO: ${viejos.length} de ${total} instrumentos no se han vuelto a escribir en esta pasada.`,
    'Lo que hay de ellos en la base es de una pasada anterior: el escritor no borra, y subiría como vigente.'
  ];
  for (const raiz of viejos.slice(0, cuantos)) {
    lineas.push(`  ${raiz.id}  ${raiz.nombre} | escrito el ${raiz.escrito ? String(raiz.escrito).slice(0, 10) : 'sin fecha'}`);
  }
  if (viejos.length > cuantos) lineas.push(`  ... y ${viejos.length - cuantos} más`);
  return lineas.join('\n');
}

/**
 * La lista de la última subida. Va en `refrescos/`, que no va al repositorio ni a la nube: el sitio que se
 * publica es `sitio/`, y lo que sube `nube:subir` se lee del emulador.
 */
export const LISTA_DEL_REFRESCO = join(AQUI, 'refrescos', 'entran_por_igualar.json');

/** Quién entra y quién sale respecto a la última subida. Sin subida anterior no hay con qué comparar: `primera`. */
export function cambiosEnElCalculo(anterior, fondos) {
  const entranHoy = fondos.filter((fondo) => fondo.entra);
  if (anterior === undefined) return { primera: true, entran: [], salen: [] };
  const antes = new Map(anterior.entran.map((fondo) => [fondo.isin, fondo]));
  const hoy = new Set(entranHoy.map((fondo) => fondo.isin));
  return {
    primera: false,
    entran: entranHoy.filter((fondo) => !antes.has(fondo.isin)),
    salen: anterior.entran.filter((fondo) => !hoy.has(fondo.isin))
  };
}

/** Si hay que parar antes de subir: alguien entra o sale, y nadie ha dicho que lo sabe. */
export function hayQuePararLaSubida(cambios, { sube, admite }) {
  return sube && !admite && cambios.entran.length + cambios.salen.length > 0;
}

const NOMBRE_DE_LA_VENTANA = { '3y': '3 años', '5y': '5 años', '10y': '10 años' };

function lineaDeDiferencias(fondo) {
  const ventanas = Object.entries(fondo.diferencias_pp).filter(([, valor]) => typeof valor === 'number');
  if (ventanas.length === 0) return 'sin contraste: no hay cifras del proveedor en euros con las que comparar';
  return ventanas
    .map(([ventana, valor]) => `${NOMBRE_DE_LA_VENTANA[ventana] ?? ventana} ${Math.abs(valor).toFixed(3).replace('.', ',')}`)
    .join(' · ');
}

/** El listado tal como se lee en la salida. */
export function textoDelListado(listado, anterior, cambios) {
  const lineas = [
    `Con rendimiento a 12 meses: ${listado.con_rendimiento} fondos. ${listado.bloqueados} los bloquea su política, y no se miran. Los demás:`
  ];
  for (const fondo of listado.fondos) {
    lineas.push(`  ${fondo.entra ? 'ENTRA' : 'fuera'}  ${fondo.isin}  ${fondo.nombre} | ${lineaDeDiferencias(fondo)}`);
  }
  lineas.push('Son puntos al año entre su serie y el proveedor. Entra quien está a 0,10 o menos en todas, con dos ventanas al menos.');
  if (cambios.primera) {
    lineas.push('No hay subida anterior con la que comparar.');
    return lineas.join('\n');
  }
  if (cambios.entran.length + cambios.salen.length === 0) {
    lineas.push(`Respecto a la última subida, del ${anterior.fecha}: nadie entra ni sale.`);
    return lineas.join('\n');
  }
  lineas.push(`Respecto a la última subida, del ${anterior.fecha}:`);
  for (const fondo of cambios.entran) lineas.push(`  ENTRA EN EL CÁLCULO  ${fondo.isin}  ${fondo.nombre}`);
  for (const fondo of cambios.salen) lineas.push(`  SALE DEL CÁLCULO    ${fondo.isin}  ${fondo.nombre}`);
  lineas.push('Las cifras de las carteras que los lleven van a cambiar por esto: míralas antes de subir.');
  return lineas.join('\n');
}

/** Lo pregunta a la regla de verdad, en Python: copiarla aquí sería tener dos. */
function quienEntraHoy() {
  const r = spawnSync('python', ['quien_entra.py'], {
    cwd: AQUI,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  });
  if (r.status !== 0) {
    console.error(`\nPARADO: no se ha podido saber quién entra en el cálculo (salida ${r.status}). No se ha subido nada a la nube.`);
    console.error((r.stderr ?? '').split('\n').slice(-12).join('\n'));
    process.exit(2);
  }
  return JSON.parse(r.stdout);
}

function leeLaListaAnterior() {
  return existsSync(LISTA_DEL_REFRESCO) ? JSON.parse(readFileSync(LISTA_DEL_REFRESCO, 'utf8')) : undefined;
}

function guardaLaLista(listado) {
  mkdirSync(dirname(LISTA_DEL_REFRESCO), { recursive: true });
  const entran = listado.fondos.filter((fondo) => fondo.entra).map(({ isin, nombre }) => ({ isin, nombre }));
  writeFileSync(LISTA_DEL_REFRESCO, `${JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), entran }, null, 1)}\n`);
}

/** Enseña el listado y devuelve qué ha cambiado. No guarda nada: la lista solo se guarda al subir. */
function listaQuienEntra() {
  console.log('\n=== Quién entra en el cálculo por igualar al proveedor (decisión 55) ===');
  const listado = quienEntraHoy();
  const anterior = leeLaListaAnterior();
  const cambios = cambiosEnElCalculo(anterior, listado.fondos);
  console.log(textoDelListado(listado, anterior, cambios));
  return { listado, cambios };
}

async function main() {
  if (bandera('solo-listado')) {
    listaQuienEntra();
    return;
  }
  let antes;
  try {
    antes = await fotografia();
  } catch (error) {
    console.error(`El emulador de la base nueva no responde: ${error.message}`);
    console.error('Levántalo con: node 4-base-nueva/arrancar.mjs');
    process.exit(2);
  }
  console.log(`antes: ${JSON.stringify(antes)}`);

  if (!bandera('sin-extractor')) {
    /* La identidad (CFI, LEI, cotizaciones, bajas) se refresca con el fichero COMPLETO semanal de FIRDS, a
       mano y dentro de este refresco, nunca con los deltas diarios (decisión 35 de DECISIONES_DATOS_2026-11-07.md):
       el completo son 15 MB y una semana de retraso no cambia la identidad. Va antes de `update` para que la
       pasada lea la identidad nueva. `--sin-firds` lo salta si ESMA no responde y hay que refrescar precios. */
    if (!bandera('sin-firds')) paso('Extractor: identidad FIRDS (completo semanal)', 'python', ['main.py', 'firds', '--sin-deltas'], EXTRACTOR);
    const update = ['main.py', 'update', '--all'];
    if (!bandera('completo')) update.push('--familias', 'precio,rendimiento');
    paso('Extractor: descargar', 'python', update, EXTRACTOR);
    paso('Extractor: calidad', 'python', ['main.py', 'calidad'], EXTRACTOR);
    paso('Extractor: exportar', 'python', ['main.py', 'export'], EXTRACTOR);
    paso('Extractor: canónico', 'python', ['main.py', 'bdb'], EXTRACTOR);
    paso('Extractor: series', 'python', ['main.py', 'series'], EXTRACTOR);
    paso('Extractor: cambios y ESTR', 'python', ['main.py', 'cambios'], EXTRACTOR);
  }

  /* PLA-1: lo que se escriba a partir de aquí lleva un `updated_at` posterior. */
  const inicioDeLaEscritura = new Date().toISOString();
  paso('Base local: instrumentos', 'npm', ['run', 'baseNueva:write', '--', '--write'], PLATAFORMA, PUERTA_LOCAL);
  paso('Base local: tarjetas e índice', 'npm', ['run', 'baseNueva:batch', '--', '--write'], PLATAFORMA, PUERTA_LOCAL);
  paso('Base local: series', 'npm', ['run', 'baseNueva:series', '--', '--write'], PLATAFORMA, PUERTA_LOCAL);

  const auditoria = paso('Auditoría', 'npm', ['run', 'audit:base-nueva'], PLATAFORMA);

  const despues = await fotografia();
  console.log(`\nantes  : ${JSON.stringify(antes)}\ndespues: ${JSON.stringify(despues)}`);

  /* PLA-3 (auditoría del 16-11-2026): se comprueba ANTES de guardar. Guardar sobrescribe el volcado, y antes una base
     que no validaba quedaba en disco como la buena. */
  const sinGuardar =
    'NO se ha guardado en disco: el volcado sigue siendo el de antes de este refresco. El emulador sí tiene lo escrito ahora; ' +
    'para volver al volcado hay que cerrarlo sin Ctrl-C (que guardaría) y arrancarlo de nuevo.';
  if (!auditoria.includes('La base nueva valida entera')) {
    console.error(`\nPARADO: la base no valida entera. No se sube nada.\n${sinGuardar}`);
    process.exit(2);
  }
  const perdido = perdidas(antes, despues);
  if (perdido.length > 0) {
    console.error(`\nPARADO: se han perdido datos, y no se sube nada:\n  ${perdido.join('\n  ')}\n${sinGuardar}`);
    process.exit(2);
  }

  /* En Windows, Node se cae al salir de la CLI de Firebase después de exportar bien (assert de libuv,
     salida 3221226505). Lo que dice si se guardó es el mensaje, no el código de salida. */
  paso('Guardar en disco', 'node', ['4-base-nueva/guardar.mjs'], RAIZ, {}, 'Export complete');

  /* PLA-1: quién no se ha vuelto a escribir. No impide guardar —ya estaban en el volcado—, pero sí subir. */
  const raices = await raicesDeLosInstrumentos();
  const viejos = sinReescribir(raices, inicioDeLaEscritura);
  if (viejos.length > 0) console.warn(`\n${textoDeLosNoReescritos(viejos, raices.length)}`);
  if (bandera('sube') && sonDemasiados(viejos.length, raices.length) && !bandera('admite-instrumentos-sin-reescribir')) {
    console.error('PARADO: son más del 1 %, y no se sube. Para subir así: --admite-instrumentos-sin-reescribir.');
    process.exit(2);
  }

  const mezcla = cierreMezclado(await cierresMensuales());
  if (mezcla !== undefined) {
    console.warn(`\nAVISO: los fondos no miden al mismo cierre: ${JSON.stringify(mezcla.reparto)}`);
    console.warn('Suele ser un refresco en los primeros días del mes. Conviene repetirlo unos días después.');
    if (bandera('sube') && !bandera('admite-cierres-mezclados')) {
      console.error('PARADO: no se sube. Para subir así: --admite-cierres-mezclados.');
      process.exit(2);
    }
  }

  const { listado, cambios } = listaQuienEntra();
  if (hayQuePararLaSubida(cambios, { sube: bandera('sube'), admite: bandera('admite-cambios-en-el-calculo') })) {
    /* La lista no se guarda: la próxima vez sigue diciendo lo mismo, hasta que se suba sabiéndolo. */
    console.error('\nPARADO: alguien entra o sale del cálculo. No se sube. Para subir así: --admite-cambios-en-el-calculo.');
    process.exit(2);
  }

  if (!bandera('sube')) {
    /* PLA-2 (auditoría del 16-11-2026): aquí no se guarda la lista. Guardada, el `--sube` siguiente comparaba con este
       refresco y decía «nadie entra ni sale» de cambios que la nube aún no tenía: la puerta se gastaba sin subir. */
    console.log('\nLa base local está refrescada. NADA subido a la nube: eso pide --sube.');
    return;
  }
  const opciones = ['run', 'nube:subir', '--', '--parte', 'catalogo', '--escribe'];
  paso('Nube: subir el catálogo', 'npm', opciones, PLATAFORMA, { ...PUERTA_NUBE, NODE_OPTIONS: '--max-old-space-size=6144' });
  guardaLaLista(listado);
  console.log('\nHecho: el catálogo de la nube está al día.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
