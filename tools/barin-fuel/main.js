'use strict';
/*
 * main.js - barin-fuel: readouts on the instrument cluster of a BMW with an MGU (iDrive 7), drawn by cluster-render
 * on its `panel` target over the stock cluster. A root service (barin-fuel.service), Node 8. Reads the car only.
 *
 *   consumption  KombiIF.statusBordcomputerAverage  -> consumption.js  in the bottom strip, left of the temperature
 *   oil warm-up  CDS.statusEngineTemperature        -> oil.js          off unless oil_enabled
 *   fuel left    KombiIF.statusRangeTankStatus      -> tank.js         off unless tank_enabled
 *   each -> text.js (pixels) -> cluster.js (its own layer)
 *
 * No SSH needed to run or place it: a USB stick with a `barin-fuel` folder gives it settings (config.json) and takes
 * its report (report.txt: the values seen, cluster-render's status, the log) and the fonts found (fonts.txt).
 * Settings: /var/opt/barin-fuel/config.json (config.js). Log: journalctl -u barin-fuel, and
 * /var/opt/barin-fuel/log/events.log. BARIN_FUEL_DIR, BARIN_FUEL_SOMEIP, CLUSTER_RENDER_CLIENT, SOMEIP_NODE,
 * OAP_APPMGMT move the paths, for a run by hand.
 */
const config = require('./config');
const consumption = require('./consumption');
const text = require('./text');
const usb = require('./usb');
const fontprobe = require('./fontprobe');
const { createOil } = require('./oil');
const { createTank, rangeKm } = require('./tank');
const { createCluster } = require('./cluster');
const { createSomeip } = require('./someip');
const oapgen = require('./oapgen');
const { createEventLog } = require('./eventlog');

const VERSION = '0.3.6';
const KOMBI = 'de.bmw.infotainment.KombiIF';
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const RETRY_MS = 30000;
const BOOT_RETRY_MS = 60000;
const USB_MS = 10000;
const STATUS_MS = 60000;
const PROBE_AFTER_MS = 120000;
const REFRESH_MS = 60000;
const env = process.env;
const DIR = env.BARIN_FUEL_DIR || '/var/opt/barin-fuel';
const PATHS = {
    config: DIR + '/config.json',
    events: DIR + '/log/events.log',
    fonts: DIR + '/fonts.txt',
    catalog: '/etc/oap/someip/someip-interfaces.json',
    someipDir: env.BARIN_FUEL_SOMEIP || '/run/barin-fuel/someip',
    client: env.CLUSTER_RENDER_CLIENT || '/var/opt/cluster-render/current/cluster_render_client.js',
    binding: env.SOMEIP_NODE || '/usr/lib/someip.node',
};

function member(p, name) {
    return p !== null && typeof p === 'object' ? p[name] : undefined;
}

/*
 * deps: { cfg, glyphs, client, someip, fs, log, tail(n), now(), setTimeout, clearTimeout, setInterval, execFile,
 * usbRoots (optional) }. Returns the handlers, for the tests.
 */
