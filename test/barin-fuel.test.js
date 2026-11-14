'use strict';
// node --test test/   (on the Mac; the tool itself runs on the head unit's Node 8)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const T = path.join(__dirname, '..', 'tools', 'barin-fuel');
const consumption = require(path.join(T, 'consumption'));
const config = require(path.join(T, 'config'));
const text = require(path.join(T, 'text'));
const usb = require(path.join(T, 'usb'));
const fontprobe = require(path.join(T, 'fontprobe'));
const main = require(path.join(T, 'main'));
const glyphs = JSON.parse(fs.readFileSync(path.join(T, 'glyphs.json'), 'utf8'));

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'barin-fuel-')); }

test('decode: counters, no value, unit', () => {
    const p = { consumptionAverage1BC1: 114, consumptionAverage2BC2: 98, statusUnitOfMeasurementConsumptionBC: 'VERBRAUCH_IN_L_S_100KM' };
    assert.deepStrictEqual(consumption.decode(p, 1), { value: 11.4, text: '11.4', unit: 'l/100km', bc1: 11.4, bc2: 9.8, unitRaw: 'VERBRAUCH_IN_L_S_100KM' });
    assert.strictEqual(consumption.decode(p, 2).text, '9.8');
    assert.strictEqual(consumption.decode({ consumptionAverage1BC1: 65535 }, 1).text, '--.-');
    assert.strictEqual(consumption.decode(null, 1).value, null);
    assert.strictEqual(consumption.decode({ consumptionAverage1BC1: 300, statusUnitOfMeasurementConsumptionBC: 4 }, 1).unit, 'km/l');
});

test('config: bad keys ignored, box kept on the panel', () => {
    const m = config.merge(config.DEFAULTS, { x: 1900, w: 300, color: [2, 0, 0], counter: 3, foo: 1 });
    assert.strictEqual(m.config.x, 1900);
    assert.strictEqual(m.config.w, 20, 'clamped to the panel edge');
    assert.deepStrictEqual(m.config.color, config.DEFAULTS.color.slice());
    assert.strictEqual(m.config.counter, 1);
    assert.deepStrictEqual(m.ignored.sort(), ['color', 'counter', 'foo']);
    assert.ok(config.parse('{nope', 'f').warning.startsWith('f:'));
    assert.strictEqual(config.load('/nonexistent/x.json', fs.readFileSync).warning, null);
});

test('colour by value: blue below 9, white 9-10.5, yellow above; names accepted', () => {
    const c = config.DEFAULTS;
    const at = (v, u) => config.colorFor(c, v, u || 'l/100km');
    assert.deepStrictEqual(at(8.9), c.color_low);
    assert.deepStrictEqual(at(9.0), c.color_mid);
    assert.deepStrictEqual(at(10.5), c.color_mid);
    assert.deepStrictEqual(at(10.6), c.color_high);
    assert.deepStrictEqual(at(null), c.color, 'no value: the plain colour');
    assert.deepStrictEqual(at(25, 'km/l'), c.color, 'another unit: the plain colour');
    const m = config.merge(c, { color_high: 'Red', color: 'amber', low_below: 8, high_above: 7, color_low: 'pink' });
    assert.deepStrictEqual(m.config.color_high, config.NAMED.red);
    assert.deepStrictEqual(m.config.color, config.NAMED.amber);
    assert.strictEqual(m.config.high_above, 8, 'high never below low');
    assert.deepStrictEqual(m.ignored, ['color_low']);
    assert.deepStrictEqual(config.colorFor(Object.assign({}, c, { color_by_value: false }), 5, 'l/100km'), c.color);
});

