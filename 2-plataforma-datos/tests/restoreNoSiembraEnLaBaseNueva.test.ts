import { describe, expect, it } from 'vitest';
import { motivoParaNoSembrarAhi } from '../scripts/restoreBackupToEmulator';
import { HOST_EMULADOR_BASE_DE_SIEMPRE, HOST_EMULADOR_BASE_NUEVA } from '../src/config/projectAllowlist';

/**
 * PLA-8 (auditoría integral del 16-11-2026): el sembrado de la base de siempre aceptaba cualquier puerto local, también
 * el del emulador de la base nueva. Los dos emuladores sirven con cualquier id de proyecto, así que lo único que separa
 * las dos bases es el puerto: sembrar en el 8092 mezclaría la copia de la maestra vieja con la base nueva, que persiste.
 */
describe('donde se siembra la copia de la maestra de siempre', () => {
  it('en el emulador de la base de siempre, si', () => {
    expect(HOST_EMULADOR_BASE_DE_SIEMPRE).toBe('127.0.0.1:8082');
    expect(motivoParaNoSembrarAhi(HOST_EMULADOR_BASE_DE_SIEMPRE)).toBeUndefined();
    expect(motivoParaNoSembrarAhi('localhost:8082')).toBeUndefined();
    // Un ensayo de restauracion en otro puerto local sigue valiendo.
    expect(motivoParaNoSembrarAhi('127.0.0.1:8099')).toBeUndefined();
  });

  it('en el de la base nueva, no, se le llame como se le llame', () => {
    expect(HOST_EMULADOR_BASE_NUEVA).toBe('127.0.0.1:8092');
    for (const host of ['127.0.0.1:8092', 'localhost:8092']) {
      expect(motivoParaNoSembrarAhi(host), host).toBe(
        'El puerto 8092 es el del emulador de la base nueva: la copia de la maestra de siempre no se siembra ahi. El de la base de siempre es el 8082.'
      );
    }
  });

  it('fuera del ordenador, tampoco, como antes', () => {
    for (const host of ['', 'firestore.googleapis.com:443', '10.0.0.5:8082', '127.0.0.1', 'localhost:8082/x']) {
      expect(motivoParaNoSembrarAhi(host), host).toBe('FIRESTORE_EMULATOR_HOST debe apuntar a localhost.');
    }
  });
});
