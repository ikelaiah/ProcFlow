/* Deterministic store-only ZIP writer used by package-runtime.mjs. Keeping the
   writer dependency-free avoids adding a runtime or release-time package. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
function dosTime() { return { date: 0x5021, time: 0 }; }

export function writeStoreZip(output, entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const checksum = crc32(data);
    const header = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date),
      u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name
    ]);
    local.push(header, data);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date),
      u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name
    ]));
    offset += header.length + data.length;
  }
  const centralData = Buffer.concat(central);
  const body = Buffer.concat([...local, centralData, Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralData.length), u32(offset), u16(0)
  ])]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, body);
  return createHash("sha256").update(body).digest("hex");
}
