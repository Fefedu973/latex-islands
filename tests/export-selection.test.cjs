/* SPDX-License-Identifier: GPL-3.0-or-later */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../export-core.js');
const message = (id, role, text, extra = {}) => ({id, author:{role}, content:{content_type:'text',parts:[text]}, ...extra});
const archive = messages => ({title:'Selection', source_url:'https://chatgpt.com/c/example', messages, raw_pages:[{payload:{messages}}]});

test('selection options distinguish all from none and explicit role modes override legacy includeUser', () => {
  assert.equal(core.normalizeOptions().selectedMessageIds, null);
  assert.deepEqual(core.normalizeOptions({selectedMessageIds:[]}).selectedMessageIds, []);
  const ids = ['second', '', null, 'second', 'first'];
  assert.deepEqual(core.normalizeOptions({selectedMessageIds:ids}).selectedMessageIds, ['second','first']);
  assert.deepEqual(ids, ['second','',null,'second','first']);
  assert.equal(core.normalizeOptions({roleMode:'answers',includeUser:true}).includeUser, false);
  assert.equal(core.normalizeOptions({roleMode:'prompts',includeUser:false}).includeUser, true);
  assert.equal(core.normalizeOptions({includeUser:false}).includeUser, false);
  assert.equal(core.normalizeOptions({roleMode:'unknown'}).roleMode, 'conversation');
});

test('strict role modes exclude tool calls and generated tool media while conversation preserves existing options', () => {
  const data = archive([
    message('prompt','user','Question'),
    message('progress','assistant','Searching',{channel:'commentary'}),
    message('call','assistant','Search call',{recipient:'browser'}),
    message('tool','tool','Search results'),
    message('image','tool','',{content:{content_type:'image_asset_pointer',asset_pointer:'file-service://image'}}),
    message('answer','assistant','Answer')
  ]);
  const keys = options => core.buildTranscript(data,options).entries.map(entry=>entry.key);
  assert.deepEqual(keys({}), ['prompt','image','answer']);
  assert.deepEqual(keys({includeTools:true,includeProgress:true}), ['prompt','progress','call','tool','image','answer']);
  assert.deepEqual(keys({roleMode:'answers'}), ['answer']);
  assert.deepEqual(keys({roleMode:'answers',includeTools:true,includeProgress:true}), ['progress','answer']);
  assert.deepEqual(keys({roleMode:'prompts',includeUser:false,includeTools:true,includeProgress:true}), ['prompt']);
  assert.deepEqual(keys({includeUser:false}), ['image','answer']);
});

test('selecting any final fragment keeps the whole grouped response and its IDs', () => {
  const data = archive([
    message('u','user','Prompt'),
    message('first','assistant','First fragment',{metadata:{turn_exchange_id:'turn'}}),
    message('last','assistant','Last fragment',{metadata:{turn_exchange_id:'turn'}}),
    message('other','assistant','Other answer')
  ]);
  for (const id of ['first','last']) {
    const transcript = core.buildTranscript(data,{selectedMessageIds:[id]});
    assert.equal(transcript.messageCount,1); assert.equal(transcript.sourceMessageCount,2); assert.equal(transcript.rawMessageCount,4);
    assert.equal(transcript.entries[0].key,'first');
    assert.equal(transcript.entries[0].text,'First fragment\n\nLast fragment');
    assert.deepEqual(transcript.entries[0].messageIds,['first','last']);
  }
  const ordered = core.buildTranscript(data,{selectedMessageIds:['other','last','u']});
  assert.deepEqual(ordered.entries.map(entry=>entry.key),['u','first','other']);
});

test('role filtering happens after grouping so prompts still separate assistant responses', () => {
  const data = archive([
    message('a','assistant','Before',{metadata:{turn_exchange_id:'reused'}}),
    message('u','user','Intervening prompt'),
    message('b','assistant','After',{metadata:{turn_exchange_id:'reused'}})
  ]);
  for (const options of [{roleMode:'answers'}, {includeUser:false}]) {
    const result = core.buildTranscript(data,options);
    assert.deepEqual(result.entries.map(entry=>entry.messageIds),[['a'],['b']]);
  }
});

