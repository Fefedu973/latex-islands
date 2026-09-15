const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const {render}=require('../export-preview-renderer.js');
function harness(t){
  const dom=new JSDOM('<!doctype html><main id="preview"></main>',{url:'https://chatgpt.com',runScripts:'outside-only'});
  t.after(()=>dom.window.close());return {dom,container:dom.window.document.getElementById('preview')};
}

test('preview renders readable headings, paragraphs, emphasis, lists and quotations',t=>{
  const {container}=harness(t);
  render(container,'# Course C#\n\nA **strong** word, *emphasis*, and `x_i`.\nNext line.\n\n- One\n- Two\n\n3. Third\n4. Fourth\n\n> Quoted **text**\n> Second line.\n\n---');
  assert.equal(container.querySelector('h1').textContent,'Course C#');
  assert.equal(container.querySelector('strong').textContent,'strong');assert.equal(container.querySelector('em').textContent,'emphasis');
  assert.equal(container.querySelector('code').textContent,'x_i');assert.match(container.querySelector('p').textContent,/\nNext line\./);
  assert.deepEqual([...container.querySelectorAll('ul li')].map(node=>node.textContent),['One','Two']);
  assert.equal(container.querySelector('ol').start,3);assert.equal(container.querySelectorAll('ol li').length,2);
  assert.equal(container.querySelector('blockquote strong').textContent,'text');assert.ok(container.querySelector('hr'));
});

test('fenced code is literal, has no fence markers, and cannot execute HTML or fetch images',t=>{
  const {container}=harness(t);
  const code='<script>alert("x")</script>\n<img src="https://example.org/private">\n**literal** $x_i$ [bad](javascript:alert)';
  render(container,'````html\n'+code+'\n```\n````');
  assert.equal(container.querySelector('.li-preview-language').textContent,'html');
  assert.equal(container.querySelector('pre code').textContent,code+'\n```');
  assert.equal(container.querySelector('img,script,a,strong,em'),null);
  assert.equal(container.querySelectorAll('code').length,1);
});

test('raw HTML, images, and unsafe links remain text; only explicit HTTP links become anchors',t=>{
  const {container}=harness(t);
  const html='<img src="https://example.org/x" onerror="alert(1)"><script>bad()</script><iframe src="https://example.org/y"></iframe>';
  render(container,html+'\n\n![Image](https://example.org/image.png) [Run](javascript:alert) [Data](data:text/html,bad) [File](file:///secret) [Safe](https://example.org/page?q=one)');
  assert.ok(container.textContent.includes(html));assert.equal(container.querySelector('img,script,iframe,object,style'),null);
  assert.equal(container.querySelectorAll('a').length,1);
  const anchor=container.querySelector('a');assert.equal(anchor.href,'https://example.org/page?q=one');
  assert.equal(anchor.textContent,'Safe');assert.equal(anchor.rel,'noopener noreferrer');assert.equal(anchor.target,'_blank');
  assert.ok(container.textContent.includes('![Image](https://example.org/image.png)'));assert.ok(container.textContent.includes('[Run](javascript:alert)'));
});

test('TeX remains literal in display blocks, inline math and formatted prose',t=>{
  const {container}=harness(t);
  const display='\\[\n\\frac{x_i}{y_j} = **literal**\n\\]';
  const dollars='$$\nx_i * y_i = 2\n$$';
  render(container,'Inline \\(x_i * y_i\\), $a_b$ and **outside $x**y$ intact**.\n\n'+display+'\n\n'+dollars);
  const math=[...container.querySelectorAll('.li-preview-math')].map(node=>node.textContent);
  assert.deepEqual(math,[display,dollars]);assert.equal(container.querySelectorAll('.li-preview-math strong,.li-preview-math em').length,0);
  assert.match(container.querySelector('p').textContent,/\\\(x_i \* y_i\\\), \$a_b\$/);
  assert.equal(container.querySelector('p strong').textContent,'outside $x**y$ intact');
  assert.equal(container.querySelector('p em'),null);
});

test('simple tables support alignment, code with pipes and literal TeX cell content',t=>{
  const {container}=harness(t);
  render(container,'| Value | Meaning |\n| :--- | ---: |\n| `x|y` | **Code** |\n| $x|y$ | \\(a_i * b_i\\) |\n\nAfter table.');
  assert.deepEqual([...container.querySelectorAll('th')].map(node=>node.textContent),['Value','Meaning']);
  assert.equal(container.querySelectorAll('tbody tr').length,2);assert.equal(container.querySelectorAll('tbody td').length,4);
  assert.equal(container.querySelector('td code').textContent,'x|y');assert.equal(container.querySelector('td strong').textContent,'Code');
  assert.equal(container.querySelectorAll('tbody tr')[1].children[0].textContent,'$x|y$');
  assert.equal(container.querySelectorAll('tbody tr')[1].children[1].textContent,'\\(a_i * b_i\\)');
  assert.equal(container.querySelectorAll('th')[1].style.textAlign,'right');assert.equal(container.lastElementChild.textContent,'After table.');
});

test('unclosed code and unknown Markdown retain text, and a second render replaces previous content',t=>{
  const {container}=harness(t);
  render(container,'```text\nunfinished **code**\n\\(x\\)');
  assert.equal(container.querySelector('pre code').textContent,'unfinished **code**\n\\(x\\)');
  render(container,'literal_file_name\n\nText with [unclosed syntax.');
  assert.equal(container.querySelector('pre,code,em'),null);assert.match(container.textContent,/literal_file_name/);assert.match(container.textContent,/\[unclosed syntax/);
});

test('browser bundle exposes the documented dependency-free API',t=>{
  const {dom,container}=harness(t);
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../export-preview-renderer.js'),'utf8'));
  assert.equal(typeof dom.window.LatexIslandsPreview.render,'function');
  dom.window.LatexIslandsPreview.render(container,'## Browser preview');assert.equal(container.querySelector('h2').textContent,'Browser preview');
});
