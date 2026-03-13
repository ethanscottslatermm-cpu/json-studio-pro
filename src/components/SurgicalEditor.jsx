import React, { useState, useCallback, useRef } from 'react';
import './SurgicalEditor.css';

const API_URL = '/.netlify/functions/ai';
const MAP_SAMPLE_EVERY = 30;   
const CHUNK_CHARS      = 12000; 

// ── AI CALL (For Analysis) ──────────────────────────────────────────────────
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

// ── UTILITIES ────────────────────────────────────────────────────────────────
function buildFileSkeleton(code, mode) {
  const lines = code.split('\n');
  const skeleton = [];
  const isJSX = mode === 'js' || mode === 'jsx';
  const isCSS = mode === 'css';

  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) return;
    const isStructural = (isJSX && (trimmed.startsWith('import ') || trimmed.startsWith('export'))) || (isCSS && trimmed.endsWith('{'));
    if (isStructural) skeleton.push(`L${ln}: ${line.slice(0, 90)}`);
  });
  return skeleton.join('\n').slice(0, 7000);
}

function extractChunk(code, startLine, endLine) {
  const lines = code.split('\n');
  return {
    content: lines.slice(startLine - 1, endLine).join('\n'),
    before:  lines.slice(0, startLine - 1),
    after:   lines.slice(endLine),
  };
}

function stitchPatch(before, patched, after) {
  return [...before, ...patched.split('\n'), ...after].join('\n');
}

