import React, { useState, useCallback, useRef } from 'react';
import './SurgicalEditor.css';

const API_URL = '/.netlify/functions/ai';
const MAP_SAMPLE_EVERY = 30;   // lines between samples for large files
const CHUNK_CHARS      = 12000; // chars per surgical chunk (~3k tokens)

// ── AI CALL ─────────────────────────────────────────────────────────────────
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
  const text = (data.content || []).map(b => b.text || '').join('');
  if (!text) throw new Error('Empty response');
  return text;
}

// ── SMART FILE SAMPLER ───────────────────────────────────────────────────────
// For large files: extract structural skeleton without sending full content
function buildFileSkeleton(code, mode) {
  const lines = code.split('\n');
  const skeleton = [];

  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();
    const isStructural =
      // CSS: selectors, variables, @rules
      (mode === 'css' && (trimmed.startsWith(':root') || trimmed.startsWith('@') || (trimmed.includes('{') && !trimmed.startsWith('//')) || trimmed.startsWith('--'))) ||
      // JS/JSX: functions, components, imports, exports, hooks, classes
      ((mode === 'js' || mode === 'jsx') && (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('function ') || trimmed.startsWith('const ') || trimmed.startsWith('class ') || trimmed.startsWith('async ') || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('useEffect') || trimmed.startsWith('useState'))) ||
      // HTML: tags, comments
      (mode === 'html' && (trimmed.startsWith('<') || trimmed.startsWith('<!--'))) ||
      // JSON: top-level keys
      (mode === 'json' && (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')));

    if (isStructural || ln % MAP_SAMPLE_EVERY === 0) {
      skeleton.push(`L${ln}: ${line.slice(0, 120)}`);
    }
  });

  return skeleton.join('\n');
}

// ── EXTRACT CHUNK ─────────────────────────────────────────────────────────────
function extractChunk(code, startLine, endLine) {
  const lines = code.split('\n');
  return {
    content: lines.slice(startLine - 1, endLine).join('\n'),
    before:  lines.slice(0, startLine - 1),
    after:   lines.slice(endLine),
  };
}

// ── STITCH PATCH ─────────────────────────────────────────────────────────────
function stitchPatch(before, patched, after) {
  return [...before, ...patched.split('\n'), ...after].join('\n');
}

