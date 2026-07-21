const express = require('express');
const router = express.Router();
const { supabase } = require('./supabase');

router.get('/journey', async (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ journey: null, error: 'No session' });
  }

  try {
    const userLoginid = req.session.currentAccount || req.session.accounts?.[0]?.loginid;
    if (!userLoginid) {
      return res.status(400).json({ journey: null, error: 'No account selected' });
    }

    const { data: journey, error: journeyError } = await supabase
      .from('journeys')
      .select('*')
      .eq('user_loginid', userLoginid)
      .maybeSingle();

    if (journeyError) throw journeyError;
    if (!journey) {
      return res.json({ journey: null });
    }

    const { data: days, error: daysError } = await supabase
      .from('journey_days')
      .select('*')
      .eq('journey_id', journey.id)
      .order('day_number', { ascending: true });

    if (daysError) throw daysError;

    res.json({
      journey: {
        ...journey,
        days: days || []
      }
    });
  } catch (err) {
    console.error('[API] /journey error:', err.message || err);
    res.status(500).json({ journey: null, error: err.message });
  }
});

router.post('/journey', async (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ journey: null, error: 'No session' });
  }

  try {
    const { initial_balance, daily_target_pct, cycle_length_days, start_date } = req.body;

    if (!initial_balance || !daily_target_pct || !cycle_length_days || !start_date) {
      return res.status(400).json({ journey: null, error: 'All journey fields are required' });
    }

    const userLoginid = req.session.currentAccount || req.session.accounts?.[0]?.loginid;
    if (!userLoginid) {
      return res.status(400).json({ journey: null, error: 'No account selected' });
    }

    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabase
      .from('journeys')
      .select('id')
      .eq('user_loginid', userLoginid)
      .maybeSingle();

    if (existingError) throw existingError;

    let journeyId;

    if (existing) {
      journeyId = existing.id;
      const { error: updateError } = await supabase
        .from('journeys')
        .update({
          initial_balance: Number(initial_balance),
          daily_target_pct: Number(daily_target_pct),
          cycle_length_days: Number(cycle_length_days),
          start_date,
          updated_at: now
        })
        .eq('id', journeyId);

      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('journey_days')
        .delete()
        .eq('journey_id', journeyId);

      if (deleteError) throw deleteError;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('journeys')
        .insert({
          user_loginid: userLoginid,
          initial_balance: Number(initial_balance),
          daily_target_pct: Number(daily_target_pct),
          cycle_length_days: Number(cycle_length_days),
          start_date,
          created_at: now,
          updated_at: now
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      journeyId = inserted.id;
    }

    const rows = [];
    let start = Number(initial_balance);
    const r = Number(daily_target_pct) / 100;
    const base = new Date(start_date);

    const insertPromises = [];

    for (let i = 1; i <= Number(cycle_length_days); i++) {
      const end = start * (1 + r);
      const date = new Date(base);
      date.setDate(base.getDate() + (i - 1));
      const dateStr = date.toISOString().slice(0, 10);

      rows.push({
        day: i,
        date: dateStr,
        start,
        end,
        profit: end - start,
        rate: Number(daily_target_pct),
        actual: null,
        diff: null,
        status: 'pending'
      });

      insertPromises.push(
        supabase.from('journey_days').insert({
          journey_id: journeyId,
          day_number: i,
          date: dateStr,
          expected_start: start,
          expected_end: end,
          actual_balance: null,
          status: 'pending'
        })
      );

      start = end;
    }

    const results = await Promise.all(insertPromises);
    for (const result of results) {
      if (result.error) throw result.error;
    }

    res.json({
      journey: {
        id: journeyId,
        user_loginid: userLoginid,
        initial_balance: Number(initial_balance),
        daily_target_pct: Number(daily_target_pct),
        cycle_length_days: Number(cycle_length_days),
        start_date: start_date,
        created_at: now,
        updated_at: now,
        days: rows
      }
    });
  } catch (err) {
    console.error('[API] POST /journey error:', err.message || err);
    res.status(500).json({ journey: null, error: err.message });
  }
});

router.delete('/journey', async (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ success: false, error: 'No session' });
  }

  try {
    const userLoginid = req.session.currentAccount || req.session.accounts?.[0]?.loginid;
    if (!userLoginid) {
      return res.status(400).json({ success: false, error: 'No account selected' });
    }

    const { data: journey, error: journeyError } = await supabase
      .from('journeys')
      .select('id')
      .eq('user_loginid', userLoginid)
      .maybeSingle();

    if (journeyError) throw journeyError;

    if (journey) {
      const { error: deleteDaysError } = await supabase
        .from('journey_days')
        .delete()
        .eq('journey_id', journey.id);

      if (deleteDaysError) throw deleteDaysError;

      const { error: deleteJourneyError } = await supabase
        .from('journeys')
        .delete()
        .eq('id', journey.id);

      if (deleteJourneyError) throw deleteJourneyError;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /journey error:', err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
