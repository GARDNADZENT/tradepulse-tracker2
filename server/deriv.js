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
  const wsReqId = msg.req_id || Date.now();
  console.log('[WS] ========== WebSocket Call ==========');
  console.log('[WS] Account:', accountId);
  console.log('[WS] Message:', JSON.stringify(msg));

  // 1. Obtain a one-time WebSocket URL via OTP (REST).
  const otp = await rest(`/accounts/${accountId}/otp`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('[WS] OTP Response:', JSON.stringify(otp));

  const wsUrl = otp && (otp.websocket_url || otp.ws_url || (otp.data && (otp.data.websocket_url || otp.data.ws_url || otp.data.url)));
  if (!wsUrl) {
    console.error('[WS] OTP response missing ws_url');
    throw new Error('Deriv OTP did not return a WebSocket URL');
  }
  console.log('[WS] WebSocket URL:', wsUrl);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const reqId = (msg.req_id = wsReqId);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error('Deriv WebSocket timeout after 15s')); }
    }, 15000);

    ws.on('open', () => {
      console.log('[WS] Connection opened, sending:', JSON.stringify(msg));
      ws.send(JSON.stringify(msg));
    });
    ws.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
    ws.on('close', (code, reason) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Deriv WebSocket closed before response. Code: ' + code + ', Reason: ' + reason)); }
    });
    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (e) { return; }
      console.log('[WS] Raw message received:', JSON.stringify(data));

      // Resolve once we get the response that matches our req_id (or the requested type).
      const type = Object.keys(msg).find((k) => k !== 'req_id' && k !== 'passthrough' && k !== 'subscribe');
      const hasResponse = data[type] !== undefined || data.error !== undefined;
      const matches = data.req_id === reqId || (data.echo_req && data.echo_req.req_id === reqId) || (!data.req_id && hasResponse);
      console.log('[WS] Match check - type:', type, 'req_id:', data.req_id, 'matches:', matches);

      if (!matches) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (data.error) {
        console.error('[WS] Error response:', JSON.stringify(data.error));
        if (data.error.code === 'InvalidToken' || data.error.message === 'Invalid or expired token') {
          reject({ unauthorized: true, status: 401 });
        } else {
          reject(new Error(data.error.message || 'Deriv WebSocket error'));
        }
        return;
      }
      console.log('[WS] Response resolved successfully');
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

function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    date_from: Math.floor(start.getTime() / 1000),
    date_to: Math.floor(now.getTime() / 1000),
  };
}

  function translateStatement(data, accountId) {
    const items = (data && data.statement && Array.isArray(data.statement.transactions)) ? data.statement.transactions
      : (data && Array.isArray(data.transactions) ? data.transactions
      : (data && Array.isArray(data.data) ? data.data : []));
    return items
      .filter((item) => item.contract_id)
      .map((item) => {
        const action = item.action_type || item.type || 'unknown';
        const amount = item.amount != null ? Number(item.amount) : 0;
        const time = item.transaction_time ? Number(item.transaction_time) : null;
        return {
          id: item.transaction_id,
          contractId: item.contract_id,
          type: action,
          stake: action === 'buy' ? Math.max(0, amount) : 0,
          payout: 0,
          profit: 0,
          purchaseTime: action === 'buy' ? time : null,
          closeTime: action === 'sell' ? time : null,
          contractType: null,
          symbol: null,
          isWin: false,
          account_loginid: accountId,
          source: 'statement',
        };
      });
  }

  function translateProfitTable(data, accountId) {
    const items = (data && data.profit_table && Array.isArray(data.profit_table.transactions)) ? data.profit_table.transactions
      : (data && Array.isArray(data.transactions) ? data.transactions
      : (data && Array.isArray(data.data) ? data.data : []));
    return items
      .map((item) => {
        const buyPrice = item.buy_price != null ? Number(item.buy_price) : 0;
        const sellPrice = item.sell_price != null ? Number(item.sell_price) : 0;
        const profit = sellPrice - buyPrice;
        const isWin = profit > 0;
        const isLoss = profit < 0;

        return {
          id: item.transaction_id,
          contractId: item.contract_id,
          type: 'sell',
          stake: buyPrice,
          payout: item.payout != null ? Number(item.payout) : 0,
          profit,
          purchaseTime: item.purchase_time ? Number(item.purchase_time) : null,
          closeTime: item.sell_time ? Number(item.sell_time) : (item.purchase_time ? Number(item.purchase_time) : null),
          contractType: item.contract_type || null,
          symbol: item.underlying_symbol || null,
          isWin,
          isLoss,
          account_loginid: accountId,
          source: 'profit_table',
        };
      });
  }

