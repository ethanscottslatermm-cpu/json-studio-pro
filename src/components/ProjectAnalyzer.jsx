import React, { useState, useRef, useCallback } from 'react';
import './ProjectAnalyzer.css';

const MAX_CHUNK_TOKENS = 60000; // safe per-request limit
const CHARS_PER_TOKEN  = 4;     // rough estimate
const MAX_CHUNK_CHARS  = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;

const API_URL = '/.netlify/functions/ai';

// File extensions we can meaningfully analyze
const SUPPORTED_EXT = [
  '.js','.jsx','.ts','.tsx','.json','.css','.html',
  '.md','.env.example','.toml','.sql','.txt','.py',
];

function isSupportedFile(name) {
  if (name.startsWith('.')) return false; // skip .git etc
  return SUPPORTED_EXT.some(ext => name.toLowerCase().endsWith(ext));
}

function estimateTokens(str) {
  return Math.ceil(str.length / CHARS_PER_TOKEN);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── CHUNKER ──────────────────────────────────────────────────────────────────
// Groups files into chunks that each fit within the token limit
function chunkFiles(files) {
  const chunks = [];
  let current = [];
  let currentChars = 0;

  for (const f of files) {
    if (f.content.length > MAX_CHUNK_CHARS) {
      // Large file: split into sub-chunks
      let offset = 0;
      while (offset < f.content.length) {
        const slice = f.content.slice(offset, offset + MAX_CHUNK_CHARS);
        chunks.push([{ ...f, content: slice, partial: true, partOffset: offset }]);
        offset += MAX_CHUNK_CHARS;
      }
    } else if (currentChars + f.content.length > MAX_CHUNK_CHARS) {
      if (current.length) chunks.push(current);
      current = [f];
      currentChars = f.content.length;
    } else {
      current.push(f);
      currentChars += f.content.length;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ProjectAnalyzer() {
  const [files, setFiles]           = useState([]);   // { name, path, content, size, tokens }
  const [question, setQuestion]     = useState('');
  const [results, setResults]       = useState([]);   // { role, text, files? }
  const [busy, setBusy]             = useState(false);
  const [progress, setProgress]     = useState(null); // { current, total, label }
  const [selectedFiles, setSelected]= useState(new Set()); // paths selected for focused Q
  const [view, setView]             = useState('upload'); // upload | files | chat
  const [summary, setSummary]       = useState(null);
  const dropRef   = useRef(null);
  const fileInput = useRef(null);
  const msgsEnd   = useRef(null);

  // ── FILE LOADING ────────────────────────────────────────────────────────────
  async function readEntries(entry, pathPrefix = '') {
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(file => {
          if (!isSupportedFile(file.name)) return resolve([]);
          const reader = new FileReader();
          reader.onload = e => resolve([{
            name: file.name,
            path: pathPrefix + file.name,
            content: e.target.result,
            size: file.size,
            tokens: estimateTokens(e.target.result),
          }]);
          reader.onerror = () => resolve([]);
          reader.readAsText(file);
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries(async entries => {
          const nested = await Promise.all(
            entries.map(e => readEntries(e, pathPrefix + entry.name + '/'))
          );
          resolve(nested.flat());
        });
      } else {
        resolve([]);
      }
    });
  }

  async function handleDrop(e) {
    e.preventDefault();
    dropRef.current?.classList.remove('drag');
    const items = [...e.dataTransfer.items];
    const allFiles = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        const read = await readEntries(entry);
        allFiles.push(...read);
      }
    }
    if (allFiles.length) loadFiles(allFiles);
  }

  async function handleFileInput(e) {
    const raw = [...e.target.files];
    const loaded = await Promise.all(raw.filter(f => isSupportedFile(f.name)).map(f =>
      new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = ev => resolve({
          name: f.name,
          path: f.webkitRelativePath || f.name,
          content: ev.target.result,
          size: f.size,
          tokens: estimateTokens(ev.target.result),
        });
        reader.onerror = () => resolve(null);
        reader.readAsText(f);
      })
    ));
    loadFiles(loaded.filter(Boolean));
  }

  function loadFiles(newFiles) {
    // Dedupe by path
    setFiles(prev => {
      const map = new Map(prev.map(f => [f.path, f]));
      newFiles.forEach(f => map.set(f.path, f));
      return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
    });
    setSelected(new Set(newFiles.map(f => f.path)));
    setView('files');
  }

  function removeFile(path) {
    setFiles(f => f.filter(x => x.path !== path));
    setSelected(s => { const n = new Set(s); n.delete(path); return n; });
  }

  function toggleSelect(path) {
    setSelected(s => {
      const n = new Set(s);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
  }

  // ── AI CALLS ────────────────────────────────────────────────────────────────
  async function callAI(prompt) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    return (data.content || []).map(b => b.text || '').join('');
  }

  // Full codebase summary — chunked
  async function analyzeProject() {
    if (!files.length || busy) return;
    setBusy(true);
    setSummary(null);
    setView('chat');

    const active = files.filter(f => selectedFiles.has(f.path));
    const chunks  = chunkFiles(active);
    const chunkSummaries = [];

    pushResult('system', `🔍 Analyzing ${active.length} files in ${chunks.length} chunk${chunks.length > 1 ? 's' : ''}...`);

    try {
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ current: i + 1, total: chunks.length, label: chunks[i].map(f => f.name).join(', ') });

        const fileBlock = chunks[i].map(f =>
          `### FILE: ${f.path}${f.partial ? ` (partial, offset ${f.partOffset})` : ''}\n\`\`\`\n${f.content}\n\`\`\``
        ).join('\n\n');

        const prompt = `You are a senior code reviewer analyzing a codebase chunk (${i + 1} of ${chunks.length}).

${fileBlock}

Provide a concise technical summary covering:
1. What these files do
2. Key patterns, dependencies, or issues noticed
3. Any bugs, errors, or improvements worth flagging

Be specific and brief. This summary will be combined with others for a full project analysis.`;

        const resp = await callAI(prompt);
        chunkSummaries.push({ files: chunks[i].map(f => f.path), summary: resp });
      }

      setProgress({ current: chunks.length, total: chunks.length, label: 'Synthesizing...' });

      // Final synthesis
      const synthPrompt = `You are a senior architect. Below are analysis summaries of different chunks of a codebase.

${chunkSummaries.map((c, i) => `## Chunk ${i + 1} (${c.files.join(', ')})\n${c.summary}`).join('\n\n')}

