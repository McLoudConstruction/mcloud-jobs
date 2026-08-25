// Takes one brand hex color and derives light-mode-safe and dark-mode-safe
// accent variants by adjusting lightness (never hue) until each clears a
// real contrast floor against that mode's background — so it's always
// legible, and always still recognizably the same color the person chose.

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s; const l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Adjusts lightness until the color clears `minRatio` against `bgHex`,
// searching toward darker first (most brand colors read best a bit
// deepened against a light bg, and lightened against a dark bg), falling
// back to the other direction if needed.
function deriveAccent(brandHex, bgHex, minRatio = 3.0) {
  const bgRgb = hexToRgb(bgHex);
  const baseHsl = rgbToHsl(hexToRgb(brandHex));
  const isLightBg = relativeLuminance(bgRgb) > 0.5;

  const step = isLightBg ? -0.03 : 0.03; // darken on light bg, lighten on dark bg
  // Cap how light this can go — an accent is used as a solid button fill
  // with white text on it, so it must stay dark/saturated enough for
  // that text to stay legible, not just distinct from the page behind it.
  const lightnessCeiling = 0.58;
  let hsl = { ...baseHsl };
  for (let i = 0; i < 25; i++) {
    const rgb = hslToRgb(hsl);
    if (contrastRatio(rgb, bgRgb) >= minRatio) return rgbToHex(rgb);
    hsl = { ...hsl, l: Math.max(0.1, Math.min(lightnessCeiling, hsl.l + step)) };
  }
  return rgbToHex(hslToRgb(hsl)); // best effort if it never quite clears the floor
}

export function deriveThemeAccents(brandHex) {
  if (!brandHex || !/^#?[0-9a-f]{3,6}$/i.test(brandHex)) return null;
  const hex = brandHex.startsWith('#') ? brandHex : `#${brandHex}`;

  const light = deriveAccent(hex, '#fafaf8', 3.2);
  const dark = deriveAccent(hex, '#1a1a1d', 3.2);

  const shift = (colorHex, delta) => {
    const hsl = rgbToHsl(hexToRgb(colorHex));
    return rgbToHex(hslToRgb({ ...hsl, l: Math.max(0.05, Math.min(0.95, hsl.l + delta)) }));
  };

  return {
    accentLight: light,
    accentLightHover: shift(light, -0.07),
    accentDark: dark,
    accentDarkHover: shift(dark, 0.07),
  };
}
