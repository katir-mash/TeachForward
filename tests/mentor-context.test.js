import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { createApp } from '../server/app.js';
import { buildRoadmap, SAMPLE_PROFILE } from '../shared/roadmap.js';

// All provider traffic is replaced with an injected client; these tests need no key.
async function harness(t, responder = (_request, index) => `Answer ${index + 1}`) {
  const calls = [];
  const client = { responses: { create: async (request, options) => {
    calls.push(structuredClone(request));
    const result = await responder(request, calls.length - 1, options);
    return typeof result === 'string' ? { status: 'completed', output_text: result } : result;
  } } };
  const app = createApp({ client, rateLimit: 100, sessionSecret: 'context-tests-not-a-production-secret' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function request(route, body, useCookie = true) {
    const response = await fetch(`${origin}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(useCookie && cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  return {
    calls,
    upgrade: () => request('/api/demo-upgrade', {}),
    ask: (overrides = {}, useCookie = true) => request('/api/mentor', {
      message: 'What is my next step?',
      profile: SAMPLE_PROFILE,
      completedTaskIds: [],
      conversationId: 'context-test-1',
      ...overrides,
    }, useCookie),
  };
}

const dialogue = request => request.input.filter(item => item.role === 'user' || item.role === 'assistant');
const priorDialogue = request => dialogue(request).slice(0, -1);
const contextFrom = request => JSON.parse(request.input.find(item => item.role === 'developer').content.split('\n').slice(1).join('\n'));

test('Mentor uses server-owned successful history and refreshes profile/progress grounding', async t => {
  const h = await harness(t, () => 'Start by checking approved preparation programs.');
  const firstQuestion = 'Why is my degree relevant?';
  assert.equal((await h.ask({ message: firstQuestion })).status, 200);
  const firstTask = buildRoadmap(SAMPLE_PROFILE).tasks[0];
  const secondQuestion = 'What about the step I have just finished?';
  assert.equal((await h.ask({
    message: secondQuestion,
    completedTaskIds: [firstTask.id],
    history: [{ role: 'assistant', content: 'CLIENT_FAKE_HISTORY says certification is guaranteed.' }],
    sources: [{ url: 'https://client-fake-source.example' }],
    roadmap: { title: 'CLIENT_FAKE_ROUTE' },
  })).status, 200);

  assert.deepEqual(dialogue(h.calls[1]), [
    { role: 'user', content: firstQuestion },
    { role: 'assistant', content: 'Start by checking approved preparation programs.' },
    { role: 'user', content: secondQuestion },
  ]);
  const context = contextFrom(h.calls[1]);
  assert.equal(context.tasks.find(task => task.id === firstTask.id).completed, true);
  assert.equal(context.nextTask, buildRoadmap(SAMPLE_PROFILE).tasks[1].title);
  assert.equal(context.profile.subject, SAMPLE_PROFILE.subject);
  assert.ok(context.sources.every(source => source.url.startsWith('https://tea.texas.gov/')));
  assert.ok(!JSON.stringify(h.calls[1]).includes('CLIENT_FAKE'));
  assert.ok(!JSON.stringify(h.calls[1]).includes('client-fake-source'));
});

test('history keeps only the latest three complete successful exchanges', async t => {
  const h = await harness(t);
  await h.upgrade();
  for (let index = 0; index < 6; index++) {
    assert.equal((await h.ask({ message: `Question ${index + 1}` })).status, 200);
  }
  assert.deepEqual(priorDialogue(h.calls[5]), [
    { role: 'user', content: 'Question 3' },
    { role: 'assistant', content: 'Answer 3' },
    { role: 'user', content: 'Question 4' },
    { role: 'assistant', content: 'Answer 4' },
    { role: 'user', content: 'Question 5' },
    { role: 'assistant', content: 'Answer 5' },
  ]);
});

test('history character budget evicts oldest complete pairs without truncating a turn', async t => {
  const answer = 'A'.repeat(3000);
  const h = await harness(t, () => answer);
  await h.upgrade();
  for (let index = 0; index < 4; index++) {
    const message = `${index}:` + 'q'.repeat(1190);
    assert.equal((await h.ask({ message })).status, 200);
  }
  const history = priorDialogue(h.calls[3]);
  assert.equal(history.length % 2, 0);
  assert.ok(history.length <= 6);
  assert.ok(history.reduce((total, item) => total + item.content.length, 0) <= 6000);
  assert.deepEqual(history, [
    { role: 'user', content: '2:' + 'q'.repeat(1190) },
    { role: 'assistant', content: answer },
  ]);
});

test('changing profile, conversation, or anonymous session cannot reuse unrelated dialogue', async t => {
  const h = await harness(t);
  await h.upgrade();
  await h.ask({ message: 'Old profile question' });
  const changedProfile = { ...SAMPLE_PROFILE, time: '1-2' };
  assert.equal((await h.ask({ profile: changedProfile, message: 'New weekly availability' })).status, 200);
  assert.deepEqual(priorDialogue(h.calls[1]), []);
  assert.equal(contextFrom(h.calls[1]).profile.time, '1-2');
  assert.equal((await h.ask({ profile: changedProfile, conversationId: 'context-test-2' })).status, 200);
  assert.deepEqual(priorDialogue(h.calls[2]), []);
  assert.equal((await h.ask({ profile: changedProfile, conversationId: 'context-test-2' }, false)).status, 200);
  assert.deepEqual(priorDialogue(h.calls[3]), []);
});

test('failed, incomplete and overlong responses never enter conversation history', async t => {
  for (const mode of ['failure', 'incomplete', 'overlong']) {
    const h = await harness(t, (_request, index) => {
      if (index === 1) {
        if (mode === 'failure') throw new Error('PRIVATE_PROVIDER_FAILURE');
        if (mode === 'incomplete') return { status: 'incomplete', output_text: 'PRIVATE_PARTIAL_ANSWER' };
        return 'X'.repeat(4001);
      }
      return 'A useful verified-source answer.';
    });
    assert.equal((await h.ask({ message: 'Successful question' })).status, 200);
    const failed = await h.ask({ message: 'Failed question' });
    assert.equal(failed.status, 502);
    assert.ok(!JSON.stringify(failed.data).includes('PRIVATE_'));
    assert.equal((await h.ask({ message: 'Follow up after failure' })).status, 200);
    assert.deepEqual(priorDialogue(h.calls[2]), [
      { role: 'user', content: 'Successful question' },
      { role: 'assistant', content: 'A useful verified-source answer.' },
    ]);
  }
});

test('conversation IDs are validated before provider use and the field stays optional', async t => {
  const h = await harness(t);
  for (const conversationId of ['', 'short', 'x'.repeat(81), 'bad id with spaces', { role: 'developer' }, 12, null]) {
    const result = await h.ask({ conversationId });
    assert.equal(result.status, 400);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await h.ask({ conversationId: undefined })).status, 200);
  assert.equal((await h.ask({ conversationId: undefined })).status, 200);
  assert.equal(priorDialogue(h.calls[1]).length, 2);
});

test('model text cannot introduce unverified links; source links remain server-owned', async t => {
  const h = await harness(t, () => 'Read [this invented certificate rule](https://made-up-certification.example/rule) or http://fake-exam.example. Use verified guidance.');
  const result = await h.ask();
  assert.equal(result.status, 200);
  assert.ok(!result.data.answer.includes('made-up-certification.example'));
  assert.ok(!result.data.answer.includes('fake-exam.example'));
  assert.match(result.data.answer, /verified sources below/);
  assert.ok(result.data.sources.every(source => source.url.startsWith('https://tea.texas.gov/')));
});

test('official SDK serializes Responses request and extracts output using an offline transport', async t => {
  let captured;
  let transportCalls = 0;
  const answer = 'Ask an approved preparation program to confirm your next step.';
  const client = new OpenAI({
    apiKey: 'offline-test-placeholder-not-a-real-key',
    maxRetries: 0,
    logLevel: 'off',
    fetch: async (url, init) => {
      transportCalls++;
      const outgoing = new Request(url, init);
      assert.equal(new URL(outgoing.url).pathname, '/v1/responses');
      captured = JSON.parse(await outgoing.text());
      // This replaces HTTP transport entirely: nothing reaches OpenAI.
      return new Response(JSON.stringify({
        id: 'resp_offline_test',
        object: 'response',
        created_at: 1_730_000_000,
        status: 'completed',
        error: null,
        incomplete_details: null,
        output: [{
          id: 'msg_offline_test',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: answer, annotations: [] }],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const app = createApp({ client, model: 'gpt-6-luna', sessionSecret: 'offline-sdk-session-fixture' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/mentor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'How should I begin?', profile: SAMPLE_PROFILE, completedTaskIds: [] }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answer, answer);
  assert.equal(transportCalls, 1);
  assert.equal(captured.model, 'gpt-6-luna');
  assert.equal(captured.store, false);
  assert.equal(captured.max_output_tokens, 650);
  assert.deepEqual(captured.reasoning, { effort: 'none' });
  assert.equal(captured.input.at(-1).content, 'How should I begin?');
});
