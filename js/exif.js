// Lecture minimale de l'EXIF d'un JPEG : focale équivalente 35 mm (pour la pose de la caméra).
export function readExifFocal35(buffer) {
  try {
    const dv = new DataView(buffer);
    if (dv.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < dv.byteLength) {
      const marker = dv.getUint16(off);
      const len = dv.getUint16(off + 2);
      if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) return parseTiff(dv, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch (e) { /* EXIF illisible */ }
  return null;
}

function parseTiff(dv, t) {
  const le = dv.getUint16(t) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const ifd0 = t + u32(t + 4);
  let exifIfd = null;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8769) exifIfd = t + u32(e + 8);
  }
  if (!exifIfd) return null;
  const n = u16(exifIfd);
  let f35 = null, f = null;
  for (let i = 0; i < n; i++) {
    const e = exifIfd + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0xa405) f35 = u16(e + 8);
    if (tag === 0x920a) { const o = t + u32(e + 8); f = u32(o) / u32(o + 4); }
  }
  return f35 ? { focal35: f35, focal: f } : null;
}
