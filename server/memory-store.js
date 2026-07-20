const session = require('express-session');

class MemoryStore extends session.Store {
  constructor() {
    super();
    this.sessions = new Map();
  }

  get(sid, callback) {
    const session = this.sessions.get(sid);
    console.log('[Store] get sid:', sid, 'found:', !!session);
    callback(null, session || null);
  }

  set(sid, session, callback) {
    console.log('[Store] set sid:', sid, 'keys:', session ? Object.keys(session).join(',') : 'none');
    this.sessions.set(sid, session);
    callback(null);
  }

  destroy(sid, callback) {
    console.log('[Store] destroy sid:', sid);
    this.sessions.delete(sid);
    callback(null);
  }
}

module.exports = MemoryStore;
