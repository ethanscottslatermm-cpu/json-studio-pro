import React, { useState, useCallback, useRef } from 'react';
import Header          from './components/Header';
import CodeEditor      from './components/CodeEditor';
import AIPanel         from './components/AIPanel';
import StatusBar       from './components/StatusBar';
import ProjectAnalyzer from './components/ProjectAnalyzer';
import SectionMap      from './components/SectionMap';
import SurgicalEditor  from './components/SurgicalEditor';
import { useAI } from './hooks/useAI';
import { parseJSONError, flattenFields } from './lib/utils';
import { saveSession } from './lib/supabase';
import './App.css';

// ── DEFAULT SAMPLE ────────────────────────────────────────────────────────────
const SAMPLE = `{
  "company": "Monarch-Elite Holdings",
  "platform": "Speed2Lead",
  "division": "Insurance Lead Generation",
  "campaigns": [
    {
      "id": "cam_001",
      "name": "Group Health — Michigan",
      "status": "active",
      "budget": 15000,
      "leads": 342,
      "conversion_rate": 0.18,
      "target_naics": ["524114", "524113"],
      "crm": "Close.io",
      "tcpa_compliant": true,
      "agents": [
        { "id": "agt_01", "name": "Sarah Chen", "region": "Detroit", "active": true },
        { "id": "agt_02", "name": "Marcus Rivera", "region": "Grand Rapids", "active": true }
      ]
    },
    {
      "id": "cam_002",
      "name": "Commercial Lines — California",
      "status": "paused",
      "budget": 22000,
      "leads": 189,
      "conversion_rate": 0.14,
      "target_naics": ["238210", "236220"],
      "crm": "Convoso",
      "tcpa_compliant": true,
      "agents": [
        { "id": "agt_03", "name": "Elena Park", "region": "Los Angeles", "active": true }
      ]
    }
  ],
  "settings": {
    "speed_to_lead_seconds": 45,
    "auto_assign": true,
    "email_provider": "EmailJS",
    "deployment": "Netlify",
    "supabase_enabled": true
  },
  "last_updated": null
}`;