test('boxes: own scale and align, 0 and empty inherit; center align', () => {
    const c = config.merge(config.DEFAULTS, { scale: 0.85, align: 'center', tank_scale: 0.71, oil_align: 'left' }).config;
    assert.deepStrictEqual([config.box(c, '').scale, config.box(c, '').align], [0.85, 'center']);
    assert.deepStrictEqual([config.box(c, 'tank_').scale, config.box(c, 'tank_').align], [0.71, 'center']);
    assert.deepStrictEqual([config.box(c, 'oil_').scale, config.box(c, 'oil_').align], [0.85, 'left']);
    const r = text.render(glyphs, { value: '51', unit: 'L' }, { w: 200, h: 60, baseline: 46, gap: 6, align: 'center', color: [1, 1, 1] });
    let minX = 200, maxX = 0;
    for (let i = 0; i < 200 * 60; i++) if (r.rgba[i * 4 + 3]) { minX = Math.min(minX, i % 200); maxX = Math.max(maxX, i % 200); }
    assert.ok(Math.abs((minX + maxX) / 2 - 100) < 6, 'centred: ' + minX + '-' + maxX);
});

test('unit: own label and a smaller size', () => {
    const opts = { w: 300, h: 60, baseline: 46, gap: 6, align: 'left', color: [1, 1, 1] };
    const full = text.render(glyphs, { value: '8.5', unit: 'l/km' }, opts);
    const small = text.render(glyphs, { value: '8.5', unit: 'l/km' }, Object.assign({}, opts, { unitScale: 0.8 }));
    const num = text.render(glyphs, { value: '8.5', unit: '' }, opts);
    const unitW = (r) => r.width - num.width - 6;
    assert.ok(Math.abs(unitW(small) / unitW(full) - 0.8) < 0.05, 'unit 20% narrower');
    const top = (r) => { for (let i = 0; i < 300 * 60; i++) if (r.rgba[i * 4 + 3] && i % 300 > num.width + 4) return Math.floor(i / 300); return -1; };
    assert.ok(top(small) > top(full), 'and lower-topped (smaller) on the same baseline');
    const c = config.merge(config.DEFAULTS, { unit_label: 'l/km', unit_scale: 0.8 });
    assert.deepStrictEqual([c.config.unit_label, c.config.unit_scale, c.ignored], ['l/km', 0.8, []]);
    assert.deepStrictEqual(config.merge(config.DEFAULTS, { unit_label: 'л/км' }).ignored, ['unit_label'], 'letters the font lacks');
});

test('litres colour by the range left: yellow at 70 km, red at 50', () => {
    const c = config.DEFAULTS;
    assert.deepStrictEqual(config.tankColorFor(c, 71), c.tank_color);
    assert.deepStrictEqual(config.tankColorFor(c, 70), c.tank_color_yellow);
    assert.deepStrictEqual(config.tankColorFor(c, 51), c.tank_color_yellow);
    assert.deepStrictEqual(config.tankColorFor(c, 50), c.tank_color_red);
    assert.deepStrictEqual(config.tankColorFor(c, 0), c.tank_color_red);
    assert.deepStrictEqual(config.tankColorFor(c, null), c.tank_color, 'no range: plain');
    const tankMod = require(path.join(T, 'tank'));
    assert.deepStrictEqual([tankMod.rangeKm(452), tankMod.rangeKm(4095), tankMod.rangeKm(undefined)], [452, null, null]);
    const m = config.merge(c, { tank_yellow_km: 40, tank_red_km: 60 }).config;
    assert.strictEqual(m.tank_red_km, 40, 'red never above yellow');
});

test('run: the litres turn red with little range left', async () => {
    const cfg = config.merge(config.DEFAULTS, { tank_enabled: true }).config;
    const painted = [];
    const realRender = text.render;
    text.render = (g, parts, opts) => { painted.push([parts.value, opts.color]); return realRender(g, parts, opts); };
    try {
        const { h } = harness({ cfg });
        await h.watching;
        h.onTank({ fluidLevelFuelTank: 6, range: 45 });
        const last = painted.filter((p) => p[0] === '6').pop();
        assert.deepStrictEqual(last[1], cfg.tank_color_red);
        assert.ok(h.report().includes('range 45 km'));
    } finally {
        text.render = realRender;
    }
});

