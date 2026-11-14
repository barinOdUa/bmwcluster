'use strict';
/*
 * eventlog.js - the log lines also in a small file, because the head unit's journal keeps only minutes:
 * /var/opt/barin-fuel/log/events.log, ISO time + the line; past maxBytes it becomes events.log.1 (one kept).
 * tail(n) gives the last lines for the USB report. A failure to write never reaches the service.
 */
const path = require('path');

function createEventLog(file, maxBytes, fs, now) {
    let size = null;
    const recent = [];

    function prepare() {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        try { size = fs.statSync(file).size; } catch (e) { size = 0; }
    }

    return {
        write(line) {
            const text = new Date(now()).toISOString() + ' ' + line;
            recent.push(text);
            if (recent.length > 300) recent.shift();
            try {
                if (size === null) prepare();
                const bytes = Buffer.byteLength(text) + 1;
                if (size + bytes > maxBytes && size > 0) {
                    fs.renameSync(file, file + '.1');
                    size = 0;
                }
                fs.appendFileSync(file, text + '\n');
                size += bytes;
            } catch (e) { /* the log is a help, never a reason to stop */ }
        },
        tail(n) { return recent.slice(-n); },
    };
}

module.exports = { createEventLog };
