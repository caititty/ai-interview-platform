import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { useSessionStore } from '../src/stores/sessionStore.ts';
const store = () => useSessionStore.getState();
beforeEach(() => store().reset());

test('an accepted answer stays pending until the next question starts', () => {
  store().setAwaitingResponse(true);
  assert.equal(store().isAwaitingResponse, true);
  store().startQuestion(undefined, 2);
  assert.equal(store().isAwaitingResponse, false);
  assert.equal(store().isStreaming, true);
});

test('history loaded before WebSocket replay restores the active round without duplicate bubbles', () => {
  store().addQuestion(101, 1, '完整问题');
  store().startQuestion(101, 1);
  assert.equal(store().currentRoundId, 101);
  assert.equal(store().isStreaming, true);
  store().appendChunk('完整');
  store().appendChunk('问题');
  store().finalizeQuestion(101, '完整问题');
  assert.equal(store().messages.length, 1);
  assert.equal(store().messages[0].text, '完整问题');
  assert.equal(store().messages[0].streaming, false);
});

test('duplicate START preserves the partial text already displayed', () => {
  store().startQuestion(undefined, 1);
  store().appendChunk('第一段');
  store().startQuestion(undefined, 1);
  store().appendChunk('第二段');
  assert.equal(store().messages.length, 1);
  assert.equal(store().messages[0].text, '第一段第二段');
});

test('missing IDs do not cause different questions to be deduplicated', () => {
  store().startQuestion(undefined, 1);
  store().startQuestion(undefined, 2);
  assert.equal(store().messages.length, 2);
});

test('END repairs missed chunks using the authoritative complete text', () => {
  store().startQuestion(undefined, 1);
  store().appendChunk('部分');
  store().finalizeQuestion(102, '部分片段丢失后的完整问题');
  assert.equal(store().messages[0].text, '部分片段丢失后的完整问题');
  assert.equal(store().currentRoundId, 102);
  assert.equal(store().isStreaming, false);
});

test('END without START still displays the final question and REST fills in metadata', () => {
  store().setAwaitingResponse(true);
  store().finalizeQuestion(103, '追问内容');
  store().addQuestion(103, undefined, '追问内容', 'CLARIFY', 1, 2);
  assert.equal(store().messages.length, 1);
  assert.equal(store().messages[0].parentSeq, 1);
  assert.equal(store().messages[0].followUpIndex, 2);
  assert.equal(store().isAwaitingResponse, false);
});

test('history refresh cannot replace text while a question is streaming', () => {
  store().startQuestion(undefined, 1);
  store().appendChunk('当前正在输出');
  store().addQuestion(104, 1, 'REST 快照');
  assert.equal(store().messages.length, 1);
  assert.equal(store().messages[0].text, '当前正在输出');
  assert.equal(store().messages[0].roundId, 104);
});

test('disconnect, pause and reset release the pending answer state', () => {
  store().setAwaitingResponse(true);
  store().setConnected(false);
  assert.equal(store().isAwaitingResponse, false);
  store().setAwaitingResponse(true);
  store().setStatus('PAUSED');
  assert.equal(store().isAwaitingResponse, false);
  store().setAwaitingResponse(true);
  store().reset();
  assert.equal(store().isAwaitingResponse, false);
});
