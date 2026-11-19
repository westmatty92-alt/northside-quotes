// yaml-lite — a small YAML reader for the subset OpenAPI files use. No dependencies.
//
// Supports: block mappings and sequences, "- key: value" items, flow collections
// ([a, b], { a: 1 }, nested, across lines), single/double-quoted strings, plain scalars,
// comments, and literal/folded block scalars (| and >). Not supported (throws or reads as
// text): anchors/aliases, tags, multi-document streams, complex keys.
//
// Each parsed mapping remembers the 1-based source line of every key in a hidden
// `__lines` property so checkers can point at file:line.

const LINES = Symbol.for('yaml-lite.lines');
export const lineOf = (obj, key) => obj?.[LINES]?.[key] ?? 0;

function stripComment(text) {
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q && (q === "'" ? text[i + 1] !== "'" : text[i - 1] !== '\\')) q = null; else if (c === q && q === "'") i++; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s\[{,:-]/.test(text[i - 1])) q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return JSON.parse(s);
  return s;
}

function parseFlow(src, lineNo) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const fail = (m) => { throw new Error(`line ${lineNo}: ${m}`); };
  function value() {
    ws();
    if (src[i] === '[') {
      i++; const arr = [];
      for (;;) { ws(); if (src[i] === ']') { i++; return arr; } arr.push(value()); ws(); if (src[i] === ',') i++; else if (src[i] !== ']') fail('expected , or ] in flow sequence'); }
    }
    if (src[i] === '{') {
      i++; const obj = {};
      for (;;) {
        ws(); if (src[i] === '}') { i++; return obj; }
        const k = token(true); ws();
        if (src[i] !== ':') fail('expected : in flow mapping');
        i++; obj[String(k)] = value(); ws();
        if (src[i] === ',') i++; else if (src[i] !== '}') fail('expected , or } in flow mapping');
      }
    }
    return token(false);
  }
  function token(isKey) {
    ws();
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i]; let j = i + 1;
      while (j < src.length) { if (src[j] === q) { if (q === "'" && src[j + 1] === "'") { j += 2; continue; } if (q === '"' && src[j - 1] === '\\') { j++; continue; } break; } j++; }
      const t = src.slice(i, j + 1); i = j + 1; return scalar(t);
    }
    let j = i;
    while (j < src.length && !/[,\]}]/.test(src[j]) && !(src[j] === ':' && (isKey ? /[\s,\]}]|$/.test(src[j + 1] ?? '') : /\s/.test(src[j + 1] ?? '')))) j++;
    const t = src.slice(i, j); i = j; return scalar(t);
  }
  const v = value(); ws();
  if (i < src.length) fail(`unexpected text after flow value: ${src.slice(i, i + 20)}`);
  return v;
}

const balance = (s) => {
  let d = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c; else if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--;
  }
  return d;
};

/** Split "key: value" at the first ": " (or trailing ":") outside quotes and brackets. */
function splitKey(text) {
  let q = null, d = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { if (i === 0) q = c; continue; }
    if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--;
    else if (c === ':' && d === 0 && (i === text.length - 1 || text[i + 1] === ' ')) return [text.slice(0, i), text.slice(i + 1).trim()];
  }
  return null;
}

export function parseYaml(source) {
  const raw = source.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (let n = 0; n < raw.length; n++) {
    const r = raw[n];
    if (/^\s*(---|\.\.\.)\s*$/.test(r) && lines.length === 0) continue;
    if (/\t/.test(r.match(/^\s*/)[0])) throw new Error(`line ${n + 1}: tabs are not allowed for indentation`);
    const text = stripComment(r);
    if (!text.trim()) { lines.push({ blank: true, n: n + 1, rawText: r }); continue; }
    lines.push({ indent: text.match(/^ */)[0].length, text: text.trim(), n: n + 1, rawText: r });
  }
  let i = 0;
  const skipBlank = () => { while (i < lines.length && lines[i].blank) i++; };

  function inlineValue(rest, ln, ownerIndent) {
    if (/^[|>][+-]?\d*$/.test(rest)) {
      const folded = rest[0] === '>';
      const out = [];
      let base = null;
      while (i < lines.length) {
        const L = lines[i];
        if (!L.blank && L.indent <= ownerIndent) break;
        if (L.blank) { out.push(''); i++; continue; }
        base ??= L.rawText.match(/^ */)[0].length;
        out.push(L.rawText.slice(base)); i++;
      }
      while (out.length && out[out.length - 1] === '') out.pop();
      return folded ? out.join(' ').replace(/\s+\n?/g, ' ') : out.join('\n');
    }
    if (/^[\[{]/.test(rest)) {
      let s = rest;
      while (balance(s) > 0 && i < lines.length) { skipBlank(); if (i >= lines.length) break; s += ' ' + lines[i].text; i++; }
      return parseFlow(s, ln);
    }
    if (/^[&*!]/.test(rest)) throw new Error(`line ${ln}: anchors, aliases and tags are not supported`);
    return scalar(rest);
  }

  function block(indent) {
    skipBlank();
    if (i >= lines.length) return null;
    const first = lines[i];
    if (first.text === '-' || first.text.startsWith('- ')) return seq(first.indent);
    return map(first.indent);
  }

  function map(indent) {
    const obj = {};
    Object.defineProperty(obj, LINES, { value: {}, enumerable: false });
    for (;;) {
      skipBlank();
      if (i >= lines.length) break;
      const L = lines[i];
      if (L.indent < indent) break;
      if (L.indent > indent) throw new Error(`line ${L.n}: unexpected indentation`);
      if (L.text === '-' || L.text.startsWith('- ')) break;
      const kv = splitKey(L.text);
      if (!kv) throw new Error(`line ${L.n}: expected "key: value"`);
      const key = String(scalar(kv[0]));
      obj[LINES][key] = L.n;
      i++;
      if (kv[1] === '') {
        skipBlank();
        if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && (lines[i].text === '-' || lines[i].text.startsWith('- '))))) obj[key] = block(lines[i].indent);
        else obj[key] = null;
      } else obj[key] = inlineValue(kv[1], L.n, indent);
    }
    return obj;
  }

  function seq(indent) {
    const arr = [];
    for (;;) {
      skipBlank();
      if (i >= lines.length) break;
      const L = lines[i];
      if (L.indent !== indent || !(L.text === '-' || L.text.startsWith('- '))) break;
      const rest = L.text === '-' ? '' : L.text.slice(2).trimStart();
      if (rest === '') { i++; skipBlank(); arr.push(i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : null); continue; }
      if (splitKey(rest) && !/^[\[{"']/.test(rest)) {
        // "- key: value" → a mapping whose first key sits after the dash
        const inner = indent + (L.text.length - rest.length);
        lines[i] = { ...L, indent: inner, text: rest };
        arr.push(map(inner));
        continue;
      }
      i++;
      arr.push(inlineValue(rest, L.n, indent));
    }
    return arr;
  }

  const doc = block(0);
  skipBlank();
  if (i < lines.length) throw new Error(`line ${lines[i].n}: unexpected indentation`);
  return doc;
}
