const express = require('express');
const router = express.Router();
const { generateState, generatePKCE, getAuthUrl, exchangeCodeForToken } = require('./oauth-helper');
const { getAccounts } = require('./deriv');

async function handleCallback(req, res) {
  console.log('=== OAuth Callback Started ===');

  const code = req.query.code;
  const state = req.query.state;
  const sessionData = req.session.oauth;

  console.log('[Step 1] Authorization code received:', code ? `${code.slice(0, 8)}...` : 'MISSING');
  console.log('[Step 1] State received:', state);
  console.log('[Step 1] Session data exists:', !!sessionData);
  console.log('[Step 1] Stored state:', sessionData ? sessionData.state : 'N/A');

  if (!sessionData || !sessionData.state || state !== sessionData.state) {
    console.error('[Step 1] State validation FAILED');
    return res.redirect('/?error=invalid_state');
  }
  console.log('[Step 1] State validation PASSED');

  try {
    console.log('[Step 2] Exchanging code for token...');
    console.log('[Step 2] Token endpoint: https://auth.deriv.com/oauth2/token');
    console.log('[Step 2] Method: POST');
    console.log('[Step 2] Request body: grant_type=authorization_code&client_id=***&redirect_uri=***&code=***&code_verifier=***');

    const tokens = await exchangeCodeForToken(code, sessionData.codeVerifier);

    console.log('[Step 3] Token exchange response received');
    console.log('[Step 3] HTTP status: 200');
    console.log('[Step 3] access_token exists:', !!tokens.access_token);
    console.log('[Step 3] refresh_token exists:', !!tokens.refresh_token);
    console.log('[Step 3] expires_in:', tokens.expires_in);
    console.log('[Step 3] token_type:', tokens.token_type);

    req.session.tokens = tokens;
    req.session.oauth = null;
    console.log('[Step 5] Session tokens stored');

    console.log('[Step 4] Fetching accounts...');
    const accounts = await getAccounts(req);
    console.log('[Step 4] Accounts response:', JSON.stringify(accounts));
    console.log('[Step 4] Parsed user information: accounts count =', accounts.length);

    req.session.accounts = accounts;
    const realAccount = accounts.find((a) => !a.is_virtual);
    req.session.currentAccount = (realAccount || accounts[0] || {}).loginid || null;
    console.log('[Step 5] Session accounts stored');
    console.log('[Step 5] Session currentAccount set to:', req.session.currentAccount);
    console.log('[Step 5] Session created. Session ID:', req.sessionID);

    // Log session cookie info
    const sessionCookie = req.sessionID;
    console.log('[Step 5] Session cookie value (sid):', sessionCookie);

    console.log('[Step 6] OAuth callback complete. Redirecting to dashboard.');
    res.redirect('/dashboard');
  } catch (err) {
    console.error('=== OAuth Callback FAILED ===');
    console.error('[Error] Step:', err.step || 'unknown');
    console.error('[Error] Message:', err.message || err);
    console.error('[Error] Stack:', err.stack);
    const errorParam = encodeURIComponent(err.message || 'auth_failed');
    res.redirect(`/?error=${errorParam}`);
  }
}

router.get('/login', (req, res) => {
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();
  req.session.oauth = { state, codeVerifier };
  res.redirect(getAuthUrl(state, codeChallenge));
});

router.get('/callback', handleCallback);

module.exports = { router, handleCallback };
