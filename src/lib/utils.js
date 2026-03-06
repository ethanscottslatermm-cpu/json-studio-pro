function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function highlightJSON(code) {
  let r = '', i = 0, len = code.length;
  while (i < len) {
    if (code[i] === '"') {
      let j = i + 1;
      while (j < len && !(code[j] === '"' && code[j - 1] !== '\\')) j++;
      j++;
      const s = esc(code.slice(i, j));
      let k = j;
      while (k < len && (code[k] === ' ' || code[k] === '\t')) k++;
      r += code[k] === ':' ? `<span class="syn-key">${s}</span>` : `<span class="syn-str">${s}</span>`;
      i = j; continue;
    }
    if (/[-\d]/.test(code[i]) && (i === 0 || /[^\w.]/.test(code[i - 1]))) {
      let j = i; if (code[j] === '-') j++;
      while (j < len && /[\d.eE+\-]/.test(code[j])) j++;
      r += `<span class="syn-num">${esc(code.slice(i, j))}</span>`; i = j; continue;
    }
    if (code.slice(i, i + 4) === 'true')  { r += `<span class="syn-bool">true</span>`;  i += 4; continue; }
    if (code.slice(i, i + 5) === 'false') { r += `<span class="syn-bool">false</span>`; i += 5; continue; }
    if (code.slice(i, i + 4) === 'null')  { r += `<span class="syn-null">null</span>`;  i += 4; continue; }
    if ('{}[]:,'.includes(code[i])) { r += `<span class="syn-punct">${esc(code[i])}</span>`; i++; continue; }
    r += esc(code[i]); i++;
  }
  return r;
}

export function highlightHTML(code) {
  return esc(code)
    .replace(/(&lt;\/?)([\w-]+)/g, '<span class="syn-tag">$1$2</span>')
    .replace(/([\w-]+)(=)(&quot;[^&]*&quot;)/g, '<span class="syn-attr">$1</span>$2<span class="syn-str">$3</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="syn-comment">$1</span>');
}

export function highlightCSS(code) {
  return esc(code)
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="syn-comment">$1</span>')
    .replace(/([.#]?[\w-]+)\s*\{/g, '<span class="syn-selector">$1</span>{')
    .replace(/([\w-]+)\s*:/g, '<span class="syn-key">$1</span>:')
    .replace(/:\s*([^;{}\n]+)/g, ': <span class="syn-str">$1</span>');
}

export function highlightJS(code) {
  const kws = /\b(const|let|var|function|return|if|else|for|while|class|import|export|default|async|await|try|catch|new|this|typeof|null|undefined|true|false)\b/g;
  return esc(code)
    .replace(/(\/\/[^\n]*)/g, '<span class="syn-comment">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="syn-comment">$1</span>')
    .replace(/(&quot;[^&]*&quot;|&#039;[^&]*&#039;)/g, '<span class="syn-str">$1</span>')
    .replace(kws, '<span class="syn-bool">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="syn-num">$1</span>')
    .replace(/\b([\w$]+)(?=\s*\()/g, '<span class="syn-fn">$1</span>');
}

export function getHighlighter(mode) {
  const map = { json: highlightJSON, html: highlightHTML, css: highlightCSS, js: highlightJS };
  return map[mode] || (s => esc(s));
}

export function parseJSONError(e, code) {
  const m = e.message;
  const pm = m.match(/position (\d+)/);
  let line = 1, col = 1;
  if (pm) {
    const before = code.slice(0, +pm[1]);
    line = before.split('\n').length;
    col = before.split('\n').pop().length + 1;
  }
  return { msg: m, line, col };
}

export function flattenFields(obj, prefix = '', out = []) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    Object.keys(obj).forEach(k => {
      const path = prefix ? `${prefix}.${k}` : k;
      const v = obj[k];
      const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'boolean' ? 'bool'
        : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'object';
      out.push({ key: k, path, type: t, val: v });
      if (v && typeof v === 'object') flattenFields(v, path, out);
    });
  }
  return out;
}

export function formatAIText(text) {
  return text
    .replace(/```(\w+)?\s*([\s\S]+?)```/g, '<pre>$2</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

export function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```(\w+)?\s*([\s\S]+?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ lang: (m[1] || '').toLowerCase(), code: m[2].trim() });
  }
  return blocks;
}
