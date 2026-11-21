/**
 * 4-base-nueva/guardar.mjs — guarda la base nueva en disco SIN parar el emulador.
 *
 *   node 4-base-nueva/guardar.mjs
 *
 * `--export-on-exit` solo guarda en una salida ordenada. Esto existe para el resto de los
 * casos: antes de un reinicio de la maquina, despues de una pasada de escritura que ha
 * costado, o cuando no se quiere depender de que el cierre vaya bien.
 *
 * Sobrescribe el volcado anterior a proposito: lo que se quiere guardar es el estado de
 * ahora, no una historia de volcados.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/* El comando va como una sola cadena, igual que en `arrancar.mjs` y por lo mismo: en Windows
   `spawn` de un `.cmd` sin shell falla con `spawn EINVAL`, y con shell mas lista de argumentos
   avisa (DEP0190) de que no los escapa. Ninguno de estos lleva espacios. */
const ORDEN = [
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase',
    'emulators:export',
    'datos',
    '--force',
    '--project',
    'bdb-gestor-de-activos'
].join(' ');

const hijo = spawn(ORDEN, { cwd: AQUI, stdio: 'inherit', shell: true });

hijo.on('exit', (codigo) => process.exit(codigo ?? 0));
