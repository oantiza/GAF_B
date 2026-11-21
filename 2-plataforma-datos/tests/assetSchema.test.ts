import { describe, it, expect } from 'vitest';
import { Asset, AssetType } from '../src/types/assets';

describe('Asset Schema', () => {
    it('debería poder tipar un Fondo válido con ISIN', () => {
        const fondo: Asset = {
            asset_id: '123',
            asset_type: 'FUND',
            identity: {
                name: 'Fondo Prueba'
            },
            identifiers: {
                isin: 'ES0123456789'
            },
            listings: [],
            retrocession: 1.38
        };
        expect(fondo.asset_type).toBe('FUND');
        expect(fondo.retrocession).toBe(1.38);
    });

    it('debería poder tipar un ETF válido con ISIN y ticker', () => {
        const etf: Asset = {
            asset_id: '456',
            asset_type: 'ETF',
            identity: {
                name: 'ETF Prueba'
            },
            identifiers: {
                isin: 'IE0123456789',
                ticker: 'SPY'
            },
            listings: []
        };
        expect(etf.asset_type).toBe('ETF');
    });

    it('debería poder tipar una Acción válida con ISIN y ticker', () => {
        const accion: Asset = {
            asset_id: '789',
            asset_type: 'STOCK',
            identity: {
                name: 'Accion Prueba'
            },
            identifiers: {
                isin: 'US0123456789',
                ticker: 'AAPL'
            },
            listings: []
        };
        expect(accion.asset_type).toBe('STOCK');
    });
});
