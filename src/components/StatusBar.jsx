import React from 'react';
import './StatusBar.css';

export default function StatusBar({ lines, size, keys, cursorPos, mode }) {
  return (
    <div className="statusbar">
      <span className="sb-item mode-indicator">{mode.toUpperCase()}</span>
      <span className="sb-sep" />
      <span className="sb-item">Ln {cursorPos.line}, Col {cursorPos.col}</span>
      <span className="sb-sep" />
      <span className="sb-item">Lines: {lines}</span>
      <span className="sb-sep" />
      <span className="sb-item">Size: {size}</span>
      <span className="sb-sep" />
      <span className="sb-item">Keys: {keys ?? '—'}</span>
      <div style={{ flex: 1 }} />
      <span className="sb-item brand-sb">JSON Studio Pro · Monarch-Elite Holdings</span>
    </div>
  );
}
