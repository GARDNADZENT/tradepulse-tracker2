const express = require('express');
const router = express.Router();
const { getDb } = require('./db');

router.get('/journey', (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ journey: null, error: 'No session' });
  }

  try {
    const db = getDb();
    const userLoginid = req.session.currentAccount || req.session.accounts?.[0]?.loginid;
    if (!userLoginid) {
      return res.status(400).json({ journey: null, error: 'No account selected' });
    }

    const journey = db.prepare(`
      SELECT id, user_loginid, initial_balance, daily_target_pct, cycle_length_days, start_date, created_at, updated_at
      FROM journeys WHERE user_loginid = ?
    `).get(userLoginid);

    if (!journey) {
      return res.json({ journey: null });
    }

    const days = db.prepare(`
      SELECT id, day_number, date, expected_start, expected_end, actual_balance, status
      FROM journey_days WHERE journey_id = ? ORDER BY day_number ASC
    `).all(journey.id);

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

router.post('/journey', (req, res) => {
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

    const db = getDb();
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO journeys (user_loginid, initial_balance, daily_target_pct, cycle_length_days, start_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_loginid) DO UPDATE SET
        initial_balance = excluded.initial_balance,
        daily_target_pct = excluded.daily_target_pct,
        cycle_length_days = excluded.cycle_length_days,
        start_date = excluded.start_date,
        updated_at = excluded.updated_at
    `).run(userLoginid, initial_balance, daily_target_pct, cycle_length_days, start_date, now, now);

    const journeyId = result.lastInsertRowid || db.prepare('SELECT id FROM journeys WHERE user_loginid = ?').get(userLoginid).id;

    db.prepare('DELETE FROM journey_days WHERE journey_id = ?').run(journeyId);

    const rows = [];
    let start = Number(initial_balance);
    const r = Number(daily_target_pct) / 100;
    const base = new Date(start_date);

    const insertDay = db.prepare(`
      INSERT INTO journey_days (journey_id, day_number, date, expected_start, expected_end, actual_balance, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

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

      insertDay.run(journeyId, i, dateStr, start, end, null, 'pending');
      start = end;
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

router.delete('/journey', (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ success: false, error: 'No session' });
  }

  try {
    const userLoginid = req.session.currentAccount || req.session.accounts?.[0]?.loginid;
    if (!userLoginid) {
      return res.status(400).json({ success: false, error: 'No account selected' });
    }

    const db = getDb();
    const journey = db.prepare('SELECT id FROM journeys WHERE user_loginid = ?').get(userLoginid);
    if (journey) {
      db.prepare('DELETE FROM journey_days WHERE journey_id = ?').run(journey.id);
      db.prepare('DELETE FROM journeys WHERE id = ?').run(journey.id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /journey error:', err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
