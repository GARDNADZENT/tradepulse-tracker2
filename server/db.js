const supabase = require('./supabase');

async function getDb() {
  return supabase;
}

async function getJourney(supabaseClient, userLoginid) {
  const { data, error } = await supabaseClient
    .from('journeys')
    .select('id, user_loginid, initial_balance, daily_target_pct, cycle_length_days, start_date, created_at, updated_at')
    .eq('user_loginid', userLoginid)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch journey: ${error.message}`);
  }

  return data || null;
}

async function getJourneyDays(supabaseClient, journeyId) {
  const { data, error } = await supabaseClient
    .from('journey_days')
    .select('id, day_number, date, expected_start, expected_end, actual_balance, status')
    .eq('journey_id', journeyId)
    .order('day_number', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch journey days: ${error.message}`);
  }

  return data || [];
}

async function upsertJourney(supabaseClient, journey) {
  const { data, error } = await supabaseClient
    .from('journeys')
    .upsert([journey], { onConflict: 'user_loginid' })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert journey: ${error.message}`);
  }

  return data;
}

async function insertJourneyDays(supabaseClient, days) {
  const { error } = await supabaseClient
    .from('journey_days')
    .insert(days);

  if (error) {
    throw new Error(`Failed to insert journey days: ${error.message}`);
  }
}

async function deleteJourneyDays(supabaseClient, journeyId) {
  const { error } = await supabaseClient
    .from('journey_days')
    .delete()
    .eq('journey_id', journeyId);

  if (error) {
    throw new Error(`Failed to delete journey days: ${error.message}`);
  }
}

async function deleteJourney(supabaseClient, userLoginid) {
  const { data, error } = await supabaseClient
    .from('journeys')
    .delete()
    .eq('user_loginid', userLoginid)
    .select('id')
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to delete journey: ${error.message}`);
  }

  return data;
}

function closeDb() {
  // No-op for Supabase
}

module.exports = {
  getDb,
  getJourney,
  getJourneyDays,
  upsertJourney,
  insertJourneyDays,
  deleteJourneyDays,
  deleteJourney,
  closeDb,
};