function parseJSON(str) {
  let clean = str.trim().replace(/^```json\s*/m,'').replace(/^```\s*/m,'').replace(/\s*```$/m,'').trim();
  try { return JSON.parse(clean); } catch { throw new Error('Could not parse AI response'); }
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SurgicalEditor({ code, mode, onApplyPatch, onJumpToLine }) {
  const [phase, setPhase]           = useState('idle');     
  const [fileMap, setFileMap]       = useState(null);       
  const [intent, setIntent]         = useState('');         
  const [analysis, setAnalysis]     = useState(null);       
  const [patches, setPatches]       = useState([]);         
  const [appliedCount, setApplied]  = useState(0);
  const [log, setLog]               = useState([]);         
  const [expandedSection, setExpanded] = useState(null);
  
  // ── NEW GITHUB PERSISTENCE STATE ──
  const [fileSha, setFileSha]       = useState(null); 
  const [targetPath, setTargetPath] = useState('src/data/inventory.json'); // Set your default target file
  
  const logRef = useRef(null);

  const addLog = useCallback((msg, type = 'info') => {
    setLog(l => [...l, { msg, type, ts: Date.now() }]);
    setTimeout(() => logRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
  }, []);

  // ── STEP 1: BUILD FILE MAP ─────────────────────────────────────────────────
  const buildMap = useCallback(async () => {
    if (!code.trim()) return;
    setPhase('mapping');
    setLog([]);
    addLog('Scanning file structure...', 'info');

    try {
      const skeleton = buildFileSkeleton(code, mode);
      const prompt = `Analyze this ${mode} file and return a JSON array of sections: {id, title, category, description, startLine, endLine}.\n\nCode:\n${skeleton}`;
      const resp = await callAI(prompt, 2000);
      const sections = parseJSON(resp);
      setFileMap(sections);
      addLog(`✓ Mapped ${sections.length} sections`, 'success');
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
    addLog(`Analyzing request: "${intent}"`, 'info');

    try {
      const prompt = `Based on these sections: ${JSON.stringify(fileMap)}, analyze this request: "${intent}". Return JSON: {summary, approach, affectedSections: [ids], riskLevel}.`;
      const resp = await callAI(prompt, 1000);
      setAnalysis(parseJSON(resp));
      addLog(`✓ Analysis complete`, 'success');
      setPhase('ready');
    } catch (e) {
      addLog(`✗ Analysis failed: ${e.message}`, 'error');
      setPhase('ready');
    }
  }, [intent, fileMap, addLog]);

  // ── STEP 3: RUN PATCHES (In-Memory Preview) ──────────────────────────────
  const runPatches = useCallback(async () => {
    if (!analysis || !fileMap) return;
    setPhase('patching');
    addLog('Generating surgical patches...', 'info');

    const affected = fileMap.filter(s => analysis.affectedSections?.includes(s.id));
    const newPatches = [];

    for (const section of affected) {
      try {
        const { content } = extractChunk(code, section.startLine, section.endLine);
        const prompt = `Fix this ${mode} code block based on: "${intent}". Return ONLY the fixed code.\n\n${content}`;
        const patched = await callAI(prompt, 2000);
        const clean = patched.trim().replace(/^```[\w]*\s*/,'').replace(/\s*```$/,'').trim();

        newPatches.push({
          ...section,
          original: content,
          patched: clean,
          fullPatched: stitchPatch(code.split('\n').slice(0, section.startLine - 1), clean, code.split('\n').slice(section.endLine)),
          status: 'pending'
        });
        addLog(`✓ Patch ready for ${section.title}`, 'success');
      } catch (e) { addLog(`✗ Failed ${section.title}: ${e.message}`, 'error'); }
    }
    setPatches(newPatches);
    setPhase('review');
  }, [analysis, fileMap, code, mode, intent, addLog]);

  // ── STEP 4: PERSISTENT APPLY (GitHub Mutation) ───────────────────────────
  const applyPatch = useCallback(async (patchIdx) => {
    const patch = patches[patchIdx];
    if (!patch) return;

    addLog(`↗ Mutating file on GitHub: ${targetPath}...`, 'info');

    try {
      const response = await fetch('/.netlify/functions/repair-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: targetPath,
          content: patch.fullPatched,
          sha: fileSha, 
          instruction: intent
        }),
      });

      const data = await response.json();

      if (response.ok) {
        onApplyPatch(patch.fullPatched); // Update local UI
        setPatches(p => p.map((x, i) => i === patchIdx ? { ...x, status: 'applied' } : x));
        setApplied(c => c + 1);
        setFileSha(data.newSha); // Update SHA for next mutation
        addLog(`✓ File Mutated Successfully on GitHub!`, 'success');
      } else {
        throw new Error(data.error || 'GitHub Write Failed');
      }
    } catch (err) {
      addLog(`✗ Mutation Failed: ${err.message}`, 'error');
    }
  }, [patches, onApplyPatch, targetPath, fileSha, intent, addLog]);

  // ── RENDER ──
  if (phase === 'idle' && !code.trim()) {
    return (
      <div className="se-empty-workspace">
        <div className="se-empty-icon">⚡</div>
        <h2>Welcome, Chef!</h2>
        <p>Paste or upload a JSON file to begin surgical analysis.</p>
      </div>
    );
  }

  return (
    <div className="se-wrap">
      <div className="se-header">
        <div className="se-title">⚡ Surgical Editor</div>
        <input 
          className="se-path-input" 
          value={targetPath} 
          onChange={e => setTargetPath(e.target.value)} 
          placeholder="GitHub File Path"
        />
        <button className="se-map-btn" onClick={buildMap} disabled={phase === 'mapping'}>
          {phase === 'mapping' ? '⟳ Mapping...' : '⬡ Map File'}
        </button>
      </div>

      {fileMap && (
        <div className="se-intent-wrap">
          <textarea
            className="se-intent-input"
            value={intent}
            onChange={e => setIntent(e.target.value)}
            placeholder="What should the AI fix or change?"
          />
          <button className="se-analyze-btn" onClick={analyzeIntent} disabled={phase === 'analyzing'}>
            ✦ Analyze
          </button>
        </div>
      )}

      {analysis && phase !== 'patching' && patches.length === 0 && (
        <div className="se-analysis">
          <p>{analysis.summary}</p>
          <button className="se-run-btn" onClick={runPatches}>⚡ Run Surgical Patches</button>
        </div>
      )}

      {log.length > 0 && (
        <div className="se-log" ref={logRef}>
          {log.map((l, i) => <div key={i} className={`se-log-line se-log-${l.type}`}>{l.msg}</div>)}
        </div>
      )}

      {patches.map((patch, i) => (
        <div key={i} className={`se-patch se-patch-${patch.status}`}>
          <div className="se-patch-header">
            <span>{patch.title}</span>
            <span className="se-patch-status">{patch.status}</span>
          </div>
          <div className="se-diff-cols">
             <pre className="se-diff-code removed">{patch.original}</pre>
             <pre className="se-diff-code added">{patch.patched}</pre>
          </div>
          {patch.status === 'pending' && (
            <button className="se-apply-btn" onClick={() => applyPatch(i)}>✓ Apply & Save to GitHub</button>
          )}
        </div>
      ))}
    </div>
  );
}
