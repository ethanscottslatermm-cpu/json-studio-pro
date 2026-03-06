import React, { useRef, useEffect, useCallback } from 'react';
import { getHighlighter } from '../lib/utils';
import './CodeEditor.css';

export default function CodeEditor({ code, onChange, mode, errors }) {
  const edRef  = useRef(null);
  const hlRef  = useRef(null);
  const lnRef  = useRef(null);

  const highlighted = getHighlighter(mode)(code);

  // Sync scroll between textarea, highlight layer, and line numbers
  const syncScroll = useCallback(() => {
    if (!edRef.current || !hlRef.current || !lnRef.current) return;
    hlRef.current.scrollTop  = edRef.current.scrollTop;
    hlRef.current.scrollLeft = edRef.current.scrollLeft;
    lnRef.current.scrollTop  = edRef.current.scrollTop;
  }, []);

  useEffect(() => {
    const el = edRef.current;
    if (!el) return;
    el.addEventListener('scroll', syncScroll);
    return () => el.removeEventListener('scroll', syncScroll);
  }, [syncScroll]);

  // Tab key support
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = e.target.selectionStart;
      const en = e.target.selectionEnd;
      const next = code.slice(0, s) + '  ' + code.slice(en);
      onChange(next);
      requestAnimationFrame(() => {
        if (edRef.current) {
          edRef.current.selectionStart = s + 2;
          edRef.current.selectionEnd   = s + 2;
        }
      });
    }
  }, [code, onChange]);

  const lineCount = code.split('\n').length;
  const lineNums = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

  // Build error line set for gutter marks
  const errorLines = new Set(errors.map(e => e.line));

  return (
    <div className="code-editor">
      {/* LINE NUMBERS */}
      <div className="line-nums" ref={lnRef}>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i + 1} className={`ln ${errorLines.has(i + 1) ? 'ln-err' : ''}`}>
            {i + 1}
          </div>
        ))}
      </div>

      {/* EDITOR AREA */}
      <div className="editor-wrap">
        {/* Syntax highlight layer (behind) */}
        <div
          ref={hlRef}
          className="hl-layer"
          dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
        />
        {/* Editable textarea (on top, transparent) */}
        <textarea
          ref={edRef}
          className="editor-ta"
          value={code}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Paste JSON, HTML, CSS, or JS here — or use AI Generate..."
        />
      </div>
    </div>
  );
}
