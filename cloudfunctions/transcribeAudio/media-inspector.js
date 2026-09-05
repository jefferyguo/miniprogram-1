'use strict'

const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

function readBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    let headerSize = 8
    if (size === 1 && offset + 16 <= end) {
      const largeSize = Number(buffer.readBigUInt64BE(offset + 8))
      if (!Number.isSafeInteger(largeSize)) break
      size = largeSize
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) break
    boxes.push({ type, start: offset, end: offset + size, dataStart: offset + headerSize })
    offset += size
  }
  return boxes
}

function findDescendant(buffer, box, wantedType) {
  const children = readBoxes(buffer, box.dataStart, box.end)
  for (const child of children) {
    if (child.type === wantedType) return child
    if (CONTAINER_BOXES.has(child.type)) {
      const found = findDescendant(buffer, child, wantedType)
      if (found) return found
    }
  }
  return null
}

function getHandlerType(buffer, trak) {
  const hdlr = findDescendant(buffer, trak, 'hdlr')
  return hdlr && hdlr.dataStart + 12 <= hdlr.end
    ? buffer.toString('ascii', hdlr.dataStart + 8, hdlr.dataStart + 12)
    : ''
}

function readAudioSampleEntry(buffer, trak) {
  const stsd = findDescendant(buffer, trak, 'stsd')
  if (!stsd || stsd.dataStart + 16 > stsd.end) return {}
  const entries = readBoxes(buffer, stsd.dataStart + 8, stsd.end)
  const entry = entries[0]
  if (!entry) return {}
  const data = entry.dataStart
  return {
    audioCodec: entry.type,
    channels: data + 18 <= entry.end ? buffer.readUInt16BE(data + 16) : null,
    sampleRate: data + 28 <= entry.end ? Math.round(buffer.readUInt32BE(data + 24) / 65536) : null
  }
}

function readMovieDuration(buffer, moov) {
  const mvhd = findDescendant(buffer, moov, 'mvhd')
  if (!mvhd || mvhd.dataStart + 20 > mvhd.end) return null
  const version = buffer.readUInt8(mvhd.dataStart)
  const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12)
  const durationOffset = timescaleOffset + 4
  if (durationOffset + (version === 1 ? 8 : 4) > mvhd.end) return null
  const timescale = buffer.readUInt32BE(timescaleOffset)
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset)
  return timescale > 0 ? Number((duration / timescale).toFixed(3)) : null
}

function inspectMp4(buffer) {
  const file = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const topLevel = readBoxes(file)
  const moov = topLevel.find(box => box.type === 'moov')
  if (!moov) {
    return { probeStatus: 'unsupported_or_incomplete', hasAudioStream: null }
  }
  const tracks = readBoxes(file, moov.dataStart, moov.end).filter(box => box.type === 'trak')
  const audioTrack = tracks.find(track => getHandlerType(file, track) === 'soun')
  return {
    probeStatus: 'ok',
    container: 'mp4',
    duration: readMovieDuration(file, moov),
    hasAudioStream: Boolean(audioTrack),
    ...(audioTrack ? readAudioSampleEntry(file, audioTrack) : {})
  }
}

module.exports = { inspectMp4 }
