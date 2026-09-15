/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LatexIslandsExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function conversationId(pathname) {
    const match = String(pathname).match(/(?:^|\/)c\/([^/]+)\/?$/);
    return match && ID.test(match[1]) ? match[1] : null;
  }
  function pathFor(id, cursor) {
    if (!ID.test(id)) throw new Error('Identifiant de conversation invalide.');
    const query = new URLSearchParams({include_has_versions: 'true', num_turns: '10'});
    if (cursor != null) query.set('before', cursor);
    return '/backend-api/conversations/' + id + (cursor == null ? '' : '/messages') + '?' + query;
  }
  function assertPage(payload, first) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages) ||
        !payload.page_info || typeof payload.page_info.has_previous_page !== 'boolean') {
      throw new Error('Format de réponse ChatGPT non reconnu. Export arrêté pour éviter un fichier incomplet.');
    }
    if (first && payload.page_info.has_next_page === true) {
      throw new Error('ChatGPT n’a pas renvoyé les derniers messages. Rechargez la conversation puis réessayez.');
    }
    if (payload.page_info.has_previous_page &&
        (typeof payload.page_info.start_cursor !== 'string' || !payload.page_info.start_cursor || payload.page_info.start_cursor.length > 512)) {
      throw new Error('Curseur de pagination absent ou invalide. Export incomplet, téléchargement annulé.');
    }
  }
  function mergeMessages(pages) {
    // Pages arrive newest first. Keep the newest copy of an overlapping message,
    // but keep all original versions and unknown fields in raw_pages.
    const newest = new Map();
    for (const page of pages) for (const message of page.payload.messages) {
      if (message && typeof message.id === 'string' && !newest.has(message.id)) newest.set(message.id, message);
    }
    const seen = new Set(), messages = [];
    for (const page of [...pages].reverse()) for (const message of page.payload.messages) {
      if (message && typeof message.id === 'string') {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        messages.push(newest.get(message.id));
      } else messages.push(message);
    }
    return messages;
  }
  function legacyMessages(payload) {
    const nodes = Object.values(payload.mapping);
    // Preserve every branch. Stable chronological order is only a reading aid;
    // parent/child topology remains intact in the original mapping in raw_pages.
    return nodes.map((node, index) => ({message: node && node.message, index}))
      .filter(item => item.message != null)
      .sort((a, b) => (Number(a.message.create_time) || 0) - (Number(b.message.create_time) || 0) || a.index - b.index)
      .map(item => item.message);
  }
  async function collectConversation({id, fetchJSON, onProgress = () => {}, maxPages = 500, now = () => new Date().toISOString()}) {
    if (!ID.test(id)) throw new Error('Ouvrez une conversation enregistrée pour l’exporter.');
    if (typeof fetchJSON !== 'function') throw new Error('Transport indisponible.');
    const rawPages = [];
    let path = pathFor(id), payload, legacy = false;
    try { payload = await fetchJSON(path); }
    catch (error) {
      if (error.status !== 404 && error.status !== 405) throw error;
      path = '/backend-api/conversation/' + id;
      payload = await fetchJSON(path);
      legacy = true;
    }
    if (payload && payload.mapping && typeof payload.mapping === 'object' && !Array.isArray(payload.mapping)) legacy = true;
    if (legacy && (!payload || !payload.mapping || typeof payload.mapping !== 'object' || Array.isArray(payload.mapping))) {
      throw new Error('Format de conversation non reconnu. Aucun export incomplet n’a été téléchargé.');
    }
    const reportedId = payload && (payload.conversation_id || payload.id);
    if (reportedId && reportedId !== id) throw new Error('La réponse ne correspond pas à la conversation demandée.');
    const cursors = new Set(), messageIds = new Set();
    let anonymousMessages = 0;
    while (true) {
      if (!legacy) assertPage(payload, rawPages.length === 0);
      rawPages.push({path, fetched_at: now(), payload});
      if (!legacy) for (const message of payload.messages) {
        if (message && typeof message.id === 'string') messageIds.add(message.id);
        else anonymousMessages++;
      }
      onProgress({pages: rawPages.length, messages: legacy ? legacyMessages(payload).length : messageIds.size + anonymousMessages});
      if (legacy || !payload.page_info.has_previous_page) break;
      if (rawPages.length >= maxPages) throw new Error('Limite de pagination atteinte. Export incomplet, téléchargement annulé.');
      const cursor = payload.page_info.start_cursor;
      if (cursors.has(cursor)) throw new Error('La pagination ChatGPT tourne en boucle. Export incomplet, téléchargement annulé.');
      cursors.add(cursor);
      path = pathFor(id, cursor);
      payload = await fetchJSON(path);
    }
    const conversation = rawPages[0].payload;
    const messages = legacy ? legacyMessages(conversation) : mergeMessages(rawPages);
    return {
      format: 'latex-islands-conversation', format_version: 1, exported_at: now(),
      conversation_id: id, title: conversation.title || 'Conversation ChatGPT',
      source_url: 'https://chatgpt.com/c/' + id,
      completeness: {
        pagination_complete: true, pages: rawPages.length, messages: messages.length,
        scope: legacy ? 'all_nodes_in_returned_mapping' : 'all_pages_of_current_server_conversation',
        attachments: 'references_only',
        note: 'Le JSON conserve tous les champs renvoyés. Les fichiers joints et les versions non renvoyées par le serveur ne sont pas téléchargés.'
      },
      messages, raw_pages: rawPages
    };
  }
  function fence(value, language = '') {
    const text = String(value), matches = text.match(/`+/g) || [];
    const marker = '`'.repeat(Math.max(3, ...matches.map(run => run.length + 1)));
    return marker + language + '\n' + text + '\n' + marker;
  }
  function inline(value) { return String(value).replace(/[\\`*_[\]<>#]/g, '\\$&').replace(/[\r\n]+/g, ' '); }
  const DEFAULT_OPTIONS = Object.freeze({
    includeUser: true, includeTools: false, includeProgress: false,
    includeAttachments: true, includeSources: true, timestamps: false, branch: 'current'
  });
  function normalizeOptions(options = {}) {
    if (!options || typeof options !== 'object') options = {};
    const result = {...DEFAULT_OPTIONS};
    for (const key of Object.keys(result)) if (typeof result[key] === 'boolean' && typeof options[key] === 'boolean') result[key] = options[key];
    result.branch = options.branch === 'all' ? 'all' : 'current';
    return result;
  }
  function safeURL(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href.replace(/[()<>]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) : '';
    } catch { return ''; }
  }
  function link(title, url) { return '[' + inline(title) + '](' + url + ')'; }
  function timestamp(value) {
    if (value == null || value === '') return '';
    const milliseconds = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : value;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '';
  }
  function selectedMessages(archive, options) {
    const messages = Array.isArray(archive.messages) ? archive.messages : [];
    const payload = archive.raw_pages?.find(page => page.payload?.mapping)?.payload;
    if (!payload || options.branch === 'all' || !payload.mapping[payload.current_node]) return messages;
    // Native legacy exports contain sibling answers as well. Follow the selected
    // path instead of interleaving alternatives by their wall-clock timestamps.
    const path = [], seen = new Set();
    let id = payload.current_node;
    while (id != null && payload.mapping[id] && !seen.has(id)) {
      seen.add(id);
      const node = payload.mapping[id];
      if (node.message) path.push(node.message);
      id = node.parent;
    }
    return path.reverse();
  }
  function referenceIds(value) {
    if (typeof value === 'string') return [value];
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(referenceIds);
    const result = [];
    for (const key of ['ref_id', 'reference_id', 'citation_id', 'id', 'refs', 'ref_ids']) {
      if (value[key] != null && value[key] !== value) result.push(...referenceIds(value[key]));
    }
    if (value.turn_index != null && value.ref_index != null && typeof value.ref_type === 'string') {
      result.push('turn' + value.turn_index + value.ref_type + value.ref_index);
    }
    return result;
  }
  function sourceIndex(metadata) {
    const ids = new Map(), markers = new Map(), listed = new Map();
    function walk(value, inheritedIds = [], inheritedMarker = '', primary = false, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 8) return [];
      if (Array.isArray(value)) return value.flatMap(item => walk(item, inheritedIds, inheritedMarker, primary, depth + 1));
      const refs = [...inheritedIds, ...referenceIds(value)];
      const marker = typeof value.matched_text === 'string' ? value.matched_text : inheritedMarker;
      const url = safeURL(value.url || value.source_url || value.link || value.web_url);
      const found = [];
      if (url) {
        const source = {url, title: typeof value.title === 'string' && value.title.trim() ? value.title : new URL(url).hostname};
        found.push(source);
        for (const ref of refs) if (typeof ref === 'string') ids.set(ref, source);
        if (primary) listed.set(url, source);
      }
      for (const key of ['citation', 'sources', 'items', 'entries', 'results', 'metadata', 'content_references', 'citations']) {
        if (value[key] && typeof value[key] === 'object') found.push(...walk(value[key], refs, marker, primary, depth + 1));
      }
      if (marker && /[\uE200-\uE2FF]/.test(marker) && found.length) markers.set(marker, found);
      return found;
    }
    walk(metadata.content_references, [], '', true);
    walk(metadata.citations, [], '', true);
    walk(metadata.search_result_groups);
    return {ids, markers, listed};
  }
  function protectedMarkdown(markdown, stripCodeFences = false) {
    const saved = [];
    let prefix = '\u0000LI';
    while (markdown.includes(prefix)) prefix += '_';
    function save(value) { return prefix + (saved.push(value) - 1) + '\u0000'; }
    const lines = markdown.split('\n'), output = [];
    for (let index = 0; index < lines.length; index++) {
      const start = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!start || (start[1][0] === '`' && start[2].includes('`'))) { output.push(lines[index]); continue; }
      const block = [lines[index]], marker = start[1];
      let closed = false;
      while (++index < lines.length) {
        block.push(lines[index]);
        const end = lines[index].match(/^ {0,3}(`+|~+)[ \t]*$/);
        if (end && end[1][0] === marker[0] && end[1].length >= marker.length) { closed = true; break; }
      }
      output.push(save(stripCodeFences ? block.slice(1, closed ? -1 : undefined).join('\n') : block.join('\n')));
    }
    let text = output.join('\n');
    text = text.replace(/(`+)([^`\n]*?)\1/g, (whole, _, code) => save(stripCodeFences ? code : whole));
    text = text.replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\s)[^$\n]+?\$/g, save);
    return {text, restore(value) {
      for (let index = saved.length - 1; index >= 0; index--) value = value.split(prefix + index + '\u0000').join(saved[index]);
      return value;
    }};
  }
  function replaceReferences(text, metadata, options) {
    const index = sourceIndex(metadata), used = new Map();
    function render(sources) {
      const distinct = [...new Map(sources.map(source => [source.url, source])).values()];
      for (const source of distinct) used.set(source.url, source);
      return options.includeSources ? distinct.map(source => link(source.title, source.url)).join(', ') : '';
    }
    // These are display tokens, not Markdown; never rewrite normal code/math.
    const protectedText = protectedMarkdown(text);
    let output = protectedText.text;
    for (const [marker, sources] of index.markers) {
      if (output.includes(marker)) output = output.split(marker).join(render(sources));
    }
    output = output.replace(/\uE200(?:cite|filecite)\uE202([^\uE201]*)\uE201/g, (_, body) => {
      const sources = body.split('\uE202').map(ref => index.ids.get(ref)).filter(Boolean);
      if (sources.length) return render(sources);
      return options.includeSources ? '[source non disponible dans l’export]' : '';
    });
    // Entity annotations contain a plain display name as their second field.
    output = output.replace(/\uE200entity\uE202([^\uE201]*)\uE201/g, (_, body) => {
      try { const fields = JSON.parse(body); return typeof fields[1] === 'string' ? fields[1] : ''; } catch { return ''; }
    });
    output = output.replace(/\uE200[^\uE201]*\uE201/g, '');
    output = protectedText.restore(output);
    if (options.includeSources) {
      const remaining = [...index.listed.values()].filter(source => !used.has(source.url) && !output.includes(source.url));
      if (remaining.length) output += '\n\n**Sources**\n\n' + remaining.map(source => '- ' + link(source.title, source.url)).join('\n');
    }
    return output;
  }
  function assetId(value) {
    return typeof value === 'string' ? value.replace(/^(?:sediment|file-service):\/\//, '').split(/[/?#]/)[0] : '';
  }
  function attachmentKind(value) {
    const type = String(value.content_type || ''), mime = String(value.mime_type || '');
    if (/image/.test(type) || mime.startsWith('image/')) return 'Image';
    if (/audio/.test(type) || mime.startsWith('audio/')) return 'Audio';
    if (/video/.test(type) || mime.startsWith('video/')) return 'Vidéo';
    return 'Fichier';
  }
  function isAsset(value) {
    return value && typeof value === 'object' && (value.asset_pointer || /^(?:image_asset_pointer|audio|audio_asset_pointer|video|video_asset_pointer|file|file_asset_pointer|input_audio|input_audio_perception|audio_perception)$/.test(value.content_type || ''));
  }
  function attachmentText(part, state) {
    if (!state.options.includeAttachments) return '';
    const id = assetId(part.asset_pointer || part.id || part.file_id);
    const attached = state.attachments.find(item => assetId(item.id || item.file_id || item.asset_pointer) === id && id);
    const value = {...part, ...attached};
    const key = id || value.name || value.url || part;
    if (state.seenAssets.has(key)) return '';
    state.seenAssets.add(key);
    const kind = attachmentKind(value);
    const name = typeof value.name === 'string' ? value.name : typeof value.filename === 'string' ? value.filename : '';
    const url = safeURL(value.url || value.download_url || value.asset_pointer_link || part.metadata?.asset_pointer_link || part.asset_pointer);
    const dimensions = Number(value.width) > 0 && Number(value.height) > 0 ? ' · ' + Number(value.width) + ' × ' + Number(value.height) + ' px' : '';
    const feminine = kind === 'Image' || kind === 'Vidéo';
    const title = kind + (name ? ' : ' + name : state.role === 'tool' ? feminine ? ' générée' : ' généré' : feminine ? ' jointe' : ' joint');
    return '> ' + (url ? link(title, url) : '**' + inline(title) + '**') + dimensions + (url ? '' : ' — fichier non intégré à l’export.');
  }
  function partText(part, state, depth = 0) {
    if (typeof part === 'string') return part;
    if (part == null || depth > 8) return '';
    if (Array.isArray(part)) return part.map(item => partText(item, state, depth + 1)).filter(Boolean).join('\n\n');
    if (typeof part !== 'object') return '';
    const type = part.content_type || '';
    if (/^(?:model_editable_context|user_editable_context|computer_initialize_state|system_error)$/.test(type)) return '';
    if (isAsset(part)) {
      const text = typeof part.text === 'string' ? part.text : typeof part.transcription === 'string' ? part.transcription : '';
      const nested = part.audio || part.video;
      return [text, nested && isAsset(nested) ? attachmentText({...part, ...nested}, state) : attachmentText(part, state)].filter(Boolean).join('\n\n');
    }
    if (type === 'thoughts') {
      if (!state.options.includeProgress) return '';
      return (Array.isArray(part.thoughts) ? part.thoughts : []).map(thought => {
        if (!thought || typeof thought !== 'object') return '';
        return [typeof thought.summary === 'string' && thought.summary.trim() ? '**' + inline(thought.summary) + '**' : '', typeof thought.content === 'string' ? thought.content : ''].filter(Boolean).join('\n\n');
      }).filter(Boolean).join('\n\n');
    }
    if (type === 'reasoning_recap') return state.options.includeProgress && typeof part.content === 'string' ? part.content : '';
    if (type === 'code' && typeof part.text === 'string') return fence(part.text, /^[a-z0-9_+-]+$/i.test(part.language || '') ? part.language : '');
    if (Array.isArray(part.parts)) return partText(part.parts, state, depth + 1);
    if (type === 'text_audio') return [partText(part.text, state, depth + 1), partText(part.audio, state, depth + 1)].filter(Boolean).join('\n\n');
    if (typeof part.text === 'string') return part.text;
    if (typeof part.transcription === 'string') return part.transcription;
    if (!state.options.includeAttachments) return '';
    return '> Contenu ' + (type ? '« ' + inline(type) + ' » ' : '') + 'disponible dans l’archive JSON.';
  }
  function mediaParts(content) {
    if (!content || typeof content !== 'object') return [];
    if (isAsset(content)) return [content];
    if (content.content_type === 'text_audio') return mediaParts(content.audio);
    return Array.isArray(content.parts) ? content.parts.flatMap(mediaParts) : [];
  }
  function messageKind(message, options) {
    const role = message.author?.role, metadata = message.metadata || {}, type = message.content?.content_type;
    if (metadata.is_visually_hidden_from_conversation) return '';
    if (type === 'reasoning_recap' && metadata.reasoning_recap_type === 'hide_all') return '';
    if (/^(?:model_editable_context|user_editable_context|computer_initialize_state)$/.test(type || '')) return '';
    if (role === 'assistant' && message.recipient && message.recipient !== 'all') return options.includeTools ? 'call' : '';
    if (/^(?:analysis|justify|confidence)$/.test(message.channel || '')) return '';
    if (role === 'user') return options.includeUser ? 'user' : '';
    if (role === 'tool') return options.includeTools ? 'tool' : options.includeAttachments && mediaParts(message.content).length ? 'media' : '';
    if (role !== 'assistant') return '';
    if (/^(?:thoughts|reasoning_recap)$/.test(type || '') || /^(?:commentary|notification|summary)$/.test(message.channel || '')) return options.includeProgress ? 'progress' : '';
    return !message.channel || message.channel === 'final' ? 'assistant' : '';
  }
  function buildTranscript(archive, inputOptions = {}) {
    const options = normalizeOptions(inputOptions), entries = [];
    let sourceMessageCount = 0;
    for (const message of selectedMessages(archive, options)) {
      if (!message || typeof message !== 'object') continue;
      const kind = messageKind(message, options);
      if (!kind) continue;
      const role = message.author?.role, metadata = message.metadata || {};
      const state = {role, options, attachments: Array.isArray(metadata.attachments) ? metadata.attachments.filter(item => item && typeof item === 'object') : [], seenAssets: new Set()};
      const content = kind === 'media' ? mediaParts(message.content) : message.content;
      let text = partText(content, state);
      for (const attachment of state.attachments) {
        const reference = attachmentText(attachment, state);
        if (reference) text += (text ? '\n\n' : '') + reference;
      }
      // Applying citation cleanup only to prose avoids changing example tokens
      // inside fenced code, which must remain byte-for-byte reproducible.
      text = replaceReferences(text, metadata, options).trim();
      if (!text) continue;
      sourceMessageCount++;
      const label = kind === 'user' ? 'Vous' : kind === 'tool' ? 'Outil' + (message.author?.name ? ' · ' + message.author.name : '') : kind === 'call' ? 'ChatGPT · Appel à ' + message.recipient : kind === 'progress' ? 'ChatGPT · Étape intermédiaire' : 'ChatGPT';
      const turn = metadata.turn_exchange_id || metadata.working_turn_id || '';
      const previous = entries.at(-1);
      // Consecutive pieces of a single assistant turn form one response. A
      // turn_id alone is insufficient: asynchronous tool runs can reuse it.
      if (turn && previous && previous.turn === turn && previous.kind === kind && kind === 'assistant') {
        previous.text += '\n\n' + text;
        if (message.id) previous.messageIds.push(message.id);
      } else {
        entries.push({role: kind === 'media' ? 'assistant' : role, label, text, timestamp: options.timestamps ? timestamp(message.create_time) : '', messageIds: message.id ? [message.id] : [], kind, turn});
      }
    }
    return {title: String(archive.title || 'Conversation ChatGPT'), sourceUrl: safeURL(archive.source_url), entries, messageCount: entries.length, sourceMessageCount, rawMessageCount: Array.isArray(archive.messages) ? archive.messages.length : 0};
  }
  function toMarkdown(archive, options = {}) {
    const transcript = buildTranscript(archive, options), lines = ['# ' + inline(transcript.title), ''];
    if (transcript.sourceUrl) lines.push(link('Conversation originale', transcript.sourceUrl), '');
    for (const entry of transcript.entries) {
      lines.push('---', '', '## ' + inline(entry.label), '');
      if (entry.timestamp) lines.push('*' + entry.timestamp + '*', '');
      lines.push(entry.text, '');
    }
    if (!transcript.entries.length) lines.push('_Aucun message ne correspond aux options choisies._', '');
    return lines.join('\n');
  }
  function plainText(markdown) {
    // Protect code and TeX before removing presentational Markdown. In
    // particular, underscores in x_i and backslashes in \\frac must survive.
    const protectedText = protectedMarkdown(markdown, true);
    let text = protectedText.text;
    text = text.replace(/!?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, title, url) => title + ' (' + url + ')');
    text = text.replace(/^ {0,3}#{1,6}\s+/gm, '').replace(/^ {0,3}> ?/gm, '');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1').replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1');
    text = text.replace(/\\([`*_[\]<>#])/g, '$1');
    return protectedText.restore(text);
  }
  function toText(archive, options = {}) {
    const transcript = buildTranscript(archive, options), lines = [transcript.title, ''];
    if (transcript.sourceUrl) lines.push('Conversation originale : ' + transcript.sourceUrl, '');
    for (const entry of transcript.entries) {
      lines.push('────────────────────────────────────────', '', entry.label + (entry.timestamp ? ' · ' + entry.timestamp : ''), '', plainText(entry.text), '');
    }
    if (!transcript.entries.length) lines.push('Aucun message ne correspond aux options choisies.', '');
    return lines.join('\n');
  }
  function fileName(title, extension) {
    const base = String(title || 'conversation').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100) || 'conversation';
    return (/^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(base) ? '_' : '') + base + '.' + extension;
  }
  return {conversationId, pathFor, collectConversation, mergeMessages, DEFAULT_OPTIONS, normalizeOptions, buildTranscript, toMarkdown, toText, fileName};
});
