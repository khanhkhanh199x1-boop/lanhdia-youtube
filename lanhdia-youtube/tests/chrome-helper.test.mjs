import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Runs the exact packaged native host under Mono with only synthetic profile directories.
// The test chrome.exe records the argv; it never starts a browser or contacts a site.
const win = process.platform === 'win32';
const mono = !win && spawnSync('mcs', ['--version']).status === 0 && spawnSync('mono', ['--version']).status === 0;
test('packaged workstation host: verified profile routing, one-time capture, isolation, closed/missing profile, rejected parameters', { skip: !mono }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ld-native-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('unzip', ['-oq', 'dist/downloads/lanhdia-windows-helper.zip', '-d', dir]);
  const exe = join(dir, 'LanhDiaChromeHost.exe');
  execFileSync('mcs', ['-langversion:5', '-r:System.Web.Extensions', '-out:' + exe, join(dir, 'Host.cs'), join(dir, 'BuildInfo.cs')]);
  const info = readFileSync(join(dir, 'BuildInfo.cs'), 'utf8');
  const origin = /Origin = "([^"]+)";/.exec(info)[1], ext = /ExtensionId = "([^"]+)";/.exec(info)[1];
  const data = join(dir, 'local'), root = join(data, 'Google', 'Chrome', 'User Data');
  const chrome = join(data, 'Google', 'Chrome', 'Application');
  mkdirSync(chrome, { recursive: true });
  for (const p of ['Default', 'Profile 48', 'Profile 77']) mkdirSync(join(root, p), { recursive: true });
  const log = join(dir, 'argv');
  writeFileSync(join(chrome, 'chrome.exe'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$LD_TEST_ARGS"\n', { mode: 0o700 });
  const env = { ...process.env, XDG_DATA_HOME: data, LD_TEST_ARGS: log };
  const frame = (data) => { const body = Buffer.from(JSON.stringify(data)); const len = Buffer.alloc(4); len.writeUInt32LE(body.length); return Buffer.concat([len, body]); };
  const run = (op, source, payload, arg = 'chrome-extension://' + ext + '/') => spawnSync('mono', [exe, arg, '--parent-window=0'], { env, input: frame({ op, source, ...payload }), timeout: 8000 });
  const a = 'a'.repeat(32), b = 'b'.repeat(32), workspace = 'workspace-a', channelId = 'UC' + 'A'.repeat(22);
  const req = (op, source, payload = {}) => {
    const p = run(op, source, payload);
    assert.equal(p.status, 0, p.stderr.toString());
    assert.equal(p.stdout.readUInt32LE(0), p.stdout.length - 4);
    return JSON.parse(p.stdout.subarray(4));
  };
  const last = () => readFileSync(log, 'utf8').trimEnd().split('\n').slice(-3);
  assert.equal(run('local', a, {}, 'chrome-extension://' + 'a'.repeat(32) + '/').status, 2);
  assert.deepEqual(req('local', a).data.directories, ['Default', 'Profile 48', 'Profile 77']);
  assert.equal(req('pair-start', a, { directory: '..\\Default' }).code, 'PROFILE_NOT_FOUND');
  assert.equal(req('capture', a, { channelId }).code, 'PROFILE_UNPAIRED');
  const pair = (key, directory, other) => {
    assert.equal(req('pair-start', key, { directory }).ok, true);
    const [profile, arg, url] = last();
    assert.equal(profile, '--profile-directory=' + directory);
    assert.equal(arg, '--new-tab'); assert.ok(url.startsWith(origin + '/chrome-verify#pair='));
    const ticket = url.split('=')[1];
    assert.equal(req('pair-finish', other, { ticket }).code, 'PAIR_WRONG_PROFILE');
    assert.equal(req('pair-finish', key, { ticket }).data.profile, directory);
    assert.equal(req('pair-finish', key, { ticket }).code, 'PAIR_EXPIRED');
  };
  pair(a, 'Default', b); pair(b, 'Profile 48', a);
  assert.equal(req('dashboard', a, { workspace }).data.dashboard, 'this');
  assert.equal(req('state', b, { workspace }).data.dashboard, 'other');
  assert.equal(req('state', a, { workspace: 'other' }).data.dashboard, 'different-workspace');
  assert.equal(req('capture', b, { channelId, url: 'https://not.allowed/' }).ok, true);
  const launch = last(); assert.equal(launch[0], '--profile-directory=Default');
  assert.ok(launch[2].startsWith(origin + '/channels#chrome-sync='));
  const ticket = launch[2].split('=')[1];
  assert.equal(req('capture', b, { channelId }).ok, true);
  assert.equal(last()[2], launch[2]); // duplicate click shares a pending ticket
  assert.equal(req('read', b, { workspace, ticket }).code, 'WRONG_DASHBOARD');
  assert.equal(req('read', a, { workspace: 'other', ticket }).code, 'WRONG_DASHBOARD');
  assert.deepEqual(req('read', a, { workspace, ticket }).data, { ticket, workspace, channelId, profileKey: b, directory: 'Profile 48' });
  const open = { workspace, channelId, profileKey: b, view: 'studio' };
  assert.equal(req('open', a, open).code, 'CHANNEL_NOT_LINKED_HERE');
  assert.equal(req('ack', a, { workspace, ticket }).ok, true);
  assert.equal(req('read', a, { workspace, ticket }).code, 'CAPTURE_EXPIRED');
  assert.equal(req('open', a, { ...open, view: 'chrome://settings' }).code, 'INVALID_REQUEST');
  assert.equal(req('open', a, { ...open, channelId: channelId + ' --incognito' }).code, 'INVALID_REQUEST');
  assert.equal(req('open', a, { ...open, profileKey: a }).code, 'CHANNEL_NOT_LINKED_HERE');
  assert.equal(req('open', a, { ...open, url: 'file:///unsafe' }).data.profile, 'Profile 48');
  assert.deepEqual(last(), ['--profile-directory=Profile 48', '--new-tab', `https://studio.youtube.com/channel/${channelId}`]);
  const path = join(root, 'Profile 48');
  renameSync(path, path + ' backup'); mkdirSync(path);
  assert.equal(req('open', a, open).code, 'PROFILE_NOT_FOUND'); // recycled directories fail closed
  assert.equal(existsSync(join(path, 'LanhDiaYouTube.ChromeHub.link')), false);
  assert.equal(req('unlink', a, open).ok, true);
  assert.equal(req('open', a, open).code, 'CHANNEL_NOT_LINKED_HERE');
});
