'use strict';
/*
 * config.js - barin-fuel's settings: the defaults, then /var/opt/barin-fuel/config.json over them (kept over updates).
 * The same file on a USB stick (<stick>/barin-fuel/config.json) replaces it, so the readout can be placed without SSH.
 * A key of the wrong kind or out of range is ignored: the value before it stays.
 *
 * Coordinates are on cluster-render's `panel` target: the whole 1920x720 cluster, top-left 0,0.
 */

const PANEL_W = 1920;
const PANEL_H = 720;

const DEFAULTS = Object.freeze({
    // the box's top-left. x: under the black tick on the white line left of the outside temperature, y: the bottom
    // strip (stock text there sits at about y 665-710). Both estimated from a photo: placed on the car.
    x: 1230,
    y: 652,
    w: 300,                     // the box; the readout is drawn inside it
    h: 60,
    baseline: 46,               // the text's baseline, px from the box's top
    gap: 6,                     // between the figure and its unit, px
    align: 'left',              // 'left' (starts at x), 'right' (ends at x + w) or 'center' (in the box)
    scale: 1,                   // 0.3-2: the readout bigger or smaller (oil_scale, tank_scale: 0 = the same as this)
    counter: 1,                 // 1: consumptionAverage1BC1, 2: consumptionAverage2BC2
    show_unit: true,
    unit_label: '',             // the consumption's unit as shown; '': the car's own (l/100km, mpg, km/l)
    unit_scale: 1,              // 0.5-1.5: the consumption's unit against its normal size
    // colours: [r, g, b] each 0-1, or a name of NAMED. By value (l/100km only): below low_below the low colour, above
    // high_above the high one, between them (both ends included) the mid one. Otherwise, and in other units, `color`.
    color_by_value: true,
    low_below: 9,
    high_above: 10.5,
    color_low: Object.freeze([0.47, 0.72, 1.0]),    // blue
    color_mid: Object.freeze([0.95, 0.96, 0.98]),   // white, as the stock strip
    color_high: Object.freeze([1.0, 0.82, 0.25]),   // yellow
    color: Object.freeze([0.95, 0.96, 0.98]),

    // oil warm-up (off until switched on): an oil can and the oil temperature while cold, oil_flash_s in the warm
    // colour on reaching oil_warm_c, then nothing until it is below oil_rearm_c again. Placed under the speed, left.
    oil_enabled: false,
    oil_x: 560, oil_y: 460, oil_w: 220, oil_h: 60, oil_baseline: 46,
    oil_scale: 0,               // 0: as `scale`
    oil_align: '',              // '': as `align`
    oil_warm_c: 80,
    oil_rearm_c: 70,
    oil_flash_s: 4,
    oil_color_cold: Object.freeze([0.47, 0.72, 1.0]),   // blue
    oil_color_warm: Object.freeze([0.36, 0.86, 0.45]),  // green

    // fuel left in litres (off until switched on), steadied over 10 s. Placed under the COMFORT / gear line, right.
    tank_enabled: false,
    tank_x: 1260, tank_y: 460, tank_w: 200, tank_h: 60, tank_baseline: 46,
    tank_scale: 0,              // 0: as `scale`
    tank_align: '',             // '': as `align`
    tank_color: Object.freeze([0.95, 0.96, 0.98]),
    // by the range left (KombiIF.statusRangeTankStatus.range, km): at or below these the litres turn yellow / red
    tank_yellow_km: 70,
    tank_red_km: 50,
    tank_color_yellow: Object.freeze([1.0, 0.82, 0.25]),
    tank_color_red: Object.freeze([1.0, 0.36, 0.3]),

    test_pattern: false,        // every box switched on shows its edge and a sample value all the time, to place it
    hidden: false,              // true: draw nothing (the readouts off without uninstalling)
});

/* the boxes: the key prefix of each readout */
const BOXES = ['', 'oil_', 'tank_'];

const NAMED = Object.freeze({
    white: [0.95, 0.96, 0.98], blue: [0.47, 0.72, 1.0], yellow: [1.0, 0.82, 0.25], amber: [1.0, 0.69, 0.29],
    teal: [0.37, 0.94, 0.82], green: [0.36, 0.86, 0.45], red: [1.0, 0.36, 0.3], orange: [1.0, 0.55, 0.2],
});
const COLOR_KEYS = ['color', 'color_low', 'color_mid', 'color_high', 'oil_color_cold', 'oil_color_warm', 'tank_color',
    'tank_color_yellow', 'tank_color_red'];

const isInt = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (lo, hi) => (v) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const isBool = (v) => typeof v === 'boolean';
const isColor = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(NAMED, v.toLowerCase())) ||
    (Array.isArray(v) && v.length === 3 && v.every(isNum(0, 1)));
