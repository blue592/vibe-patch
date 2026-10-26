import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, propose, selectModel } from '../src/providers.js';

const proposal = { summary: 'Build', files: [{ path: 'app.js', content: 'hello' }] };
const json = JSON.stringify(proposal);
const env = { OPENAI_API_KEY: 'dummy-openai', ANTHROPIC_API_KEY: 'dummy-claude', GOOGLE_GENERATIVE_AI_API_KEY: 'dummy-gemini' };
const cases = [
  {
    provider: 'openai', host: 'api.openai.com', path: '/v1/responses', header: 'authorization', key: 'Bearer dummy-openai',
    fixture: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: json }] }], usage: { input_tokens: 10, output_tokens: 20 } },
  },
  {
    provider: 'claude', host: 'api.anthropic.com', path: '/v1/messages', header: 'x-api-key', key: 'dummy-claude',
    fixture: { stop_reason: 'end_turn', content: [{ type: 'text', text: json }], usage: { input_tokens: 10, output_tokens: 20 } },
  },
  {
    provider: 'gemini', host: 'generativelanguage.googleapis.com', path: '/v1beta/models/test-model:generateContent', header: 'x-goog-api-key', key: 'dummy-gemini',
    fixture: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: json }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } },
  },
];

test('three native adapters send requests only to official hosts and preserve usage', async () => {
  for (const c of cases) {
    let calls = 0;
    const fetcher = async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, c.host);
      assert.equal(new URL(url).pathname, c.path);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      const headers = new Headers(options.headers);
      assert.equal(headers.get(c.header), c.key);
      assert.equal(headers.get('content-type'), 'application/json');
      const body = JSON.parse(options.body);
      if (c.provider === 'openai') { assert.equal(body.store, false); assert.match(body.input, /Build a page/); }
      if (c.provider === 'claude') { assert.match(body.messages[0].content, /Build a page/); assert.equal(headers.get('anthropic-version'), '2023-06-01'); }
      if (c.provider === 'gemini') { assert.match(body.contents[0].parts[0].text, /Build a page/); assert.equal(body.generationConfig.responseMimeType, 'application/json'); }
      return new Response(JSON.stringify(c.fixture), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const model = selectModel(c.provider, 'test-model', env, fetcher);
    const result = await propose(model, 'Build a page', {});
    assert.equal(calls, 1);
    assert.deepEqual(result.output, proposal);
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 });
  }
});

test('missing credentials, invalid models and unknown providers fail before network', () => {
  assert.throws(() => selectModel('other', 'x', {}), /provider/);
  assert.throws(() => selectModel('claude', '', env), /model/);
  assert.throws(() => selectModel('gemini', 'test', {}), /GOOGLE_GENERATIVE_AI_API_KEY/);
  assert.throws(() => selectModel('openai', 'model?key=x', env), /model/);
});

test('upstream errors and secrets are never exposed', async () => {
  for (const c of cases) {
    const fetcher = async () => new Response(JSON.stringify({ error: { message: 'dummy-secret' } }), { status: 401 });
    await assert.rejects(propose(selectModel(c.provider, 'test-model', env, fetcher), 'Build', {}), error => {
      assert.ok(!error.message.includes('dummy-secret'));
      return /AI request failed/.test(error.message);
    });
  }
});

test('malformed provider JSON cannot become proposed code', async () => {
  const fetcher = async () => new Response('invalid', { status: 200 });
  await assert.rejects(propose(selectModel('openai', 'test-model', env, fetcher), 'Build', {}), /AI request failed/);
  assert.throws(() => decode('{bad}'), /valid JSON/);
  assert.deepEqual(decode('```json\n{"files":[]}\n```'), { files: [] });
});

test('truncated, blocked and incomplete generations are rejected', async () => {
  const failed = [
    ['openai', { status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: json }] }] }],
    ['claude', { stop_reason: 'max_tokens', content: [{ type: 'text', text: json }] }],
    ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: json }] } }] }],
  ];
  for (const [provider, fixture] of failed) {
    const fetcher = async () => new Response(JSON.stringify(fixture), { status: 200 });
    await assert.rejects(propose(selectModel(provider, 'test-model', env, fetcher), 'x', {}), /finish cleanly/);
  }
});

test('large provider responses are rejected without printing upstream data', async () => {
  const fetcher = async () => new Response('secret', { status: 200, headers: { 'content-length': '5000000' } });
  await assert.rejects(propose(selectModel('openai', 'test-model', env, fetcher), 'x', {}), /AI request failed/);
});

test('chunked oversized responses are rejected even without Content-Length', async () => {
  const fetcher = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2_500_000));
      controller.enqueue(new Uint8Array(2_500_000));
      controller.close();
    },
  }), { status: 200 });
  await assert.rejects(propose(selectModel('openai', 'test-model', env, fetcher), 'x', {}), /AI request failed/);
});

test('non-object provider JSON fails safely', async () => {
  const fetcher = async () => new Response('null', { status: 200 });
  await assert.rejects(propose(selectModel('openai', 'test-model', env, fetcher), 'x', {}), /finish cleanly/);
});

