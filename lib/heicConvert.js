// "Upload from library" on iPhone commonly hands the browser a HEIC/HEIF
// file — the default format the Photos app saves to — which every browser
// except Safari (native OS-level decode) has no built-in decoder for.
// Feeding one straight into a canvas-based pipeline (<img> load, then
// drawImage) just fails silently. Camera-captured photos never hit this,
// since the in-app camera always produces a canvas-native format already.
//
// Using heic-to rather than the more commonly-known heic2any: heic2any's
// bundled decoder hasn't been updated in years and can't read newer HEIC
// variants (e.g. the 10-bit/HDR HEIC modern iPhones save by default),
// failing with "ERR_LIBHEIF format not supported". heic-to tracks current
// libheif releases specifically to keep up with that. It's loaded on
// demand (a multi-MB WASM decoder) so the common, non-HEIC upload path
// never pays for it.
export function looksHeic(file) {
  return /image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
}

export async function ensureDecodableImage(file) {
  if (!looksHeic(file)) return file;
  try {
    const { heicTo } = await import('heic-to');
    return await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
  } catch (err) {
    throw new Error(`This HEIC/HEIF photo couldn't be converted for upload (${err?.message || 'unknown error'}). Try "Take Photos" instead, or on iPhone: Settings > Camera > Formats > Most Compatible.`);
  }
}
