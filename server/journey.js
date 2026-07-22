const express = require('express');
const router = express.Router();
const { getDb, getJourney, getJourneyDays, upsertJourney, insertJourneyDays, deleteJourneyDays, deleteJourney } = require('./db');

router.get('/journey', async (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ journey: null, error: 'No session' });
  }

  try {
    const db = await getDb();
    const userLoginid = req.session.currentAccount || req.session.accounts?.[0]?.loginid;
    if (!userLoginid) {
      return res.status(400).json({ journey: null, error: 'No account selected' });
    }

    const journey = await getJourney(db, userLoginid);

    if (!journey) {
      return res.json({ journey: null });
    }

    const days = await getJourneyDays(db, journey.id);

    res.json({
      journey: {
        ...journey,
        days
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

    const db = await getDb();
    const now = new Date().toISOString();

    const { id: journeyId } = await upsertJourney(db, {
      user_loginid: userLoginid,
      initial_balance: Number(initial_balance),
      daily_target_pct: Number(daily_target_pct),
      cycle_length_days: Number(cycle_length_days),
      start_date: start_date,
      created_at: now,
      updated_at: now,
    });

    await deleteJourneyDays(db, journeyId);

    const rows = [];
    let start = Number(initial_balance);
    const r = Number(daily_target_pct) / 100;
    const base = new Date(start_date);

    const daysToInsert = [];
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

      daysToInsert.push({
        journey_id: journeyId,
        day_number: i,
        date: dateStr,
        expected_start: start,
        expected_end: end,
        actual_balance: null,
        status: 'pending',
      });

      start = end;
    }

    await insertJourneyDays(db, daysToInsert);

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

    const db = await getDb();
    const journey = await deleteJourney(db, userLoginid);

    if (journey) {
      await deleteJourneyDays(db, journey.id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /journey error:', err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
