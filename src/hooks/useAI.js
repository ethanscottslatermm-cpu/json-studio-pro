import { useState, useCallback } from 'react';

const API_URL = '/.netlify/functions/ai';

export function useAI() {
  const [busy, setBusy] = useState(false);

  const call = useCallback(async ({ prompt, image = null, maxTokens = 1500 }) => {
    setBusy(true);
    try {
      let content;
      if (image) {
        content = [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.base64,
            },
          },
          { type: 'text', text: prompt },
        ];
      } else {
        content = prompt;
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_tokens: maxTokens,
          messages: [{ role: 'user', content }],
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `API error ${res.status}`);
      }

      const data = await res.json();

      if (data.error) throw new Error(data.error.message || 'API error');

      const text = (data.content || []).map(b => b.text || '').join('');
      if (!text) throw new Error('Empty response from AI');

      return text;
    } catch (err) {
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { call, busy };
}