function run(deps) {
    const log = deps.log, fs = deps.fs, now = deps.now;
    const st = {
        cfg: deps.cfg, data: consumption.decode(null, deps.cfg.counter), raw: null,
        kombi: false, cds: false, oilRaw: null, tankRaw: null, rangeKm: null,
        history: [], status: null, statusAt: null, fonts: null, said: {}, lastReport: null, lastWarning: null,
    };
    const oil = createOil(() => st.cfg);
    const tank = createTank(10000);
    let timer = null;
    const cluster = createCluster(deps.client, log, (t) => {
        if (t !== st.status) log('cluster-render status:\n' + t.trim());
        st.status = t;
        st.statusAt = new Date(now()).toISOString();
    });
    const layers = { fuel: cluster.layer('fuel'), oil: cluster.layer('oil'), tank: cluster.layer('tank') };

    function note(key, line) {
        if (st.said[key] === line) return;
        st.said[key] = line;
        log(line);
        st.history.push(new Date(now()).toISOString() + ' ' + line);
        if (st.history.length > 300) st.history.shift();
    }

    function paint(layer, prefix, parts, color, visible, unitScale) {
        const cfg = st.cfg, b = config.box(cfg, prefix);
        const pic = text.render(deps.glyphs, parts, {
            w: b.w, h: b.h, baseline: b.baseline, gap: cfg.gap, align: b.align, color, frame: cfg.test_pattern,
            unitScale: unitScale || 1,
        });
        layer.picture(pic.rgba);
        layer.show(!cfg.hidden && visible);
    }

    function draw() {
        const cfg = st.cfg, d = st.data, t = now();
        // consumption
        const value = cfg.test_pattern && d.value === null ? '88.8' : d.text;
        paint(layers.fuel, '', { value, unit: cfg.show_unit ? (cfg.unit_label || d.unit) : '' },
            config.colorFor(cfg, d.value, d.unit), cfg.test_pattern || (st.kombi && d.value !== null), cfg.unit_scale);
        // oil warm-up
        const o = oil.state(t);
        if (cfg.oil_enabled) {
            const shown = o.oil === null ? (cfg.test_pattern ? '42' : '--') : String(o.oil);
            paint(layers.oil, 'oil_', { icon: 'oil', value: shown + '°', unit: '' },
                o.warm ? cfg.oil_color_warm : cfg.oil_color_cold, cfg.test_pattern || (st.cds && o.visible));
        } else layers.oil.show(false);
        // fuel left
        const l = tank.value(t);
        if (cfg.tank_enabled) {
            const shown = l === null ? (cfg.test_pattern ? '38' : '--') : String(l);
            paint(layers.tank, 'tank_', { value: shown, unit: 'L' }, config.tankColorFor(cfg, st.rangeKm),
                cfg.test_pattern || (st.kombi && l !== null));
        } else layers.tank.show(false);
        // the oil readout changes by itself (the warm flash ends, a value goes stale): draw again then
        if (timer !== null) deps.clearTimeout(timer);
        timer = null;
        if (cfg.oil_enabled && o.next !== null) timer = deps.setTimeout(() => { timer = null; draw(); }, Math.max(50, o.next + 10));
    }

    function onAverage(p) {
        st.raw = p;
        st.data = consumption.decode(p, st.cfg.counter);
        const d = st.data;
        note('avg', 'average BC1 ' + d.bc1 + ' BC2 ' + d.bc2 + ' unit ' + d.unitRaw + ' -> shown ' + d.text + ' ' + d.unit);
        draw();
    }

    function onTank(p) {
        const raw = member(p, 'fluidLevelFuelTank');
        st.tankRaw = raw;
        st.rangeKm = rangeKm(member(p, 'range'));
        tank.feed(raw, now());
        note('tank', 'tank ' + raw + ' l (left ' + member(p, 'fluidLevelFuelTankLeftHand') + ', right ' +
            member(p, 'fluidLevelFuelTankRightHand') + '), range ' + st.rangeKm + ' km -> shown ' + tank.value(now()));
        draw();
    }

    function onTemperature(p) {
        const raw = member(p, 'temperatureEngineOilDrive');
        st.oilRaw = raw;
        oil.feed(raw, now());
        const o = oil.state(now());
        note('oil', 'oil ' + (o.oil === null ? '--' : o.oil + ' C') + ' (' + o.phase + ')');
        draw();
    }

    function apply(cfg, why) {
        if (config.same(cfg, st.cfg)) return false;
        st.cfg = cfg;
        log('settings (' + why + '): ' + JSON.stringify(cfg));
        layers.fuel.configure(config.box(cfg, ''));
        layers.oil.configure(config.box(cfg, 'oil_'));
        layers.tank.configure(config.box(cfg, 'tank_'));
        st.data = consumption.decode(st.raw, cfg.counter);
        draw();
        return true;
    }

    function report() {
        const d = st.data, o = oil.state(now());
        const lines = [
            'barin-fuel ' + VERSION + ', ' + new Date(now()).toISOString(),
            '',
            'consumption: ' + d.text + ' ' + d.unit + ' (counter ' + st.cfg.counter + ')   BC1: ' + d.bc1 +
                '   BC2: ' + d.bc2 + '   unit: ' + d.unitRaw,
            'oil: ' + (o.oil === null ? '--' : o.oil + ' C') + ' (' + o.phase + ', raw ' + st.oilRaw + ', ' +
                (st.cfg.oil_enabled ? 'on' : 'off') + ')',
            'tank: ' + tank.value(now()) + ' l (raw ' + st.tankRaw + ', range ' + st.rangeKm + ' km, ' +
                (st.cfg.tank_enabled ? 'on' : 'off') + ')',
            'providers: KombiIF ' + (st.kombi ? 'available' : 'not available') + ', CDS ' + (st.cds ? 'available' : 'not available'),
            'raw average: ' + JSON.stringify(st.raw),
            '',
            'settings: ' + JSON.stringify(st.cfg),
            '',
            '== over time (BC1 / BC2: compare with the trip computer\'s "since start" to pick the counter)',
        ].concat(st.history, [
            '',
            '== cluster-render status, ' + (st.statusAt || 'not yet'),
            st.status ? st.status.trim() : '(none yet)',
            '',
            '== fonts: ' + (st.fonts ? 'see fonts.txt' : 'not scanned yet (2 minutes after start)'),
            '',
            '== log',
        ], deps.tail(120));
        return lines.join('\n') + '\n';
    }

    function usbRound() {
        const found = usb.folders(fs, deps.usbRoots);
        if (!found.length) return;
        const c = usb.readConfig(fs, found);
        if (c) {
            const parsed = config.parse(c.text, c.file);
            if (parsed.warning && parsed.warning !== st.lastWarning) log(parsed.warning);
            st.lastWarning = parsed.warning;
            if (apply(parsed.config, 'from ' + c.file)) {
                try { fs.writeFileSync(PATHS.config, JSON.stringify(parsed.config, null, 2) + '\n'); } catch (e) {
                    log('settings: cannot keep them in ' + PATHS.config + ': ' + e.message);
                }
            }
        }
        const r = report();
        if (r !== st.lastReport) {
            usb.write(fs, found, 'report.txt', r);
            st.lastReport = r;
        }
        if (st.fonts) usb.write(fs, found, 'fonts.txt', st.fonts);
    }

    function probeFonts() {
        log('fonts: scanning the head unit');
        fontprobe.scan({ fs }).then((res) => new Promise((resolve) => {
            deps.execFile('fc-list', [], { timeout: 10000 }, (err, out) => resolve({ res, fc: err ? null : String(out) }));
        })).then((r) => {
            st.fonts = fontprobe.format(r.res, r.fc);
            log('fonts: ' + r.res.files.length + ' font files, ' + r.res.scanned + ' entries scanned');
            try { fs.writeFileSync(PATHS.fonts, st.fonts); } catch (e) { /* the stick has it too */ }
        }).catch((e) => log('fonts: ' + e));
    }

    log('barin-fuel ' + VERSION + ': ' + JSON.stringify(st.cfg));
    layers.fuel.configure(config.box(st.cfg, ''));
    layers.oil.configure(config.box(st.cfg, 'oil_'));
    layers.tank.configure(config.box(st.cfg, 'tank_'));
    cluster.start();
    draw();
    deps.setInterval(usbRound, USB_MS);
    deps.setInterval(() => cluster.askStatus(), STATUS_MS);
    deps.setTimeout(probeFonts, PROBE_AFTER_MS);

    function watch(iface, handlers, key) {
        const onAvailability = (a) => { st[key] = a; draw(); };
        return deps.someip.watch(iface, '1', handlers, onAvailability).then((res) => {
            if (res.error) {
                log(iface + ': ' + res.error + ', again in ' + RETRY_MS / 1000 + ' s');
                deps.setTimeout(() => watch(iface, handlers, key), RETRY_MS);
                return res;
            }
            if (res.available) onAvailability(true);
            // values are sent on change; asked again now and then in case a change was missed
            deps.setInterval(() => res.refresh(), REFRESH_MS);
            return res;
        });
    }
    const watching = watch(KOMBI, { statusBordcomputerAverage: onAverage, statusRangeTankStatus: onTank }, 'kombi')
        .then(() => watch(CDS, { statusEngineTemperature: onTemperature }, 'cds'));
    return { onAverage, onTank, onTemperature, draw, apply, report, usbRound, watching, state: st };
}

