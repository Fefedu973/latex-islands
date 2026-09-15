/* Synthetic fixtures use the API shape observed in the supplied HAR, never
 * personal messages, cookies, tokens or HAR contents. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../export-core.js');
const ID = '01234567-89ab-4cde-8f01-23456789abcd';
const message = (id, role, text, extra = {}) => ({id, author: {role, name: null, metadata: {}}, content: {content_type: 'text', parts: [text]}, ...extra});
const page = (messages, before, extra = {}) => ({messages, page_info: {start_cursor: before, end_cursor: messages.at(-1)?.id, has_previous_page: !!before, has_next_page: false}, ...extra});
const fixture = () => {
  const system = message('system', 'system', 'System context', {unknown_new_field: {keep: ['all', 0, false, null]}});
  const user = message('user', 'user', 'A question', {metadata: {attachments: [{id: 'file-1', name: 'plot.png'}]}});
  const hidden = message('reason', 'assistant', 'Technical message', {channel: 'analysis', metadata: {is_visually_hidden_from_conversation: true}});
  const tool = message('tool', 'tool', 'Tool result', {recipient: 'python', content: {content_type: 'multimodal_text', parts: ['Result', {content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-2'}]}});
  const answer = message('answer', 'assistant', 'Final **answer** with $x^2$ and a citation marker.');
  return [
    page([tool, answer], 'before-2', {title: 'Fixture conversation', conversation_id: ID, safe_urls: ['https://example.org'], unknown_conversation_flag: {preserve: true}}),
    page([user, hidden, {...tool, metadata: {older_copy: true}}], 'before-1', {page_extension: {cursor_metadata: 123}, page_info: {start_cursor: 'before-1', has_previous_page: true, has_next_page: true}}),
    page([system, user], null)
  ];
};

test('modern API follows every previous cursor and preserves every raw payload and all roles', async () => {
  const pages = fixture(), requests = [], progress = [];
  const archive = await core.collectConversation({id: ID, fetchJSON: async path => { requests.push(path); return pages[requests.length - 1]; }, onProgress: p => progress.push(p), now: () => '2026-09-15T12:00:00Z'});
  assert.deepEqual(requests, [core.pathFor(ID), core.pathFor(ID, 'before-2'), core.pathFor(ID, 'before-1')]);
  assert.deepEqual(progress.map(p => p.messages), [2, 4, 5]);
  assert.deepEqual(archive.messages.map(m => m.id), ['system', 'user', 'reason', 'tool', 'answer']);
  assert.deepEqual(archive.messages.map(m => m.author.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.equal(archive.messages[3], pages[0].messages[0], 'newest duplicate wins in readable list');
  assert.deepEqual(archive.raw_pages.map(p => p.payload), pages, 'older duplicate and unknown metadata remain in raw pages');
  assert.equal(archive.completeness.pagination_complete, true);
  assert.equal(archive.completeness.attachments, 'references_only');
  assert.deepEqual(JSON.parse(JSON.stringify(archive)).raw_pages.map(p => p.payload), pages);
});

test('missing pagination metadata, stalled cursors and an unfinished latest page fail visibly', async () => {
  await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => ({messages: []})}), /Format de réponse/);
  await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => ({messages: [], page_info: {has_previous_page: true}})}), /Curseur/);
  let count = 0;
  await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => { count++; return page([], 'stuck'); }}), /boucle/);
  assert.equal(count, 2, 'stalled API cannot run forever');
  await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => page([], null, {page_info: {has_previous_page: false, has_next_page: true}})}), /derniers messages/);
});

test('pagination failures and limits never produce a success archive', async () => {
  let count = 0;
  await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => { if (++count === 2) throw Object.assign(new Error('Rate limit'), {status: 429}); return fixture()[0]; }}), /Rate limit/);
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(core.collectConversation({id: ID, maxPages: 2, fetchJSON: async () => page([], 'cursor-' + (++count))}), /Limite/);
  assert.equal(count, 2);
});

test('only a missing modern endpoint triggers legacy fallback; legacy preserves the entire mapping', async () => {
  const mapping = {root: {parent: null, children: ['a'], message: null}, a: {parent: 'root', children: ['b', 'branch'], message: message('a', 'user', 'Question', {create_time: 1})}, b: {parent: 'a', children: [], message: message('b', 'assistant', 'Current', {create_time: 3})}, branch: {parent: 'a', children: [], message: message('branch', 'assistant', 'Alternative', {create_time: 2})}};
  const requests = [];
  const archive = await core.collectConversation({id: ID, fetchJSON: async path => { requests.push(path); if (requests.length === 1) throw Object.assign(new Error('Not found'), {status: 404}); return {title: 'Legacy', mapping, current_node: 'b', moderation_results: []}; }});
  assert.equal(requests[1], '/backend-api/conversation/' + ID);
  assert.deepEqual(archive.messages.map(m => m.id), ['a', 'branch', 'b']);
  assert.deepEqual(archive.raw_pages[0].payload.mapping, mapping);
  assert.equal(archive.completeness.scope, 'all_nodes_in_returned_mapping');
  for (const status of [401, 403, 429, 500]) {
    let reads = 0;
    await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => { reads++; throw Object.assign(new Error('Request failed'), {status}); }}), /Request failed/);
    assert.equal(reads, 1);
  }
});

test('input and server conversation IDs are checked before export', async () => {
  let called = false;
  await assert.rejects(core.collectConversation({id: '../../secret', fetchJSON: async () => { called = true; }}), /conversation enregistrée/);
  assert.equal(called, false);
  await assert.rejects(core.collectConversation({id: ID, fetchJSON: async () => page([], null, {conversation_id: 'another'})}), /ne correspond pas/);
  assert.equal(core.conversationId('/c/' + ID), ID);
  assert.equal(core.conversationId('/g/g-example/c/' + ID), ID);
  assert.equal(core.conversationId('/share/' + ID), null);
  assert.equal(core.conversationId('/c/not-a-saved-conversation'), null);
  const path = core.pathFor(ID, 'opaque cursor/with?query&characters');
  assert.equal(new URL(path, 'https://chatgpt.com').searchParams.get('before'), 'opaque cursor/with?query&characters');
});

test('default Markdown is a visible dialogue preserving code and math, without JSON metadata', async () => {
  const pages = fixture();
  pages[0].messages[1].content.parts.push('```mermaid\ngraph TD\nA --> B\n```');
  let index = 0;
  const archive = await core.collectConversation({id: ID, fetchJSON: async () => pages[index++]});
  const markdown = core.toMarkdown(archive);
  assert.match(markdown, /## Vous/);
  assert.match(markdown, /## ChatGPT/);
  assert.doesNotMatch(markdown, /System context|Technical message|Tool result/);
  assert.ok(markdown.includes('Final **answer** with $x^2$'));
  assert.ok(markdown.includes('```mermaid\ngraph TD\nA --> B\n```'));
  assert.match(markdown, /Image générée/);
  assert.match(markdown, /plot\.png/);
  assert.doesNotMatch(markdown, /image_asset_pointer|file-service:|unknown_new_field|is_visually_hidden_from_conversation|<details>|```json/);
  assert.equal(core.buildTranscript(archive).messageCount, 3, 'image-only tool output remains a visible response');
  assert.equal(archive.messages[0].unknown_new_field.keep[0], 'all', 'JSON fidelity is unchanged');
});

test('messages with no ID and unfamiliar content remain available', async () => {
  const unknown = {author: {role: 'future-role'}, content: {future_content_type: {data: [1, 2, 3]}}};
  const archive = await core.collectConversation({id: ID, fetchJSON: async () => page([unknown, unknown, null], null)});
  assert.equal(archive.messages.length, 3);
  assert.doesNotMatch(core.toMarkdown(archive), /future_content_type/);
  assert.deepEqual(archive.messages[0], unknown, 'unknown server fields stay available in the JSON');
  assert.equal(core.fileName('CON', 'json'), '_CON.json');
  assert.equal(core.fileName('A/B:C?D', 'md'), 'A-B-C-D.md');
});

const transcriptArchive = messages => ({title: 'Synthetic transcript', source_url: 'https://chatgpt.com/c/' + ID, messages, raw_pages: []});

test('sample-shaped multimodal turns become a chronological transcript without duplicate image references', () => {
  // This recreates structural edge cases from the user-provided export, using
  // invented content and identifiers only. Never check the private file in.
  const messages = [];
  for (let i = 0; i < 14; i++) {
    const metadata = {turn_exchange_id: 'exchange-' + i};
    messages.push(message('u' + i, 'user', 'Question ' + i, {create_time: 100 + i, metadata: {...metadata}}));
    if (i < 6) {
      messages.at(-1).content = {content_type: 'multimodal_text', parts: [{content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-' + i, width: 640, height: 480}, 'Question ' + i]};
      messages.at(-1).metadata.attachments = [{id: 'file-' + i, name: 'photo-' + i + '.png', mime_type: 'image/png'}];
    }
    messages.push(message('context-' + i, 'assistant', '', {content: {content_type: 'model_editable_context', model_set_context: 'Internal context'}, metadata}));
    messages.push(message('thought-' + i, 'assistant', '', {content: {content_type: 'thoughts', thoughts: [{summary: 'Preparing', content: 'Intermediate step', chunks: [], finished: true}]}, metadata}));
    messages.push(message('recap-' + i, 'assistant', '', {content: {content_type: 'reasoning_recap', content: 'Worked briefly'}, metadata}));
    messages.push(message('empty-tool-' + i, 'tool', '', {content: {content_type: 'multimodal_text', parts: []}, metadata}));
    if (i === 9) {
      messages.push(message('image-' + i, 'tool', '', {author: {role: 'tool', name: 'internal.identifier'}, content: {content_type: 'multimodal_text', parts: [{content_type: 'image_asset_pointer', asset_pointer: 'sediment://generated-file', width: 1024, height: 768, metadata: {dalle: {gen_id: 'opaque'}}}]}, metadata}));
    } else messages.push(message('answer-' + i, 'assistant', 'Answer ' + i, {channel: 'final', create_time: 90 + i, metadata}));
  }
  const archive = transcriptArchive(messages), before = JSON.stringify(archive);
  const transcript = core.buildTranscript(archive), markdown = core.toMarkdown(archive);
  assert.equal(transcript.messageCount, 28);
  assert.equal(transcript.entries.filter(entry => entry.role === 'user').length, 14);
  assert.equal(transcript.entries.filter(entry => entry.role === 'assistant').length, 14);
  assert.equal((markdown.match(/640 × 480 px/g) || []).length, 6);
  assert.equal((markdown.match(/photo-0\.png/g) || []).length, 1, 'part pointer and metadata attachment are one file');
  assert.match(markdown, /Image générée.*1024 × 768 px/);
  assert.doesNotMatch(markdown, /Preparing|Internal context|Worked briefly|sediment:|opaque|internal\.identifier/);
  assert.equal(transcript.entries[0].role, 'user', 'server turn order wins over unreliable create_time');
  assert.equal(transcript.entries[1].text, 'Answer 0');
  assert.equal(JSON.stringify(archive), before, 'derivatives never mutate the raw archive');
});

test('options independently control answers, progress, tools, attachments and UTC timestamps', () => {
  const archive = transcriptArchive([
    message('user', 'user', 'Visible question', {create_time: 0, metadata: {attachments: [{id: 'file-a', name: 'diagram.pdf', url: 'https://example.org/diagram.pdf'}]}}),
    message('analysis', 'assistant', 'Hidden analysis', {channel: 'analysis'}),
    message('progress', 'assistant', 'Searching now', {channel: 'commentary'}),
    message('thought', 'assistant', '', {content: {content_type: 'thoughts', thoughts: [{summary: 'A visible summary', content: 'A visible step'}]}}),
    message('hidden-recap', 'assistant', '', {content: {content_type: 'reasoning_recap', content: 'Do not show'}, metadata: {reasoning_recap_type: 'hide_all'}}),
    message('call', 'assistant', '', {channel: 'analysis', recipient: 'python', content: {content_type: 'code', language: 'python', text: 'print(2)'}}),
    message('tool', 'tool', '2', {author: {role: 'tool', name: 'python'}}),
    message('answer', 'assistant', 'Visible answer', {channel: 'final', create_time: 1789473600})
  ]);
  const defaults = core.toMarkdown(archive);
  assert.match(defaults, /diagram\.pdf/);
  assert.doesNotMatch(defaults, /Searching now|visible summary|print\(2\)|UTC|Hidden analysis|Do not show/);
  const detailed = core.toMarkdown(archive, {includeTools: true, includeProgress: true, timestamps: true});
  assert.match(detailed, /Searching now/);
  assert.match(detailed, /A visible summary/);
  assert.match(detailed, /```python\nprint\(2\)\n```/);
  assert.match(detailed, /Outil · python/);
  assert.match(detailed, /1970-01-01 00:00:00 UTC/);
  assert.doesNotMatch(detailed, /Hidden analysis|Do not show/);
  assert.doesNotMatch(core.toMarkdown(archive, {includeAttachments: false}), /diagram\.pdf/);
  const answers = core.toMarkdown(archive, {includeUser: false});
  assert.doesNotMatch(answers, /## Vous|Visible question|diagram\.pdf/);
  assert.match(answers, /Visible answer/);
});

test('legacy transcript follows current_node ancestry instead of combining alternative answers', () => {
  const a = message('a', 'user', 'Question'), b = message('b', 'assistant', 'Selected answer'), c = message('c', 'assistant', 'Alternative answer');
  const archive = {...transcriptArchive([a, c, b]), raw_pages: [{payload: {current_node: 'b', mapping: {root: {message: null, parent: null}, a: {message: a, parent: 'root'}, b: {message: b, parent: 'a'}, c: {message: c, parent: 'a'}}}}]};
  assert.doesNotMatch(core.toMarkdown(archive), /Alternative answer/);
  assert.match(core.toMarkdown(archive), /Selected answer/);
  assert.match(core.toMarkdown(archive, {branch: 'all'}), /Alternative answer/);
  assert.equal(archive.messages.length, 3);
});

test('consecutive final fragments merge only within the same exchange, never by reused turn_id', () => {
  const archive = transcriptArchive([
    message('a', 'assistant', 'First part', {metadata: {turn_exchange_id: 'one'}}),
    message('b', 'assistant', 'Second part', {metadata: {turn_exchange_id: 'one'}}),
    message('u', 'user', 'Next question', {metadata: {turn_id: 'reused'}}),
    message('c', 'assistant', 'Next response', {metadata: {turn_id: 'reused'}})
  ]);
  const entries = core.buildTranscript(archive).entries;
  assert.equal(entries.length, 3);
  assert.equal(entries[0].text, 'First part\n\nSecond part');
  assert.deepEqual(entries[0].messageIds, ['a', 'b']);
  assert.equal(entries[2].text, 'Next response');
});

test('citations resolve to readable safe links, including nested refs and sources without markers', () => {
  const marker = '\uE200cite\uE202turn0search1\uE201';
  const archive = transcriptArchive([message('a', 'assistant', 'A sourced claim. ' + marker, {metadata: {
    content_references: [{matched_text: marker, items: [{title: 'Paper', url: 'https://example.org/paper(1)', refs: [{turn_index: 0, ref_type: 'search', ref_index: 1}]}]}],
    citations: [{citation: {title: 'Further reading', url: 'https://example.org/reading'}}, {title: 'Unsafe', url: 'javascript:alert(1)'}]
  }})]);
  const markdown = core.toMarkdown(archive);
  assert.match(markdown, /A sourced claim\. \[Paper\]\(https:\/\/example.org\/paper%281%29\)/);
  assert.match(markdown, /\*\*Sources\*\*/);
  assert.match(markdown, /\[Further reading\]\(https:\/\/example.org\/reading\)/);
  assert.doesNotMatch(markdown, /\uE200|Unsafe|javascript:/);
  const withoutSources = core.toMarkdown(archive, {includeSources: false});
  assert.match(withoutSources, /A sourced claim/);
  assert.doesNotMatch(withoutSources, /Paper|Further reading|\uE200/);
});

