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

test('loads math text support for diagram labels and preamble macros', () => {
  for (const label of ['charge', 'réseau compliqué']) {
    const source = String.raw`\begin{circuitikz}\draw (0,0) to[generic,l=$\text{${label}}$] (3,0);\end{circuitikz}`;
    const result = core.normalizeTeX(source);
    assert.deepEqual(result.texPackages, {amstext:'', circuitikz:''});
    assert.equal(result.body, source);
  }
  const result = core.normalizeTeX(String.raw`\documentclass{standalone}
\newcommand{\labeltext}{\text{charge}}
\begin{document}\begin{tikzpicture}\node {$\labeltext$};\end{tikzpicture}\end{document}`);
  assert.equal(result.texPackages.amstext, '');
  assert.equal(result.addToPreamble, String.raw`\newcommand{\labeltext}{\text{charge}}`);
});

test('math text inference preserves explicit AMS packages and options', () => {
  const body = String.raw`\begin{tikzpicture}\node {$\text{charge}$};\end{tikzpicture}`;
  for (const [name, options] of [['amsmath', 'fleqn'], ['amstext', '']]) {
    const result = core.normalizeTeX(`\\usepackage[${options}]{${name}}\n` + body);
    assert.deepEqual(result.texPackages, {[name]:options});
    assert.equal(result.body, body);
  }
});

test('comments, escaped commands and other text commands do not load amstext', () => {
  const source = String.raw`% \text{ignored}
\begin{tikzpicture}
\node[align=center,text width=\textwidth] {line\\text{literal} \textbf{bold} \textit{italic} \textnormal{normal}};
\end{tikzpicture}`;
  assert.deepEqual(core.normalizeTeX(source).texPackages, {});
});

