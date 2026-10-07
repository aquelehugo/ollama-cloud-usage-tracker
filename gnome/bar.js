// SPDX-License-Identifier: MIT
//
// Quota bar widget — a fixed-width bar made of solid blocks. The bar
// is a St.DrawingArea painted with Cairo; the cell colours come from a
// palette derived from the user's GNOME theme (so the bar reads on
// light and dark backgrounds without clashing).

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';

const PALETTE = {
    accent: '#3584e4',
    success: '#33d17a',
    warning: '#f6d32d',
    error: '#e01b24',
};

// GNOME 45 kept the static St.ThemeContext.get_default(); 46+ dropped it
// in favour of get_for_stage(). Resolve whichever the running shell has
// (null ⇒ the preferred-height/width vfuncs fall back to static metric
// estimates instead of crashing the allocation).
function themeContext() {
    if (typeof St.ThemeContext.get_for_stage === 'function')
        return St.ThemeContext.get_for_stage(global.stage);
    if (typeof St.ThemeContext.get_default === 'function')
        return St.ThemeContext.get_default();
    return null;
}

export const Bar = GObject.registerClass({
    Properties: {
        pct: GObject.ParamSpec.double('pct', null, null,
            GObject.ParamFlags.READWRITE, 0, 100, 0),
        'color-name': GObject.ParamSpec.string('color-name', null, null,
            GObject.ParamFlags.READWRITE, 'accent'),
        cells: GObject.ParamSpec.uint('cells', null, null,
            GObject.ParamFlags.READWRITE, 1, 64, 24),
    },
}, class Bar extends St.DrawingArea {
    _init({width = 24, pct = 0, color = 'accent'} = {}) {
        super._init({
            y_expand: false,
            reactive: false,
            accessible_role: 0,
        });
        this._cells = Math.max(1, Math.floor(width));
        this._pct = Math.max(0, Math.min(pct, 100));
        this._colorName = color;
        this.connect('repaint', () => this._draw());
    }

    get actor() {
        return this;
    }

    get pct() { return this._pct; }
    set pct(v) {
        v = Math.max(0, Math.min(v, 100));
        if (v === this._pct)
            return;
        this._pct = v;
        this.queue_repaint();
    }

    get color_name() { return this._colorName; }
    set color_name(v) {
        if (v === this._colorName)
            return;
        this._colorName = v;
        this.queue_repaint();
    }

    get cells() { return this._cells; }
    set cells(v) {
        v = Math.max(1, Math.floor(v));
        if (v === this._cells)
            return;
        this._cells = v;
        this.queue_relayout();
    }

    vfunc_get_preferred_height(_forWidth) {
        // 1 em tall — keep aligned with the rest of the panel
        const ctx = themeContext();
        const theme = ctx ? ctx.get_theme() : null;
        const fd = theme ? theme.get_font('panel-status-indicators-keyboard') : null;
        const metrics = fd ? fd.get_metrics() : null;
        const ascent = metrics ? metrics.get_ascent() : 11;
        const descent = metrics ? metrics.get_descent() : 3;
        const height = Math.max(8, Math.ceil((ascent + descent) / 1024));
        return [height, height];
    }

    vfunc_get_preferred_width(_forHeight) {
        const ctx = themeContext();
        const theme = ctx ? ctx.get_theme() : null;
        const fd = theme ? theme.get_font('panel-status-indicators-keyboard') : null;
        const extents = fd ? fd.get_extents('█'.repeat(this._cells), null) : null;
        const width = extents ? Math.ceil(extents[1].width / 1024) + 2 : this._cells * 12;
        return [width, width];
    }

    _draw() {
        const cr = this.get_context();
        if (!cr)
            return;
        try {
            const [w, h] = this.get_surface_size();
            if (w === 0 || h === 0)
                return;
            const cellW = w / this._cells;
            const inset = Math.max(0.5, cellW * 0.08);
            const barH = Math.max(2, h * 0.6);
            const yOffset = (h - barH) / 2;
            const filled = Math.max(0, Math.min(this._cells, Math.round((this._pct / 100) * this._cells)));

            const fg = this._resolveColor(PALETTE[this._colorName] ?? PALETTE.accent, 1.0);
            const bg = this._resolveColor('#808080', 0.25);

            for (let i = 0; i < this._cells; i++) {
                const x = i * cellW + inset;
                const cw = cellW - inset * 2;
                cr.setSourceRGBA(...(i < filled ? fg : bg));
                cr.rectangle(x, yOffset, cw, barH);
                cr.fill();
            }
        } finally {
            cr.$dispose?.();
        }
    }

    _resolveColor(spec, alpha = 1.0) {
        const c = Clutter.Color.from_string(spec);
        if (!c[0])
            return [0.5, 0.5, 0.5, alpha];
        return [c[1].red / 255, c[1].green / 255, c[1].blue / 255, alpha];
    }
});
