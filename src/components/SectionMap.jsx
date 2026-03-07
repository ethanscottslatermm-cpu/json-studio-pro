import React, { useState, useCallback } from 'react';
import './SectionMap.css';

const API_URL = '/.netlify/functions/ai';

async function callAI(prompt, maxTokens = 1500) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'API error');
  return (data.content || []).map(b => b.text || '').join('');
}

export default function SectionMap({ code, mode, onJumpToLine, onApplyPatch }) {
  const [sections, setSections]       = useState([]);
  const [search, setSearch]           = useState('');
  const [busy, setBusy]               = useState(false);
  const [selected, setSelected]       = useState(null); // selected section
  const [instruction, setInstruction] = useState('');
  const [explanation, setExplanation] = useState(null);
  const [diff, setDiff]               = useState(null);   // { original, patched, sectionIdx }
  const [patchBusy, setPatchBusy]     = useState(false);
  const [searchBusy, setSearchBusy]   = useState(false);
  const [searchResults, setSearchResults] = useState(null);

  // ── GENERATE SECTION MAP ──────────────────────────────────────────────────
  const generateMap = useCallback(async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setSections([]);
    setSelected(null);
    setExplanation(null);
    setDiff(null);

    const prompt = `You are a code analyzer. Analyze this ${mode.toUpperCase()} code and return a JSON array of sections.

Each section must have:
- "title": short plain-English label (e.g. "Font & Typography", "Button Styles", "Supabase Connection", "Lead Form Handler")
- "description": one sentence plain-English description of what this section does
- "startLine": line number where this section starts (1-indexed)
- "endLine": line number where this section ends
- "type": one of: "config", "styles", "component", "function", "data", "imports", "exports", "util"
- "keywords": array of 3-5 search keywords in plain English

Return ONLY a valid JSON array. No explanation, no markdown, just the raw JSON array.

Code:
\`\`\`${mode}
${code}
\`\`\``;

    try {
      const resp = await callAI(prompt, 2000);
      const clean = resp.trim()
        .replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
      const parsed = JSON.parse(clean);
      setSections(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      setSections([{ title: 'Parse Error', description: e.message, startLine: 1, endLine: 1, type: 'config', keywords: [] }]);
    } finally {
      setBusy(false);
    }
  }, [code, mode, busy]);

  // ── EXPLAIN SECTION ───────────────────────────────────────────────────────
  const explainSection = useCallback(async (section) => {
    setSelected(section);
    setExplanation(null);
    setDiff(null);
    onJumpToLine(section.startLine);

    const lines = code.split('\n').slice(section.startLine - 1, section.endLine);
    const snippet = lines.join('\n');

    const prompt = `You are a coding teacher explaining code to a beginner.

Explain this ${mode.toUpperCase()} code section called "${section.title}" in plain English.
No jargon. Explain what each part does like explaining to someone learning to code for the first time.
Keep it under 150 words. Use simple bullet points.

Code:
\`\`\`${mode}
${snippet}
\`\`\``;

    try {
      const resp = await callAI(prompt, 600);
      setExplanation(resp);
    } catch (e) {
      setExplanation(`Error: ${e.message}`);
    }
  }, [code, mode, onJumpToLine]);

  // ── APPLY INSTRUCTION TO SECTION ─────────────────────────────────────────
  const applyInstruction = useCallback(async () => {
    if (!selected || !instruction.trim() || patchBusy) return;
    setPatchBusy(true);
    setDiff(null);

    const lines = code.split('\n');
    const snippet = lines.slice(selected.startLine - 1, selected.endLine).join('\n');

    const prompt = `You are a code editor. Apply the user's instruction to ONLY this specific section of code.

Section: "${selected.title}" (lines ${selected.startLine}–${selected.endLine})
Mode: ${mode.toUpperCase()}
Instruction: ${instruction}

Original section code:
\`\`\`${mode}
${snippet}
\`\`\`

Return ONLY the updated section code — no explanation, no markdown fences, just the raw updated code that replaces this section exactly.`;

    try {
      const patched = await callAI(prompt, 1500);
      const clean = patched.trim()
        .replace(/^```[\w]*\s*/,'').replace(/\s*```$/,'').trim();

      // Build full patched file
      const before  = lines.slice(0, selected.startLine - 1);
      const after   = lines.slice(selected.endLine);
      const patchedLines = clean.split('\n');
      const fullPatched  = [...before, ...patchedLines, ...after].join('\n');

      setDiff({ original: snippet, patched: clean, fullPatched, sectionTitle: selected.title });
    } catch (e) {
      setDiff({ error: e.message });
    } finally {
      setPatchBusy(false);
    }
  }, [selected, instruction, code, mode, patchBusy]);

  // ── PLAIN ENGLISH SEARCH ──────────────────────────────────────────────────
  const searchCode = useCallback(async () => {
    if (!search.trim() || searchBusy || !sections.length) return;
    setSearchBusy(true);
    setSearchResults(null);

    const prompt = `A user is searching their ${mode.toUpperCase()} code for: "${search}"

Here are the available code sections:
${sections.map((s, i) => `${i}. "${s.title}" — ${s.description} (keywords: ${s.keywords?.join(', ')})`).join('\n')}

Return a JSON array of section indices (numbers only) that are most relevant to the search query.
Return ONLY the JSON array like [0, 2, 4]. If nothing matches return [].`;

    try {
      const resp = await callAI(prompt, 200);
      const clean = resp.trim().replace(/^```.*$/gm,'').trim();
      const indices = JSON.parse(clean);
      setSearchResults(Array.isArray(indices) ? indices : []);
    } catch (e) {
      // fallback: simple keyword match
      const q = search.toLowerCase();
      const matches = sections.reduce((acc, s, i) => {
        const haystack = `${s.title} ${s.description} ${(s.keywords||[]).join(' ')}`.toLowerCase();
        if (haystack.includes(q)) acc.push(i);
        return acc;
      }, []);
      setSearchResults(matches);
    } finally {
      setSearchBusy(false);
    }
  }, [search, sections, mode, searchBusy]);

  // ── TYPE COLORS ───────────────────────────────────────────────────────────
  const typeColor = {
    config:    'tc-config',
    styles:    'tc-styles',
    component: 'tc-component',
    function:  'tc-function',
    data:      'tc-data',
    imports:   'tc-imports',
    exports:   'tc-exports',
    util:      'tc-util',
  };

  const visibleSections = searchResults !== null
    ? sections.filter((_, i) => searchResults.includes(i))
    : sections;

  return (
    <div className="sm-wrap">
      {/* HEADER ROW */}
      <div className="sm-header">
        <div className="sm-title">Section Map</div>
        <button className="sm-gen-btn" onClick={generateMap} disabled={busy || !code.trim()}>
          {busy ? '⟳ Mapping...' : '⬡ Generate Map'}
        </button>
      </div>

      {/* SEARCH BAR */}
      {sections.length > 0 && (
        <div className="sm-search-row">
          <input
            className="sm-search"
            value={search}
            onChange={e => { setSearch(e.target.value); if (!e.target.value) setSearchResults(null); }}
            onKeyDown={e => e.key === 'Enter' && searchCode()}
            placeholder="Search in plain English — e.g. font, button hover, API call..."
          />
          <button className="sm-search-btn" onClick={searchCode} disabled={searchBusy}>
            {searchBusy ? '⟳' : '⌕'}
          </button>
          {searchResults !== null && (
            <button className="sm-clear-btn" onClick={() => { setSearchResults(null); setSearch(''); }}>✕</button>
          )}
        </div>
      )}

      {/* SEARCH RESULTS LABEL */}
      {searchResults !== null && (
        <div className="sm-search-label">
          {searchResults.length === 0
            ? 'No sections found for that search'
            : `${searchResults.length} section${searchResults.length !== 1 ? 's' : ''} found`}
        </div>
      )}

      {/* EMPTY STATE */}
      {sections.length === 0 && !busy && (
        <div className="sm-empty">
          <div className="sm-empty-icon">⬡</div>
          <p>Click Generate Map to analyze your code into sections</p>
        </div>
      )}

      {/* LOADING */}
      {busy && (
        <div className="sm-loading">
          <div className="sm-ld"><span>●</span><span>●</span><span>●</span></div>
          <p>Analyzing code structure...</p>
        </div>
      )}

      {/* SECTION LIST */}
      {visibleSections.length > 0 && (
        <div className="sm-sections">
          {visibleSections.map((s, i) => (
            <div
              key={i}
              className={`sm-section ${selected?.title === s.title ? 'active' : ''}`}
              onClick={() => explainSection(s)}
            >
              <div className="sm-sec-top">
                <span className={`sm-type ${typeColor[s.type] || 'tc-util'}`}>{s.type}</span>
                <span className="sm-lines">L{s.startLine}–{s.endLine}</span>
              </div>
              <div className="sm-sec-title">{s.title}</div>
              <div className="sm-sec-desc">{s.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* SELECTED SECTION DETAIL */}
      {selected && (
        <div className="sm-detail">
          <div className="sm-detail-header">
            <span className="sm-detail-title">{selected.title}</span>
            <button className="sm-detail-close" onClick={() => { setSelected(null); setExplanation(null); setDiff(null); }}>✕</button>
          </div>

          {/* EXPLANATION */}
          {explanation && (
            <div className="sm-explanation">
              <div className="sm-exp-label">PLAIN ENGLISH EXPLANATION</div>
              <div className="sm-exp-text" dangerouslySetInnerHTML={{ __html: formatText(explanation) }} />
            </div>
          )}

          {!explanation && !diff && (
            <div className="sm-exp-loading"><div className="sm-ld"><span>●</span><span>●</span><span>●</span></div></div>
          )}

          {/* INSTRUCTION INPUT */}
          <div className="sm-instruction-wrap">
            <div className="sm-inst-label">EDIT THIS SECTION</div>
            <div className="sm-inst-row">
              <textarea
                className="sm-inst-input"
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyInstruction(); }}}
                placeholder={`e.g. "Change font to Barlow" or "Add a hover effect" or "Fix the spacing"`}
                rows={2}
              />
              <button className="sm-inst-btn" onClick={applyInstruction} disabled={patchBusy || !instruction.trim()}>
                {patchBusy ? '⟳' : '⬆'}
              </button>
            </div>
          </div>

          {/* DIFF PREVIEW */}
          {diff && !diff.error && (
            <div className="sm-diff">
              <div className="sm-diff-label">PROPOSED CHANGES — {diff.sectionTitle}</div>
              <div className="sm-diff-cols">
                <div className="sm-diff-col">
                  <div className="sm-diff-col-label removed">BEFORE</div>
                  <pre className="sm-diff-code removed">{diff.original}</pre>
                </div>
                <div className="sm-diff-col">
                  <div className="sm-diff-col-label added">AFTER</div>
                  <pre className="sm-diff-code added">{diff.patched}</pre>
                </div>
              </div>
              <div className="sm-diff-actions">
                <button className="sm-apply-btn" onClick={() => {
                  onApplyPatch(diff.fullPatched);
                  setDiff(null);
                  setInstruction('');
                }}>✓ Apply Changes</button>
                <button className="sm-reject-btn" onClick={() => { setDiff(null); }}>✕ Reject</button>
              </div>
            </div>
          )}

          {diff?.error && (
            <div className="sm-diff-error">⚠ Patch error: {diff.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatText(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^[•\-] (.+)$/gm, '<div class="sm-bullet">• $1</div>')
    .replace(/\n/g, '<br/>');
}
