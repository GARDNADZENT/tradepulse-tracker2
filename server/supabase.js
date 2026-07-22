const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error('Missing required env var: SUPABASE_URL');
}

if (!supabaseSecretKey) {
  throw new Error('Missing required env var: SUPABASE_SECRET_KEY');
}

module.exports = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
