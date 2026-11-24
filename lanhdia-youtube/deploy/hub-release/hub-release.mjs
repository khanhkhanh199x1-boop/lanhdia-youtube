import {brotliDecompressSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
for (const group of ["hub-platform","hub-panel","hub-worker","hub-native"]) {
  const changes=JSON.parse(brotliDecompressSync(Buffer.from(readFileSync(`${group}.b64`, 'utf8'), 'base64')));
  for (const [path,edit] of Object.entries(changes)) {
    let source;
    if (edit.baseline) {
      source=readFileSync(path);
      if (createHash('sha256').update(source).digest('hex')!==edit.baseline) throw new Error(`Unexpected baseline for ${path}`);
    }
    if (edit.remove) { rmSync(path); continue; }
    mkdirSync(dirname(path),{recursive:true});
    if (edit.new!==undefined) writeFileSync(path,edit.new);
    else {
      const lines=source.toString('utf8').split(/(?<=\n)/);
      for (const [start,end,text] of edit.edits.reverse()) lines.splice(start,end-start,text);
      writeFileSync(path,lines.join(''));
    }
  }
}