export default function App() {
  const [code, setCode]   = useState(SAMPLE);
  const [mode, setModeRaw] = useState('json');
  const [view, setView]   = useState('code'); // code | preview
  const [toast, setToast] = useState(null);
  const [rightPanel, setRightPanel] = useState('ai'); // ai | sections
  const { call, busy }    = useAI();
  const toastTimer        = useRef(null);
  const editorRef         = useRef(null);

  const handleJumpToLine = (line) => {
    setView('code');
    setTimeout(() => editorRef.current?.jumpToLine(line), 50);
  };

  // ── DERIVED STATE ──────────────────────────────────────────────────────────
  const errors = (() => {
    if (mode !== 'json' || !code.trim()) return [];
    try { JSON.parse(code); return []; }
    catch (e) { return [parseJSONError(e, code)]; }
  })();

  const status = !code.trim() ? 'empty' : errors.length ? 'error' : 'ok';

  const fields = (() => {
    if (mode !== 'json') return [];
    try { return flattenFields(JSON.parse(code)); }
    catch { return []; }
  })();

  const lines = code.split('\n').length;
  const bytes = new TextEncoder().encode(code).length;
  const size  = bytes < 1024 ? `${bytes} B` : `${(bytes/1024).toFixed(1)} KB`;
  const keyCount = fields.filter(f => f.type !== 'object' && f.type !== 'array').length || null;

  // Cursor position (approximate — tracked via caret)
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  // ── HANDLERS ───────────────────────────────────────────────────────────────
  const setMode = useCallback((m) => {
    setModeRaw(m);
    setView('code');
  }, []);

  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const handleFormat = useCallback(() => {
    if (mode !== 'json') { showToast('Format available in JSON mode', 'warn'); return; }
    try {
      setCode(JSON.stringify(JSON.parse(code), null, 2));
      showToast('✨ Formatted');
    } catch { showToast('Fix errors before formatting', 'err'); }
  }, [code, mode, showToast]);

  const handleFix = useCallback(async () => {
    if (mode !== 'json') { showToast('Auto-Fix available in JSON mode', 'warn'); return; }
    try { JSON.parse(code); showToast('✓ No errors to fix'); return; } catch {}
    try {
      const resp = await call({
        prompt: `Fix ALL syntax errors in this JSON. Return ONLY corrected JSON — no explanation, no markdown:\n\n${code}`,
        maxTokens: 2000
      });
      const clean = resp.trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
      JSON.parse(clean);
      setCode(JSON.stringify(JSON.parse(clean), null, 2));
      showToast('🔧 Auto-repaired by AI');
    } catch (e) {
      showToast('Repair failed — try AI chat', 'err');
    }
  }, [code, mode, call, showToast]);

  const handleGenerate = useCallback(() => {
    showToast('Use AI chat to generate code ✦');
  }, [showToast]);

  const handlePreview = useCallback(() => {
    setView(v => v === 'preview' ? 'code' : 'preview');
  }, []);

  const handleApplyCode = useCallback((newCode) => {
    setCode(newCode);
    setView('code');
    showToast('✓ Applied to editor');
  }, [showToast]);

  const handleSaveSession = useCallback(async () => {
    await saveSession({ mode, code });
    showToast('💾 Session saved to Supabase');
  }, [mode, code]);

  // Build preview HTML
  const previewSrc = (() => {
    if (mode === 'html') return code;
    if (mode === 'json') return `<!DOCTYPE html><html><head>
      <style>body{background:#0c0d0e;color:#e8e9ea;font-family:'JetBrains Mono',monospace;padding:24px;font-size:12.5px;}
      pre{background:#111315;border:1px solid #222527;border-radius:5px;padding:18px;line-height:1.7;overflow-x:auto;white-space:pre-wrap;}
      .t{color:#b8956a;font-size:10px;font-weight:700;letter-spacing:2px;margin-bottom:10px;font-family:'Barlow Condensed',sans-serif;}</style>
      </head><body><div class="t">JSON OUTPUT</div><pre>${code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
    if (mode === 'css') return `<!DOCTYPE html><html><head><style>${code}</style></head>
      <body><div class="container"><h1>Heading</h1><p>Paragraph text sample</p>
      <button>Button</button><input placeholder="Input field"/><div class="card"><p>Card component</p></div></div></body></html>`;
    if (mode === 'js') return `<!DOCTYPE html><html><head>
      <style>body{background:#0c0d0e;color:#e8e9ea;font-family:'JetBrains Mono',monospace;padding:20px;font-size:12px;}
      #out{background:#111315;border:1px solid #222527;border-radius:5px;padding:14px;min-height:80px;white-space:pre-wrap;}</style>
      </head><body><div style="color:#b8956a;font-size:10px;font-weight:700;letter-spacing:2px;margin-bottom:8px;">CONSOLE OUTPUT</div>
      <div id="out"></div>
      <script>const _o=document.getElementById('out');const _l=console.log;
      console.log=(...a)=>{_o.textContent+=a.join(' ')+'\\n';_l(...a);};
      try{${code}}catch(e){_o.textContent+='ERROR: '+e.message;_o.style.color='#a85c5c';}
      <\/script></body></html>`;
    return '<p>No preview available</p>';
  })();

  return (
    <div className="app">
      <Header
        mode={mode}
        setMode={setMode}
        status={status}
        onFormat={handleFormat}
        onFix={handleFix}
        onGenerate={handleGenerate}
        onPreview={handlePreview}
      />

      <div className="workspace">
        {/* LEFT SIDEBAR */}
        <div className="sidebar">
          <SbBtn title="Code Editor"  icon="✏️" active={view==='code'}    onClick={()=>setView('code')} />
          <SbBtn title="Live Preview" icon="👁️" active={view==='preview'} onClick={()=>setView('preview')} />
          <div className="sb-sep" />
          <SbBtn title="Format"    icon="✨" onClick={handleFormat} />
          <SbBtn title="Minify"    icon="⬛" onClick={() => {
            if (mode !== 'json') return;
            try { setCode(JSON.stringify(JSON.parse(code))); showToast('⬛ Minified'); }
            catch { showToast('Fix errors first','err'); }
          }} />
          <div className="sb-sep" />
          <SbBtn title="Load Sample" icon="📄" onClick={() => { setCode(SAMPLE); setModeRaw('json'); showToast('📄 Sample loaded'); }} />
          <SbBtn title="Copy"        icon="⎘"  onClick={() => { navigator.clipboard.writeText(code); showToast('⎘ Copied'); }} />
          <SbBtn title="Save Session" icon="💾" onClick={handleSaveSession} />
          <SbBtn title="Clear"       icon="🗑️" onClick={() => { setCode(''); showToast('Cleared'); }} />
        </div>

      {/* MAIN AREA */}
      <div className="main-area">
        {/* PROJECT ANALYZER MODE */}
        {mode === 'project' ? (
          <ProjectAnalyzer />
        ) : (
          <>
            {/* EDITOR TAB BAR */}
            <div className="tab-bar">
              <div className="tab active">
                {mode === 'json' ? '{ }' : mode === 'html' ? '◈' : mode === 'css' ? '◉' : '⌬'}
                &nbsp;
                {view === 'preview' ? 'preview' : { json:'untitled.json', html:'index.html', css:'styles.css', js:'script.js' }[mode]}
              </div>
              <div style={{ flex: 1 }} />
            </div>

            {/* CODE EDITOR */}
            {view === 'code' && (
              <CodeEditor
                ref={editorRef}
                code={code}
                onChange={setCode}
                mode={mode}
                errors={errors}
              />
            )}

            {/* PREVIEW */}
            {view === 'preview' && (
              <div className="preview-wrap">
                <div className="preview-chrome">
                  <div className="chrome-dots">
                    <span style={{background:'#ff5f57'}} />
                    <span style={{background:'#febc2e'}} />
                    <span style={{background:'#28c840'}} />
                  </div>
                  <span className="chrome-url">preview.{mode}</span>
                  <button className="chrome-btn" onClick={() => {
                    const w = window.open('','_blank');
                    w.document.write(previewSrc);
                    w.document.close();
                  }}>⤢</button>
                </div>
                <iframe
                  className="preview-frame"
                  srcDoc={previewSrc}
                  title="preview"
                  sandbox="allow-scripts"
                />
              </div>
            )}
          </>
        )}
      </div>

        {/* RIGHT PANEL */}
        <div className="right-panel-wrap">
          <div className="right-panel-tabs">
            <button className={"rp-tab " + (rightPanel==="ai"?"on":"")} onClick={()=>setRightPanel("ai")}>✦ AI Chat</button>
            <button className={"rp-tab " + (rightPanel==="sections"?"on":"")} onClick={()=>setRightPanel("sections")}>⬡ Sections</button>
            <button className={"rp-tab " + (rightPanel==="surgical"?"on":"")} onClick={()=>setRightPanel("surgical")}>⚡ Surgical</button>
          </div>
          {rightPanel === "ai" ? (
            <AIPanel
              code={code}
              mode={mode}
              onApplyCode={handleApplyCode}
              errors={errors}
              fields={fields}
              onJumpToLine={handleJumpToLine}
            />
          ) : rightPanel === "sections" ? (
            <SectionMap
              code={code}
              mode={mode}
              onJumpToLine={handleJumpToLine}
              onApplyPatch={(patched) => { handleApplyCode(patched); }}
            />
          ) : (
            <SurgicalEditor
              code={code}
              mode={mode}
              onJumpToLine={handleJumpToLine}
              onApplyPatch={(patched) => { handleApplyCode(patched); }}
            />
          )}
        </div>
      </div>

      <StatusBar
        lines={lines}
        size={size}
        keys={keyCount}
        cursorPos={cursor}
        mode={mode}
      />

      {/* TOAST */}
      {toast && (
        <div className={`toast ${toast.type === 'err' ? 'toast-err' : ''} show`}>
          {toast.msg}
        </div>
      )}
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
