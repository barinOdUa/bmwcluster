'use strict';
/*
 * tank.js - the fuel left, in litres, steadied: KombiIF.statusRangeTankStatus.fluidLevelFuelTank (litres, 255 and
 * up = no value; as idrive7-apps' Live Data reads it). The level sloshes in corners, so the shown figure is the mean
 * of the last window_ms and moves only when that mean is at least 0.6 l away from it. Pure: the caller passes the time.
 */

function litres(raw) {
    return Number.isInteger(raw) && raw >= 0 && raw < 255 ? raw : null;
}

/* the range left in km (statusRangeTankStatus.range, 4095 and up = no value), or null */
function rangeKm(raw) {
    return Number.isInteger(raw) && raw >= 0 && raw < 4095 ? raw : null;
}

function createTank(windowMs) {
    const win = windowMs || 10000;
    const samples = [];
    let shown = null;

    return {
        /* a new raw value at time t; returns true when the shown figure changed */
        feed(raw, t) {
            const l = litres(raw);
            if (l === null) return false;
            samples.push({ t, l });
            while (samples.length && t - samples[0].t > win) samples.shift();
            const mean = samples.reduce((s, x) => s + x.l, 0) / samples.length;
            if (shown === null || Math.abs(mean - shown) >= 0.6) {
                const next = Math.round(mean);
                const changed = next !== shown;
                shown = next;
                return changed;
            }
            return false;
        },
        /* the figure to show, or null before the first value. Kept however long ago it came: the cluster sends the
         * level only when it changes, so a parked car sends nothing for minutes (0.3.0 hid it after 30 s and it
         * blinked with each minute's re-read). Whether the cluster is there at all is the caller's to say. */
        value() {
            return samples.length ? shown : null;
        },
    };
}

module.exports = { createTank, litres, rangeKm };
