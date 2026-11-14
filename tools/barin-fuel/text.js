'use strict';
/*
 * text.js - the readout as pixels: the figure ("11.4") and its unit ("l/100km") on one baseline, composed from the
 * alpha masks in glyphs.json (dev/bake_font.py) into an RGBA image for cluster-render's image layer.
 * Plain Node 8: no canvas, no optional chaining.
 */

const decoded = new WeakMap();

/* a glyph's mask as bytes, decoded once */
function mask(g) {
    let m = decoded.get(g);
    if (!m) {
        m = g.a ? Buffer.from(g.a, 'base64') : Buffer.alloc(0);
        decoded.set(g, m);
    }
    return m;
}

/* a glyph scaled by s (0.5-1.5): its mask resampled (area-weighted for smaller, bilinear for bigger), metrics scaled */
function scaleGlyph(g, s) {
    const w = Math.max(0, Math.round(g.w * s)), h = Math.max(0, Math.round(g.h * s));
    const out = { adv: g.adv * s, w, h, ox: g.ox * s, top: g.top * s, a: '' };
    if (!w || !h || !g.w || !g.h) { decoded.set(out, Buffer.alloc(0)); return out; }
    const src = mask(g), dst = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            // the source area this pixel covers, averaged
            const x0 = x / s, x1 = (x + 1) / s, y0 = y / s, y1 = (y + 1) / s;
            let sum = 0, area = 0;
            for (let sy = Math.floor(y0); sy < Math.min(g.h, Math.ceil(y1)); sy++) {
                const fy = Math.min(y1, sy + 1) - Math.max(y0, sy);
                for (let sx = Math.floor(x0); sx < Math.min(g.w, Math.ceil(x1)); sx++) {
                    const f = fy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
                    sum += src[sy * g.w + sx] * f;
                    area += f;
                }
            }
            dst[y * w + x] = area ? Math.round(sum / area) : 0;
        }
    }
    decoded.set(out, dst);
    return out;
}

const scaledFaces = new WeakMap();

/* face with every glyph scaled by s, made once per face and s */
function scaledFace(face, s) {
    if (!s || s === 1) return face;
    let byS = scaledFaces.get(face);
    if (!byS) { byS = {}; scaledFaces.set(face, byS); }
    if (!byS[s]) {
        const glyphs = {};
        Object.keys(face.glyphs).forEach((ch) => { glyphs[ch] = scaleGlyph(face.glyphs[ch], s); });
        byS[s] = { size: face.size * s, glyphs };
    }
    return byS[s];
}

/* the widest digit's advance: digits drawn tabular keep the figure from jumping as it changes */
function digitAdvance(face) {
    let w = 0;
    for (let d = 0; d <= 9; d++) {
        const g = face.glyphs[String(d)];
        if (g && g.adv > w) w = g.adv;
    }
    return w;
}

/* the pen positions of s in face: [{ g, x }] and the total advance; unknown characters are skipped */
function layout(face, s, tabular) {
    const dw = tabular ? digitAdvance(face) : 0;
    const out = [];
    let x = 0;
    for (const ch of String(s)) {
        const g = face.glyphs[ch];
        if (!g) continue;
        const isDigit = ch >= '0' && ch <= '9';
        const adv = isDigit && dw ? dw : g.adv;
        // a tabular digit sits in the middle of its cell
        out.push({ g, x: x + (isDigit && dw ? (dw - g.adv) / 2 : 0) });
        x += adv;
    }
    return { items: out, width: x };
}

/* alpha (w*h bytes) += the glyph at pen x, baseline y; overlapping pixels keep the stronger */
function blit(alpha, w, h, g, penX, baseY) {
    if (!g.w || !g.h) return;
    const m = mask(g);
    const left = Math.round(penX + g.ox);
    const top = Math.round(baseY - g.top);
    for (let row = 0; row < g.h; row++) {
        const yy = top + row;
        if (yy < 0 || yy >= h) continue;
        for (let col = 0; col < g.w; col++) {
            const xx = left + col;
            if (xx < 0 || xx >= w) continue;
            const v = m[row * g.w + col];
            const i = yy * w + xx;
            if (v > alpha[i]) alpha[i] = v;
        }
    }
}

/*
 * glyphs: glyphs.json; parts: { value, unit, icon (a name of glyphs.icons, drawn first) }; opts: { w, h, baseline, gap,
 * align ('left' | 'right' | 'center' in the box), unitScale (the unit's size against its baked one, 1 default),
 * color [r,g,b] 0-1,
 * tabular (digits in equal cells), frame (draw the box's edge, for placing it on the car) }. Returns { rgba: Buffer (w*h*4, straight alpha), width }.
 */
function render(glyphs, parts, opts) {
    const w = opts.w, h = opts.h;
    const alpha = new Uint8Array(w * h);
    // proportional digits, as the stock strip draws its own (a tabular "1" leaves a gap: "1 1.4")
    const num = layout(glyphs.num, parts.value, !!opts.tabular);
    const unit = parts.unit ? layout(scaledFace(glyphs.unit, opts.unitScale), parts.unit, false) : { items: [], width: 0 };
    const icon = parts.icon && glyphs.icons ? glyphs.icons[parts.icon] : null;
    const gap = unit.items.length ? opts.gap : 0;
    const iconW = icon ? icon.adv + opts.gap * 1.5 : 0;
    const total = iconW + num.width + gap + unit.width;
    let x0 = opts.align === 'right' ? w - total : opts.align === 'center' ? (w - total) / 2 : 0;
    x0 = Math.max(0, x0);
    if (icon) {
        // the icon centred on the figures' cap height
        const cap = glyphs.num.glyphs['0'] ? glyphs.num.glyphs['0'].top : icon.h;
        blit(alpha, w, h, icon, x0, opts.baseline - cap / 2 + icon.h / 2);
    }
    const nx = x0 + iconW;
    num.items.forEach((it) => blit(alpha, w, h, it.g, nx + it.x, opts.baseline));
    const ux = nx + num.width + gap;
    unit.items.forEach((it) => blit(alpha, w, h, it.g, ux + it.x, opts.baseline));
    if (opts.frame) {
        for (let x = 0; x < w; x++) { alpha[x] = 255; alpha[(h - 1) * w + x] = 255; }
        for (let y = 0; y < h; y++) { alpha[y * w] = 255; alpha[y * w + w - 1] = 255; }
    }
    const c = opts.color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const a = alpha[i];
        if (!a) continue;
        rgba[i * 4] = c[0];
        rgba[i * 4 + 1] = c[1];
        rgba[i * 4 + 2] = c[2];
        rgba[i * 4 + 3] = a;
    }
    return { rgba, width: Math.round(total) };
}

module.exports = { render, layout };