/* Start, trying again every BOOT_RETRY_MS while something it needs is missing (cluster-render's client, the SOME/IP
 * binding, MainApp's generator): no restart loop. d: { requireClient, requireBinding, generate, start, log, setTimeout } */
function boot(d) {
    let ClusterRender, binding;
    try {
        ClusterRender = d.requireClient();
        binding = d.requireBinding();
        d.generate();
    } catch (e) {
        d.log('barin-fuel: cannot start yet: ' + String(e && e.message ? e.message : e).split('\n')[0] +
            ', again in ' + BOOT_RETRY_MS / 1000 + ' s');
        d.setTimeout(() => boot(d), BOOT_RETRY_MS);
        return;
    }
    try {
        d.start(ClusterRender, binding);
    } catch (e) {
        d.log('barin-fuel: ' + (e && e.stack ? e.stack : e));
    }
}

function main() {
    const fs = require('fs');
    const childProcess = require('child_process');
    const events = createEventLog(PATHS.events, 256 * 1024, fs, Date.now);
    const log = (line) => { console.log(line); events.write(line); };
    const loaded = config.load(PATHS.config, fs.readFileSync);
    if (loaded.warning) log(loaded.warning);
    const glyphs = JSON.parse(fs.readFileSync(__dirname + '/glyphs.json', 'utf8'));
    boot({
        log, setTimeout,
        requireClient: () => require(PATHS.client).ClusterRender,
        requireBinding: () => require(PATHS.binding),
        generate: () => oapgen.generate(PATHS.catalog, PATHS.someipDir, {
            readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync,
            existsSync: fs.existsSync, generator: oapgen.loadGenerator(env.OAP_APPMGMT || oapgen.APPMGMT, fs.readFileSync),
        }),
        start: (ClusterRender, binding) => {
            const client = new ClusterRender('barin-fuel');
            process.on('SIGTERM', () => { client.close(); process.exit(0); });
            run({
                cfg: loaded.config, glyphs, client, fs, log, tail: events.tail,
                someip: createSomeip(binding, PATHS.someipDir, fs.readFileSync, log),
                now: Date.now, setTimeout, clearTimeout, setInterval, execFile: childProcess.execFile,
            });
        },
    });
}

if (require.main === module) main();
module.exports = { run, boot, PATHS, VERSION };
