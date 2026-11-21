/**
 * 4-base-nueva/version.mjs — qué commit se compila, qué commit se despliega y qué commit está publicado.
 *
 * Auditoría del 16-11-2026 (SEG-3). No quedaba registrado qué commit estaba en producción: el sitio se
 * compilaba desde `HEAD` sin estampar nada y el despliegue de funciones exigía el árbol limpio pero no
 * apuntaba cuál subía. Para saberlo había que comparar la huella del índice publicado con una compilación
 * hecha a mano.
 *
 *   node 4-base-nueva/version.mjs        # dice qué commit sirve la web publicada y lo compara con el de aquí
 *
 * - **El sitio** lleva un `version.json` junto al índice, con el commit del que salió. Se publica con él.
 * - **Las funciones** dejan una línea en `4-base-nueva/despliegues.jsonl` cuando el despliegue acaba bien.
 *   Ese fichero es local y no va al repositorio: es el registro de quien despliega.
 *
 * El commit de un repositorio privado no es un secreto: dice qué versión hay, no qué contiene.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const REGISTRO_DE_DESPLIEGUES = join(AQUI, 'despliegues.jsonl');
export const SITIO_PUBLICADO = 'https://bdb-gestor-de-activos.web.app';

function git(argumentos, cwd) {
    const r = spawnSync('git', argumentos, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')} termino con ${r.status}: ${(r.stderr ?? '').trim()}`);
    return r.stdout.trim();
}

/** El commit en el que está una carpeta del repositorio: el hash entero, el corto y su fecha. */
export function commitDe(carpeta) {
    const commit = git(['rev-parse', 'HEAD'], carpeta);
    return { commit, corto: commit.slice(0, 8), fecha_del_commit: git(['show', '-s', '--format=%cI', 'HEAD'], carpeta) };
}

/** Lo que se escribe en `version.json`: de qué commit salió el sitio y cuándo se compiló. */
export function versionDelSitio(commit, ahora = new Date()) {
    return { ...commit, compilado: ahora.toISOString() };
}

/** Deja `version.json` en la carpeta del sitio. Devuelve lo escrito. */
export function escribirVersion(sitio, commit, ahora = new Date()) {
    const version = versionDelSitio(commit, ahora);
    writeFileSync(join(sitio, 'version.json'), `${JSON.stringify(version, null, 2)}\n`);
    return version;
}

/** Añade una línea al registro local de despliegues. Devuelve la línea escrita. */
export function registrarDespliegue(datos, ruta = REGISTRO_DE_DESPLIEGUES, ahora = new Date()) {
    const linea = { fecha: ahora.toISOString(), ...datos };
    appendFileSync(ruta, `${JSON.stringify(linea)}\n`);
    return linea;
}

/** La frase que compara lo publicado con lo de aquí. */
export function comparacion(publicado, local) {
    if (!publicado?.commit) return 'La web publicada no lleva version.json: se compiló antes del 16-11-2026, o no se ha desplegado desde entonces.';
    const cuando = `compilado el ${publicado.compilado ?? 'sin fecha'}`;
    return publicado.commit === local.commit
        ? `La web publicada sale de ${publicado.corto ?? publicado.commit.slice(0, 8)}, que es el commit de aquí (${cuando}).`
        : `La web publicada sale de ${publicado.corto ?? publicado.commit.slice(0, 8)} (${cuando}), y aquí está ${local.corto}: no son el mismo.`;
}

async function main() {
    const local = commitDe(AQUI);
    console.log(`aquí      : ${local.corto} · ${local.fecha_del_commit}`);
    let publicado = null;
    try {
        const respuesta = await fetch(`${SITIO_PUBLICADO}/version.json`, { cache: 'no-store' });
        /* Sin el fichero, el sitio contesta el índice (es una aplicación de una sola página): no es JSON. */
        if (respuesta.ok && (respuesta.headers.get('content-type') ?? '').includes('json')) publicado = await respuesta.json();
    } catch (error) {
        console.error(`No se pudo leer ${SITIO_PUBLICADO}/version.json: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
    console.log(comparacion(publicado, local));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