test('anonymous keys remain stable across role filters, do not collide with real IDs and select complete groups', () => {
  const data = archive([
    message('anonymous:1','user','Named prompt'),
    message(undefined,'assistant','Anonymous first',{metadata:{turn_exchange_id:'turn'}}),
    message(undefined,'assistant','Anonymous last',{metadata:{turn_exchange_id:'turn'}}),
    message(undefined,'assistant','Independent answer')
  ]);
  const all = core.buildTranscript(data), answers = core.buildTranscript(data,{roleMode:'answers'});
  assert.equal(new Set(all.entries.map(entry=>entry.key)).size,3);
  assert.deepEqual(answers.entries.map(entry=>entry.key),all.entries.slice(1).map(entry=>entry.key));
  assert.deepEqual(answers.entries[0].messageIds,[]);
  const selected = core.buildTranscript(data,{selectedMessageIds:[answers.entries[0].key]});
  assert.equal(selected.entries[0].text,'Anonymous first\n\nAnonymous last');
  assert.equal(selected.sourceMessageCount,2);
});

test('empty, unknown and role-mismatched selections produce empty derivatives without mutating raw JSON', () => {
  const data = archive([message('u','user','Question'),message('a','assistant','Answer')]);
  const before = JSON.stringify(data);
  for (const options of [{selectedMessageIds:[]},{selectedMessageIds:['missing']},{roleMode:'prompts',selectedMessageIds:['a']}]) {
    const transcript = core.buildTranscript(data,options);
    assert.equal(transcript.messageCount,0); assert.equal(transcript.sourceMessageCount,0);
    assert.match(core.toMarkdown(data,options),/No messages match/);
    assert.match(core.toText(data,options),/No messages match/);
  }
  assert.equal(core.buildTranscript(data,{selectedMessageIds:null}).messageCount,2);
  assert.equal(JSON.stringify(data),before);
});

test('refreshed archives cannot reuse an anonymous selection while real IDs remain stable', () => {
  const first = archive([message(undefined,'assistant','Original anonymous answer'),message('known','user','Original prompt')]);
  const refreshed = archive([message(undefined,'assistant','Unrelated anonymous answer'),message('known','user','Updated prompt')]);
  const key = core.buildTranscript(first).entries[0].key;
  assert.equal(core.buildTranscript(first,{roleMode:'answers'}).entries[0].key,key);
  assert.notEqual(core.buildTranscript(refreshed).entries[0].key,key);
  assert.equal(core.buildTranscript(refreshed,{selectedMessageIds:[key]}).messageCount,0);
  const retained = core.buildTranscript(refreshed,{selectedMessageIds:['known']});
  assert.equal(retained.entries[0].key,'known');assert.equal(retained.entries[0].text,'Updated prompt');
  // Even an unusual real ID that equals the generated key cannot shadow it.
  first.messages.push(message(key,'user','Explicit colliding identifier'));
  const entries = core.buildTranscript(first).entries;
  assert.equal(new Set(entries.map(entry=>entry.key)).size,entries.length);
  assert.equal(entries.at(-1).key,key);
});

test('selection respects the selected legacy branch before role and message filters', () => {
  const u=message('u','user','Prompt'), a=message('a','assistant','Chosen'), b=message('b','assistant','Alternative');
  const data={...archive([u,a,b]),raw_pages:[{payload:{current_node:'a',mapping:{u:{message:u,parent:null},a:{message:a,parent:'u'},b:{message:b,parent:'u'}}}}]};
  assert.equal(core.buildTranscript(data,{selectedMessageIds:['b']}).messageCount,0);
  assert.equal(core.buildTranscript(data,{branch:'all',selectedMessageIds:['b']}).entries[0].text,'Alternative');
});
