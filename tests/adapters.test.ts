import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, prepared, toolEnvelope } from './helpers.ts';
import { parseTool } from '../packages/adapters/src/tools.ts';
import { provider, AmbiguousProviderError } from '../packages/adapters/src/providers.ts';
import { dockerArgs, processBounded, dockerAvailable } from '../packages/adapters/src/sandbox.ts';
import { defaultLimits } from '../packages/core/src/schema.ts';
test('sandbox arguments deny network, privileges, host env and mutable images', () => {
  const args = dockerArgs(
    'test',
    'sha256:' + 'a'.repeat(64),
    '/tmp/source',
    '/tmp/controller',
    defaultLimits,
    'foundry-test',
  );
  for (const flag of [
    '--network=none',
    '--read-only',
    '--user=65534:65534',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pull=never',
    '--log-driver=none',
  ])
    assert.ok(args.includes(flag));
  assert.equal(
    args.some((a) => a.includes('docker.sock') || a.includes('.ssh')),
    false,
  );
  assert.throws(
    () => dockerArgs('test', 'latest', '/s', '/c', defaultLimits, 'slither'),
    /immutable/,
  );
  assert.throws(
    () =>
      dockerArgs('test', 'sha256:' + 'a'.repeat(64), '/s,escape', '/c', defaultLimits, 'slither'),
    /mount/,
  );
  assert.throws(
    () => dockerArgs('test', 'sha256:' + 'a'.repeat(64), '/s', '/c', defaultLimits, 'arbitrary'),
    /Unknown/,
  );
});
test('process runner bounds output, time, cancellation, and environment', async () => {
  const cmd = process.execPath;
  const clean = await processBounded(
    cmd,
    ['-e', 'console.log(process.env.GEBAL_TEST_SECRET||"absent")'],
    2,
    1024,
  );
  assert.equal(clean.stdout.trim(), 'absent');
  const overflow = await processBounded(cmd, ['-e', 'console.log("x".repeat(5000))'], 2, 1000);
  assert.equal(overflow.overflow, true);
  const timeout = await processBounded(cmd, ['-e', 'setInterval(()=>{},1000)'], 0.05, 1000);
  assert.equal(timeout.timedOut, true);
  const abort = new AbortController();
  abort.abort();
  const cancelled = await processBounded(
    cmd,
    ['-e', 'setInterval(()=>{},1000)'],
    2,
    1000,
    abort.signal,
  );
  assert.equal(cancelled.cancelled, true);
});
test('Foundry empty, skipped, failed, malformed and successful outputs remain distinct', () => {
  const c = setup();
  try {
    const { snap } = prepared(c);
    const parse = (x: any, code = 0) =>
      parseTool('foundry-test', toolEnvelope('forge', x, code), snap);
    assert.equal(parse({}).state, 'unknown');
    assert.equal(
      parse({ suite: { test_results: { one: { status: 'Skipped' } } } }).state,
      'unknown',
    );
    assert.equal(
      parse({ suite: { test_results: { one: { status: 'Failure' } } } }, 1).state,
      'failed',
    );
    assert.equal(
      parse({ suite: { test_results: { one: { status: 'Success' } } } }).state,
      'succeeded',
    );
    assert.throws(() => parse({ suite: { new_schema: true } }));
    assert.equal(
      parseTool(
        'foundry-build',
        toolEnvelope('forge', { errors: [{ severity: 'error', message: 'compile error' }] }, 1),
        snap,
      ).state,
      'failed',
    );
  } finally {
    c.cleanup();
  }
});
test('Slither parser preserves native facts and rejects unknown schemas and bad spans', () => {
  const c = setup();
  try {
    const { snap } = prepared(c);
    const detector = {
      check: 'example',
      impact: 'Low',
      confidence: 'Medium',
      description: 'Synthetic parser fixture only',
      elements: [{ source_mapping: { filename_relative: 'src/CreditLedger.sol', lines: [5, 6] } }],
    };
    const parse = (data: any) => parseTool('slither', toolEnvelope('slither', data, 255), snap);
    const result = parse({ success: true, error: null, results: { detectors: [detector] } });
    assert.equal(result.findings[0].confidence, 'medium');
    assert.equal(result.findings[0].source[0].start, 5);
    assert.equal(parse({ success: true, error: null, results: {} }).state, 'succeeded');
    const missingCompletion = JSON.parse(
      toolEnvelope('slither', { success: true, error: null, results: {} }),
    );
    missingCompletion.stderr = '';
    assert.throws(
      () => parseTool('slither', JSON.stringify(missingCompletion), snap),
      /completion/,
    );
    assert.throws(() => parse({ success: false, error: 'failed', results: { detectors: [] } }));
    assert.throws(() =>
      parse({
        success: true,
        error: null,
        results: {
          detectors: [
            {
              ...detector,
              elements: [{ source_mapping: { filename_relative: '../../secret', lines: [1] } }],
            },
          ],
        },
      }),
    );
  } finally {
    c.cleanup();
  }
});
const content = JSON.stringify({
  observations: [],
  gaps: ['No real provider call in this transport test'],
});
for (const name of ['openai', 'anthropic'] as const)
  test(`${name} official HTTP request, structured output, usage, and no tools`, async () => {
    let request: any;
    const fake = (async (url: any, init: any) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify(
          name === 'openai'
            ? {
                status: 'completed',
                output: [{ content: [{ type: 'output_text', text: content }] }],
                usage: { input_tokens: 17, output_tokens: 9 },
              }
            : {
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: content }],
                usage: { input_tokens: 17, output_tokens: 9 },
              },
        ),
        { status: 200, headers: { 'x-request-id': 'fake-request' } },
      );
    }) as typeof fetch;
    const p = provider(name, 'mock-key', fake);
    const out = await p.review({
      model: 'explicit-model-id',
      context: 'source',
      maxOutputTokens: 512,
    });
    assert.equal(out.inputTokens, 17);
    assert.equal(out.outputTokens, 9);
    assert.equal(request.body.model, 'explicit-model-id');
    assert.equal(request.body.tools, undefined);
    assert.equal(request.init.redirect, 'error');
    assert.ok(
      request.url.startsWith(
        name === 'openai' ? 'https://api.openai.com/' : 'https://api.anthropic.com/',
      ),
    );
    assert.equal(p.capabilities().tools, false);
  });
test('provider malformed output, refusal, missing usage and ambiguous transport never silently succeed or retry', async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    throw new Error('connection reset');
  }) as typeof fetch;
  await assert.rejects(
    provider('openai', 'mock', transport).review({
      model: 'x',
      context: 'x',
      maxOutputTokens: 512,
    }),
    AmbiguousProviderError,
  );
  assert.equal(calls, 1);
  for (const response of [
    { status: 'incomplete' },
    { status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } },
    { status: 'completed', output: [{ content: [{ type: 'output_text', text: content }] }] },
  ]) {
    await assert.rejects(
      provider(
        'openai',
        'mock',
        (async () => new Response(JSON.stringify(response))) as typeof fetch,
      ).review({ model: 'x', context: 'x', maxOutputTokens: 512 }),
    );
  }
  assert.throws(() => provider('openai', ''), /Missing/);
});
test('real sandbox runtime probe reports availability honestly', async () => {
  const status = await dockerAvailable();
  assert.equal(typeof status.available, 'boolean');
  assert.ok(status.detail.length > 0);
});
