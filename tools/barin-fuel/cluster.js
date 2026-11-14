'use strict';
/*
 * cluster.js - the readouts' layers on the instrument cluster through cluster-render (robertnisipeanu/idrive-apps,
 * native/cluster-render/PROTOCOL.md): one image layer per readout, class overlay, on the `panel` target (slot 0x203:
 * the whole 1920x720 cluster, over the stock gauges, under the telltales; BMW's own gear box is drawn over it
 * whatever we do).
 *
 * The client keeps each image and sends it again after every reconnect, so a picture is handed over only when it
 * changed. A new box size (w, h) means a new layer: the old one is dropped. cluster-render's status text and every
 * target and layer state go to the log and the report: they say whether the panel is shown and what the cluster has
 * up while it is.
 */

function createCluster(client, log, onStatus) {
    const byRef = new Map();

    /* one readout's layer; box: { x, y, w, h, scale } */
    function layer(name) {
        let ref = 0, box = null, visible = false, lastPicture = null;

        function make(b) {
            if (ref) { client.drop(ref); byRef.delete(ref); }
            box = { w: b.w, h: b.h };
            ref = client.image({ target: 'panel', klass: 'overlay', x: b.x, y: b.y, w: b.w, h: b.h,
                iw: b.w, ih: b.h, sampling: 'bilinear', px: 0, py: 0, sx: b.scale, sy: b.scale,
                visible: visible ? 1 : 0 });
            if (!ref) log('panel ' + name + ': the cluster-render client refused the layer (' + b.w + 'x' + b.h + ')');
            else byRef.set(ref, name);
            if (ref && lastPicture && lastPicture.length === b.w * b.h * 4) client.pixels(ref, null, lastPicture);
        }

        return {
            configure(b) {
                if (!box || box.w !== b.w || box.h !== b.h) {
                    lastPicture = null;
                    make(b);
                    return;
                }
                if (ref) client.set(ref, { x: b.x, y: b.y, sx: b.scale, sy: b.scale, px: 0, py: 0 });
            },
            /* the readout's pixels, w*h*4 RGBA of the current box */
            picture(rgba) {
                if (!ref || !box || rgba.length !== box.w * box.h * 4) return false;
                if (lastPicture && lastPicture.equals(rgba)) return true;
                lastPicture = Buffer.from(rgba);
                return client.pixels(ref, null, lastPicture);
            },
            show(on) {
                on = !!on;
                if (on === visible) return;
                visible = on;
                if (ref) client.set(ref, { visible: on ? 1 : 0 });
            },
        };
    }

    return {
        layer,
        start() {
            client.on('ready', () => { log('panel: connected to cluster-render'); client.status(); });
            client.on('status', (text) => { if (onStatus) onStatus(String(text)); });
            client.on('disconnected', () => log('panel: cluster-render disconnected, reconnecting'));
            client.on('target', (name, state, holder, reason) => {
                if (name === 'panel') log('panel: target ' + state + (holder ? ' holder=' + holder : '') + (reason ? ' (' + reason + ')' : ''));
            });
            client.on('layer', (r, state, reason) => {
                if (byRef.has(r)) log('panel ' + byRef.get(r) + ': layer ' + state + (reason ? ' (' + reason + ')' : ''));
            });
            client.on('refused', (op, r, reason) => log('panel: refused ' + op + (byRef.has(r) ? ' ' + byRef.get(r) : '') + ': ' + reason));
            client.connect();
        },
        askStatus() { client.status(); },
    };
}

module.exports = { createCluster };
