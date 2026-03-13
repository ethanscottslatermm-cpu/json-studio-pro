import React, { useState, useCallback, useRef } from 'react';
import Header           from './components/Header';
import CodeEditor       from './components/CodeEditor';
import AIPanel          from './components/AIPanel';
import StatusBar        from './components/StatusBar';
import ProjectAnalyzer  from './components/ProjectAnalyzer';
import SectionMap       from './components/SectionMap';
import SurgicalEditor   from './components/SurgicalEditor';
import { useAI }        from './hooks/useAI';
import { parseJSONError, flattenFields } from './lib/utils';
import { saveSession }  from './lib/supabase';
import './App.css';

const SAMPLE = `{
  "company": "Monarch-Elite Holdings",
  "platform": "Speed2Lead",
  "settings": {
    "deployment": "Netlify",
    "supabase_enabled": true
  }
}`;

export default function App() {
  // To enforce "Clean Startup", change SAMPLE to ''
  const [code, setCode]   = useState(SAMPLE);
  const [mode, setModeRaw] = useState('json');
  const [view, setView]   = useState('code'); 
  const [toast, setToast] = useState(null);
  const [rightPanel, setRightPanel] = useState('ai'); 
  const { call, busy }    = useAI();
  const toastTimer        = useRef(null);
  const editorRef         = useRef(null);

  // ── FIX: JUMP TO LINE LOGIC ────────────────────────────────────────────────
  const handleJumpToLine = useCallback((line) => {
    setView('code');
    // We use a small timeout to ensure the Editor component is rendered before jumping
    setTimeout(() => {
      if (editorRef.current && editorRef.current.jumpToLine) {
        editorRef.current.jumpToLine(line);
      }
    }, 100);
  }, []);

  // ── DERIVED STATE ──────────────────────────────────────────────────────────
  const errors = (() => {
    if (mode !== 'json' || !code.trim()) return [];
    try { JSON.parse(code); return []; }
    catch (e) { return [parseJSONError(e, code)]; }
  })();

  const status = !code.trim() ? 'empty' : errors.length ? 'error' : 'ok';
  const lines = code.split('\n').length;
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  // ── HANDLERS ───────────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const handleApplyCode = useCallback((newCode) => {
    setCode(newCode);
    setView('code');
    showToast('✓ Syncing with GitHub...');
  }, [showToast]);

  const handleFormat = useCallback(() => {
    try {
      setCode(JSON.stringify(JSON.parse(code), null, 2));
      showToast('✨ Formatted');
    } catch { showToast('Fix errors before formatting', 'err'); }
  }, [code, showToast]);

  return (
    <div className="app">
      <Header
        mode={mode}
        setMode={setModeRaw}
        status={status}
        onFormat={handleFormat}
        onPreview={() => setView(v => v === 'preview' ? 'code' : 'preview')}
      />

      <div className="workspace">
        <div className="sidebar">
          <SbBtn title="Editor" icon="✏️" active={view==='code'} onClick={()=>setView('code')} />
          <SbBtn title="Preview" icon="👁️" active={view==='preview'} onClick={()=>setView('preview')} />
          <div className="sb-sep" />
          <SbBtn title="Save" icon="💾" onClick={() => showToast('💾 Saved')} />
          <SbBtn title="Clear" icon="🗑️" onClick={() => setCode('')} />
        </div>

        <div className="main-area">
          {view === 'code' ? (
            <CodeEditor
              ref={editorRef}
              code={code}
              onChange={setCode}
              mode={mode}
              errors={errors}
            />
          ) : (
            <div className="preview-placeholder">Live Preview Active</div>
          )}
        </div>

        {/* RIGHT PANEL - SURGICAL INTEGRATION */}
        <div className="right-panel-wrap">
          <div className="right-panel-tabs">
            <button className={`rp-tab ${rightPanel==="ai"?"on":""}`} onClick={()=>setRightPanel("ai")}>✦ AI</button>
            <button className={`rp-tab ${rightPanel==="surgical"?"on":""}`} onClick={()=>setRightPanel("surgical")}>⚡ Surgical</button>
          </div>
          
          {rightPanel === "ai" ? (
            <AIPanel code={code} mode={mode} onApplyCode={handleApplyCode} onJumpToLine={handleJumpToLine} />
          ) : (
            <SurgicalEditor 
              code={code} 
              mode={mode} 
              onApplyPatch={handleApplyCode} 
              onJumpToLine={handleJumpToLine} 
            />
          )}
        </div>
      </div>

      <StatusBar lines={lines} mode={mode} cursorPos={cursor} />

      {toast && <div className={`toast ${toast.type === 'err' ? 'toast-err' : ''} show`}>{toast.msg}</div>}
    </div>
  );
}

function SbBtn({ icon, title, onClick, active }) {
  return (
    <button className={`sb-btn ${active ? 'active' : ''}`} title={title} onClick={onClick}>
      {icon}
    </button>
  );
}
