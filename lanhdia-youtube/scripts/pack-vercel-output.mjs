// Vercel Build Output API: frontend and Express function built from the same source.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const output = '.vercel/output';
const fn = `${output}/functions/api/index.func`;
const runtime = 'nodejs26.x';
rmSync(output, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
cpSync('dist', `${output}/static`, { recursive: true });
const dependencies = Object.fromEntries(['express', 'cors', 'firebase-admin'].map((name) => [name, JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version]));
writeFileSync(`${fn}/package.json`, JSON.stringify({ private: true, type: 'module', dependencies }));
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', fn], { stdio: 'inherit' });
await build({
  stdin: { contents: "import {createApiApp} from './server.ts'; export default createApiApp();", resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: `${fn}/index.js`, external: Object.keys(dependencies),
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ launcherType: 'Nodejs', runtime, handler: 'index.js', shouldAddHelpers: false }));
writeFileSync(`${output}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api/(.*)$', dest: '/api/index' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}));
console.log('Packaged Vercel output: static frontend and Express API.');
