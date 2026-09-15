// "Upload from library" on iPhone commonly hands the browser a HEIC/HEIF
// file — the default format the Photos app saves to — which every browser
// except Safari (native OS-level decode) has no built-in decoder for.
// Feeding one straight into a canvas-based pipeline (<img> load, then
// drawImage) just fails silently. Camera-captured photos never hit this,
// since the in-app camera always produces a canvas-native format already.
//
// heic2any is loaded on demand (~1MB WASM decoder) so the common,
// non-HEIC upload path never pays for it.
export function looksHeic(file) {
  return /image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
}

export async function ensureDecodableImage(file) {
  if (!looksHeic(file)) return file;
  try {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    // Live/burst HEIC photos can decode to more than one frame — the
    // first is the actual photo.
    return Array.isArray(result) ? result[0] : result;
  } catch (err) {
    throw new Error(`This is a HEIC/HEIF photo and couldn't be converted for upload (${err?.message || 'unknown error'}). Try "Take Photos" instead, or on iPhone: Settings > Camera > Formats > Most Compatible.`);
  }
}