const toColor = (v) => (typeof v === 'string' ? NAMED[v.toLowerCase()] : v).slice();
const RULES = {
    gap: isInt(0, 60),
    align: (v) => v === 'left' || v === 'right' || v === 'center',
    scale: isNum(0.3, 2),
    oil_scale: (v) => v === 0 || isNum(0.3, 2)(v),
    tank_scale: (v) => v === 0 || isNum(0.3, 2)(v),
    oil_align: (v) => v === '' || v === 'left' || v === 'right' || v === 'center',
    tank_align: (v) => v === '' || v === 'left' || v === 'right' || v === 'center',
    counter: (v) => v === 1 || v === 2,
    show_unit: isBool,
    // characters the unit font has (dev/bake_font.py CHARS['unit']), at most 12
    unit_label: (v) => typeof v === 'string' && v.length <= 12 && /^[0-9./\-klmpgLUS ]*$/.test(v),
    unit_scale: isNum(0.5, 1.5),
    color_by_value: isBool,
    low_below: isNum(0, 100),
    high_above: isNum(0, 100),
    color_low: isColor,
    color_mid: isColor,
    color_high: isColor,
    color: isColor,
    oil_enabled: isBool,
    oil_warm_c: isInt(30, 130),
    oil_rearm_c: isInt(20, 125),
    oil_flash_s: isNum(0, 30),
    oil_color_cold: isColor,
    oil_color_warm: isColor,
    tank_enabled: isBool,
    tank_color: isColor,
    tank_yellow_km: isInt(0, 500),
    tank_red_km: isInt(0, 500),
    tank_color_yellow: isColor,
    tank_color_red: isColor,
    test_pattern: isBool,
    hidden: isBool,
};
BOXES.forEach((p) => {
    RULES[p + 'x'] = isInt(0, PANEL_W - 8);
    RULES[p + 'y'] = isInt(0, PANEL_H - 8);
    RULES[p + 'w'] = isInt(40, 800);
    RULES[p + 'h'] = isInt(16, 200);
    RULES[p + 'baseline'] = isInt(4, 200);
});

/* base with patch's valid keys over it; { config, ignored: [keys] } */
function merge(base, patch) {
    const out = {};
    const ignored = [];
    const p = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    Object.keys(DEFAULTS).forEach((k) => {
        const v = p[k];
        if (v !== undefined && !RULES[k](v)) ignored.push(k);
        const use = v !== undefined && RULES[k](v) ? v : base[k];
        out[k] = COLOR_KEYS.indexOf(k) >= 0 ? toColor(use) : use;
    });
    Object.keys(p).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) ignored.push(k); });
    if (out.high_above < out.low_below) out.high_above = out.low_below;
    if (out.oil_rearm_c >= out.oil_warm_c) out.oil_rearm_c = out.oil_warm_c - 10;
    if (out.tank_red_km > out.tank_yellow_km) out.tank_red_km = out.tank_yellow_km;
    BOXES.forEach((p) => {
        out[p + 'w'] = Math.min(out[p + 'w'], PANEL_W - out[p + 'x']);
        out[p + 'h'] = Math.min(out[p + 'h'], PANEL_H - out[p + 'y']);
        out[p + 'baseline'] = Math.min(out[p + 'baseline'], out[p + 'h']);
    });
    return { config: out, ignored };
}

/* a readout's box: { x, y, w, h, baseline, scale, align } for prefix '' (consumption), 'oil_' or 'tank_' */
function box(cfg, prefix) {
    const own = (k) => (prefix ? cfg[prefix + k] : undefined);
    return { x: cfg[prefix + 'x'], y: cfg[prefix + 'y'], w: cfg[prefix + 'w'], h: cfg[prefix + 'h'],
        baseline: cfg[prefix + 'baseline'], scale: own('scale') || cfg.scale, align: own('align') || cfg.align };
}

/* parse text over the defaults; { config, warning } (warning: null or a line for the log) */
function parse(text, where) {
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        return { config: merge(DEFAULTS, {}).config, warning: where + ': ' + e.message };
    }
    const m = merge(DEFAULTS, json);
    return { config: m.config, warning: m.ignored.length ? where + ': ignored ' + m.ignored.join(', ') : null };
}

/* the settings from file; a missing file is no warning */
function load(file, readFileSync) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        if (e && e.code === 'ENOENT') return { config: merge(DEFAULTS, {}).config, warning: null };
        return { config: merge(DEFAULTS, {}).config, warning: file + ': ' + (e && e.code ? e.code : e) };
    }
    return parse(text, file);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* the readout's colour for value (a number or null) in unit */
function colorFor(cfg, value, unit) {
    if (!cfg.color_by_value || value === null || unit !== 'l/100km') return cfg.color;
    if (value < cfg.low_below) return cfg.color_low;
    if (value > cfg.high_above) return cfg.color_high;
    return cfg.color_mid;
}

/* the litres' colour for the range left (km or null): red at or below tank_red_km, yellow at or below tank_yellow_km */
function tankColorFor(cfg, rangeKm) {
    if (rangeKm === null || rangeKm === undefined) return cfg.tank_color;
    if (rangeKm <= cfg.tank_red_km) return cfg.tank_color_red;
    if (rangeKm <= cfg.tank_yellow_km) return cfg.tank_color_yellow;
    return cfg.tank_color;
}

module.exports = { DEFAULTS, NAMED, merge, parse, load, same, colorFor, tankColorFor, box, PANEL_W, PANEL_H };
