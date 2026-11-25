// Inspect MP4 metadata, never mdat payloads. All reads and allocations are bounded.
const MAX_MOOV_BYTES = 2 * 1024 * 1024;
function boxAt(bytes, offset, limit = bytes.length) {
  if (offset + 8 > limit) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(offset), header = 8;
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  if (size === 1) {
    if (offset + 16 > limit) return null;
    const large = view.getBigUint64(offset + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large); header = 16;
  }
  if (size < header || !Number.isSafeInteger(offset + size)) return null;
  return { type, start: offset, payload: offset + header, end: offset + size, size };
}
function children(bytes, start, end, partial = false) {
  const result = [];
  for (let offset = start; offset < end;) {
    const box = boxAt(bytes, offset, end);
    if (!box) break;
    if (box.end > end) {
      if (partial && ['moov','trak','mdia','minf','stbl'].includes(box.type)) result.push({ ...box, end, truncated: true });
      break;
    }
    result.push(box); offset = box.end;
  }
  return result;
}
const hex = (value, width = 2) => value.toString(16).padStart(width, '0').toUpperCase();
function avcSpsDepth(nal) {
  if ((nal[0] & 31) !== 7) return undefined;
  const rbsp = [];
  for (let i = 1; i < Math.min(nal.length, 128); i++) {
    if (nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    rbsp.push(nal[i]);
  }
  let bit = 24;
  const readBit = () => { if (bit >= rbsp.length * 8) throw Error('truncated SPS'); const value = rbsp[bit >> 3] >> (7 - (bit & 7)) & 1; bit++; return value; };
  const ue = () => { let zeros = 0; while (!readBit()) { if (++zeros > 30) throw Error('invalid SPS'); } let value = 1; for (let i = 0; i < zeros; i++) value = value * 2 + readBit(); return value - 1; };
  try {
    ue(); // seq_parameter_set_id
    const chroma = ue(); if (chroma > 3) return undefined;
    if (chroma === 3) readBit();
    const depth = 8 + ue();
    return depth <= 14 ? depth : undefined;
  } catch { return undefined; }
}
export function mp4VideoInfo(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = children(bytes, 0, bytes.length, true).find(box => box.type === 'moov');
  if (!moov) return null;
  const find = (parent, type) => parent && children(bytes, parent.payload, parent.end, true).find(box => box.type === type);
  let sawTrack = false;
  for (const trak of children(bytes, moov.payload, moov.end, true).filter(box => box.type === 'trak')) {
    const mdia = find(trak, 'mdia'), hdlr = find(mdia, 'hdlr');
    if (!hdlr || hdlr.payload + 12 > hdlr.end) continue;
    sawTrack = true;
    if (String.fromCharCode(...bytes.subarray(hdlr.payload + 8, hdlr.payload + 12)) !== 'vide') continue;
    const stbl = find(find(mdia, 'minf'), 'stbl'), stsd = find(stbl, 'stsd');
    if (!stsd || stsd.payload + 8 > stsd.end || view.getUint32(stsd.payload + 4) !== 1) return null;
    const entry = boxAt(bytes, stsd.payload + 8, stsd.end);
    if (!entry || entry.end > stsd.end || entry.start + 86 > entry.end) return null;
    const info = { hasVideo: true, sampleEntry: entry.type, width: view.getUint16(entry.start + 32), height: view.getUint16(entry.start + 34) };
    const configs = children(bytes, entry.start + 86, entry.end);
    const avc = configs.find(box => box.type === 'avcC');
    const hevc = configs.find(box => box.type === 'hvcC');
    const vpc = configs.find(box => box.type === 'vpcC');
    if (avc && avc.payload + 4 <= avc.end && ['avc1','avc3'].includes(entry.type)) {
      const start = avc.payload;
      info.codec = `${entry.type}.${hex(bytes[start + 1])}${hex(bytes[start + 2])}${hex(bytes[start + 3])}`;
      info.codecName = 'h264'; info.profileId = bytes[start + 1]; info.level = bytes[start + 3];
      if ([66,77,88,100].includes(info.profileId)) info.bitDepth = 8;
      if ([100,110,122,144].includes(info.profileId) && start + 6 <= avc.end) {
        let offset = start + 6;
        if ((bytes[start + 5] & 31) && offset + 2 <= avc.end) {
          const length = view.getUint16(offset);
          if (offset + 2 + length <= avc.end) info.bitDepth = avcSpsDepth(bytes.subarray(offset + 2, offset + 2 + length)) || info.bitDepth;
        }
        const skipSets = count => {
          for (let i = 0; i < count; i++) {
            if (offset + 2 > avc.end) return false;
            const length = view.getUint16(offset); offset += 2 + length;
            if (offset > avc.end) return false;
          }
          return true;
        };
        if (skipSets(bytes[start + 5] & 31) && offset < avc.end) {
          const count = bytes[offset++];
          if (skipSets(count) && offset + 3 <= avc.end && (bytes[offset] & 252) === 252 && (bytes[offset + 1] & 248) === 248) info.bitDepth = 8 + (bytes[offset + 1] & 7);
        }
      }
    } else if (hevc && hevc.payload + 23 <= hevc.end && ['hvc1','hev1'].includes(entry.type)) {
      const start = hevc.payload, profile = bytes[start + 1];
      const space = ['', 'A', 'B', 'C'][profile >> 6];
      let flags = view.getUint32(start + 2), reversed = 0;
      for (let i = 0; i < 32; i += 1) { reversed = (reversed * 2 + (flags & 1)) >>> 0; flags >>>= 1; }
      const constraints = [...bytes.subarray(start + 6, start + 12)];
      while (constraints.at(-1) === 0) constraints.pop();
      info.codec = `${entry.type}.${space}${profile & 31}.${hex(reversed, 1)}.${profile & 32 ? 'H' : 'L'}${bytes[start + 12]}${constraints.length ? `.${constraints.map(value => hex(value)).join('.')}` : ''}`;
      info.codecName = 'hevc'; info.profileId = profile & 31; info.level = bytes[start + 12];
      info.bitDepth = 8 + (bytes[start + 17] & 7);
    } else if (vpc && vpc.payload + 12 <= vpc.end && bytes[vpc.payload] === 1 && ['vp08','vp09'].includes(entry.type)) {
      const start = vpc.payload + 4;
      info.codecName = entry.type === 'vp09' ? 'vp9' : 'vp8';
      info.profileId = bytes[start]; info.level = bytes[start + 1]; info.bitDepth = bytes[start + 2] >> 4;
      if ([8,10,12].includes(info.bitDepth)) info.codec = `${entry.type}.${String(info.profileId).padStart(2, '0')}.${String(info.level).padStart(2, '0')}.${String(info.bitDepth).padStart(2, '0')}`;
    }
    if (info.codec) info.contentType = `video/mp4; codecs="${info.codec}"`;
    const mdhd = find(mdia, 'mdhd'), stts = find(stbl, 'stts');
    if (mdhd && stts && stts.payload + 8 <= stts.end) {
      const scaleOffset = mdhd.payload + (bytes[mdhd.payload] === 1 ? 20 : 12);
      if (scaleOffset + 4 <= mdhd.end) {
        const timescale = view.getUint32(scaleOffset), entries = view.getUint32(stts.payload + 4);
        let samples = 0, ticks = 0;
        if (entries <= 100000 && stts.payload + 8 + entries * 8 <= stts.end) {
          for (let i = 0; i < entries; i += 1) {
            const offset = stts.payload + 8 + i * 8, count = view.getUint32(offset);
            samples += count; ticks += count * view.getUint32(offset + 4);
          }
          if (ticks && samples && timescale) info.framerate = samples * timescale / ticks;
        }
      }
    }
    return info;
  }
  return sawTrack && !moov.truncated ? { hasVideo: false } : null;
}

export async function inspectMp4Video(url, { fetchImpl = fetch, timeoutMs = 2200 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let requests = 0;
  async function range(start, length) {
    if (++requests > 6 || length > MAX_MOOV_BYTES || signal.aborted) return null;
    const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal, cache: 'no-store' });
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers?.get('content-range') || '');
    if (response.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) < start || Number(match[2]) >= Number(match[3]) || Number(match[2]) - start + 1 > length) {
      await response.body?.cancel(); return null;
    }
    // Even a misbehaving Range origin cannot make us buffer a whole episode.
    const reader = response.body.getReader(), chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > length) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  try {
    let offset = 0, start = 0, bytes = await range(0, 4096);
    while (bytes && requests <= 6) {
      const relative = offset - start;
      const box = boxAt(bytes, relative);
      if (!box) return null;
      if (box.type === 'moov') {
        // stsd and stts usually precede the large sample indexes. A complete
        // codec entry in the prefix is enough; avoid downloading those indexes.
        const prefix = mp4VideoInfo(bytes.subarray(box.start, Math.min(box.end, bytes.length)));
        if (prefix) {
          // Some high-resolution encodes put timing tables just past 4 KiB.
          // One small metadata read enables MediaCapabilities without fetching
          // the much larger sample indexes. Keep the verified codec on failure.
          if (prefix.codec && !prefix.framerate && box.size > bytes.length - box.start) {
            try {
              const extended = await range(offset, Math.min(box.size, 16384));
              return extended ? mp4VideoInfo(extended) || prefix : prefix;
            } catch { return prefix; }
          }
          return prefix;
        }
        if (box.size > MAX_MOOV_BYTES) return null;
        const moov = box.end <= bytes.length ? bytes.subarray(box.start, box.end) : await range(offset, box.size);
        return moov ? mp4VideoInfo(moov) : null;
      }
      offset += box.size;
      if (offset - start + 16 > bytes.length) { start = offset; bytes = await range(start, 4096); }
    }
  } catch { /* Unknown is not unsupported: playback and the frame monitor remain available. */ }
  return null;
}
