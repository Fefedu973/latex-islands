/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LatexIslandsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIAGRAM_ENVS = ['tikzpicture', 'circuitikz', 'tikzcd', 'axis', 'semilogxaxis', 'semilogyaxis', 'loglogaxis'];

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

  function commented(text, index) {
    const start = text.lastIndexOf('\n', index - 1) + 1;
    for (let i = start; i < index; i++) if (text[i] === '%' && !escaped(text, i)) return true;
    return false;
  }

  function stripFence(input) {
    const text = String(input == null ? '' : input).replace(/^\uFEFF/, '').trim();
    const m = text.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/);
    let value = m ? m[2].trim() : text;
    const wrappers = [['\\[', '\\]'], ['\\(', '\\)'], ['$$', '$$']];
    for (const [open, close] of wrappers) if (value.startsWith(open) && value.endsWith(close) && value.length > open.length + close.length) {
      const inner = value.slice(open.length, -close.length).trim();
      if (/\\(?:begin\s*\{(?:tikzpicture|circuitikz|tikzcd|axis|semilogxaxis|semilogyaxis|loglogaxis)\}|tikz\b|chemfig\b|tdplot\w*\b)/.test(inner)) value = inner;
    }
    return value;
  }

  function detectKind(input, language) {
    const source = withoutComments(stripFence(input));
    const lang = String(language || '').toLowerCase().replace(/^language-/, '').trim();
    if (lang && !/^(tikz|pgfplots|circuitikz|tikzcd|chemfig|tikz-3dplot|latex|tex|text|plaintext)$/.test(lang)) return null;
    if (/^(tikz|pgfplots|circuitikz|tikzcd|chemfig|tikz-3dplot)$/.test(lang)) return 'tikz';
    if (/\\begin\s*\{\s*(tikzpicture|circuitikz|tikzcd|axis|semilogxaxis|semilogyaxis|loglogaxis)\s*\}/.test(source)) return 'tikz';
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
      let i = pattern.lastIndex;
      while (/\s/.test(text[i] || '') && i < text.length) i++;
      let options = '';
      if (text[i] === '[') {
        const optional = groupAt(text, i, '[', ']');
        if (!optional) continue;
        options = optional.value;
        i = optional.end;
        while (/\s/.test(text[i] || '') && i < text.length) i++;
      }
      const argument = groupAt(text, i, '{', '}');
      if (!argument) continue;
      results.push({name: match[1], value: argument.value, options, start: match.index, end: argument.end});
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
    if (/\b(?:diamond|trapezium|regular polygon|star)\b/.test(source)) addLibrary(libraries, 'shapes.geometric');
    if (/\b(?:Stealth|Latex|Triangle|Kite|Square|Rays)\b/.test(source) || /[-<>{}\s](?:Stealth|Latex)\b/.test(source)) addLibrary(libraries, 'arrows.meta');
    if (/\(\s*\$\s*\(/.test(source) || /\$\s*\([^\n]*\)\s*[!|]/.test(source)) addLibrary(libraries, 'calc');
    if (/\bfit\s*=/.test(source)) addLibrary(libraries, 'fit');
    if (/\\matrix\b|\bmatrix of nodes\b/.test(source)) addLibrary(libraries, 'matrix');
    if (/\bname\s+(?:path|intersections)\s*=/.test(source)) addLibrary(libraries, 'intersections');
    if (/\bpattern(?:\s+color)?\s*=/.test(source)) addLibrary(libraries, 'patterns');
    if (/\\pic\b|\bangle\s*=/.test(source)) { addLibrary(libraries, 'angles'); addLibrary(libraries, 'quotes'); }
    if (/\bdecorate\b|\bdecoration\s*=/.test(source)) { addLibrary(libraries, 'decorations.pathmorphing'); addLibrary(libraries, 'decorations.markings'); }
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
    const begin = /\\begin\s*\{document\}/g;
    let match;
    while ((match = begin.exec(cleaned))) {
      if (escaped(cleaned, match.index) || commented(cleaned, match.index)) continue;
      preamble = cleaned.slice(0, match.index).trim();
      body = cleaned.slice(begin.lastIndex);
      const endPattern = /\\end\s*\{document\}/g;
      let end;
      while ((end = endPattern.exec(body))) if (!escaped(body, end.index) && !commented(body, end.index)) { body = body.slice(0, end.index); break; }
      body = body.trim();
      break;
    }

    const warnings = [];
    if (documentClass && documentClass.name !== 'standalone') warnings.push('The diagram engine uses the standalone class; the layout of the ' + documentClass.name + ' class is ignored.');

    const uncommentedBody = () => withoutComments(body);
    if (!/\\(?:begin\s*\{(?:tikzpicture|circuitikz|tikzcd|axis|semilogxaxis|semilogyaxis|loglogaxis)\}|tikz\b|chemfig\b)/.test(uncommentedBody()) && /\\(?:draw|node|path|fill|coordinate|shade)\b/.test(uncommentedBody())) body = '\\begin{tikzpicture}\n' + body + '\n\\end{tikzpicture}';
    if (/\\begin\s*\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}/.test(uncommentedBody()) && !/\\begin\s*\{tikzpicture\}/.test(uncommentedBody())) body = '\\begin{tikzpicture}\n' + body + '\n\\end{tikzpicture}';

    const scan = withoutComments(preamble + '\n' + body);
    if (/\\begin\s*\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}|\\addplot\d*\b/.test(scan) && !Object.prototype.hasOwnProperty.call(texPackages, 'pgfplots')) texPackages.pgfplots = '';
    if (/\\begin\s*\{circuitikz\}/.test(scan) && !Object.prototype.hasOwnProperty.call(texPackages, 'circuitikz')) texPackages.circuitikz = '';
    if (/\\begin\s*\{tikzcd\}/.test(scan) && !Object.prototype.hasOwnProperty.call(texPackages, 'tikz-cd')) texPackages['tikz-cd'] = '';
    if (/\\(?:chemfig|definesubmol)\b/.test(scan) && !Object.prototype.hasOwnProperty.call(texPackages, 'chemfig')) texPackages.chemfig = '';
    if (/\\tdplot[A-Za-z@]*\b/.test(scan) && !Object.prototype.hasOwnProperty.call(texPackages, 'tikz-3dplot')) texPackages['tikz-3dplot'] = '';

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
