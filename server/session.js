const session = require('express-session');
const MemoryStore = require('./memory-store');

const store = new MemoryStore();

function setup(app) {
  app.use(
    session({
      store,
      secret: process.env.SESSION_SECRET || 'dev_secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
      },
    })
  );
}

function getStore() {
  return store;
}

function getSessionTokens(req) {
  return {
    accessToken: req.session.tokens ? req.session.tokens.access_token : null,
    refreshToken: req.session.tokens ? req.session.tokens.refresh_token : null,
  };
}

module.exports = { setup, getStore, getSessionTokens };