test('text: figure and unit drawn inside the box, tabular digits', () => {
    const opts = { w: 300, h: 60, baseline: 46, gap: 6, align: 'left', color: [1, 1, 1] };
    const a = text.render(glyphs, { value: '11.4', unit: 'l/100km' }, opts);
    assert.strictEqual(a.rgba.length, 300 * 60 * 4);
    let lit = 0, maxX = 0;
    for (let i = 0; i < 300 * 60; i++) if (a.rgba[i * 4 + 3]) { lit++; maxX = Math.max(maxX, i % 300); }
    assert.ok(lit > 500, 'something is drawn');
    assert.ok(maxX < 300 - 1, 'fits the box');
    const t1 = text.render(glyphs, { value: '11.4', unit: '' }, Object.assign({}, opts, { tabular: true }));
    const t2 = text.render(glyphs, { value: '17.8', unit: '' }, Object.assign({}, opts, { tabular: true }));
    assert.strictEqual(t1.width, t2.width, 'tabular: the same width whatever the digits');
    assert.ok(text.render(glyphs, { value: '11.4', unit: '' }, opts).width < t1.width, 'proportional by default');
    const r = text.render(glyphs, { value: '11.4', unit: '' }, Object.assign({}, opts, { align: 'right' }));
    let minX = 300;
    for (let i = 0; i < 300 * 60; i++) if (r.rgba[i * 4 + 3]) minX = Math.min(minX, i % 300);
    assert.ok(minX > 150, 'right-aligned');
});

test('usb: only sticks with a barin-fuel folder', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'STICK', 'barin-fuel'), { recursive: true });
    fs.mkdirSync(path.join(root, 'user', 'MUSIC'), { recursive: true });
    fs.mkdirSync(path.join(root, 'user', 'CAR', 'barin-fuel'), { recursive: true });
    const found = usb.folders(fs, [root]).sort();
    assert.deepStrictEqual(found, [path.join(root, 'STICK', 'barin-fuel'), path.join(root, 'user', 'CAR', 'barin-fuel')].sort());
    assert.strictEqual(usb.readConfig(fs, found), null);
    fs.writeFileSync(path.join(found[0], 'config.json'), '{"x":1000}');
    assert.strictEqual(usb.readConfig(fs, found).text, '{"x":1000}');
    assert.strictEqual(usb.write(fs, found, 'report.txt', 'hi'), 2);
});

test('usb: nothing on a stick is followed out of it', () => {
    const root = tmp();
    const outside = tmp();
    // a folder that is a symlink to elsewhere: not ours
    fs.mkdirSync(path.join(root, 'EVIL'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'EVIL', 'barin-fuel'));
    // a mount that is itself a symlink: not looked into
    fs.mkdirSync(path.join(outside, 'barin-fuel'));
    fs.symlinkSync(outside, path.join(root, 'LINK'));
    assert.deepStrictEqual(usb.folders(fs, [root]), []);

    fs.mkdirSync(path.join(root, 'OK', 'barin-fuel'), { recursive: true });
    const found = usb.folders(fs, [root]);
    assert.deepStrictEqual(found, [path.join(root, 'OK', 'barin-fuel')]);
    // report.txt a symlink to a file outside: not written through
    const target = path.join(outside, 'victim.txt');
    fs.writeFileSync(target, 'keep');
    fs.symlinkSync(target, path.join(found[0], 'report.txt'));
    assert.strictEqual(usb.write(fs, found, 'report.txt', 'overwritten'), 0);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'keep');
    // config.json a symlink, a directory, or too big: not read
    fs.symlinkSync(target, path.join(found[0], 'config.json'));
    assert.strictEqual(usb.readConfig(fs, found), null);
    fs.unlinkSync(path.join(found[0], 'config.json'));
    fs.mkdirSync(path.join(found[0], 'config.json'));
    assert.strictEqual(usb.readConfig(fs, found), null);
    fs.rmdirSync(path.join(found[0], 'config.json'));
    fs.writeFileSync(path.join(found[0], 'config.json'), ' '.repeat(usb.MAX_CONFIG + 1));
    assert.strictEqual(usb.readConfig(fs, found), null);
});

