import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, i) => { for (let j = 0; j < 8; j++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0); return i >>> 0; });
function crc32(data) {
  let crc = -1;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}
function png() {
  const side = 128;
  const raw = Buffer.alloc((side * 4 + 1) * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    if (Math.hypot(Math.max(0, Math.abs(x - 63.5) - 42), Math.max(0, Math.abs(y - 63.5) - 42)) > 19) continue;
    const at = y * (side * 4 + 1) + 1 + x * 4;
    const play = x >= 49 && x <= 88 && Math.abs(y - 64) <= (88 - x) * 0.60;
    raw.set(play ? [255, 255, 255, 255] : [185, 28, 28, 255], at);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(side); header.writeUInt32BE(side, 4); header[8] = 8; header[9] = 6;
  const chunk = (type, bytes) => {
    const tag = Buffer.from(type), out = Buffer.alloc(bytes.length + 12);
    out.writeUInt32BE(bytes.length); tag.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([tag, bytes])), bytes.length + 8);
    return out;
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(value), checksum = crc32(data);
    const l = Buffer.alloc(30), c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(33, 12);
    l.writeUInt32LE(checksum, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(filename.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(checksum, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42);
    local.push(l, filename, data); central.push(c, filename); offset += l.length + filename.length + data.length;
  }
  const toc = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(toc.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, toc, end]);
}
const config = readFileSync('src/lib/chrome-hub-config.ts', 'utf8');
const value = (name) => {
  const result = new RegExp(`export const ${name} = '([^']+)';`).exec(config)?.[1];
  if (!result) throw new Error(`Missing ${name} in Chrome Hub config`);
  return result;
};
const manifestText = readFileSync('chrome-extension/manifest.json');
const manifest = JSON.parse(manifestText);
const pin = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (x) => 'abcdefghijklmnop'[parseInt(x, 16)]);
if (pin !== value('CHROME_ID') || JSON.stringify(manifest.externally_connectable.matches) !== JSON.stringify([value('HUB_ORIGIN') + '/*'])) throw new Error('Chrome Hub extension ID/origin mismatch.');
const dir = resolve('dist/downloads'); mkdirSync(dir, { recursive: true });
const entries = ['manifest.json', 'setup.html', 'setup.css'].map((name) => [name, readFileSync(`chrome-extension/${name}`)]);
for (const name of ['worker', 'setup']) {
  const bundle = await build({ entryPoints: [`chrome-extension/${name}.ts`], bundle: true, minify: true, format: 'iife', target: 'chrome115', write: false });
  entries.push([`${name}.js`, bundle.outputFiles[0].contents]);
}
entries.push(['icon.png', png()]);
writeFileSync(`${dir}/lanhdia-chrome.zip`, zip(entries));
console.log('Packaged Chrome Manifest V3: dist/downloads/lanhdia-chrome.zip');
const buildInfo = 'internal static class BuildInfo {\n' + Object.entries({ Origin: value('HUB_ORIGIN'), HostName: value('HOST_NAME'), ExtensionId: pin })
  .map(([key, v]) => `    internal const string ${key} = ${JSON.stringify(v)};`).join('\n') + '\n}\n';
const windows = ['cai-dat-helper.bat', 'go-helper.bat', 'Host.cs', 'HUONG-DAN.txt'].map((name) => {
  const content = readFileSync(`windows-helper/${name}`, 'utf8');
  return [name, (name.endsWith('.txt') ? '\uFEFF' : '') + content.replace(/\r?\n/g, '\r\n')];
});
windows.push(['BuildInfo.cs', buildInfo.replace(/\n/g, '\r\n')]);
writeFileSync(`${dir}/lanhdia-windows-helper.zip`, zip(windows));
console.log('Packaged Windows Helper v2 (compiles locally from source): dist/downloads/lanhdia-windows-helper.zip');