test('infers mathematical and scientific dependencies from real command tokens', () => {
  const expressions = [
    ['amsmath', String.raw`\dfrac{1}{2}+\binom{n}{k}+\operatorname{tr}(A)`],
    ['amsmath', String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`],
    ['amsfonts', String.raw`\mathbb{R}+\mathfrak{g}`],
    ['amssymb', String.raw`\nexists x\lesssim y\in\mathbb{R}`],
    ['mathtools', String.raw`x\coloneqq\mathclap{y}`],
    ['mathtools', String.raw`\begin{pmatrix*}[r]1&2\end{pmatrix*}`],
    ['bm', String.raw`\bm{v}`],
    ['mhchem', String.raw`\ce{2 H2 + O2 -> 2 H2O}`],
    ['siunitx', String.raw`\SI{10}{\kilo\ohm}`],
    ['siunitx', String.raw`\qty[per-mode=symbol]{5}{\metre\per\second}`],
    ['physics', String.raw`\dv{x}{t}+\qty(x+1)`],
    ['array', String.raw`\begin{array}{>{\displaystyle}c}x\end{array}`]
  ];
  for (const [pkg, expression] of expressions) {
    const result = core.normalizeTeX(String.raw`\begin{tikzpicture}\node {$${expression}$};\end{tikzpicture}`);
    assert.deepEqual(result.texPackages, pkg === 'siunitx' ? {siunitx:'','latex-islands-siunitx':''} : {[pkg]:''}, expression);
  }
  const cancelled = core.normalizeTeX(String.raw`\node {$\cancel{x}$};`);
  assert.deepEqual(Object.keys(cancelled.texPackages), ['cancel','latex-islands-cancel']);
});

test('inference ignores comments, escaped tokens, verbatim text and user-defined commands', () => {
  const source = String.raw`\newcommand{\bm}[1]{#1}
\DeclarePairedDelimiter{\norm}{\lVert}{\rVert}
\begin{tikzpicture}
% \ce{H2O} \SI{1}{\metre} \pdv{x}{y}
\node[align=center] {line\\bm and \verb|\cancel{x}\ce{H2O}|};
\node at (0,1) {$\bm{v}+\norm{x}$};
\end{tikzpicture}`;
  const result = core.normalizeTeX(source);
  assert.deepEqual(result.texPackages, {mathtools:''});
  assert.match(result.preamble, /DeclarePairedDelimiter/);
  assert.match(result.body, /\\bm\{v\}/);
});

test('moves fragment declarations into the preamble without splitting nested macro bodies', () => {
  const prefix = String.raw`\newcommand{\smallpicture}{\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}}
\DeclareMathOperator*{\argmax}{arg\,max}
\definecolor{highlight}{RGB}{10,30,90}`;
  const body = String.raw`\begin{tikzpicture}\node {$\argmax_x f(x)$};\end{tikzpicture}`;
  const result = core.normalizeTeX(prefix + '\n' + body);
  assert.equal(result.preamble, prefix);
  assert.equal(result.body, body);
  assert.equal(result.texPackages.amsmath, '');
  const bare = core.normalizeTeX(String.raw`\DeclareMathOperator{\tr}{tr}\node {$\tr(A)$};`);
  assert.match(bare.addToPreamble, /DeclareMathOperator/);
  assert.equal(bare.body, String.raw`\begin{tikzpicture}`+'\n'+String.raw`\node {$\tr(A)$};`+'\n'+String.raw`\end{tikzpicture}`);
  const indented = core.normalizeTeX(String.raw`\DeclareMathOperator{\tr}{tr}\noindent`+body);
  assert.equal(indented.preamble, String.raw`\DeclareMathOperator{\tr}{tr}`);
  assert.equal(indented.body, String.raw`\noindent`+body);
  const centered = core.normalizeTeX(String.raw`\begin{center}`+body+String.raw`\end{center}`);
  assert.equal(centered.preamble, '');
  assert.match(centered.body, /^\\begin\{center\}/);
});

test('comments between declarations and arguments preserve packages and custom macros', () => {
  const source = String.raw`\usepackage% a comment
[fleqn]% preserve options
{amsmath,% keep both
amssymb}
\newcommand% own derivative
{\dv}[2]{#1/#2}
\begin{tikzpicture}\node {$\dv{x}{t}$};\end{tikzpicture}`;
  const result = core.normalizeTeX(source);
  assert.deepEqual(result.texPackages, {amsmath:'fleqn',amssymb:'fleqn'});
  assert.match(result.addToPreamble, /\\newcommand% own derivative/);
  assert.doesNotMatch(result.body, /usepackage/);
});

test('preserves explicit options and handles physics and siunitx without silently changing qty', () => {
  const result = core.normalizeTeX(String.raw`\usepackage[fleqn]{amsmath}\usepackage[version=4]{mhchem}
\begin{tikzpicture}\node {$\ce{H2O}+\dfrac{1}{2}$};\end{tikzpicture}`);
  assert.deepEqual(result.texPackages, {amsmath:'fleqn',mhchem:'version=4'});
  const mixed = core.normalizeTeX(String.raw`\node {$\dv{x}{t}=\SI{5}{\metre\per\second}+\qty(x)$};`);
  assert.deepEqual(mixed.texPackages, {physics:'',siunitx:'','latex-islands-siunitx':''});
  const delimiters = core.normalizeTeX(String.raw`\node {$\qty(x)+\SI{5}{\metre}$};`);
  assert.deepEqual(delimiters.texPackages, {siunitx:'',physics:'','latex-islands-siunitx':''});
  assert.throws(() => core.normalizeTeX(String.raw`\node {$\dv{x}{t}=\qty{5}{\metre\per\second}$};`), /different meanings.*physics and siunitx/);
  assert.throws(() => core.normalizeTeX(String.raw`\node {$\qty(x)+\qty{5}{\metre}$};`), /different meanings/);
  assert.deepEqual(core.normalizeTeX(String.raw`\usepackage{physics}\node {$\qty{x}{y}$};`).texPackages, {physics:''});
});

test('ignores comments between qty arguments without changing quantity or delimiter semantics', () => {
  const quantities = [
    String.raw`\qty% before value
{5}{\metre}`,
    String.raw`\qty{5}% before unit
{\metre}`,
    String.raw`\qty% before options
[round-mode=places,round-precision=1]% before value
{2.34}% before unit
{\metre}`
  ];
  for (const quantity of quantities) {
    const source = String.raw`\begin{tikzpicture}\node {$`+quantity+String.raw`$};\end{tikzpicture}`;
    const result = core.normalizeTeX(source);
    assert.deepEqual(result.texPackages, {siunitx:'','latex-islands-siunitx':''});
    assert.equal(result.body, source);
  }
  const delimiter = core.normalizeTeX(String.raw`\node {$\qty% before delimiter
(x+1)$};`);
  assert.deepEqual(delimiter.texPackages, {physics:''});
  assert.throws(() => core.normalizeTeX(String.raw`\node {$\dv{x}{t}=\qty{5}% still a unit quantity
{\metre\per\second}$};`), /different meanings.*physics and siunitx/);
});

test('infers commonly omitted TikZ and PGFPlots libraries', () => {
  const result = core.normalizeTeX(String.raw`\begin{tikzpicture}
\node[rounded rectangle,draw] {x};
\draw[decorate,decoration={brace}] (0,0)--(1,0);
\draw[snake=snake] (0,1)--(1,1);
\begin{scope}[canvas is yz plane at x=0]\draw(0,0)--(1,1);\end{scope}
\end{tikzpicture}`);
  for (const lib of ['shapes.misc','decorations.pathreplacing','snakes','3d']) assert.ok(result.tikzLibraries.split(',').includes(lib), lib);
  const plot = core.normalizeTeX(String.raw`\begin{groupplot}\nextgroupplot\addplot {x};\end{groupplot}`);
  assert.equal(plot.texPackages.pgfplots, '');
  assert.match(plot.body, /^\\begin\{tikzpicture\}/);
  assert.match(plot.addToPreamble, /\\usepgfplotslibrary\{groupplots\}/);
  assert.equal(core.detectKind(String.raw`\begin{polaraxis}\addplot {x};\end{polaraxis}`), 'tikz');
});

test('infers brace decorations for the exact user diagram and valid shorthand', () => {
  const fixtures = require('./robustness-fixtures.cjs');
  for (const name of ['tikz-brace-binary-sign-user-example','tikz-decoration-brace-shorthand']) {
    const source = fixtures.find(([key]) => key === name)[1];
    const result = core.normalizeTeX(source);
    assert.ok(result.tikzLibraries.split(',').includes('decorations.pathreplacing'), name);
    assert.equal(result.body, source, 'Library inference preserves the original diagram.');
  }
  const commented = core.normalizeTeX(String.raw`\begin{tikzpicture}
% decoration=brace
\draw[decorate,decoration=snake] (0,0)--(1,0);
\end{tikzpicture}`);
  assert.ok(!commented.tikzLibraries.split(',').includes('decorations.pathreplacing'));
});

test('reports unsupported external processes and Lua graph layouts before compilation', () => {
  assert.throws(() => core.normalizeTeX(String.raw`\usegdlibrary{layered}\begin{tikzpicture}\graph{a->b};\end{tikzpicture}`), /require LuaTeX/);
  assert.throws(() => core.normalizeTeX(String.raw`\tikzexternalize\begin{tikzpicture}\draw(0,0)--(1,0);\end{tikzpicture}`), /externalization requires external files/);
});

test('declares common Unicode math labels without rewriting source or overriding user declarations', () => {
  const body = String.raw`\begin{tikzpicture}\node {α ≤ Ω, 10 µF, μ, x → y, ℝ, 90°};\end{tikzpicture}`;
  const result = core.normalizeTeX(body);
  assert.equal(result.body, body);
  for (const point of ['03B1','2264','03A9','00B5','03BC','2192','211D','00B0']) assert.ok(result.addToPreamble.includes(`{${point}}`));
  assert.equal(result.texPackages.amsfonts, '');
  const explicit = core.normalizeTeX(String.raw`\DeclareUnicodeCharacter{03B1}{A}`+'\n'+body);
  assert.ok(explicit.addToPreamble.lastIndexOf(String.raw`\DeclareUnicodeCharacter{03B1}{A}`) > explicit.addToPreamble.indexOf(String.raw`\DeclareUnicodeCharacter{03B1}{\ensuremath{\alpha}}`));
  assert.equal(core.normalizeTeX(diagram).addToPreamble, '');
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
  assert.match(normalized.warnings.join('\n'), /Circuitikz compatibility/);
});

test('downgrades unsupported interpolated PGFPlots surface shader for TikZJax', () => {
  const source = String.raw`\begin{tikzpicture}\begin{axis}\addplot3[surf,shader=interp]{x*y};\end{axis}\end{tikzpicture}`;
  const normalized = core.normalizeTeX(source);
  assert.equal(normalized.texPackages.pgfplots, '');
  assert.match(normalized.body, /shader=flat/);
  assert.doesNotMatch(normalized.body, /shader=interp/);
  assert.match(normalized.warnings.join('\n'), /shader=interp/);
});
