// Chargement d'images pour les tests Node (sharp applique l'orientation EXIF).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = createRequire('/home/claude/dev/')('sharp'); }
export { sharp };
export async function loadImage(path, maxLong = 0) {
  let s = sharp(path).rotate();
  const meta = await sharp(path).metadata();
  if (maxLong) s = s.resize({ width: maxLong, height: maxLong, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), exif: meta };
}
export async function saveRGBA(img, path) {
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(path);
}
export const DEMO = {
  clear: new URL('../assets/demo/verre_clair_OD.jpg', import.meta.url).pathname,
  dark: new URL('../assets/demo/verre_teinte_OG.jpg', import.meta.url).pathname,
};
