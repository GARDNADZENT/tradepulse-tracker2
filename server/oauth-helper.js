const crypto = require('crypto');

function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function generateState() {
  return generateRandomString(16);
}

function generatePKCE() {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { codeVerifier, codeChallenge };
}

function getAuthUrl(state, codeChallenge) {
  const clientId = process.env.DERIV_APP_ID;
  if (!clientId) {
    throw new Error('DERIV_APP_ID is not set in environment variables');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.DERIV_REDIRECT_URI,
    response_type: 'code',
    scope: 'trade account_manage',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://auth.deriv.com/oauth2/auth?${params.toString()}`;
  console.log('========================================');
  console.log('[OAUTH DIAGNOSTIC] Exact authorization URL:');
  console.log(authUrl);
  console.log('========================================');
  console.log('[OAUTH DIAGNOSTIC] client_id:', clientId);
  console.log('[OAUTH DIAGNOSTIC] redirect_uri:', process.env.DERIV_REDIRECT_URI);
  console.log('[OAUTH DIAGNOSTIC] response_type:', 'code');
  console.log('[OAUTH DIAGNOSTIC] scope:', 'trade account_manage');
  console.log('[OAUTH DIAGNOSTIC] code_challenge:', codeChallenge);
  console.log('[OAUTH DIAGNOSTIC] code_challenge_method:', 'S256');
  console.log('[OAUTH DIAGNOSTIC] state:', state);
  console.log('========================================');

  return authUrl;
}

async function exchangeCodeForToken(code, codeVerifier) {
  const clientId = process.env.DERIV_APP_ID;
  if (!clientId) {
    throw new Error('DERIV_APP_ID is not set in environment variables');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: process.env.DERIV_REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
  });

  console.log('[Step 2] Token exchange URL: https://auth.deriv.com/oauth2/token');
  console.log('[Step 2] Token exchange method: POST');
  console.log('[Step 2] Token exchange body: grant_type=authorization_code&client_id=' + clientId.slice(0, 8) + '...&redirect_uri=' + encodeURIComponent(process.env.DERIV_REDIRECT_URI).slice(0, 20) + '...&code=' + (code ? code.slice(0, 8) + '...' : 'MISSING') + '&code_verifier=' + (codeVerifier ? codeVerifier.slice(0, 8) + '...' : 'MISSING'));

  const response = await fetch('https://auth.deriv.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  console.log('[Step 3] Token exchange HTTP status:', response.status);

  if (!response.ok) {
    const text = await response.text();
    console.error('[Step 3] Token exchange FAILED:', response.status, text);
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const tokens = await response.json();
  console.log('[Step 3] Token exchange response:');
  console.log('[Step 3]   access_token:', tokens.access_token ? tokens.access_token.slice(0, 12) + '...' : 'MISSING');
  console.log('[Step 3]   refresh_token:', tokens.refresh_token ? 'present' : 'MISSING');
  console.log('[Step 3]   expires_in:', tokens.expires_in);
  console.log('[Step 3]   token_type:', tokens.token_type);

  return tokens;
}

module.exports = { generateState, generatePKCE, getAuthUrl, exchangeCodeForToken };
