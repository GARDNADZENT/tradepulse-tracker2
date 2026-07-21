const express = require('express');
require('dotenv').config();

const requiredEnv = ['DERIV_APP_ID', 'DERIV_REDIRECT_URI', 'SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const { setup: setupSession } = require('./session');
const oauthRoutes = require('./oauth');
const apiRoutes = require('./routes');
const journeyRoutes = require('./journey');

const app = express();

setupSession(app);

app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || '';
  const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('connect.sid='));
  console.log('[Request]', req.method, req.path, 'sessionID:', req.sessionID, 'hasTokens:', !!(req.session && req.session.tokens), 'cookie:', sessionCookie ? 'present' : 'MISSING');
  next();
});

app.use('/oauth', oauthRoutes.router);
app.get('/callback', oauthRoutes.handleCallback);
app.use('/api', apiRoutes);
app.use('/api', journeyRoutes);

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`TradersPulse running on http://localhost:${PORT}`);
});

module.exports = app;
