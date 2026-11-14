'use strict';
/*
 * consumption.js - the cluster's own trip computer average, from KombiIF.statusBordcomputerAverage:
 *   consumptionAverage1BC1, consumptionAverage2BC2: 0.1 a step, 65535 = no value
 *   statusUnitOfMeasurementConsumptionBC: the unit the driver picked, an enum name or its number
 * (field names and scaling as idrive7-apps' Live Data reads them, apps/live_data/signals.js, MIT).
 * Which of the two counters is "since start" on a G15 is checked on the car: both are logged.
 */

const NO_VALUE = 65535;
const UNITS = {
    VERBRAUCH_IN_L_S_100KM: 'l/100km', VERBRAUCH_IN_MPG_UK: 'mpg', VERBRAUCH_IN_MPG_US: 'mpg US',
    VERBRAUCH_IN_KM_S_L: 'km/l', 1: 'l/100km', 2: 'mpg', 3: 'mpg US', 4: 'km/l',
};

function field(p, name) {
    return p !== null && typeof p === 'object' ? p[name] : undefined;
}

/* a raw counter as a number, or null */
function scaled(raw) {
    return Number.isInteger(raw) && raw !== NO_VALUE && raw >= 0 && raw < NO_VALUE ? raw / 10 : null;
}

/* p: the struct as the car sends it; counter 1 or 2.
 * { value, text, unit, bc1, bc2, unitRaw }: text is "11.4", or "--.-" without a value */
function decode(p, counter) {
    const bc1 = scaled(field(p, 'consumptionAverage1BC1'));
    const bc2 = scaled(field(p, 'consumptionAverage2BC2'));
    const unitRaw = field(p, 'statusUnitOfMeasurementConsumptionBC');
    const value = counter === 2 ? bc2 : bc1;
    return {
        value,
        text: value === null ? '--.-' : value.toFixed(1),
        unit: UNITS[unitRaw] || 'l/100km',
        bc1, bc2,
        unitRaw: unitRaw === undefined ? null : unitRaw,
    };
}

module.exports = { decode, scaled, UNITS };