function computeStats(contracts) {
  const total = contracts.length;
  const wins = contracts.filter(c => c.isWin).length;
  const losses = contracts.filter(c => c.isLoss).length;
  const net = contracts.reduce((s, c) => s + Number(c.profit || 0), 0);
  const winRate = total ? (wins / total * 100) : 0;
  const avgProfit = wins ? contracts.filter(c => c.isWin).reduce((s, c) => s + Number(c.profit), 0) / wins : 0;
  const avgLoss = losses ? contracts.filter(c => c.isLoss).reduce((s, c) => s + Number(c.profit), 0) / losses : 0;
  const largestWin = contracts.reduce((m, c) => Math.max(m, Number(c.profit || 0)), 0);
  const largestLoss = contracts.reduce((m, c) => Math.min(m, Number(c.profit || 0)), 0);
  const totalStake = contracts.reduce((s, c) => s + Number(c.stake || 0), 0);
  const totalPayout = contracts.reduce((s, c) => s + Number(c.payout || 0), 0);

  const byDay = {};
  contracts.forEach(c => {
    const t = c.closeTime || c.purchaseTime;
    if (!t) return;
    const day = new Date(Number(t) * 1000).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Number(c.profit || 0);
  });
  const dayEntries = Object.entries(byDay);
  const bestDay = dayEntries.length ? dayEntries.reduce((a, b) => b[1] > a[1] ? b : a) : null;
  const worstDay = dayEntries.length ? dayEntries.reduce((a, b) => b[1] < a[1] ? b : a) : null;

  const bySymbol = {};
  contracts.forEach(c => { const s = c.symbol || 'Unknown'; bySymbol[s] = (bySymbol[s] || 0) + 1; });
  const mostTraded = Object.keys(bySymbol).sort((a, b) => bySymbol[b] - bySymbol[a])[0] || '—';

  const byType = {};
  contracts.forEach(c => { const t = c.contractType || 'Unknown'; byType[t] = (byType[t] || 0) + 1; });

  let winStreak = 0, lossStreak = 0;
  const sortedC = [...contracts].sort((a, b) =>
    (Number(b.closeTime || b.purchaseTime) || 0) -
    (Number(a.closeTime || a.purchaseTime) || 0));
  let curWin = 0, curLoss = 0;
  for (const c of sortedC) {
    const p = Number(c.profit) || 0;
    if (p > 0) { curWin++; curLoss = 0; }
    else if (p < 0) { curLoss++; curWin = 0; }
    else { curWin = 0; curLoss = 0; }
    if (curWin > winStreak) winStreak = curWin;
    if (curLoss > lossStreak) lossStreak = curLoss;
  }

  if (contracts.length > 0) {
    const first = contracts[0];
    const p = Number(first.profit) || 0;
  }

  return {
    total, wins, losses, net, winRate, avgProfit, avgLoss, largestWin, largestLoss, totalStake, totalPayout,
    mostTraded, mostTradedContract: Object.keys(byType).sort((a, b) => byType[b] - byType[a])[0] || '—',
    winStreak, lossStreak, bestDay, worstDay,
  };
}

function getTodayStats(contracts) {
  const today = new Date().toISOString().slice(0, 10);
  const todayContracts = contracts.filter(c => {
    const t = c.closeTime || c.purchaseTime;
    if (!t) return false;
    return new Date(Number(t) * 1000).toISOString().slice(0, 10) === today;
  });
  return computeStats(todayContracts);
}

function filterToday(contracts) {
  const today = new Date().toISOString().slice(0, 10);
  return contracts.filter(c => {
    const t = c.closeTime || c.purchaseTime;
    if (!t) return false;
    return new Date(Number(t) * 1000).toISOString().slice(0, 10) === today;
  });
}

function getContractPerformance(contracts) {
  const groups = {};
  contracts.forEach(c => {
    const type = c.contractType || 'Unknown';
    if (!groups[type]) groups[type] = { type, trades: 0, wins: 0, losses: 0, net: 0, totalStake: 0, totalReturn: 0 };
    groups[type].trades++;
    if (c.isWin) groups[type].wins++;
    else if (c.isLoss) groups[type].losses++;
    groups[type].net += Number(c.profit || 0);
    groups[type].totalStake += Number(c.stake || 0);
    groups[type].totalReturn += Number(c.payout || 0);
  });
  return Object.values(groups).sort((a, b) => b.trades - a.trades);
}

async function getStatistics(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };

  const [balance, profitTable] = await Promise.all([
    getBalance(req, accountId).catch((e) => {
      console.error('[Stats] getBalance failed:', e.message || e);
      return { balance: 0, currency: 'USD', loginid: accountId, account_type: 'unknown', is_virtual: 0 };
    }),
    getProfitTable(req, accountId).catch((e) => {
      console.error('[Stats] getProfitTable failed:', e.message || e);
      return { profit_table: { transactions: [] } };
    }),
  ]);

  const contracts = translateProfitTable(profitTable, accountId);

  const todayStats = getTodayStats(contracts);
  const overallStats = computeStats(contracts);
  const contractPerformance = getContractPerformance(filterToday(contracts));

  return {
    accountId,
    balance,
    today: todayStats,
    overall: overallStats,
    contractPerformance,
    contracts,
  };
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

  const seeded = (req.session.accounts || []).find((a) => a.loginid === accountId);

  try {
    const data = await wsCall(accessToken, accountId, { balance: 1 });
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
    return await wsCall(accessToken, accountId, { portfolio: 1 });
  } catch (e) {
    console.error(`[Deriv] getPortfolio WS failed for ${accountId}`);
    return { portfolio: { contracts: [] } };
  }
}

async function getProfitTable(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  try {
    const params = { profit_table: 1, description: 1, limit: 500 };
    const raw = await wsCall(accessToken, accountId, params);
    return raw;
  } catch (e) {
    console.error(`[Stats] getProfitTable WS failed for ${accountId}:`, e.message || e);
    return { profit_table: { transactions: [] } };
  }
}

async function getStatement(req, accountId, dateFrom, dateTo) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  try {
    const params = { statement: 1, description: 1, limit: 999 };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    const raw = await wsCall(accessToken, accountId, params);
    return translateStatement(raw, accountId);
  } catch (e) {
    console.error(`[Stats] getStatement WS failed for ${accountId}:`, e.message || e);
    return [];
  }
}

async function getPortfolio(req, accountId) {
  const { accessToken } = getSessionTokens(req);
  if (!accessToken) throw { unauthorized: true, status: 401 };
  try {
    return await wsCall(accessToken, accountId, { portfolio: 1 });
  } catch (e) {
    console.error(`[Deriv] getPortfolio WS failed for ${accountId}`);
    return { portfolio: { contracts: [] } };
  }
}

module.exports = { getAccounts, getBalance, getPortfolio, getProfitTable, getStatement, getStatistics, rest };