test('search-group lookup, unresolved citations and entities render without opaque display tokens', () => {
  const archive = transcriptArchive([message('a', 'assistant', '\uE200cite\uE202turn7search2\uE201 Unknown \uE200cite\uE202turn8search0\uE201 \uE200entity\uE202["city","Paris","France"]\uE201', {metadata: {search_result_groups: [{entries: [{ref_id: 'turn7search2', title: 'Known page', url: 'https://example.org/known'}]}]}})]);
  const markdown = core.toMarkdown(archive);
  assert.match(markdown, /\[Known page\]\(https:\/\/example.org\/known\)/);
  assert.match(markdown, /source non disponible dans l’export/);
  assert.match(markdown, /Paris/);
  assert.doesNotMatch(markdown, /\uE200|turn7|turn8/);
});

test('citations never alter literal fenced code, inline code or TeX', () => {
  const token = '\uE200cite\uE202turn1search0\uE201';
  const body = '~~~text\n' + token + '\n~~~\n\n`' + token + '`\n\n\\[' + token + '\\]\n\nProse ' + token;
  const markdown = core.toMarkdown(transcriptArchive([message('a', 'assistant', body)]));
  assert.ok(markdown.includes('~~~text\n' + token + '\n~~~'));
  assert.ok(markdown.includes('`' + token + '`'));
  assert.ok(markdown.includes('\\[' + token + '\\]'));
  assert.match(markdown, /Prose \[source non disponible/);
});

test('plain text retains equations and code while removing conversational Markdown decoration', () => {
  const tex = '\\[\n\\frac{x_i}{y_j} = 2 \\quad \\text{value}\n\\]';
  const code = 'const x_i = "**literal**";\nconsole.log(x_i);';
  const archive = transcriptArchive([message('a', 'assistant', '### A heading\n\n**Bold** and *emphasis*, `inline_code`. [Source](https://example.org)\n\n' + tex + '\n\n$z_i$\n\n````js\n' + code + '\n````')]);
  const text = core.toText(archive);
  assert.ok(text.includes(tex));
  assert.ok(text.includes(code));
  assert.ok(text.includes('$z_i$'));
  assert.match(text, /Bold and emphasis, inline_code\. Source \(https:\/\/example.org\)/);
  assert.doesNotMatch(text, /###|````|\*\*Bold\*\*/);
});

test('structured audio and unsupported rich content use readable labels without dumping objects', () => {
  const archive = transcriptArchive([
    message('u', 'user', '', {content: {content_type: 'multimodal_text', parts: [{content_type: 'audio', asset_pointer: 'file-service://audio-a', transcription: 'Spoken question'}, {content_type: 'future_widget', configuration: {secret: 'do not print'}}]}}),
    message('a', 'assistant', '', {content: {content_type: 'code', language: 'json', text: '{"requestedCode": true, "example": "```"}'}})
  ]);
  const markdown = core.toMarkdown(archive);
  assert.match(markdown, /Spoken question/);
  assert.match(markdown, /Audio joint/);
  assert.match(markdown, /future\\_widget/);
  assert.doesNotMatch(markdown, /file-service:|configuration|do not print/);
  assert.match(markdown, /````json\n\{"requestedCode": true/, 'JSON explicitly written as conversation code remains intact');
});

test('text_audio keeps its transcript and media reference, with media independently switchable', () => {
  const archive = transcriptArchive([message('audio', 'assistant', '', {content: {content_type: 'text_audio', text: 'Spoken answer', audio: {content_type: 'audio', asset_pointer: 'file-service://audio-1'}}})]);
  assert.match(core.toMarkdown(archive), /Spoken answer/);
  assert.match(core.toMarkdown(archive), /Audio joint/);
  assert.doesNotMatch(core.toMarkdown(archive, {includeAttachments: false}), /Audio joint/);
  assert.match(core.toMarkdown(archive, {includeAttachments: false}), /Spoken answer/);
});

test('empty filters and malformed optional fields produce readable output, not exceptions', () => {
  const archive = transcriptArchive([null, 3, message('a', 'assistant', '', {content: null}), message('b', 'user', 'Question', {create_time: 'invalid', metadata: {attachments: [null]}})]);
  assert.match(core.toMarkdown(archive, {includeUser: false}), /Aucun message/);
  assert.match(core.toText(archive, {includeUser: false}), /Aucun message/);
  assert.doesNotMatch(core.toMarkdown(archive, {timestamps: true}), /Invalid Date/);
  assert.deepEqual(core.normalizeOptions(null), core.DEFAULT_OPTIONS);
});
