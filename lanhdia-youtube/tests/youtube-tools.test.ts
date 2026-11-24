import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildYouTubeToolUrl, normalizeYouTubeTarget } from '../src/pages/YouTubeToolsPage';

const video = 'dQw4w9WgXcQ';
const channel = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const list = 'PL590L5WQmH8fJL17g1q5HcJSM3pUZW3NQ';

test('normalizes video, Shorts, handle, channel and playlist links', () => {
  assert.equal(normalizeYouTubeTarget(`youtu.be/${video}?si=tracking`), video);
  assert.equal(normalizeYouTubeTarget(`https://m.youtube.com/watch?t=42&v=${video}`), video);
  assert.equal(normalizeYouTubeTarget(`https://www.youtube.com/shorts/${video}`), video);
  assert.equal(normalizeYouTubeTarget('@DữLiệu'), 'https://www.youtube.com/@DữLiệu');
  assert.equal(normalizeYouTubeTarget('https://www.youtube.com/@GoogleDevelopers/videos?si=private'), 'https://www.youtube.com/@GoogleDevelopers');
  assert.equal(normalizeYouTubeTarget(`https://www.youtube.com/channel/${channel}/about`), channel);
  assert.equal(normalizeYouTubeTarget(`https://www.youtube.com/playlist?list=${list}&si=tracking`), `https://www.youtube.com/playlist?list=${list}`);
});

test('rejects non-YouTube URLs, spoofed hosts, embedded credentials and invalid targets', () => {
  for (const target of ['', 'https://youtube.com.example.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com@example.test/@Name', 'https://user:pass@youtube.com/@Name', 'javascript:alert(1)', 'https://www.youtube.com/redirect', 'https://youtu.be/short', 'https://www.youtube.com/@bad%2Fhandle']) {
    assert.equal(normalizeYouTubeTarget(target), null, target);
  }
});

test('bulk mode deduplicates, bounds queries and only links to the provider', () => {
  const result = new URL(buildYouTubeToolUrl('bulk', `https://youtu.be/${video},\n${video} ${channel}`));
  assert.equal(result.origin, 'https://mattw.io');
  assert.equal(result.pathname, '/youtube-metadata/bulk');
  assert.equal(result.searchParams.get('url'), `${video},${channel}`);
  assert.equal(result.searchParams.get('submit'), 'true');
  assert.throws(() => buildYouTubeToolUrl('bulk', Array(11).fill(video).join(',')));
  assert.throws(() => buildYouTubeToolUrl('detail', 'https://example.test/@Name'));
});

test('search escapes delimiters and spaces; geofind never forwards text', () => {
  const search = buildYouTubeToolUrl('search', 'máy ảnh & submit=false');
  assert.ok(search.includes('%20'));
  assert.equal(new URL(search).searchParams.get('keywords'), 'máy ảnh & submit=false');
  assert.equal(new URL(search).searchParams.get('submit'), 'true');
  assert.equal(buildYouTubeToolUrl('geo', 'test'), 'https://mattw.io/youtube-geofind/location');
});
