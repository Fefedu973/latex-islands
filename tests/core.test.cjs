const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const diagram = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;

test('detects diagram code without requiring a language hint', () => {
  assert.equal(core.detectKind(diagram), 'tikz');
  assert.equal(core.detectKind('\\draw (0,0)--(1,1);', 'tikz'), 'tikz');
  assert.equal(core.detectKind(String.raw`\documentclass{article}\begin{document}Hello\end{document}`, 'latex'), null);
  assert.equal(core.detectKind(String.raw`\frac{1}{2}`, 'latex'), null);
  assert.equal(core.detectKind('% ' + diagram), null);
  assert.equal(core.detectKind('const source = "' + diagram + '";', 'javascript'), null);
});

test('full document normalization preserves preamble and package options', () => {
  const input = String.raw`\documentclass[border=3pt]{standalone}
\usepackage{tikz}
\usepackage[american]{circuitikz}
\usepackage{pgfplots,amsmath}
\usetikzlibrary{arrows.meta, positioning}
\usetikzlibrary{positioning,calc}
\newcommand{\foo}{A}
\begin{document}
\begin{circuitikz}\draw (0,0) to[R] (2,0);\end{circuitikz}
\end{document} % done`;
  const result = core.normalizeTeX(input);
  assert.deepEqual(result.documentClass, {name:'standalone', options:'border=3pt'});
  assert.deepEqual(result.texPackages, {circuitikz:'american', pgfplots:'', amsmath:''});
  assert.equal(result.tikzLibraries, 'arrows.meta,positioning,calc');
  assert.equal(result.addToPreamble, String.raw`\newcommand{\foo}{A}`);
  assert.equal(result.body, String.raw`\begin{circuitikz}\draw (0,0) to[R] (2,0);\end{circuitikz}`);
});

test('comments do not load packages or split the document', () => {
  const result = core.normalizeTeX('% \\usepackage{evil}\n% \\begin{document}\n' + diagram);
  assert.deepEqual(result.texPackages, {});
  assert.equal(result.preamble, '');
  assert.match(result.body, /% \\begin\{document\}/);
});

test('strips only enclosing diagram wrappers and keeps normal math unchanged', () => {
  for (const [a,b] of [['\\[','\\]'],['\\(','\\)'],['$$','$$']]) assert.equal(core.normalizeTeX(a + diagram + b).body, diagram);
  assert.equal(core.stripFence('\\[x^2\\]'), '\\[x^2\\]');
  assert.equal(core.stripFence('```tikz\n' + diagram + '\n```'), diagram);
});

test('infers packages and wraps bare axis or draw fragments', () => {
  const axis = core.normalizeTeX(String.raw`\begin{axis}\addplot{x};\end{axis}`);
  assert.equal(axis.texPackages.pgfplots, '');
  assert.match(axis.body, /^\\begin\{tikzpicture\}/);
  assert.equal(core.normalizeTeX(String.raw`\begin{tikzcd} A \arrow[r] & B \end{tikzcd}`).texPackages['tikz-cd'], '');
  assert.match(core.normalizeTeX(String.raw`\draw (0,0)--(1,1);`).body, /^\\begin\{tikzpicture\}/);
});

test('splits raw and fenced diagrams while leaving native math untouched', () => {
  const input = 'Texte $x$ \\(y\\) \\[z\\] $$q$$. ' + diagram + '\n```tikz\n' + diagram + '\n```\nFin';
  const parts = core.splitIslands(input);
  assert.equal(parts.filter(x => x.type === 'latex').length, 2);
  assert.equal(parts.map(x => input.slice(x.start, x.end)).join(''), input);
  assert.match(parts[0].value, /\$x\$/);
});

test('does not interpret inline code or an unrelated fenced block as a raw diagram', () => {
  const text = '`' + diagram + '`\n```javascript\nconst text = "' + diagram + '";\n```';
  assert.equal(core.splitIslands(text).filter(x => x.type === 'latex').length, 0);
  assert.equal(core.splitIslands('`' + diagram + '`').filter(x => x.type === 'latex').length, 0);
});

test('incomplete and commented raw environments remain text', () => {
  assert.equal(core.splitIslands(String.raw`\begin{tikzpicture} unfinished`).length, 1);
  assert.equal(core.splitIslands('% ' + diagram)[0].type, 'text');
});

test('detects and auto-loads chemistry and TikZ 3D packages', () => {
  const chem = core.normalizeTeX(String.raw`\chemfig{*6(-=-=-=)}`);
  assert.equal(core.detectKind(String.raw`\chemfig{CH_3-CH_2-OH}`), 'tikz');
  assert.equal(chem.texPackages.chemfig, '');
  const threeD = core.normalizeTeX(String.raw`\tdplotsetmaincoords{70}{110}\begin{tikzpicture}[tdplot_main_coords]\draw (0,0,0)--(1,1,1);\end{tikzpicture}`);
  assert.equal(threeD.texPackages['tikz-3dplot'], '');
});

test('infers common TikZ libraries for natural flowchart output', () => {
  const source = String.raw`\begin{tikzpicture}[node distance=1cm, decision/.style={diamond,draw}, >={Stealth}]
\node (a) {A};\node[decision,below=of a] (b) {B};\draw[->] (a)--(b);\end{tikzpicture}`;
  const normalized = core.normalizeTeX(source);
  const libs = normalized.tikzLibraries.split(',');
  assert.ok(libs.includes('positioning'));
  assert.ok(libs.includes('shapes.geometric'));
  assert.ok(libs.includes('arrows.meta'));
});

test('repairs common Circuitikz labels containing equals signs for rendering', () => {
  const source = String.raw`\begin{circuitikz}\draw (0,0) to[V,l=$E=10\,\mathrm{V}$] (0,3);\end{circuitikz}`;
  const normalized = core.normalizeTeX(source);
  assert.match(normalized.body, /l=\{\$E=10\\,\\mathrm\{V\}\$\}/);
  assert.match(normalized.warnings.join('\n'), /Compatibilité Circuitikz/);
});

test('downgrades unsupported interpolated PGFPlots surface shader for TikZJax', () => {
  const source = String.raw`\begin{tikzpicture}\begin{axis}\addplot3[surf,shader=interp]{x*y};\end{axis}\end{tikzpicture}`;
  const normalized = core.normalizeTeX(source);
  assert.equal(normalized.texPackages.pgfplots, '');
  assert.match(normalized.body, /shader=flat/);
  assert.doesNotMatch(normalized.body, /shader=interp/);
  assert.match(normalized.warnings.join('\n'), /shader=interp/);
});
