/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LatexIslandsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIAGRAM_ENVS = ['tikzpicture', 'circuitikz', 'tikzcd', 'axis', 'semilogxaxis', 'semilogyaxis', 'loglogaxis', 'groupplot', 'polaraxis'];
  // Public commands only: infer a dependency before compilation, without loading
  // unrelated packages that redefine operators (notably physics).
  const PACKAGE_COMMANDS = {
    amsmath: `dfrac tfrac cfrac binom dbinom tbinom genfrac boxed operatorname DeclareMathOperator
      overset underset overunderset sideset substack textsubscript textsuperscript
      xrightarrow xleftarrow iint iiint iiiint idotsint dddot ddddot boldsymbol
      lvert rvert lVert rVert eqref intertext shortintertext displaybreak allowdisplaybreaks
      numberwithin tag notag nobreakdash dotsc dotsb dotsm dotsi dotso impliedby implies`,
    amsfonts: 'mathbb mathfrak Bbb',
    amssymb: `boxdot boxplus boxtimes square blacksquare centerdot lozenge blacklozenge circlearrowright
      circlearrowleft rightleftharpoons leftrightharpoons boxminus Vdash Vvdash vDash twoheadrightarrow
      twoheadleftarrow leftleftarrows rightrightarrows upuparrows downdownarrows upharpoonright
      downharpoonright upharpoonleft downharpoonleft rightarrowtail leftarrowtail leftrightarrows
      rightleftarrows Lsh Rsh rightsquigarrow leftrightsquigarrow looparrowleft looparrowright circeq
      succsim gtrsim gtrapprox multimap therefore because doteqdot triangleq precsim lesssim lessapprox
      eqslantless eqslantgtr curlyeqprec curlyeqsucc preccurlyeq leqq leqslant lessgtr backprime
      risingdotseq fallingdotseq succcurlyeq geqq geqslant gtrless sqsubset sqsupset vartriangleright
      vartriangleleft trianglerighteq trianglelefteq bigstar between blacktriangledown blacktriangleright
      blacktriangleleft vartriangle blacktriangle triangledown eqcirc lesseqgtr gtreqless lesseqqgtr
      gtreqqless Rrightarrow Lleftarrow veebar barwedge doublebarwedge measuredangle sphericalangle
      varpropto smallsmile smallfrown Subset Supset Cup Cap curlywedge curlyvee leftthreetimes
      rightthreetimes subseteqq supseteqq bumpeq Bumpeq lll ggg circledS pitchfork dotplus backsim
      backsimeq complement intercal circledcirc circledast circleddash lvertneqq gvertneqq nleq ngeq
      nless ngtr nprec nsucc lneqq gneqq nleqslant ngeqslant lneq gneq npreceq nsucceq precnsim
      succnsim lnsim gnsim nleqq ngeqq precneqq succneqq precnapprox succnapprox lnapprox gnapprox
      nsim ncong diagup diagdown varsubsetneq varsupsetneq nsubseteqq nsupseteqq subsetneqq
      supsetneqq varsubsetneqq varsupsetneqq subsetneq supsetneq nsubseteq nsupseteq nparallel nmid
      nshortmid nshortparallel nvdash nVdash nvDash nVDash ntrianglerighteq ntrianglelefteq ntriangleleft
      ntriangleright nleftarrow nrightarrow nLeftarrow nRightarrow nLeftrightarrow nleftrightarrow
      divideontimes varnothing nexists Finv Game mho eth eqsim beth gimel daleth lessdot gtrdot
      ltimes rtimes shortmid shortparallel smallsetminus thicksim thickapprox approxeq succapprox
      precapprox curvearrowleft curvearrowright digamma varkappa Bbbk hslash backepsilon`,
    mathtools: `mathtoolsset DeclarePairedDelimiter DeclarePairedDelimiterX DeclarePairedDelimiterXPP
      coloneqq Coloneqq coloneq Coloneq eqqcolon Eqqcolon eqcolon Eqcolon dblcolon
      mathclap mathllap mathrlap cramped crampedclap crampedllap crampedrlap
      underbracket overbracket prescript splitfrac splitdfrac shortintertext
      MoveEqLeft Aboxed vdotswithin smashoperator adjustlimits`,
    bm: 'bm hm',
    mhchem: 'ce',
    siunitx: `SI SIlist SIrange si num numlist numrange ang unit qtylist qtyrange
      complexnum complexqty complexunit tablenum sisetup DeclareSIUnit DeclareSIPrefix DeclareSIPostPower DeclareSIPrePower`,
    physics: `dv pdv fdv dd differential derivative partialderivative functionalderivative
      vb va vu vectorbold vectorarrow vectorunit grad gradient curl laplacian
      bra ket braket ketbra dyad expval expectationvalue matrixelement matrixel mel
      norm abs comm acomm anticommutator poissonbracket pb evaluated
      quantity pqty bqty Bqty vqty mqty pmqty bmqty vmqty smqty`,
    array: 'newcolumntype',
    cancel: 'cancel bcancel xcancel cancelto',
    pgfplots: 'pgfplotsset addplot addplotthree usepgfplotslibrary pgfplotstableread pgfplotstabletypeset',
    circuitikz: 'ctikzset',
    chemfig: 'chemfig definesubmol chemname chemabove chembelow schemestart schemestop',
    'tikz-3dplot': 'tdplotsetmaincoords tdplotsetrotatedcoords tdplotdrawarc'
  };
  const COMMAND_PACKAGES = new Map();
  for (const [pkg, names] of Object.entries(PACKAGE_COMMANDS)) for (const name of names.split(/\s+/).filter(Boolean)) COMMAND_PACKAGES.set(name, pkg);
  const UNICODE_MATH = {
    'α':'alpha', 'β':'beta', 'γ':'gamma', 'δ':'delta', 'ε':'varepsilon', 'ϵ':'epsilon',
    'ζ':'zeta', 'η':'eta', 'θ':'theta', 'ϑ':'vartheta', 'ι':'iota', 'κ':'kappa',
    'λ':'lambda', 'μ':'mu', 'µ':'mu', 'ν':'nu', 'ξ':'xi', 'π':'pi', 'ϖ':'varpi',
    'ρ':'rho', 'ϱ':'varrho', 'σ':'sigma', 'ς':'varsigma', 'τ':'tau', 'υ':'upsilon',
    'φ':'varphi', 'ϕ':'phi', 'χ':'chi', 'ψ':'psi', 'ω':'omega',
    'Γ':'Gamma', 'Δ':'Delta', 'Θ':'Theta', 'Λ':'Lambda', 'Ξ':'Xi', 'Π':'Pi',
    'Σ':'Sigma', 'Υ':'Upsilon', 'Φ':'Phi', 'Ψ':'Psi', 'Ω':'Omega',
    '≤':'leq', '≥':'geq', '≠':'neq', '≈':'approx', '≡':'equiv', '∝':'propto',
    '±':'pm', '∓':'mp', '×':'times', '·':'cdot', '÷':'div', '∞':'infty',
    '∂':'partial', '∇':'nabla', '∫':'int', '∑':'sum', '∏':'prod', '√':'surd',
    '∈':'in', '∉':'notin', '⊂':'subset', '⊆':'subseteq', '∪':'cup', '∩':'cap', '∅':'emptyset',
    '∀':'forall', '∃':'exists', '→':'rightarrow', '←':'leftarrow', '↔':'leftrightarrow',
    '⇒':'Rightarrow', '⇐':'Leftarrow', '⇔':'Leftrightarrow', '↦':'mapsto', 'ℏ':'hbar',
    'ℝ':'mathbb{R}', 'ℕ':'mathbb{N}', 'ℤ':'mathbb{Z}', 'ℚ':'mathbb{Q}', 'ℂ':'mathbb{C}'
  };

  function escaped(text, index) {
    let n = 0;
    while (index > 0 && text[--index] === '\\') n++;
    return n % 2 === 1;
  }

  function withoutComments(text) {
    return text.split('\n').map(line => {
      for (let i = 0; i < line.length; i++) if (line[i] === '%' && !escaped(line, i)) return line.slice(0, i);
      return line;
    }).join('\n');
  }

  function commandTokens(text) {
    const tokens = [];
    for (let i = 0, depth = 0; i < text.length; i++) {
      if (text[i] === '%') { const end = text.indexOf('\n', i); if (end < 0) break; i = end; continue; }
      if (text[i] === '\\') {
        const match = /^[A-Za-z@]+/.exec(text.slice(i + 1));
        if (!match) { i++; continue; } // Includes escaped %, braces and \\ line breaks.
        const start = i, name = match[0]; i += name.length;
        tokens.push({name, start, end:i + 1, depth});
        if (name === 'verb') {
          let pos = i + 1; if (text[pos] === '*') pos++;
          const delimiter = text[pos], end = delimiter && text.indexOf(delimiter, pos + 1);
          if (end > pos) i = end;
        }
      } else if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    return tokens;
  }

  function drawingStart(text) {
    for (const token of commandTokens(text)) {
      if (token.depth !== 0) continue;
      if (['begin','tikz','draw','node','path','fill','filldraw','coordinate','shade','shadedraw','foreach','chemfig','schemestart',
        'noindent','indent','leavevmode','hspace','vspace','hfill','vfill','par','newline','linebreak','makebox','mbox','raisebox'].includes(token.name)) return token.start;
    }
    return -1;
  }

  function inferPackages(text, packages) {
    const tokens = commandTokens(text), custom = new Set(), explicit = new Set(Object.keys(packages));
    const has = name => Object.prototype.hasOwnProperty.call(packages, name);
    const add = name => { if (!has(name)) packages[name] = ''; };
    for (const token of tokens) {
      if (!['newcommand','providecommand','NewDocumentCommand','ProvideDocumentCommand','DeclareRobustCommand','def','gdef','edef','xdef','DeclareMathOperator','DeclarePairedDelimiter','DeclarePairedDelimiterX','DeclarePairedDelimiterXPP'].includes(token.name)) continue;
      let index = skipSpaceAndComments(text, token.end);
      if (text[index] === '*') index = skipSpaceAndComments(text, index + 1);
      if (text[index] === '{') index = skipSpaceAndComments(text, index + 1);
      const defined = /^\\([A-Za-z@]+)/.exec(text.slice(index));
      if (defined) custom.add(defined[1]);
    }
    const used = new Set(tokens.filter(token => !custom.has(token.name)).map(token => token.name));
    for (const name of used) {
      const pkg = COMMAND_PACKAGES.get(name);
      if (pkg) add(pkg);
      if (/^tdplot[A-Za-z]+$/.test(name)) add('tikz-3dplot');
    }
    // qty has incompatible meanings: parentheses denote physics delimiters;
    // two braced arguments denote a number and a unit in siunitx.
    if (used.has('qty') && !explicit.has('physics') && !explicit.has('siunitx')) {
      const uses = tokens.filter(token => token.name === 'qty').map(token => {
        let index = skipSpaceAndComments(text, token.end);
        if (text[index] === '[') { const options = groupAt(text,index,'[',']'); if (options) index = skipSpaceAndComments(text,options.end); }
        const value = groupAt(text,index,'{','}');
        return value && text[skipSpaceAndComments(text,value.end)] === '{' ? 'unit' : 'delimiter';
      });
      if (uses.includes('delimiter')) add('physics');
      if (uses.includes('unit')) {
        if (has('physics')) throw new Error('\\qty has different meanings in physics and siunitx. Use \\SI{value}{unit} for quantities when the diagram also uses physics delimiters or commands such as \\dv.');
        add('siunitx');
      }
    }
    for (const token of tokens) if (token.name === 'begin') {
      const env = /^\s*\{\s*([^}]+?)\s*\}/.exec(text.slice(token.end))?.[1];
      if (/^(?:align|alignat|aligned|alignedat|gather|gathered|multline|split|cases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|subequations)\*?$/.test(env || '')) add('amsmath');
      if (/^(?:dcases|dcases\*|rcases|rcases\*|drcases|drcases\*|multlined|[pbBvV]?matrix\*)$/.test(env || '')) add('mathtools');
      if (/^(?:axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|polaraxis)$/.test(env || '')) add('pgfplots');
      if (env === 'circuitikz') add('circuitikz');
      if (env === 'tikzcd') add('tikz-cd');
      if (env === 'array' || env === 'tabular' || env === 'tabular*') add('array');
    }
    if (used.has('text') && !has('amsmath') && !has('mathtools') && !has('physics') && !has('mhchem')) add('amstext');
    // Keep explicit declarations/options. Avoid duplicate inferred dependencies.
    if (has('amssymb') && !explicit.has('amsfonts')) delete packages.amsfonts;
    if ((has('mathtools') || has('physics') || has('mhchem')) && !explicit.has('amsmath')) delete packages.amsmath;
    if (has('cancel')) add('latex-islands-cancel');
    if (has('siunitx')) add('latex-islands-siunitx');
    return packages;
  }

  function commented(text, index) {
    const start = text.lastIndexOf('\n', index - 1) + 1;
    for (let i = start; i < index; i++) if (text[i] === '%' && !escaped(text, i)) return true;
    return false;
  }

  function skipSpaceAndComments(text, index) {
    while (index < text.length) {
      if (/\s/.test(text[index])) { index++; continue; }
      if (text[index] === '%') { const end = text.indexOf('\n', index); index = end < 0 ? text.length : end + 1; continue; }
      break;
    }
    return index;
  }

  function stripFence(input) {
    const text = String(input == null ? '' : input).replace(/^\uFEFF/, '').trim();
    const m = text.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/);
    let value = m ? m[2].trim() : text;
    const wrappers = [['\\[', '\\]'], ['\\(', '\\)'], ['$$', '$$']];
    for (const [open, close] of wrappers) if (value.startsWith(open) && value.endsWith(close) && value.length > open.length + close.length) {
      const inner = value.slice(open.length, -close.length).trim();
      if (/\\(?:begin\s*\{(?:tikzpicture|circuitikz|tikzcd|axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|polaraxis)\}|tikz\b|chemfig\b|tdplot\w*\b)/.test(inner)) value = inner;
    }
    return value;
  }

  function detectKind(input, language) {
    const source = withoutComments(stripFence(input));
    const lang = String(language || '').toLowerCase().replace(/^language-/, '').trim();
    if (lang && !/^(tikz|pgfplots|circuitikz|tikzcd|chemfig|tikz-3dplot|latex|tex|text|plaintext)$/.test(lang)) return null;
    if (/^(tikz|pgfplots|circuitikz|tikzcd|chemfig|tikz-3dplot)$/.test(lang)) return 'tikz';
    if (/\\begin\s*\{\s*(tikzpicture|circuitikz|tikzcd|axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|polaraxis)\s*\}/.test(source)) return 'tikz';
    if (/\\(?:chemfig|definesubmol|tdplot[A-Za-z@]*)\b/.test(source)) return 'tikz';
    if (/\\(?:tikz|draw|node|path|fill|coordinate|shade)\b/.test(source) && (/\\tikz\b/.test(source) || /^(latex|tex)$/.test(lang))) return 'tikz';
    if (/\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{[^}]*\b(?:tikz|pgfplots|circuitikz|tikz-cd|chemfig|tikz-3dplot)\b[^}]*\}/.test(source)) return 'tikz';
    return null;
  }

  function groupAt(text, pos, open, close) {
    if (text[pos] !== open) return null;
    let depth = 1;
    for (let i = pos + 1; i < text.length; i++) {
      if (escaped(text, i)) continue;
      if (text[i] === '%') { const end = text.indexOf('\n', i); if (end < 0) return null; i = end; continue; }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return {value: text.slice(pos + 1, i), end: i + 1};
    }
    return null;
  }

  function extractCommands(text, names) {
    const results = [];
    const pattern = /\\([A-Za-z]+)\b/g;
    let match;
    while ((match = pattern.exec(text))) {
      if (!names.includes(match[1]) || escaped(text, match.index)) continue;
      if (commented(text, match.index)) continue;
      let i = skipSpaceAndComments(text, pattern.lastIndex);
      let options = '';
      if (text[i] === '[') {
        const optional = groupAt(text, i, '[', ']');
        if (!optional) continue;
        options = optional.value;
        i = skipSpaceAndComments(text, optional.end);
      }
      const argument = groupAt(text, i, '{', '}');
      if (!argument) continue;
      results.push({name: match[1], value: withoutComments(argument.value), options, start: match.index, end: argument.end});
      pattern.lastIndex = argument.end;
    }
    return results;
  }

  function removeCommands(text, commands) {
    for (let i = commands.length - 1; i >= 0; i--) text = text.slice(0, commands[i].start) + text.slice(commands[i].end);
    return text;
  }

  function addLibrary(libraries, name) {
    if (name && !libraries.includes(name)) libraries.push(name);
  }

  function inferLibraries(text, libraries) {
    const source = withoutComments(text);
    if (/(?:above|below|left|right)(?:\s+(?:left|right))?\s*=\s*(?:[^,\]\n]+\s+)?of\b/.test(source)) addLibrary(libraries, 'positioning');
    if (/\b(?:diamond|ellipse|trapezium|regular polygon|star|cylinder|isosceles triangle|semicircle)\b/.test(source)) addLibrary(libraries, 'shapes.geometric');
    if (/\b(?:rounded rectangle|cross out|strike out|chamfered rectangle)\b/.test(source)) addLibrary(libraries, 'shapes.misc');
    if (/\b(?:rectangle split|circle split|circle solidus|ellipse split)\b/.test(source)) addLibrary(libraries, 'shapes.multipart');
    if (/\b(?:cloud|starburst|forbidden sign|magnifying glass)\b/.test(source)) addLibrary(libraries, 'shapes.symbols');
    if (/\b(?:single arrow|double arrow|arrow box)\b/.test(source)) addLibrary(libraries, 'shapes.arrows');
    if (/\b(?:rectangle callout|ellipse callout|cloud callout)\b/.test(source)) addLibrary(libraries, 'shapes.callouts');
    if (/\b(?:Stealth|Latex|Triangle|Kite|Square|Rays)\b/.test(source) || /[-<>{}\s](?:Stealth|Latex)\b/.test(source)) addLibrary(libraries, 'arrows.meta');
    if (/\(\s*\$\s*\(/.test(source) || /\$\s*\([^\n]*\)\s*[!|]/.test(source)) addLibrary(libraries, 'calc');
    if (/\bfit\s*=/.test(source)) addLibrary(libraries, 'fit');
    if (/\\matrix\b|\bmatrix of nodes\b/.test(source)) addLibrary(libraries, 'matrix');
    if (/\bname\s+(?:path|intersections)\s*=/.test(source)) addLibrary(libraries, 'intersections');
    if (/\bpattern(?:\s+color)?\s*=/.test(source)) addLibrary(libraries, 'patterns');
    if (/\bpattern\s*=\s*\{?\s*(?:Lines|Hatch|Dots|Stars)\b/.test(source)) addLibrary(libraries, 'patterns.meta');
    if (/\\pic\b|\bangle\s*=/.test(source)) { addLibrary(libraries, 'angles'); addLibrary(libraries, 'quotes'); }
    if (/\bdecorate\b|\bdecoration\s*=/.test(source)) { addLibrary(libraries, 'decorations.pathmorphing'); addLibrary(libraries, 'decorations.markings'); }
    if (/\bdecoration\s*=\s*(?:\{[^}]*\b)?(?:brace|show path construction|waves|expanding waves)\b/.test(source)) addLibrary(libraries, 'decorations.pathreplacing');
    if (/\btext along path\b/.test(source)) addLibrary(libraries, 'decorations.text');
    if (/\bsnake\s*=/.test(source)) addLibrary(libraries, 'snakes');
    if (/\bon background layer\b|\bshow background rectangle\b/.test(source)) addLibrary(libraries, 'backgrounds');
    if (/(?:\[|,)\s*(?:state|initial|accepting)(?:\s*[,\]=]|\s+by\b)/.test(source)) addLibrary(libraries, 'automata');
    if (/\b(?:start chain|on chain|join=by)\b/.test(source)) addLibrary(libraries, 'chains');
    if (/\b(?:canvas is (?:xy|xz|yx|yz|zx|zy) plane|canvas is plane|plane origin)\b/.test(source)) addLibrary(libraries, '3d');
    if (/\\tikzmath\b/.test(source)) addLibrary(libraries, 'math');
    if (/\b(?:drop shadow|circular drop shadow|copy shadow|general shadow)\b/.test(source)) addLibrary(libraries, 'shadows');
    if (/\\graph\b/.test(source)) addLibrary(libraries, 'graphs');
    if (/\b(?:mindmap|concept color)\b/.test(source)) addLibrary(libraries, 'mindmap');
    if (/\b(?:spy using outlines|spy using overlays)\b/.test(source)) addLibrary(libraries, 'spy');
    return libraries;
  }

  function applyCompatibility(body, context, warnings) {
    let result = body;
    if (context.circuitikz) {
      let labels = 0;
      result = result.replace(/((?:^|[,\[])\s*(?:l|l_|l\^|v|v_|v\^|i|i_|i\^)\s*=\s*)(\$[^$\n]*=[^$\n]*\$)/gm, (all, prefix, value) => {
        labels++;
        return prefix + '{' + value + '}';
      });
      if (labels) warnings.push(`Circuitikz compatibility: automatically protected ${labels} label${labels > 1 ? 's' : ''} containing “=”.`);
    }
    if (context.pgfplots) {
      let shaders = 0;
      result = result.replace(/shader\s*=\s*(?:faceted\s+)?interp\b/gi, () => { shaders++; return 'shader=flat'; });
      if (shaders) warnings.push('TikZJax compatibility: replaced shader=interp with shader=flat (the SVG/Ximera driver does not support surface interpolation).');
    }
    return result;
  }

  function normalizeTeX(input) {
    const source = stripFence(input);
    const commands = extractCommands(source, ['documentclass', 'usepackage', 'RequirePackage', 'usetikzlibrary']);
    const packages = [];
    const texPackages = {};
    const libraries = [];
    let documentClass = null;
    for (const command of commands) {
      if (command.name === 'documentclass') documentClass = {name: command.value.trim(), options: command.options};
      else if (command.name === 'usetikzlibrary') libraries.push(...command.value.split(',').map(x => x.trim()).filter(Boolean));
      else for (const name of command.value.split(',').map(x => x.trim()).filter(Boolean)) {
        if (!packages.includes(name)) packages.push(name);
        if (name !== 'tikz' && name !== 'standalone') texPackages[name] = command.options;
      }
    }

    let cleaned = removeCommands(source, commands).trim();
    let preamble = '';
    let body = cleaned;
    let hasDocument = false;
    const begin = /\\begin\s*\{document\}/g;
    let match;
    while ((match = begin.exec(cleaned))) {
      if (escaped(cleaned, match.index) || commented(cleaned, match.index)) continue;
      hasDocument = true;
      preamble = cleaned.slice(0, match.index).trim();
      body = cleaned.slice(begin.lastIndex);
      const endPattern = /\\end\s*\{document\}/g;
      let end;
      while ((end = endPattern.exec(body))) if (!escaped(body, end.index) && !commented(body, end.index)) { body = body.slice(0, end.index); break; }
      body = body.trim();
      break;
    }
    // LLM snippets often declare colors, operators or styles before the picture.
    // Those declarations belong in the generated preamble, just like a full file.
    if (!hasDocument) {
      const start = drawingStart(body);
      if (start > 0 && commandTokens(body.slice(0,start)).length) {
        preamble = body.slice(0,start).trim();
        body = body.slice(start).trim();
      }
    }

    const warnings = [];
    if (documentClass && documentClass.name !== 'standalone') warnings.push('The diagram engine uses the standalone class; the layout of the ' + documentClass.name + ' class is ignored.');

    const uncommentedBody = () => withoutComments(body);
    if (!/\\(?:begin\s*\{(?:tikzpicture|circuitikz|tikzcd|axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|polaraxis)\}|tikz\b|chemfig\b)/.test(uncommentedBody()) && /\\(?:draw|node|path|fill|filldraw|coordinate|shade|shadedraw)\b/.test(uncommentedBody())) body = '\\begin{tikzpicture}\n' + body + '\n\\end{tikzpicture}';
    if (/\\begin\s*\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|polaraxis)\}/.test(uncommentedBody()) && !/\\begin\s*\{tikzpicture\}/.test(uncommentedBody())) body = '\\begin{tikzpicture}\n' + body + '\n\\end{tikzpicture}';

    const scan = withoutComments(preamble + '\n' + body);
    // The compact TeX snapshot lacks some inputenc text fonts. Declare only the
    // mathematical characters used by this fragment, keeping its source intact.
    // User declarations follow these defaults and can override them normally.
    const unicode = [];
    for (const [character, command] of Object.entries(UNICODE_MATH)) if (scan.includes(character)) unicode.push(`\\DeclareUnicodeCharacter{${character.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}}{\\ensuremath{\\${command}}}`);
    if (scan.includes('−')) unicode.push('\\DeclareUnicodeCharacter{2212}{\\ensuremath{-}}');
    if (scan.includes('°')) unicode.push('\\DeclareUnicodeCharacter{00B0}{\\ensuremath{{}^{\\circ}}}');
    if (unicode.length) preamble = unicode.join('\n') + '\n' + preamble;
    inferPackages(preamble + '\n' + body, texPackages);

    const plotLibraries = [];
    if (Object.prototype.hasOwnProperty.call(texPackages, 'pgfplots')) {
      if (/\bfill between\b/.test(scan)) plotLibraries.push('fillbetween');
      if (/\\begin\s*\{groupplot\}|\\nextgroupplot\b/.test(scan)) plotLibraries.push('groupplots');
      if (/\b(?:boxplot|hist)\b/.test(scan)) plotLibraries.push('statistics');
      if (/\\begin\s*\{polaraxis\}/.test(scan)) plotLibraries.push('polar');
      if (/\bdate coordinates in\s*=/.test(scan)) plotLibraries.push('dateplot');
    }
    if (plotLibraries.length) preamble = '\\usepgfplotslibrary{' + plotLibraries.join(',') + '}\n' + preamble;

    const activeCommands = new Set(commandTokens(preamble + '\n' + body).map(token => token.name));
    if (activeCommands.has('usegdlibrary')) throw new Error('TikZ graph drawing layouts require LuaTeX, which is not available in this renderer. Use explicit node positions or a TikZ layout that does not require LuaTeX.');
    if (activeCommands.has('tikzexternalize')) throw new Error('TikZ externalization requires external files and processes. Remove \\tikzexternalize to render the picture directly.');

    const uniqueLibraries = [...new Set(libraries)];
    inferLibraries(scan, uniqueLibraries);
    body = applyCompatibility(body, {
      circuitikz: Object.prototype.hasOwnProperty.call(texPackages, 'circuitikz') || /\\begin\s*\{circuitikz\}/.test(scan),
      pgfplots: Object.prototype.hasOwnProperty.call(texPackages, 'pgfplots') || /\\begin\s*\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}/.test(scan)
    }, warnings);

    return {
      source,
      kind: detectKind(source),
      packages,
      body,
      preamble,
      documentClass,
      texPackages,
      tikzLibraries: uniqueLibraries.join(','),
      addToPreamble: preamble,
      warnings
    };
  }

  function rawDiagramEnd(text, start, environment) {
    const regex = /\\(begin|end)\s*\{\s*([A-Za-z]+)\s*\}/g;
    regex.lastIndex = start;
    let depth = 0, match;
    while ((match = regex.exec(text))) {
      if (escaped(text, match.index) || commented(text, match.index) || match[2] !== environment) continue;
      if (match[1] === 'begin') depth++;
      else if (--depth === 0) return regex.lastIndex;
    }
    return -1;
  }

  function splitIslands(input) {
    const text = String(input || '');
    const tokens = [];
    let cursor = 0, plainStart = 0;
    function push(type, start, end, value) {
      if (start > plainStart) tokens.push({type: 'text', value: text.slice(plainStart, start), start: plainStart, end: start});
      tokens.push({type, value, start, end});
      plainStart = end;
      cursor = end;
    }
    while (cursor < text.length) {
      const rest = text.slice(cursor);
      const fence = (cursor === 0 || text[cursor - 1] === '\n') && rest.match(/^(`{3,}|~{3,})([^\n]*)\n/);
      if (fence) {
        const closePattern = new RegExp('^' + fence[1][0] + '{' + fence[1].length + ',}\\s*$', 'gm');
        closePattern.lastIndex = cursor + fence[0].length;
        const close = closePattern.exec(text);
        if (!close) break;
        const value = text.slice(cursor + fence[0].length, close.index).trim();
        const end = close.index + close[0].length;
        if (detectKind(value, fence[2].trim().split(/\s+/)[0])) push('latex', cursor, end, value);
        else cursor = end;
        continue;
      }
      if (text[cursor] === '`' && !escaped(text, cursor)) {
        const delimiter = rest.match(/^`+/)[0];
        const end = text.indexOf(delimiter, cursor + delimiter.length);
        if (end >= 0) { cursor = end + delimiter.length; continue; }
      }
      if (text[cursor] === '\\' && !escaped(text, cursor) && !commented(text, cursor)) {
        const environment = rest.match(/^\\begin\s*\{\s*([A-Za-z]+)\s*\}/);
        if (environment && DIAGRAM_ENVS.includes(environment[1])) {
          const end = rawDiagramEnd(text, cursor, environment[1]);
          if (end >= 0) { push('latex', cursor, end, text.slice(cursor, end)); continue; }
        }
      }
      cursor++;
    }
    if (plainStart < text.length) tokens.push({type: 'text', value: text.slice(plainStart), start: plainStart, end: text.length});
    return tokens;
  }

  return Object.freeze({detectKind, normalizeTeX, splitIslands, stripFence});
});
