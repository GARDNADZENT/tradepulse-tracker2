const express = require('express');
const { getAccounts, getBalance, getPortfolio, getProfitTable, getStatement, getStatistics } = require('./deriv');

const router = express.Router();

router.get('/oauth/me', async (req, res) => {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({ user: null, error: 'No session' });
  }

  try {
    const accounts = await getAccounts(req);
    const realAccount = accounts && accounts.find((a) => !a.is_virtual);
    const user = {
      accounts,
      currentAccount: (realAccount || accounts[0] || {}).loginid || null,
    };
    console.log('[API] /oauth/me - Session currentAccount:', req.session.currentAccount);
    console.log('[API] /oauth/me - Returning currentAccount:', user.currentAccount);
    console.log('[API] /oauth/me response:', JSON.stringify(user));
    res.json({ user, sessionId: req.sessionID });
  } catch (err) {
    console.error('[API] /oauth/me error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ user: null, error: 'Unauthorized' });
    res.status(500).json({ user: null, error: err.message });
  }
});

router.get('/accounts', async (req, res) => {
  try {
    const accounts = await getAccounts(req);
    console.log('[API] /accounts response:', JSON.stringify(accounts));
    res.json(accounts);
  } catch (err) {
    console.error('[API] /accounts error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const accountId = req.query.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_id required' });

    const [balance, portfolio, profitTable, statement] = await Promise.all([
      getBalance(req, accountId),
      getPortfolio(req, accountId),
      getProfitTable(req, accountId),
      getStatement(req, accountId),
    ]);

    res.json({
      accountId,
      balance,
      portfolio,
      profitTable,
      statement,
    });
  } catch (err) {
    console.error('[API] /dashboard error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/balance', async (req, res) => {
  try {
    const accountId = req.query.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_id required' });
    const data = await getBalance(req, accountId);
    res.json(data);
  } catch (err) {
    console.error('[API] /balance error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/portfolio', async (req, res) => {
  try {
    const accountId = req.query.account_id;
    const data = await getPortfolio(req, accountId);
    res.json(data);
  } catch (err) {
    console.error('[API] /portfolio error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/profit-table', async (req, res) => {
  try {
    const accountId = req.query.account_id;
    const data = await getProfitTable(req, accountId);
    res.json(data);
  } catch (err) {
    console.error('[API] /profit-table error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/statement', async (req, res) => {
  try {
    const accountId = req.query.account_id;
    const data = await getStatement(req, accountId);
    res.json(data);
  } catch (err) {
    console.error('[API] /statement error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/portfolio', async (req, res) => {
  try {
    const data = await getPortfolio(req);
    res.json(data);
  } catch (err) {
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/profit-table', async (req, res) => {
  try {
    const data = await getProfitTable(req);
    res.json(data);
  } catch (err) {
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/statement', async (req, res) => {
  try {
    const data = await getStatement(req);
    res.json(data);
  } catch (err) {
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/statistics', async (req, res) => {
  try {
    const accountId = req.query.account_id;
    if (!accountId) return res.status(400).json({ error: 'account_id required' });
    const data = await getStatistics(req, accountId);
    res.json(data);
  } catch (err) {
    console.error('[API] /statistics error:', err.message || err);
    if (err && err.unauthorized) return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('traderspulse.sid');
    res.json({ success: true });
  });
});

module.exports = router;
