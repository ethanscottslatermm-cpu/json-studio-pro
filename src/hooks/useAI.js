import { useState, useCallback } from 'react';

const API_URL = process.env.REACT_APP_AI_ENDPOINT || '/.netlify/functions/ai';

export function useAI() {
  const [busy, setBusy] = useState(false);

  const call = useCallback(async ({ prompt, image = null, maxTokens = 1500 }) => {
    setBusy(true);
    try {
      let content;
      if (image) {
        content = [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: prompt }
        ];
      } else {
        content = prompt;
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content }]
        })
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      return (data.content || []).map(b => b.text || '').join('');
    } catch (err) {
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { call, busy };
}
