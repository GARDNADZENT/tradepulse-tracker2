const { getSessionTokens } = require('./session');
const WebSocket = require('ws');

const DERIV_API_BASE = 'https://api.derivws.com/trading/v1/options';
const DERIV_APP_ID = process.env.DERIV_APP_ID;

function getHeaders(accessToken) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
  };
  if (DERIV_APP_ID) {
    headers['Deriv-App-ID'] = DERIV_APP_ID;
  }
  return headers;
}

async function rest(path, accessToken, options = {}) {
  const url = `${DERIV_API_BASE}${path}`;
  console.log('[Deriv] REST', url, 'App-ID:', !!DERIV_APP_ID);
  const res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(accessToken), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    console.error('[Deriv] 401 Unauthorized');
    throw { unauthorized: true, status: 401 };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[Deriv] REST error:', res.status, text.slice(0, 200));
    throw new Error(`Deriv API error ${res.status}: ${text}`);
  }
  return res.json();
}

/* Deriv's balance/portfolio/statement/profit_table are WebSocket-only.
   Steps:
     1. POST /accounts/{accountId}/otp  (REST, Bearer token) -> ws_url
     2. open WebSocket, send msg, resolve the matching response. */
async function wsCall(accessToken, accountId, msg) {
  // 1. Obtain a one-time WebSocket URL via OTP (REST).
  const otp = await rest(`/accounts/${accountId}/otp`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const wsUrl = otp && (otp.websocket_url || otp.ws_url || (otp.data && (otp.data.websocket_url || otp.data.ws_url)));
  if (!wsUrl) {
    console.error('[Deriv] OTP response missing ws_url:', JSON.stringify(otp).slice(0, 200));
    throw new Error('Deriv OTP did not return a WebSocket URL');
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const reqId = (msg.req_id = msg.req_id || Date.now());
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error('Deriv WebSocket timeout')); }
    }, 15000);

    ws.on('open', () => {
      console.log('[Deriv] WS open, sending', JSON.stringify(msg));
      ws.send(JSON.stringify(msg));
    });
    ws.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
    ws.on('close', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Deriv WebSocket closed before response')); } });
    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (e) { return; }
      // Resolve once we get the response that matches our req_id (or the requested type).
      const type = Object.keys(msg).find((k) => k !== 'req_id' && k !== 'passthrough' && k !== 'subscribe');
      const hasResponse = data[type] !== undefined || data.error !== undefined;
      const matches = data.req_id === reqId || (data.echo_req && data.echo_req.req_id === reqId) || (!data.req_id && hasResponse);
      if (!matches) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (data.error) {
        console.error('[Deriv] WS error:', JSON.stringify(data.error).slice(0, 200));
        if (data.error.code === 'InvalidToken' || data.error.message === 'Invalid or expired token') {
          reject({ unauthorized: true, status: 401 });
        } else {
          reject(new Error(data.error.message || 'Deriv WebSocket error'));
        }
        return;
      }
      resolve(data);
    });
  });
}

function translateAccounts(data) {
  if (!data || !Array.isArray(data.data)) return [];
  return data.data.map((acc) => ({
    loginid: acc.account_id || acc.loginid,
    balance: acc.balance,
    currency: acc.currency,
    is_virtual: acc.account_type === 'demo' ? 1 : 0,
    landing_company_shortcode: '',
    account_type: acc.account_type,
    group: acc.group,
    status: acc.status,
  }));
}

function translateStatement(data) {
  const items = (data && data.statement && Array.isArray(data.statement.transactions)) ? data.statement.transactions
    : (data && Array.isArray(data.data) ? data.data : []);
  return items
    .filter((item) => item.contract_type)
    .map((item) => ({
      transaction_id: item.transaction_id,
      contract_id: item.contract_id,
      date: item.date || item.created_at,
      amount: item.amount,
      balance: item.balance_after,
      type: item.transaction_type || item.type,
      description: item.description,
      is_sold: item.is_sold,
      contract_type: item.contract_type,
      symbol: item.symbol,
      buy_price: item.buy_price,
      payout: item.payout,
      profit: item.profit != null ? Number(item.profit) : null,
      purchase_time: item.purchase_time ? Number(item.purchase_time) : null,
      date_expiry: item.date_expiry ? Number(item.date_expiry) : null,
      sell_time: item.sell_time ? Number(item.sell_time) : null,
    }));
}

async function getAccounts(req) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  const data = await rest('/accounts', accessToken);
  return translateAccounts(data);
}

async function getBalance(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };

  // Seed balances from the accounts list (REST) so every account — including
  // Real — always has a balance even if its live WebSocket call is slow/down.
  const seeded = (req.session.accounts || []).find((a) => a.loginid === accountId);

  try {
    const data = await wsCall(accessToken, accountId, { balance: 1, account: accountId });
    const b = data.balance || {};
    return {
      balance: Number(b.balance),
      currency: b.currency,
      loginid: b.account_id || accountId,
      account_type: b.account_type,
      is_virtual: b.account_type === 'demo' ? 1 : 0,
    };
  } catch (e) {
    if (seeded) {
      console.error(`[Deriv] getBalance WS failed for ${accountId}, using seeded balance`);
      return {
        balance: Number(seeded.balance),
        currency: seeded.currency,
        loginid: seeded.loginid || accountId,
        account_type: seeded.account_type,
        is_virtual: seeded.is_virtual,
      };
    }
    throw e;
  }
}

async function getPortfolio(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  try {
    return await wsCall(accessToken, accountId, { portfolio: 1, account: accountId });
  } catch (e) {
    console.error(`[Deriv] getPortfolio WS failed for ${accountId}`);
    return { portfolio: { contracts: [] } };
  }
}

async function getProfitTable(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  try {
    return await wsCall(accessToken, accountId, { profit_table: 1, account: accountId });
  } catch (e) {
    console.error(`[Deriv] getProfitTable WS failed for ${accountId}`);
    return { profit_table: { transactions: [] } };
  }
}

async function getStatement(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  try {
    const data = await wsCall(accessToken, accountId, { statement: 1, account: accountId, limit: 200 });
    return translateStatement(data);
  } catch (e) {
    console.error(`[Deriv] getStatement WS failed for ${accountId}`);
    return [];
  }
}

module.exports = { getAccounts, getBalance, getPortfolio, getProfitTable, getStatement, rest };
