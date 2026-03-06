import React, { useState, useRef, useEffect } from 'react';
import { useAI } from '../hooks/useAI';
import { formatAIText, extractCodeBlocks } from '../lib/utils';
import { saveScan } from '../lib/supabase';
import './AIPanel.css';

const QUICK_PROMPTS = [
  'Explain this structure',
  'Fix all errors',
  'Add 3 more records',
  'Generate a schema',
  'Flatten structure',
  'Refactor & optimize',
];

const SCAN_TYPES = [
  { id: 'auto',    label: '✦ Auto-Detect & Fix', cls: 'amber' },
  { id: 'error',   label: '⬤ Error Message',      cls: 'danger' },
  { id: 'ui',      label: '◈ UI / Design Bug',    cls: 'ghost' },
  { id: 'console', label: '⚠ Console Output',     cls: 'ghost' },
  { id: 'code',    label: '◻ Code Screenshot',    cls: 'ghost' },
];

export default function AIPanel({ code, mode, onApplyCode, errors, fields }) {
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([{
    role: 'ai',
    text: `Hello! I'm your JSON Studio AI assistant.\n\nI can **explain**, **repair**, and **generate** code — and analyze screenshots of errors or broken UI.\n\nSwitch to the **📸 Screenshot** tab to upload an error image.`
  }]);
  const [input, setInput] = useState('');
  const [pendingImg, setPendingImg] = useState(null);
  const [scanCtx, setScanCtx] = useState('');
  const [scanHistory, setScanHistory] = useState([]);
  const [dragging, setDragging] = useState(false);

  const { call, busy } = useAI();
  const msgsRef = useRef(null);
  const fileRef  = useRef(null);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages]);

  // ── SEND CHAT MESSAGE ──────────────────────────────────────────────────────
  async function send(text) {
    const msg = text || input.trim();
    if (!msg || busy) return;
    setInput('');
    pushMsg('user', msg);

    const prompt = `You are JSON Studio Pro AI — expert in JSON, HTML, CSS, JavaScript.
Current mode: ${mode.toUpperCase()}
Current editor code:
\`\`\`${mode}
${code || '(empty)'}
\`\`\`

User: ${msg}

Be concise and technical. Wrap code in triple-backtick blocks with language tags.`;

    try {
      const resp = await call({ prompt });
      pushMsg('ai', resp, true);
    } catch (e) {
      pushMsg('ai', `⚠ Connection error: \`${e.message}\``);
    }
  }

  // ── SCREENSHOT ANALYSIS ────────────────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) loadImage(file);
  }

  function loadImage(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target.result.split(',')[1];
      setPendingImg({ base64: b64, mediaType: file.type, name: file.name, src: ev.target.result });
    };
    reader.readAsDataURL(file);
  }

  async function analyze(type) {
    if (!pendingImg || busy) return;
    const typeLabels = { auto: 'Auto-Detect', error: 'Error Message', ui: 'UI Bug', console: 'Console Output', code: 'Code Screenshot' };

    setTab('chat');
    pushMsg('user', `📸 Analyzing screenshot: ${pendingImg.name}\nType: ${typeLabels[type]}${scanCtx ? `\nContext: ${scanCtx}` : ''}`, false, pendingImg.src);

    const prompts = {
      error:   `You are an expert debugger. Analyze this error screenshot. Identify the exact error, its root cause, and provide a complete fix with code.`,
      ui:      `You are an expert UI developer. Analyze this UI/design bug screenshot. Describe what's broken visually and provide the CSS/HTML fix.`,
      console: `You are an expert developer. Analyze this console output screenshot. Explain every issue and provide specific code fixes.`,
      code:    `You are an expert code reviewer. Analyze this code screenshot. Identify all bugs, errors, and issues. Provide the corrected code.`,
      auto:    `You are an expert full-stack developer. Auto-detect what type of issue this screenshot shows (error, UI bug, console, code, etc). Provide a complete diagnosis and all fixes needed with code examples.`,
    };

    let fullPrompt = prompts[type];
    if (scanCtx) fullPrompt += `\n\nContext: ${scanCtx}`;
    if (code) fullPrompt += `\n\nCurrent editor code:\n\`\`\`${mode}\n${code}\n\`\`\``;
    fullPrompt += `\n\nStructure your response:\n1. **What I See**\n2. **Root Cause**\n3. **Fix** (with code blocks)`;

    try {
      const resp = await call({ prompt: fullPrompt, image: pendingImg });
      pushMsg('ai', resp, true);

      // Save to Supabase
      await saveScan({
        filename: pendingImg.name,
        analysisType: type,
        aiResponse: resp,
        imageThumb: pendingImg.src,
      });

      setScanHistory(h => [{ name: pendingImg.name, type: typeLabels[type], time: new Date().toLocaleTimeString() }, ...h.slice(0, 9)]);
      setPendingImg(null);
      setScanCtx('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      pushMsg('ai', `⚠ Analysis error: \`${e.message}\``);
    }
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function pushMsg(role, text, checkCode = false, imgSrc = null) {
    setMessages(m => [...m, { role, text, imgSrc }]);
    if (checkCode) {
      const blocks = extractCodeBlocks(text);
      blocks.forEach(b => {
        if (['json','html','css','js','javascript'].includes(b.lang) || b.code.startsWith('{') || b.code.startsWith('[')) {
          setTimeout(() => setMessages(m => [...m, { role: 'apply', code: b.code, lang: b.lang }]), 80);
        }
      });
    }
  }

  const errCount = errors.length;

  return (
    <div className="ai-panel">
      {/* TABS */}
      <div className="ai-tabs">
        {[
          { id: 'chat',       label: '✦ AI Chat'    },
          { id: 'screenshot', label: '📸 Screenshot' },
          { id: 'errors',     label: `⚠ Errors${errCount ? ` (${errCount})` : ''}` },
          { id: 'fields',     label: '⊞ Fields'     },
        ].map(t => (
          <button key={t.id} className={`ai-tab ${tab === t.id ? 'active' : ''} ${t.id === 'errors' && errCount ? 'has-badge' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── CHAT TAB ── */}
      {tab === 'chat' && (
        <div className="ai-chat">
          <div className="messages" ref={msgsRef}>
            {messages.map((m, i) => (
              <Message key={i} msg={m} onApply={code => { onApplyCode(code); }} />
            ))}
            {busy && <div className="msg msg-ai"><div className="msg-label">AI</div><LoadingDots /></div>}
          </div>
          <div className="chat-bottom">
            <div className="quick-prompts">
              {QUICK_PROMPTS.map(p => (
                <button key={p} className="qp" onClick={() => send(p)}>{p}</button>
              ))}
            </div>
            <div className="input-row">
              <textarea
                className="chat-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask anything about your code..."
                rows={1}
              />
              <button className="send-btn" onClick={() => send()} disabled={busy}>➤</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SCREENSHOT TAB ── */}
      {tab === 'screenshot' && (
        <div className="screenshot-panel">
          <div className="ss-scroll">
            <p className="ss-desc">Upload a screenshot of an error, broken UI, console output, or any code bug — AI will diagnose and fix it.</p>

            {/* DROP ZONE */}
            {!pendingImg && (
              <div
                className={`drop-zone ${dragging ? 'dragging' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files[0]) loadImage(e.target.files[0]); }} />
                <div className="dz-icon">📸</div>
                <div className="dz-title">Drop screenshot here</div>
                <div className="dz-sub">or click to browse — PNG, JPG, WebP</div>
              </div>
            )}

            {/* IMAGE PREVIEW */}
            {pendingImg && (
              <div className="img-preview">
                <img src={pendingImg.src} alt="screenshot" />
                <div className="img-meta">
                  <span className="img-name">{pendingImg.name}</span>
                  <button className="img-remove" onClick={() => { setPendingImg(null); if(fileRef.current) fileRef.current.value=''; }}>✕ Remove</button>
                </div>
              </div>
            )}

            {/* ANALYZE OPTIONS */}
            {pendingImg && (
              <div className="scan-opts">
                <div className="scan-opts-label">ANALYZE AS</div>
                <div className="scan-btns">
                  {SCAN_TYPES.map(t => (
                    <button key={t.id} className={`scan-btn ${t.cls}`} onClick={() => analyze(t.id)} disabled={busy}>{t.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* CONTEXT */}
            {pendingImg && (
              <div className="ctx-wrap">
                <div className="ctx-label">ADD CONTEXT (optional)</div>
                <textarea
                  className="ctx-input"
                  value={scanCtx}
                  onChange={e => setScanCtx(e.target.value)}
                  placeholder="e.g. 'React app using Supabase and Netlify'"
                  rows={2}
                />
              </div>
            )}

            {/* SCAN HISTORY */}
            {scanHistory.length > 0 && (
              <div className="scan-history">
                <div className="ctx-label">RECENT SCANS</div>
                {scanHistory.map((s, i) => (
                  <div key={i} className="history-row" onClick={() => setTab('chat')}>
                    <span className="hist-icon">📸</span>
                    <div className="hist-info">
                      <div className="hist-name">{s.name}</div>
                      <div className="hist-type">{s.type} · {s.time}</div>
                    </div>
                    <span className="hist-done">✓</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ERRORS TAB ── */}
      {tab === 'errors' && (
        <div className="errors-panel">
          {errors.length === 0 ? (
            <div className="no-errors">
              <span className="no-err-icon">✓</span>
              <p>No errors detected</p>
            </div>
          ) : (
            errors.map((e, i) => (
              <div key={i} className="error-card">
                <div className="err-title">⚠ Line {e.line}, Col {e.col}</div>
                <div className="err-msg">{e.msg}</div>
              </div>
            ))
          )}
          {errors.length > 0 && (
            <div className="errors-footer">
              <button className="scan-btn danger" onClick={() => { setTab('chat'); send('Fix all syntax errors in my code'); }}>
                🔧 Auto-Fix All Errors
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── FIELDS TAB ── */}
      {tab === 'fields' && (
        <div className="fields-panel">
          {fields.length === 0 ? (
            <div className="no-errors"><span className="no-err-icon">{ }</span><p>No fields — valid JSON needed</p></div>
          ) : (
            fields.map((f, i) => (
              <div key={i} className="field-row">
                <span className="f-key">{f.key}</span>
                <span className="f-path">{f.path}</span>
                <span className={`f-type ft-${f.type}`}>{f.type}</span>
              </div>
            ))
          )}
          <div className="fields-footer">
            <button className="scan-btn amber" onClick={() => { setTab('chat'); send('Add a new relevant field to this JSON with a good key and value'); }}>
              ✦ AI Add Field
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MESSAGE ────────────────────────────────────────────────────────────────
function Message({ msg, onApply }) {
  if (msg.role === 'apply') {
    return (
      <button className="apply-btn" onClick={() => onApply(msg.code)}>
        ⬆ Apply {(msg.lang || 'code').toUpperCase()} to Editor
      </button>
    );
  }
  return (
    <div className={`msg msg-${msg.role === 'user' ? 'user' : 'ai'}`}>
      {msg.role === 'ai' && <div className="msg-label">AI ASSISTANT</div>}
      {msg.imgSrc && (
        <div className="msg-img-wrap">
          <img src={msg.imgSrc} alt="screenshot" className="msg-img" />
        </div>
      )}
      <div dangerouslySetInnerHTML={{ __html: formatAIText(msg.text) }} />
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="loading-dots">
      <span>●</span><span>●</span><span>●</span>
    </div>
  );
}