// ── PARSE JSON SAFE ──────────────────────────────────────────────────────────
function parseJSON(str) {
  const clean = str.trim()
    .replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
  return JSON.parse(clean);
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SurgicalEditor({ code, mode, onApplyPatch, onJumpToLine }) {
  const [phase, setPhase]           = useState('idle');     // idle | mapping | ready | analyzing | patching | review
  const [fileMap, setFileMap]       = useState(null);       // array of sections
  const [intent, setIntent]         = useState('');         // user instruction
  const [analysis, setAnalysis]     = useState(null);       // AI analysis result
  const [patches, setPatches]       = useState([]);         // proposed patches
  const [appliedCount, setApplied]  = useState(0);
  const [log, setLog]               = useState([]);         // progress log
  const [expandedSection, setExpanded] = useState(null);
  const logRef = useRef(null);

  const addLog = useCallback((msg, type = 'info') => {
    setLog(l => [...l, { msg, type, ts: Date.now() }]);
    setTimeout(() => logRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
  }, []);

  // ── STEP 1: BUILD FILE MAP ─────────────────────────────────────────────────
  const buildMap = useCallback(async () => {
    if (!code.trim()) return;
    setPhase('mapping');
    setFileMap(null);
    setAnalysis(null);
    setPatches([]);
    setLog([]);
    addLog('Building file skeleton...', 'info');

    const totalLines = code.split('\n').length;
    const isLarge    = code.length > 40000;

    try {
      const skeleton = isLarge ? buildFileSkeleton(code, mode) : code;
      addLog(`File: ${totalLines} lines, ${(code.length/1024).toFixed(1)}KB — ${isLarge ? 'large file mode (skeleton)' : 'full scan'}`, 'info');

      const prompt = `You are a code architect analyzing a ${mode.toUpperCase()} file.

${isLarge ? 'File skeleton (structural lines extracted):' : 'Full file:'}
\`\`\`
${skeleton.slice(0, 30000)}
\`\`\`

Return a JSON array of code sections. Each section:
{
  "id": "unique_snake_case_id",
  "title": "Human readable title",
  "category": one of: "authentication" | "database" | "ui_layout" | "styling" | "typography" | "navigation" | "forms" | "api_calls" | "state_management" | "routing" | "configuration" | "utilities" | "email" | "error_handling" | "data_processing" | "imports" | "exports" | "components" | "hooks" | "animations" | "responsive" | "security" | "performance",
  "description": "Plain English: what this section does and why it matters",
  "startLine": number,
  "endLine": number,
  "complexity": "simple" | "moderate" | "complex",
  "issues": ["any obvious issues or smells noticed, empty array if none"]
}

Be thorough — identify ALL logical sections. Return ONLY the JSON array.`;

      const resp = await callAI(prompt, 2500);
      const sections = parseJSON(resp);
      setFileMap(sections);
      addLog(`✓ Mapped ${sections.length} sections across ${totalLines} lines`, 'success');
      setPhase('ready');
    } catch (e) {
      addLog(`✗ Map failed: ${e.message}`, 'error');
      setPhase('idle');
    }
  }, [code, mode, addLog]);

  // ── STEP 2: ANALYZE INTENT ────────────────────────────────────────────────
  const analyzeIntent = useCallback(async () => {
    if (!intent.trim() || !fileMap) return;
    setPhase('analyzing');
    setAnalysis(null);
    setPatches([]);
    addLog(`Analyzing: "${intent}"`, 'info');

    try {
      const mapSummary = fileMap.map(s =>
        `[${s.id}] ${s.title} (${s.category}) L${s.startLine}-${s.endLine} — ${s.description}${s.issues?.length ? ` ⚠ Issues: ${s.issues.join(', ')}` : ''}`
      ).join('\n');

      const prompt = `You are a code surgeon. A developer wants to make changes to their ${mode.toUpperCase()} codebase.

Developer's request: "${intent}"

File sections available:
${mapSummary}

Analyze the request and return a JSON object:
{
  "summary": "Plain English explanation of what needs to change and why",
  "approach": "Step-by-step approach to make these changes safely",
  "affectedSections": ["array of section IDs that need to be read/modified"],
  "riskLevel": "low" | "medium" | "high",
  "riskReason": "Why this risk level",
  "estimatedChunks": number,
  "warnings": ["any warnings the developer should know before proceeding"]
}

Be precise about which sections are affected. Return ONLY the JSON.`;

      const resp = await callAI(prompt, 1000);
      const result = parseJSON(resp);
      setAnalysis(result);
      addLog(`✓ Analysis complete — ${result.affectedSections?.length || 0} sections affected`, 'success');
      if (result.warnings?.length) {
        result.warnings.forEach(w => addLog(`⚠ ${w}`, 'warn'));
      }
      setPhase('ready');
    } catch (e) {
      addLog(`✗ Analysis failed: ${e.message}`, 'error');
      setPhase('ready');
    }
  }, [intent, fileMap, mode, addLog]);

  // ── STEP 3: SURGICAL PATCH ───────────────────────────────────────────────
  const runPatches = useCallback(async () => {
    if (!analysis || !fileMap) return;
    setPhase('patching');
    setPatches([]);
    addLog('Starting surgical patches...', 'info');

    const affected = fileMap.filter(s => analysis.affectedSections?.includes(s.id));
    const newPatches = [];

    for (let i = 0; i < affected.length; i++) {
      const section = affected[i];
      addLog(`Patching [${i+1}/${affected.length}]: ${section.title}...`, 'info');

      try {
        const { content, before, after } = extractChunk(code, section.startLine, section.endLine);

        // If chunk is too large, split it
        const chunks = [];
        if (content.length > CHUNK_CHARS) {
          const lines = content.split('\n');
          let chunk = [];
          let chunkStart = section.startLine;
          lines.forEach((line, idx) => {
            chunk.push(line);
            if (chunk.join('\n').length > CHUNK_CHARS || idx === lines.length - 1) {
              chunks.push({ content: chunk.join('\n'), startLine: chunkStart, endLine: chunkStart + chunk.length - 1 });
              chunkStart += chunk.length;
              chunk = [];
            }
          });
        } else {
          chunks.push({ content, startLine: section.startLine, endLine: section.endLine });
        }

        for (const chunk of chunks) {
          const prompt = `You are a surgical code editor. Make ONLY the changes needed for this specific request.

Request: "${intent}"
Section: "${section.title}" (${section.category})
File type: ${mode.toUpperCase()}
Lines: ${chunk.startLine}-${chunk.endLine}

Context from analysis: ${analysis.approach}

Current code for this section:
\`\`\`${mode}
${chunk.content}
\`\`\`

Rules:
1. Make ONLY changes relevant to the request
2. Do NOT rewrite unrelated code
3. Preserve all existing logic, variable names, and structure unless the request requires changing them
4. Return ONLY the updated code for this section — no explanation, no markdown fences
5. If this section needs NO changes for this request, return it exactly as-is`;

          const patched = await callAI(prompt, 2000);
          const clean = patched.trim()
            .replace(/^```[\w]*\s*/,'').replace(/\s*```$/,'').trim();

          // Only add to patches if something actually changed
          if (clean !== chunk.content.trim()) {
            newPatches.push({
              sectionId:    section.id,
              sectionTitle: section.title,
              category:     section.category,
              startLine:    chunk.startLine,
              endLine:      chunk.endLine,
              original:     chunk.content,
              patched:      clean,
              fullPatched:  stitchPatch(
                code.split('\n').slice(0, chunk.startLine - 1),
                clean,
                code.split('\n').slice(chunk.endLine)
              ),
              status: 'pending',
            });
            addLog(`✓ Changes found in "${section.title}"`, 'success');
          } else {
            addLog(`○ No changes needed in "${section.title}"`, 'skip');
          }
        }
      } catch (e) {
        addLog(`✗ Failed "${section.title}": ${e.message}`, 'error');
      }
    }

    setPatches(newPatches);
    if (newPatches.length === 0) {
      addLog('No changes were needed — code already satisfies the request', 'success');
    } else {
      addLog(`✓ ${newPatches.length} patch${newPatches.length !== 1 ? 'es' : ''} ready for review`, 'success');
    }
    setPhase('review');
  }, [analysis, fileMap, code, mode, intent, addLog]);

  // ── APPLY SINGLE PATCH ────────────────────────────────────────────────────
  const applyPatch = useCallback((patchIdx) => {
    const patch = patches[patchIdx];
    if (!patch) return;
    onApplyPatch(patch.fullPatched);
    setPatches(p => p.map((x, i) => i === patchIdx ? { ...x, status: 'applied' } : x));
    setApplied(c => c + 1);
    onJumpToLine(patch.startLine);
  }, [patches, onApplyPatch, onJumpToLine]);

  // ── APPLY ALL PATCHES ─────────────────────────────────────────────────────
  const applyAll = useCallback(() => {
    // Apply patches in reverse line order to preserve line numbers
    const sorted = [...patches]
      .map((p, i) => ({ ...p, idx: i }))
      .filter(p => p.status === 'pending')
      .sort((a, b) => b.startLine - a.startLine);

    let currentCode = code;
    for (const patch of sorted) {
      const lines = currentCode.split('\n');
      const before = lines.slice(0, patch.startLine - 1);
      const after  = lines.slice(patch.endLine);
      currentCode  = [...before, ...patch.patched.split('\n'), ...after].join('\n');
    }
    onApplyPatch(currentCode);
    setPatches(p => p.map(x => ({ ...x, status: 'applied' })));
    setApplied(patches.length);
  }, [patches, code, onApplyPatch]);

  const rejectPatch = useCallback((patchIdx) => {
    setPatches(p => p.map((x, i) => i === patchIdx ? { ...x, status: 'rejected' } : x));
  }, []);

  // ── CATEGORY COLORS ───────────────────────────────────────────────────────
  const catColor = {
    authentication: 'cat-auth', database: 'cat-db', ui_layout: 'cat-ui',
    styling: 'cat-style', typography: 'cat-type', navigation: 'cat-nav',
    forms: 'cat-form', api_calls: 'cat-api', state_management: 'cat-state',
    routing: 'cat-route', configuration: 'cat-config', utilities: 'cat-util',
    email: 'cat-email', error_handling: 'cat-err', data_processing: 'cat-data',
    imports: 'cat-import', exports: 'cat-import', components: 'cat-comp',
    hooks: 'cat-hook', animations: 'cat-anim', responsive: 'cat-resp',
    security: 'cat-sec', performance: 'cat-perf',
  };

  const pendingPatches = patches.filter(p => p.status === 'pending');

  return (
    <div className="se-wrap">

      {/* ── HEADER ── */}
      <div className="se-header">
        <div className="se-title">⚡ Surgical Editor</div>
        {code.trim() && (
          <button className="se-map-btn" onClick={buildMap} disabled={phase === 'mapping' || phase === 'patching'}>
            {phase === 'mapping' ? '⟳ Mapping...' : fileMap ? `⟳ Re-map (${fileMap.length})` : '⬡ Map File'}
          </button>
        )}
      </div>

      {/* ── NO CODE STATE ── */}
      {!code.trim() && (
        <div className="se-empty">
          <div className="se-empty-icon">⚡</div>
          <p>Paste your code into the editor then click Map File</p>
        </div>
      )}

      {/* ── INTENT INPUT ── */}
      {fileMap && (
        <div className="se-intent-wrap">
          <div className="se-intent-label">WHAT DO YOU WANT TO CHANGE?</div>
          <textarea
            className="se-intent-input"
            value={intent}
            onChange={e => setIntent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analyzeIntent(); }}}
            placeholder={`Examples:\n• Fix all Supabase connection errors\n• Change the color scheme to dark blue\n• Add loading states to all API calls\n• Fix the email template not sending\n• Make the form validation more robust`}
            rows={3}
          />
          <button
            className="se-analyze-btn"
            onClick={analyzeIntent}
            disabled={!intent.trim() || phase === 'analyzing' || phase === 'patching'}
          >
            {phase === 'analyzing' ? '⟳ Analyzing...' : '✦ Analyze Changes'}
          </button>
        </div>
      )}

      {/* ── ANALYSIS RESULT ── */}
      {analysis && (
        <div className="se-analysis">
          <div className="se-analysis-header">
            <span className="se-analysis-title">ANALYSIS</span>
            <span className={`se-risk se-risk-${analysis.riskLevel}`}>{analysis.riskLevel} risk</span>
          </div>
          <p className="se-analysis-summary">{analysis.summary}</p>
          <p className="se-analysis-approach">{analysis.approach}</p>
          <div className="se-affected-list">
            {analysis.affectedSections?.map(id => {
              const s = fileMap?.find(x => x.id === id);
              return s ? (
                <span key={id} className={`se-affected-tag ${catColor[s.category] || 'cat-util'}`}>
                  {s.title}
                </span>
              ) : null;
            })}
          </div>
          {phase !== 'patching' && pendingPatches.length === 0 && (
            <button className="se-run-btn" onClick={runPatches} disabled={phase === 'patching'}>
              ⚡ Run {analysis.affectedSections?.length} Surgical Patch{analysis.affectedSections?.length !== 1 ? 'es' : ''}
            </button>
          )}
        </div>
      )}

      {/* ── PROGRESS LOG ── */}
      {log.length > 0 && (
        <div className="se-log" ref={logRef}>
          {log.map((l, i) => (
            <div key={i} className={`se-log-line se-log-${l.type}`}>
              {l.msg}
            </div>
          ))}
          {phase === 'patching' && (
            <div className="se-log-line se-log-info">
              <span className="se-ld"><span>●</span><span>●</span><span>●</span></span>
            </div>
          )}
        </div>
      )}

      {/* ── FILE MAP ── */}
      {fileMap && phase !== 'patching' && (
        <div className="se-map">
          <div className="se-map-header">
            <span className="se-map-label">FILE MAP — {fileMap.length} SECTIONS</span>
            <span className="se-map-lines">{code.split('\n').length} lines</span>
          </div>
          <div className="se-sections">
            {fileMap.map((s, i) => (
              <div key={s.id} className={`se-section ${expandedSection === i ? 'expanded' : ''} ${analysis?.affectedSections?.includes(s.id) ? 'affected' : ''}`}>
                <div className="se-sec-row" onClick={() => { setExpanded(expandedSection === i ? null : i); onJumpToLine(s.startLine); }}>
                  <span className={`se-cat ${catColor[s.category] || 'cat-util'}`}>{s.category.replace(/_/g,' ')}</span>
                  <span className="se-sec-title">{s.title}</span>
                  <span className="se-sec-lines">L{s.startLine}–{s.endLine}</span>
                  {s.issues?.length > 0 && <span className="se-issue-badge">⚠{s.issues.length}</span>}
                  {analysis?.affectedSections?.includes(s.id) && <span className="se-affected-badge">targeted</span>}
                </div>
                {expandedSection === i && (
                  <div className="se-sec-detail">
                    <p className="se-sec-desc">{s.description}</p>
                    {s.issues?.length > 0 && (
                      <div className="se-issues">
                        {s.issues.map((issue, j) => (
                          <div key={j} className="se-issue">⚠ {issue}</div>
                        ))}
                      </div>
                    )}
                    <div className="se-sec-actions">
                      <button className="se-sec-btn" onClick={(e) => { e.stopPropagation(); setIntent(`Fix issues in the ${s.title} section`); }}>
                        Fix this section
                      </button>
                      <button className="se-sec-btn" onClick={(e) => { e.stopPropagation(); setIntent(`Explain and improve the ${s.title} section`); }}>
                        Improve this section
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PATCHES REVIEW ── */}
      {patches.length > 0 && (
        <div className="se-patches">
          <div className="se-patches-header">
            <span className="se-patches-title">PROPOSED CHANGES — {patches.length} PATCH{patches.length !== 1 ? 'ES' : ''}</span>
            {pendingPatches.length > 1 && (
              <button className="se-apply-all-btn" onClick={applyAll}>
                ✓ Apply All ({pendingPatches.length})
              </button>
            )}
          </div>
          {patches.map((patch, i) => (
            <div key={i} className={`se-patch se-patch-${patch.status}`}>
              <div className="se-patch-header">
                <span className={`se-patch-cat ${catColor[patch.category] || 'cat-util'}`}>{patch.category?.replace(/_/g,' ')}</span>
                <span className="se-patch-title">{patch.sectionTitle}</span>
                <span className="se-patch-lines">L{patch.startLine}–{patch.endLine}</span>
                {patch.status !== 'pending' && (
                  <span className={`se-patch-status ${patch.status}`}>
                    {patch.status === 'applied' ? '✓ applied' : '✕ rejected'}
                  </span>
                )}
              </div>
              <div className="se-diff-cols">
                <div className="se-diff-col">
                  <div className="se-diff-lbl removed">BEFORE</div>
                  <pre className="se-diff-code removed">{patch.original}</pre>
                </div>
                <div className="se-diff-col">
                  <div className="se-diff-lbl added">AFTER</div>
                  <pre className="se-diff-code added">{patch.patched}</pre>
                </div>
              </div>
              {patch.status === 'pending' && (
                <div className="se-patch-actions">
                  <button className="se-apply-btn" onClick={() => applyPatch(i)}>✓ Apply</button>
                  <button className="se-reject-btn" onClick={() => rejectPatch(i)}>✕ Reject</button>
                  <button className="se-jump-btn" onClick={() => onJumpToLine(patch.startLine)}>↗ Jump to line</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
