/**
 * 4-base-nueva/arrancar.mjs — levanta el emulador del proyecto nuevo, con persistencia.
 *
 *   node 4-base-nueva/arrancar.mjs
 *
 * Hace tres cosas que a mano se olvidan, y las tres han costado un rato alguna vez:
 *
 *  1. **El JDK 21 delante del PATH.** El `java` del sistema es un JRE 1.8 y firebase-tools
 *     exige 21 o superior; sin esto el arranque muere con un mensaje que no menciona Java.
 *  2. **`--import` solo si hay algo que importar.** Con la carpeta vacía o inexistente,
 *     `--import` no arranca: aborta diciendo que no encuentra el volcado. La primera vez,
 *     por definición, no lo hay.
 *  3. **`--export-on-exit`**, que es toda la persistencia: guarda al salir ordenadamente.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DATOS = path.join(AQUI, 'datos');
const PROYECTO = 'bdb-gestor-de-activos';

/** La marca que deja un volcado del emulador. Sin ella, `--import` no tiene nada que leer. */
const MARCA_DE_VOLCADO = 'firebase-export-metadata.json';

/**
 * Busca un JDK 21 o superior.
 *
 * Las rutas van con barra NORMAL y no invertida a proposito: Node las entiende igual en
 * Windows, y en una cadena de JavaScript la barra invertida es un escape. `'C:\Program'` no
 * es una ruta, es `C:` seguido de un salto de pagina, y `fs.existsSync` dice que no existe
 * sin explicar por que. Costo una pasada descubrirlo.
 */
function jdkDisponible() {
    // `JAVA_HOME` primero: es donde lo dice la propia maquina, y aqui apunta al JDK 21.
    const delEntorno = process.env.JAVA_HOME;
    if (delEntorno !== undefined && delEntorno !== '') {
        const bin = path.join(delEntorno, 'bin');
        if (fs.existsSync(path.join(bin, 'java.exe')) || fs.existsSync(path.join(bin, 'java'))) return bin;
    }
    const conocido = 'C:/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin';
    if (fs.existsSync(conocido)) return conocido;
    const padre = 'C:/Program Files/Microsoft';
    if (!fs.existsSync(padre)) return undefined;
    const candidatos = fs
        .readdirSync(padre)
        .filter((n) => /^jdk-(2[1-9]|[3-9]\d)\./.test(n))
        .sort()
        .reverse();
    for (const c of candidatos) {
        const bin = path.join(padre, c, 'bin');
        if (fs.existsSync(path.join(bin, 'java.exe'))) return bin;
    }
    return undefined;
}

/**
 * ¿Está libre este puerto en 127.0.0.1? Intenta abrirlo de verdad; es la única comprobación que no se engaña
 * (la de `Test-NetConnection` miraba `::1` y dio falsos «libre» con Vite, ver la habilidad `arrancar-entorno`).
 */
function puertoLibre(puerto) {
    return new Promise((resolver) => {
        const servidor = net.createServer();
        servidor.once('error', () => resolver(false));
        servidor.once('listening', () => servidor.close(() => resolver(true)));
        servidor.listen(puerto, '127.0.0.1');
    });
}

/**
 * Los cuatro puertos del emulador, leídos de `firebase.json` (no copiados aquí). Si otro emulador ocupa cualquiera de
 * ellos -el de registro (`logging`) es el que se olvida: el de la base de siempre lleva el suyo-, firebase-tools aborta
 * con un mensaje que no dice qué puerto ni de quién es. Se comprueban antes y se nombra el que está ocupado.
 */
async function comprobarPuertos() {
    const emuladores = JSON.parse(fs.readFileSync(path.join(AQUI, 'firebase.json'), 'utf-8')).emulators ?? {};
    const puertos = [
        ['firestore', emuladores.firestore?.port],
        ['firestore (websocket)', emuladores.firestore?.websocketPort],
        ['hub', emuladores.hub?.port],
        ['registro (logging)', emuladores.logging?.port]
    ];
    const ocupados = [];
    for (const [nombre, puerto] of puertos) {
        if (typeof puerto === 'number' && !(await puertoLibre(puerto))) ocupados.push(`${nombre}: ${puerto}`);
    }
    if (ocupados.length > 0) {
        console.error(`[base-nueva] no arranco: hay otro proceso escuchando en ${ocupados.join(', ')}.`);
        console.error('[base-nueva] Puede ser este mismo emulador ya en marcha (no hace falta otro) o el emulador de la base de');
        console.error('[base-nueva] siempre, que usa sus propios puertos pero puede haberse quedado con uno de estos. Para ver quién');
        console.error('[base-nueva] es: `Get-NetTCPConnection -LocalPort <puerto>` en PowerShell. No se para nada desde aquí.');
        process.exit(1);
    }
}
await comprobarPuertos();

fs.mkdirSync(DATOS, { recursive: true });
const hayVolcado = fs.existsSync(path.join(DATOS, MARCA_DE_VOLCADO));

const argumentos = ['emulators:start', '--only', 'firestore', '--project', PROYECTO, '--export-on-exit', 'datos'];
if (hayVolcado) argumentos.push('--import', 'datos');

const jdk = jdkDisponible();
if (jdk === undefined) {
    console.error('[base-nueva] no encuentro un JDK 21 o superior; firebase-tools lo exige y va a fallar.');
}

console.log('');
console.log('=== emulador de la base nueva ===');
console.log(`proyecto   : ${PROYECTO}`);
console.log(`firestore  : 127.0.0.1:8092   hub: 127.0.0.1:4402`);
console.log(`persiste en: ${DATOS}`);
console.log(`al arrancar: ${hayVolcado ? 'IMPORTA el volcado anterior' : 'base vacia (no hay volcado que importar)'}`);
console.log('al salir   : Ctrl-C guarda. Un kill a la fuerza no, asi que antes: node 4-base-nueva/guardar.mjs');
console.log('');

/* Dos cosas de Windows en una sola linea de codigo:
     - `shell: true` no es opcional: desde Node 20, `spawn` de un `.cmd` sin shell falla con
       `spawn EINVAL`.
     - y el comando va como UNA cadena, sin lista de argumentos, porque `spawn` con lista
       mas shell avisa (DEP0190) de que no escapa los argumentos, solo los concatena. Como
       aqui los concatenamos nosotros y ninguno lleva espacios, el aviso sobra. */
const hijo = spawn([process.platform === 'win32' ? 'firebase.cmd' : 'firebase', ...argumentos].join(' '), {
    cwd: AQUI,
    stdio: 'inherit',
    shell: true,
    env: jdk === undefined ? process.env : { ...process.env, PATH: `${jdk}${path.delimiter}${process.env.PATH}` }
});

hijo.on('exit', (codigo) => process.exit(codigo ?? 0));
