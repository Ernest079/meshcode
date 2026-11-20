// A scripted LLM server for tests: OpenAI-compatible (/v1/chat/completions, /v1/models) and Anthropic
// (/v1/messages, /v1/models with ?beta or x-api-key). Replies stream in small chunks, like real servers.
// CORS is open so the web app (another port) can call it.
import http from 'node:http';

/** @returns {Promise<{ url: string, replies: string[], requests: { path: string, headers: http.IncomingHttpHeaders, body: any }[], close: () => Promise<void> }>} */
export async function fakeLLM() {
  /** @type {string[]} */ const replies = [];
  /** @type {{ path: string, headers: http.IncomingHttpHeaders, body: any }[]} */ const requests = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' };
  const chunks = (/** @type {string} */ s) => s.match(/[\s\S]{1,7}/g) ?? [];

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    let raw = '';
    for await (const c of req) raw += c;
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path, headers: req.headers, body });
    const anthropic = 'x-api-key' in req.headers || 'anthropic-version' in req.headers;

    if (path.endsWith('/models')) {
      const data = [{ id: 'fake-coder', type: 'model', display_name: 'Fake', created_at: '2026-01-01T00:00:00Z' }];
      return res.writeHead(200, { ...cors, 'content-type': 'application/json' })
        .end(JSON.stringify(anthropic ? { data, has_more: false, first_id: 'fake-coder', last_id: 'fake-coder' } : { object: 'list', data }));
    }
    const text = replies.shift() ?? 'LGTM';
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream' });
    if (path.endsWith('/chat/completions')) {
      for (const c of chunks(text)) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    // Anthropic Messages streaming events.
    const ev = (/** @type {string} */ type, /** @type {object} */ data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_fake', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const c of chunks(text)) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: c } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}`, replies, requests, close: () => new Promise((ok) => server.close(() => ok())) };
}