test('fontprobe: font files and BMW names, symlinks and skipped dirs left out', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'usr', 'share', 'fonts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'proc'), { recursive: true });
    fs.writeFileSync(path.join(root, 'usr', 'share', 'fonts', 'BMWTypeNext-Regular.otf'), 'x');
    fs.writeFileSync(path.join(root, 'usr', 'share', 'fonts', 'Arial.ttf'), 'xx');
    fs.writeFileSync(path.join(root, 'usr', 'share', 'readme.txt'), 'x');
    fs.writeFileSync(path.join(root, 'proc', 'hidden.ttf'), 'x');
    fs.symlinkSync(path.join(root, 'usr'), path.join(root, 'loop'));
    const res = await fontprobe.scan({ fs, root, skip: [path.join(root, 'proc')], batch: 2 });
    assert.deepStrictEqual(res.files.map((f) => path.basename(f.path)).sort(), ['Arial.ttf', 'BMWTypeNext-Regular.otf']);
    const out = fontprobe.format(res, null);
    assert.ok(/== likely BMW \(1\)\n1\t.*BMWTypeNext/.test(out));
});

function fakeClient() {
    const c = new EventEmitter();
    c.layers = [];
    c.visible = {};
    c.pics = {};
    c.image = (o) => { c.layers.push(o); const ref = c.layers.length; c.visible[ref] = o.visible; return ref; };
    c.set = (ref, o) => { if ('visible' in o) c.visible[ref] = o.visible; };
    c.pixels = (ref, rects, px) => { c.pics[ref] = px.length; return true; };
    c.drop = (ref) => { delete c.visible[ref]; };
    c.status = () => {};
    c.connect = () => {};
    return c;
}

/* refs 1, 2, 3: consumption, oil, tank (made in that order) */
function harness(extra) {
    const client = fakeClient();
    const logs = [];
    const clock = { t: 0 };
    const avail = {};
    const deps = Object.assign({
        cfg: config.DEFAULTS, glyphs, client, fs, log: (l) => logs.push(l), tail: () => logs.slice(-5),
        now: () => clock.t, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => {}, execFile: () => {},
        someip: { watch: (iface, inst, handlers, onAvailability) => {
            avail[iface] = onAvailability;
            return Promise.resolve({ available: true, error: null, refresh: () => {} });
        } },
    }, extra || {});
    return { h: main.run(deps), client, logs, clock, avail };
}

test('run: shows the average once the cluster sends one, hides without', async () => {
    const { h, client, avail } = harness();
    await h.watching;
    assert.ok(!client.visible[1], 'no value yet: nothing shown');
    h.onAverage({ consumptionAverage1BC1: 114, consumptionAverage2BC2: 98, statusUnitOfMeasurementConsumptionBC: 1 });
    assert.strictEqual(client.visible[1], 1);
    assert.strictEqual(client.pics[1], 300 * 60 * 4);
    assert.ok(h.report().includes('BC1 11.4 BC2 9.8'));
    assert.ok(!client.visible[2] && !client.visible[3], 'oil and tank are off by default');
    avail['de.bmw.infotainment.KombiIF'](false);
    assert.ok(!client.visible[1]);
});

test('oil: cold shows, warm flashes green then goes, cold again after cooling', () => {
    const cfg = { oil_warm_c: 80, oil_rearm_c: 70, oil_flash_s: 4 };
    const o = require(path.join(T, 'oil')).createOil(cfg, 5000);
    o.feed(48 + 42, 0);
    assert.deepStrictEqual([o.state(0).visible, o.state(0).warm, o.state(0).oil], [true, false, 42]);
    o.feed(255, 1000);
    assert.strictEqual(o.state(1000).oil, 42, '255 changes nothing');
    o.feed(48 + 80, 2000);
    assert.deepStrictEqual([o.state(2000).visible, o.state(2000).warm], [true, true]);
    assert.strictEqual(o.state(2000).next, 4000);
    o.feed(48 + 81, 5000);
    assert.strictEqual(o.state(6100).visible, false, 'gone after the flash');
    o.feed(48 + 75, 7000);
    assert.strictEqual(o.state(7000).visible, false, 'stays off above the re-arm point');
    o.feed(48 + 60, 8000);
    assert.strictEqual(o.state(8000).visible, true, 'cold again');
    assert.strictEqual(o.state(14000).visible, false, 'stale');
    const w = require(path.join(T, 'oil')).createOil(cfg);
    w.feed(48 + 90, 0);
    assert.strictEqual(w.state(0).visible, false, 'already warm at start: no flash');
});

