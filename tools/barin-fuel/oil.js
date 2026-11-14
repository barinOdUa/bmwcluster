'use strict';
/*
 * oil.js - the oil warm-up readout: an oil can and the oil temperature while the oil is cold, a few seconds in the
 * warm colour once it reaches warm_c, then nothing until it is cold again (below rearm_c: the next cold start).
 * Oil from CDS.statusEngineTemperature.temperatureEngineOilDrive: degrees C = raw - 48, 255 = no value (as
 * idrive7-apps' Live Data and asloocod's vr-warmup read it; vr-warmup saw it every second on an X6 G06).
 * Pure: the caller passes the time; no valid value for stale_ms hides it.
 */

/* raw -> degrees C or null */
function temp(raw) {
    return Number.isInteger(raw) && raw >= 0 && raw <= 254 ? raw - 48 : null;
}

/* settings: { oil_warm_c, oil_rearm_c, oil_flash_s }, or a function returning the current ones; staleMs optional */
function createOil(settings, staleMs) {
    const stale = staleMs || 5000;
    let phase = null;           // null (not known yet), 'cold', 'flash', 'warm'
    let oil = null, at = null, flashUntil = null;

    return {
        /* a new raw value at time t; returns true when what is shown may have changed */
        feed(raw, t) {
            const cfg = typeof settings === 'function' ? settings() : settings;
            const c = temp(raw);
            if (c === null) return false;
            oil = c;
            at = t;
            if (phase === null) phase = c >= cfg.oil_warm_c ? 'warm' : 'cold';
            else if (phase === 'cold' && c >= cfg.oil_warm_c) {
                phase = 'flash';
                flashUntil = t + cfg.oil_flash_s * 1000;
            } else if ((phase === 'warm' || phase === 'flash') && c < cfg.oil_rearm_c) {
                phase = 'cold';
            }
            return true;
        },
        /* at time t: { visible, warm (the flash), oil, phase, next (ms until it changes by itself, or null) } */
        state(t) {
            if (phase === 'flash' && t >= flashUntil) phase = 'warm';
            const fresh = at !== null && t - at < stale;
            const visible = fresh && (phase === 'cold' || phase === 'flash');
            let next = null;
            if (phase === 'flash') next = flashUntil - t;
            if (visible) next = next === null ? stale - (t - at) : Math.min(next, stale - (t - at));
            return { visible, warm: phase === 'flash', oil, phase, next };
        },
    };
}

module.exports = { createOil, temp };
