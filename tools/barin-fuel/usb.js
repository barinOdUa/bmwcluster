'use strict';
/*
 * usb.js - talking to the owner without SSH: a USB stick with a folder named `barin-fuel` at its top.
 *   <stick>/barin-fuel/config.json   read: replaces the settings on the head unit (config.js)
 *   <stick>/barin-fuel/report.txt    written: what the tool saw (main.js), rewritten while the stick is in
 *   <stick>/barin-fuel/fonts.txt     written: the fonts found on the head unit (fontprobe.js)
 * A stick without the folder is never written to.
 *
 * Mounts are looked for under /run/media and /media, one and two levels down (/run/media/<label>,
 * /run/media/<user>/<label>), as the head unit's own USB media mounts them.
 *
 * The service runs as root and a stick is anyone's, so nothing on it is followed: the folder must be a real
 * directory on the stick's own file system (no symlink, the same device as the mount, its real path inside the
 * mount), files are opened with O_NOFOLLOW, only regular files are read, and config.json at most MAX_CONFIG bytes.
 */
const path = require('path');

const ROOTS = ['/run/media', '/media'];
const FOLDER = 'barin-fuel';
const MAX_CONFIG = 64 * 1024;

function constants(fs) {
    const c = fs.constants || {};
    return { NOFOLLOW: c.O_NOFOLLOW || 0, NONBLOCK: c.O_NONBLOCK || 0, RDONLY: c.O_RDONLY || 0,
        WRONLY: c.O_WRONLY || 1, CREAT: c.O_CREAT || 0x40, TRUNC: c.O_TRUNC || 0x200 };
}

/* real directories (not symlinks) right under p */
function dirs(fs, p) {
    try {
        return fs.readdirSync(p).map((n) => path.join(p, n)).filter((d) => {
            try { return fs.lstatSync(d).isDirectory(); } catch (e) { return false; }
        });
    } catch (e) {
        return [];
    }
}

/* f is mount/barin-fuel and a real directory of the mount's own file system */
function safeFolder(fs, mount, f) {
    try {
        const st = fs.lstatSync(f);
        if (!st.isDirectory() || st.isSymbolicLink()) return false;
        if (st.dev !== fs.lstatSync(mount).dev) return false;
        const real = fs.realpathSync(f), realMount = fs.realpathSync(mount);
        return real === path.join(realMount, FOLDER);
    } catch (e) {
        return false;
    }
}

/* the barin-fuel folders on the sticks plugged in now */
function folders(fs, roots) {
    const out = [];
    (roots || ROOTS).forEach((root) => {
        dirs(fs, root).forEach((a) => {
            [a].concat(dirs(fs, a)).forEach((m) => {
                const f = path.join(m, FOLDER);
                if (out.indexOf(f) < 0 && safeFolder(fs, m, f)) out.push(f);
            });
        });
    });
    return out;
}

/* a regular file's text, never through a symlink, at most max bytes; null otherwise */
function readSmall(fs, file, max) {
    const k = constants(fs);
    let fd = null;
    try {
        fd = fs.openSync(file, k.RDONLY | k.NOFOLLOW | k.NONBLOCK);
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.size > max) return null;
        const buf = Buffer.alloc(st.size);
        let got = 0;
        while (got < st.size) {
            const n = fs.readSync(fd, buf, got, st.size - got, got);
            if (n <= 0) break;
            got += n;
        }
        return buf.slice(0, got).toString('utf8');
    } catch (e) {
        return null;
    } finally {
        if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already gone */ }
    }
}

/* the first config.json on a stick: { file, text } or null */
function readConfig(fs, folderList) {
    for (const f of folderList) {
        const file = path.join(f, 'config.json');
        const text = readSmall(fs, file, MAX_CONFIG);
        if (text !== null) return { file, text };
    }
    return null;
}

/* text to <folder>/<name> on every stick, never through a symlink; how many took it */
function write(fs, folderList, name, text) {
    const k = constants(fs);
    let n = 0;
    folderList.forEach((f) => {
        let fd = null;
        try {
            fd = fs.openSync(path.join(f, name), k.WRONLY | k.CREAT | k.TRUNC | k.NOFOLLOW | k.NONBLOCK, 0o644);
            if (!fs.fstatSync(fd).isFile()) return;
            fs.writeSync(fd, text);
            n++;
        } catch (e) {
            /* read-only, pulled out, or not a plain file: the next round tries again */
        } finally {
            if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* already gone */ }
        }
    });
    return n;
}

module.exports = { folders, readConfig, write, ROOTS, FOLDER, MAX_CONFIG };
