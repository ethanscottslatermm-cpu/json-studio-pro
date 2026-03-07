import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { getHighlighter } from '../lib/utils';
import './CodeEditor.css';

const CodeEditor = forwardRef(function CodeEditor(
  { code, onChange, mode, errors }, ref
) {
  const edRef  = useRef(null);
  const hlRef  = useRef(null);
  const lnRef  = useRef(null);

  const highlighted = getHighlighter(mode)(code);

  // ── EXPOSE jumpToLine TO PARENT ──────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    jumpToLine(lineNumber) {
      if (!edRef.current) return;
      const lines = edRef.current.value.split('\n');
      let pos = 0;
      for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
        pos += lines[i].length + 1;
      }
      const lineEnd = pos + (lines[lineNumber - 1] || '').length;
      edRef.current.focus();
      edRef.current.setSelectionRange(pos, lineEnd);
      const lineHeight = 21;
      const scrollTo   = (lineNumber - 1) * lineHeight - 80;
      edRef.current.scrollTop = Math.max(0, scrollTo);
      if (hlRef.current) hlRef.current.scrollTop = edRef.current.scrollTop;
      if (lnRef.current) lnRef.current.scrollTop = edRef.current.scrollTop;
      const lnEls = lnRef.current?.querySelectorAll('.ln');
      if (lnEls && lnEls[lineNumber - 1]) {
        const el = lnEls[lineNumber - 1];
        el.classList.add('ln-flash');
        setTimeout(() => el.classList.remove('ln-flash'), 1200);
      }
    }
  }), []);

  // ── SYNC SCROLL ──────────────────────────────────────────────────────────
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

  // ── TAB KEY ──────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s  = e.target.selectionStart;
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

  const lineCount  = code.split('\n').length;
  const errorLines = new Set(errors.map(e => e.line));

  return (
    <div className="code-editor">
      {/* LINE NUMBERS */}
      <div className="line-nums" ref={lnRef}>
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i + 1}
            className={`ln ${errorLines.has(i + 1) ? 'ln-err' : ''}`}
            title={errorLines.has(i + 1) ? `Error on line ${i + 1}` : ''}
          >
            {errorLines.has(i + 1) ? '⚠' : i + 1}
          </div>
        ))}
      </div>

      {/* EDITOR AREA */}
      <div className="editor-wrap">
        {/* Error line overlays */}
        <div className="error-overlays" aria-hidden="true">
          {[...errorLines].map(ln => (
            <div
              key={ln}
              className="error-overlay-line"
              style={{ top: `${14 + (ln - 1) * 21}px` }}
            />
          ))}
        </div>
        {/* Syntax highlight layer */}
        <div
          ref={hlRef}
          className="hl-layer"
          dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
        />
        {/* Editable textarea */}
        <textarea
          ref={edRef}
          className="editor-ta"
          value={code}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Paste JSON, HTML, CSS, or JS here..."
        />
      </div>
    </div>
  );
});

export default CodeEditor;