Now provide a comprehensive project analysis:
1. **Project Overview** — what this codebase does
2. **Architecture** — how it's structured
3. **Tech Stack** — frameworks, libraries, services used
4. **Key Issues** — bugs, errors, or problems found
5. **Recommendations** — top improvements to make
6. **File Map** — brief role of each major file`;

      const synthesis = await callAI(synthPrompt);
      setSummary({ text: synthesis, chunkSummaries });
      pushResult('ai', synthesis);

    } catch (e) {
      pushResult('error', `Analysis error: ${e.message}`);
    } finally {
      setBusy(false);
      setProgress(null);
      msgsEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // Focused question on selected files
  async function askQuestion() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    pushResult('user', q);
    setBusy(true);

    const active = files.filter(f => selectedFiles.has(f.path));
    if (!active.length) {
      pushResult('error', 'No files selected. Select files in the Files tab first.');
      setBusy(false);
      return;
    }

    const chunks = chunkFiles(active);
    const answers = [];

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          setProgress({ current: i + 1, total: chunks.length, label: `Searching chunk ${i+1}...` });
        }
        const fileBlock = chunks[i].map(f =>
          `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``
        ).join('\n\n');

        const prompt = `You are a code expert. Answer the user's question based on the code below.

${fileBlock}

Question: ${q}

${summary ? `Project context: ${summary.text.slice(0, 500)}` : ''}

Be specific, reference exact file names and line areas where relevant.`;

        const resp = await callAI(prompt);
        answers.push(resp);
      }

      const final = answers.length === 1
        ? answers[0]
        : await callAI(`Combine these answers into one clear response:\n\n${answers.join('\n\n---\n\n')}`);

      pushResult('ai', final);
    } catch (e) {
      pushResult('error', `Error: ${e.message}`);
    } finally {
      setBusy(false);
      setProgress(null);
      msgsEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function pushResult(role, text, extra = {}) {
    setResults(r => [...r, { role, text, ...extra }]);
    setTimeout(() => msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  // ── STATS ───────────────────────────────────────────────────────────────────
  const totalTokens  = files.reduce((s, f) => s + f.tokens, 0);
  const activeTokens = files.filter(f => selectedFiles.has(f.path)).reduce((s, f) => s + f.tokens, 0);
  const chunks       = files.filter(f => selectedFiles.has(f.path)).length
    ? chunkFiles(files.filter(f => selectedFiles.has(f.path))).length : 0;

  const QUICK_QS = [
    'What does this codebase do?',
    'Find all bugs and errors',
    'What dependencies are used?',
    'How is the data flow structured?',
    'What needs to be refactored?',
    'Are there any security issues?',
    'Explain the component structure',
    'What API calls are being made?',
  ];

  return (
    <div className="pa-wrap">
      {/* ── TABS ── */}
      <div className="pa-tabs">
        <button className={`pa-tab ${view==='upload'?'on':''}`} onClick={()=>setView('upload')}>⬆ Upload</button>
        <button className={`pa-tab ${view==='files'?'on':''}`} onClick={()=>setView('files')}>
          📁 Files {files.length > 0 && <span className="pa-badge">{files.length}</span>}
        </button>
        <button className={`pa-tab ${view==='chat'?'on':''}`} onClick={()=>setView('chat')}>
          ✦ Analysis {results.length > 0 && <span className="pa-badge">{results.filter(r=>r.role==='ai').length}</span>}
        </button>
      </div>

      {/* ── UPLOAD VIEW ── */}
      {view === 'upload' && (
        <div className="pa-upload">
          <div
            ref={dropRef}
            className="pa-dropzone"
            onDragOver={e=>{e.preventDefault();dropRef.current.classList.add('drag');}}
            onDragLeave={()=>dropRef.current.classList.remove('drag')}
            onDrop={handleDrop}
            onClick={()=>fileInput.current.click()}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              webkitdirectory=""
              style={{display:'none'}}
              onChange={handleFileInput}
            />
            <div className="pa-dz-icon">📁</div>
            <div className="pa-dz-title">Drop your project folder here</div>
            <div className="pa-dz-sub">or click to browse — drag an entire folder to load all files at once</div>
          </div>

          <div className="pa-supported">
            <div className="pa-sup-label">SUPPORTED FILE TYPES</div>
            <div className="pa-sup-list">
              {SUPPORTED_EXT.map(e => <span key={e} className="pa-ext">{e}</span>)}
            </div>
          </div>

          <div className="pa-info-cards">
            <div className="pa-info-card">
              <div className="pa-ic-icon">⚡</div>
              <div className="pa-ic-text">
                <strong>Smart Chunking</strong>
                Files too large for one request are automatically split and analyzed in segments
              </div>
            </div>
            <div className="pa-info-card">
              <div className="pa-ic-icon">🔍</div>
              <div className="pa-ic-text">
                <strong>Full Synthesis</strong>
                All chunks are combined into one comprehensive project analysis
              </div>
            </div>
            <div className="pa-info-card">
              <div className="pa-ic-icon">💬</div>
              <div className="pa-ic-text">
                <strong>Ask Anything</strong>
                After analysis, ask specific questions about any part of the codebase
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── FILES VIEW ── */}
      {view === 'files' && (
        <div className="pa-files">
          {/* STATS BAR */}
          <div className="pa-stats">
            <div className="pa-stat">
              <span className="pa-stat-val">{files.length}</span>
              <span className="pa-stat-lbl">files</span>
            </div>
            <div className="pa-stat-sep" />
            <div className="pa-stat">
              <span className="pa-stat-val">{selectedFiles.size}</span>
              <span className="pa-stat-lbl">selected</span>
            </div>
            <div className="pa-stat-sep" />
            <div className="pa-stat">
              <span className="pa-stat-val">{activeTokens.toLocaleString()}</span>
              <span className="pa-stat-lbl">tokens</span>
            </div>
            <div className="pa-stat-sep" />
            <div className="pa-stat">
              <span className="pa-stat-val">{chunks}</span>
              <span className="pa-stat-lbl">chunk{chunks !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* SELECT ALL / NONE */}
          <div className="pa-sel-row">
            <button className="pa-sel-btn" onClick={()=>setSelected(new Set(files.map(f=>f.path)))}>Select All</button>
            <button className="pa-sel-btn" onClick={()=>setSelected(new Set())}>None</button>
            <button className="pa-sel-btn" onClick={()=>fileInput.current.click()}>+ Add More</button>
            <input ref={fileInput} type="file" multiple webkitdirectory="" style={{display:'none'}} onChange={handleFileInput}/>
          </div>

          {/* FILE LIST */}
          <div className="pa-file-list">
            {files.map(f => (
              <div key={f.path} className={`pa-file-row ${selectedFiles.has(f.path)?'sel':''}`}>
                <input
                  type="checkbox"
                  className="pa-checkbox"
                  checked={selectedFiles.has(f.path)}
                  onChange={()=>toggleSelect(f.path)}
                />
                <div className="pa-file-info" onClick={()=>toggleSelect(f.path)}>
                  <span className="pa-file-name">{f.name}</span>
                  <span className="pa-file-path">{f.path}</span>
                </div>
                <div className="pa-file-meta">
                  <span className="pa-file-tokens">{f.tokens.toLocaleString()} tk</span>
                  <span className="pa-file-size">{formatSize(f.size)}</span>
                </div>
                <button className="pa-file-rm" onClick={()=>removeFile(f.path)}>✕</button>
              </div>
            ))}
          </div>

          {/* ANALYZE BUTTON */}
          <div className="pa-analyze-wrap">
            <button
              className="pa-analyze-btn"
              onClick={analyzeProject}
              disabled={busy || !selectedFiles.size}
            >
              {busy ? '⟳ Analyzing...' : `✦ Analyze ${selectedFiles.size} File${selectedFiles.size!==1?'s':''} — ${chunks} Chunk${chunks!==1?'s':''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── CHAT / ANALYSIS VIEW ── */}
      {view === 'chat' && (
        <div className="pa-chat">
          {/* PROGRESS */}
          {busy && progress && (
            <div className="pa-progress">
              <div className="pa-prog-bar">
                <div className="pa-prog-fill" style={{width:`${(progress.current/progress.total)*100}%`}} />
              </div>
              <div className="pa-prog-label">
                Chunk {progress.current}/{progress.total} — {progress.label}
              </div>
            </div>
          )}

          {/* MESSAGES */}
          <div className="pa-messages">
            {results.length === 0 && (
              <div className="pa-empty">
                <div className="pa-empty-icon">✦</div>
                <p>Upload files and click Analyze, or ask a question below</p>
              </div>
            )}
            {results.map((r, i) => (
              <div key={i} className={`pa-msg pa-msg-${r.role}`}>
                {r.role === 'ai' && <div className="pa-msg-lbl">AI ANALYSIS</div>}
                {r.role === 'user' && <div className="pa-msg-lbl">YOU</div>}
                {r.role === 'system' && <div className="pa-msg-lbl">SYSTEM</div>}
                <div dangerouslySetInnerHTML={{__html: formatText(r.text)}} />
              </div>
            ))}
            {busy && !progress && (
              <div className="pa-msg pa-msg-ai">
                <div className="pa-msg-lbl">AI ANALYSIS</div>
                <div className="pa-ld"><span>●</span><span>●</span><span>●</span></div>
              </div>
            )}
            <div ref={msgsEnd} />
          </div>

          {/* QUICK QUESTIONS */}
          <div className="pa-quick">
            {QUICK_QS.map(q => (
              <button key={q} className="pa-qp" onClick={()=>{setQuestion(q);}}>{q}</button>
            ))}
          </div>

          {/* INPUT */}
          <div className="pa-input-wrap">
            <div className="pa-file-scope">
              <span className="pa-scope-lbl">Searching:</span>
              <span className="pa-scope-val">{selectedFiles.size} file{selectedFiles.size!==1?'s':''}</span>
              <button className="pa-scope-btn" onClick={()=>setView('files')}>Change</button>
            </div>
            <div className="pa-irow">
              <textarea
                className="pa-input"
                value={question}
                onChange={e=>setQuestion(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askQuestion();}}}
                placeholder="Ask anything about your codebase..."
                rows={1}
              />
              <button className="pa-send" onClick={askQuestion} disabled={busy || !question.trim()}>➤</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatText(text) {
  return text
    .replace(/```(\w+)?\s*([\s\S]+?)```/g, '<pre>$2</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, '<div class="pa-heading">$1</div>')
    .replace(/\n/g, '<br/>');
}