test('tank: steadied, 255 ignored, kept while the car sends nothing', () => {
    const k = require(path.join(T, 'tank')).createTank(10000);
    k.feed(38, 0);
    assert.strictEqual(k.value(0), 38);
    k.feed(41, 1000);                 // a slosh: mean 39.5
    assert.strictEqual(k.value(1000), 40);
    k.feed(38, 2000);                 // mean 39 -> within 0.6 of 40? no: 1.0 away
    assert.strictEqual(k.value(2000), 39);
    k.feed(39, 3000);                 // mean 39 -> unchanged
    assert.strictEqual(k.value(3000), 39);
    k.feed(255, 4000);
    assert.strictEqual(k.value(4000), 39);
    assert.strictEqual(k.value(600000), 39, 'parked: nothing new for minutes, still shown');
    assert.strictEqual(require(path.join(T, 'tank')).createTank().value(0), null, 'nothing yet');
});

test('run: oil and tank readouts when switched on', async () => {
    const cfg = config.merge(config.DEFAULTS, { oil_enabled: true, tank_enabled: true }).config;
    const { h, client, clock } = harness({ cfg });
    await h.watching;
    h.onTemperature({ temperatureEngineOilDrive: 48 + 40 });
    assert.strictEqual(client.visible[2], 1, 'cold oil shown');
    h.onTank({ fluidLevelFuelTank: 38 });
    assert.strictEqual(client.visible[3], 1, 'litres shown');
    clock.t = 1000;
    h.onTemperature({ temperatureEngineOilDrive: 48 + 85 });
    assert.strictEqual(client.visible[2], 1, 'the warm flash');
    clock.t = 6000;
    h.onTemperature({ temperatureEngineOilDrive: 48 + 86 });
    assert.ok(!client.visible[2], 'gone once warm');
    assert.ok(h.report().includes('tank: 38 l'));
});

test('run: settings from a USB stick are applied and kept, the report written', async () => {
    const root = tmp();
    const dir = tmp();
    const stick = path.join(root, 'CAR', 'barin-fuel');
    fs.mkdirSync(stick, { recursive: true });
    fs.writeFileSync(path.join(stick, 'config.json'), JSON.stringify({ x: 1100, test_pattern: true, w: 320, oil_enabled: true }));
    const prev = main.PATHS.config;
    main.PATHS.config = path.join(dir, 'config.json');
    try {
        const { h, client } = harness({ usbRoots: [root] });
        await h.watching;
        h.usbRound();
        assert.strictEqual(h.state.cfg.x, 1100);
        assert.strictEqual(client.layers.length, 4, 'a new box size makes a new layer');
        assert.strictEqual(client.layers[3].w, 320);
        assert.strictEqual(JSON.parse(fs.readFileSync(main.PATHS.config, 'utf8')).x, 1100);
        assert.ok(fs.readFileSync(path.join(stick, 'report.txt'), 'utf8').startsWith('barin-fuel ' + main.VERSION));
        assert.strictEqual(client.visible[4], 1, 'the test pattern shows without a value');
        assert.strictEqual(client.visible[2], 1, 'and the oil box, switched on');
        assert.ok(!client.visible[3], 'not the tank, still off');
    } finally {
        main.PATHS.config = prev;
    }
});

test('package: component.json lists every file, versions agree, Node 8 syntax', () => {
    const comp = JSON.parse(fs.readFileSync(path.join(T, 'component.json'), 'utf8'));
    assert.strictEqual(comp.version, main.VERSION);
    comp.files.forEach((f) => assert.ok(fs.existsSync(path.join(T, f.from)), f.from));
    comp.units.forEach((u) => assert.ok(fs.existsSync(path.join(T, u.from)), u.from));
    const js = fs.readdirSync(T).filter((n) => n.endsWith('.js'));
    js.forEach((n) => {
        assert.ok(comp.files.some((f) => f.from === n), n + ' is installed');
        const src = fs.readFileSync(path.join(T, n), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert.ok(!/\?\.|\?\?|\.flat\(|\.flatMap\(|Object\.fromEntries|\.matchAll\(|\breplaceAll\(/.test(src), n + ': newer than Node 8');
    });
});
