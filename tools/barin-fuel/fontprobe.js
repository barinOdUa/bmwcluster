'use strict';
/*
 * fontprobe.js - which fonts the head unit has, to find the one BMW draws its own text with (BMW Type Next).
 * Read only: walks the file system once, a little at a time so the unit never notices, and lists every font file
 * (by extension) and every file whose name says BMW type, with its size. `fc-list`, when the unit has it, is asked
 * too. Nothing is copied.
 */
const path = require('path');

const EXT = /\.(ttf|otf|ttc|otc|pfb|pfa|woff2?|fnt|bdf|pcf|fon|pfr)$/i;
const NAME = /bmw.?type|type.?next|typenext/i;
const SKIP = ['/proc', '/sys', '/dev', '/run', '/tmp', '/var/log', '/var/volatile', '/var/opt/barin-fuel'];

/* opts: { fs, root ('/'), maxDepth (12), maxEntries (300000), batch (200), skip } -> Promise<{ files, scanned, cut }> */
function scan(opts) {
    const fs = opts.fs;
    const skip = opts.skip || SKIP;
    const maxDepth = opts.maxDepth || 12;
    const maxEntries = opts.maxEntries || 300000;
    const batch = opts.batch || 200;
    const files = [];
    const stack = [{ p: opts.root || '/', d: 0 }];
    let scanned = 0, cut = false;

    return new Promise((resolve) => {
        function step() {
            let n = 0;
            while (stack.length && n < batch) {
                const it = stack.pop();
                let names;
                try { names = fs.readdirSync(it.p); } catch (e) { continue; }
                for (const name of names) {
                    const full = it.p === '/' ? '/' + name : it.p + '/' + name;
                    n++;
                    scanned++;
                    let st;
                    try { st = fs.lstatSync(full); } catch (e) { continue; }
                    if (st.isSymbolicLink()) continue;
                    if (st.isDirectory()) {
                        if (it.d + 1 <= maxDepth && skip.indexOf(full) < 0) stack.push({ p: full, d: it.d + 1 });
                    } else if (st.isFile() && (EXT.test(name) || NAME.test(name))) {
                        files.push({ path: full, size: st.size });
                    }
                }
                if (scanned >= maxEntries) { cut = true; stack.length = 0; }
            }
            if (stack.length) setImmediate(step);
            else resolve({ files: files.sort((a, b) => (a.path < b.path ? -1 : 1)), scanned, cut });
        }
        setImmediate(step);
    });
}

/* the report's text: likely BMW faces first */
function format(res, fcList) {
    const bmw = res.files.filter((f) => NAME.test(path.basename(f.path)) || /bmw/i.test(f.path));
    const line = (f) => f.size + '\t' + f.path;
    const out = [];
    out.push('fonts on the head unit: ' + res.files.length + ' files, ' + res.scanned + ' entries scanned' +
        (res.cut ? ' (stopped at the limit)' : ''));
    out.push('');
    out.push('== likely BMW (' + bmw.length + ')');
    bmw.forEach((f) => out.push(line(f)));
    out.push('');
    out.push('== all');
    res.files.forEach((f) => out.push(line(f)));
    if (fcList) {
        out.push('');
        out.push('== fc-list');
        out.push(fcList.trim());
    }
    return out.join('\n') + '\n';
}

module.exports = { scan, format, EXT, NAME };
