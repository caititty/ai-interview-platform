import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVoiceSubtitles, VoiceTurnAccumulator } from '../src/lib/rtcProtocol.ts';

function packet(data) {
  const body = new TextEncoder().encode(JSON.stringify({ data }));
  const bytes = new Uint8Array(body.length + 8);
  bytes.set(new TextEncoder().encode('subv'));
  new DataView(bytes.buffer).setUint32(4, body.length, false);
  bytes.set(body, 8);
  return bytes.buffer;
}
const subtitle = (extra = {}) => ({ userId: 'candidate', text: '你好', sequence: 1, roundId: 1, definite: false, paragraph: false, ...extra });

test('decodes UTF-8 subtitle packets with the documented big-endian header', () => {
  const data = [subtitle({ text: 'Java 线程池：核心线程' })];
  assert.deepEqual(decodeVoiceSubtitles(packet(data)), data);
});

test('rejects malformed sizes, unrelated messages, and invalid subtitle records', () => {
  assert.deepEqual(decodeVoiceSubtitles(new ArrayBuffer(2)), []);
  const broken = packet([subtitle()]);
  new DataView(broken).setUint32(4, 99, false);
  assert.deepEqual(decodeVoiceSubtitles(broken), []);
  const unrelated = packet([subtitle()]);
  new Uint8Array(unrelated).set(new TextEncoder().encode('conv'));
  assert.deepEqual(decodeVoiceSubtitles(unrelated), []);
  assert.deepEqual(decodeVoiceSubtitles(packet([{ userId: 1, text: 'invalid' }])), []);
});

test('cumulative ASR updates replace earlier text even when sequence increases', () => {
  const turns = new VoiceTurnAccumulator();
  assert.deepEqual(turns.accept(subtitle({ text: '我会 J' })), { text: '我会 J', complete: false });
  assert.deepEqual(turns.accept(subtitle({ sequence: 2, text: '我会 Java' })), { text: '我会 Java', complete: false });
  assert.deepEqual(turns.accept(subtitle({ sequence: 3, text: '我会 Java，也用过 Redis。', definite: true, paragraph: true })), { text: '我会 Java，也用过 Redis。', complete: true });
});

test('out-of-order interim packets cannot roll back the transcript', () => {
  const turns = new VoiceTurnAccumulator();
  turns.accept(subtitle({ sequence: 4, text: '我会 Java' }));
  assert.equal(turns.accept(subtitle({ sequence: 3, text: '我会' })), null);
});

test('repeated final packets cannot submit the same answer twice', () => {
  const turns = new VoiceTurnAccumulator();
  const final = subtitle({ definite: true, paragraph: true });
  assert.equal(turns.accept(final).complete, true);
  assert.equal(turns.accept(final), null);
  assert.equal(turns.accept(subtitle({ sequence: 2, definite: true, paragraph: true })), null);
  assert.equal(turns.accept(subtitle({ roundId: 2, definite: true, paragraph: true })).complete, true);
});
