import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Save a scan to Supabase
export async function saveScan({ filename, analysisType, aiResponse, imageThumb }) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('scans')
    .insert([{ filename, analysis_type: analysisType, ai_response: aiResponse, image_thumb: imageThumb, created_at: new Date().toISOString() }])
    .select()
    .single();
  if (error) console.error('Supabase saveScan error:', error);
  return data;
}

// Fetch recent scans
export async function getScans(limit = 20) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('Supabase getScans error:', error);
  return data || [];
}

// Save a session snapshot
export async function saveSession({ mode, code }) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('sessions')
    .insert([{ mode, code, created_at: new Date().toISOString() }])
    .select()
    .single();
  if (error) console.error('Supabase saveSession error:', error);
  return data;
}
