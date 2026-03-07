import React from 'react';
import './Header.css';

// ── LOGO ──────────────────────────────────────────────────────────────────────
// Replace the <div className="logo-emblem"> block with an <img> tag once you
// export your Canva logo:
//   <img src="/logo.png" alt="JSON Studio Pro" className="logo-img" />
// Drop logo.png into /public and it will be picked up automatically.
// ─────────────────────────────────────────────────────────────────────────────

const MODES = [
  { id: 'json',    label: '{ } JSON'    },
  { id: 'html',    label: '◈ HTML'      },
  { id: 'css',     label: '◉ CSS'       },
  { id: 'js',      label: '⌬ JS'        },
  { id: 'project', label: '⬡ Project'   },
];

export default function Header({ mode, setMode, status, onFormat, onFix, onGenerate, onPreview }) {
  return (
    <header className="header">
      {/* BRAND */}
      <div className="brand">
        <div className="logo-emblem">
          {/* ── SWAP THIS FOR YOUR CANVA LOGO ── */}
          <span className="logo-glyph">{ }</span>
        </div>
        <div className="brand-text">
          <span className="brand-name">JSON<em>Studio</em></span>
          <span className="brand-tag">PRO</span>
        </div>
      </div>

      {/* MODE SWITCHER */}
      <nav className="modes">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`mode-btn ${mode === m.id ? 'active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>

      {/* RIGHT ACTIONS */}
      <div className="header-actions">
        <StatusPill status={status} />
        <div className="divider" />
        <button className="hbtn ghost" onClick={onFormat}>⚡ Format</button>
        <button className="hbtn danger" onClick={onFix}>🔧 Fix</button>
        <button className="hbtn amber" onClick={onGenerate}>✦ Generate</button>
        <button className="hbtn primary" onClick={onPreview}>▶ Preview</button>
      </div>
    </header>
  );
}

function StatusPill({ status }) {
  const map = {
    ok:    { cls: 'ok',   label: 'Valid'   },
    error: { cls: 'err',  label: 'Error'   },
    idle:  { cls: 'idle', label: 'Ready'   },
    empty: { cls: 'idle', label: 'Empty'   },
  };
  const s = map[status] || map.idle;
  return (
    <div className="status-pill">
      <div className={`status-dot ${s.cls}`} />
      <span className={`status-label ${s.cls}`}>{s.label}</span>
    </div>
  );
}
