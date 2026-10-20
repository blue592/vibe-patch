import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { decode, propose, selectModel } from '../src/providers.js';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
function mock(text, finish = 'stop') {
  return new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text }], finishReason: { unified: finish, raw: undefined }, usage, warnings: [] }) });
}

test('all three official SDK adapters construct models and authenticate only to their provider', async () => {
  const env = { OPENAI_API_KEY: 'dummy-openai', ANTHROPIC_API_KEY: 'dummy-claude', GOOGLE_GENERATIVE_AI_API_KEY: 'dummy-gemini' };
  const cases = [['openai', 'api.openai.com'], ['claude', 'api.anthropic.com'], ['gemini', 'generativelanguage.googleapis.com']];
  for (const [provider, host] of cases) {
    let called = false;
    const fetcher = async (url, options) => {
      called = true;
      assert.equal(new URL(url).hostname, host);
      const headers = new Headers(options.headers);
      assert.equal(headers.get(provider === 'openai' ? 'authorization' : provider === 'claude' ? 'x-api-key' : 'x-goog-api-key'), provider === 'openai' ? 'Bearer dummy-openai' : provider === 'claude' ? 'dummy-claude' : 'dummy-gemini');
      return new Response(JSON.stringify({ error: { message: 'dummy-secret' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    };
    const model = selectModel(provider, 'test-model', env, fetcher);
    await assert.rejects(propose(model, 'Build a page', {}), error => {
      assert.ok(!error.message.includes('dummy-secret'));
      return /AI request failed/.test(error.message);
    });
    assert.ok(called, provider);
  }
});

test('missing credentials, model and unknown providers fail early', () => {
  assert.throws(() => selectModel('other', 'x', {}), /provider/);
  assert.throws(() => selectModel('claude', '', {}), /model/);
  assert.throws(() => selectModel('gemini', 'test', {}), /GOOGLE_GENERATIVE_AI_API_KEY/);
});

test('real generateText pipeline decodes a proposal with mock model', async () => {
  const expected = { summary: 'Build', files: [{ path: 'app.js', content: 'hello' }] };
  const result = await propose(mock(JSON.stringify(expected)), 'Build', {});
  assert.deepEqual(result.output, expected);
  assert.equal(result.usage.inputTokens, 10);
});

test('truncated and malformed model output never becomes a proposal', async () => {
  await assert.rejects(propose(mock('{bad}'), 'x', {}), /valid JSON/);
  await assert.rejects(propose(mock('{}', 'length'), 'x', {}), /finish cleanly/);
  assert.deepEqual(decode('```json\n{"files":[]}\n```'), { files: [] });
});
