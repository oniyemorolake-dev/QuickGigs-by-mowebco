/**
 * QuickGigs — chat realtime (Supabase Realtime) + typing broadcast.
 * Falls back to short polling when the Realtime JS client or channel fails.
 * Load after supabaseClient.js / qg-config.js.
 */
(function (global) {
  var QG_SYS_PREFIX = '⟦QG⟧';
  var _client = null;
  var _channel = null;
  var _pollFallback = null;
  var _typingLocalTimer = null;

  function cfgUrl() {
    return (global.QGSupabase && global.QGSupabase.url) || global.SUPABASE_URL || '';
  }
  function cfgKey() {
    return (global.QGSupabase && global.QGSupabase.anonKey) || global.SUPABASE_ANON_KEY || '';
  }

  global.QG_SYS_PREFIX = QG_SYS_PREFIX;

  global.isSystemChatBody = function (body) {
    return String(body || '').indexOf(QG_SYS_PREFIX) === 0;
  };

  global.parseSystemChatBody = function (body) {
    var s = String(body || '');
    if (s.indexOf(QG_SYS_PREFIX) === 0) return s.slice(QG_SYS_PREFIX.length);
    return s;
  };

  global.buildSystemChatBody = function (text) {
    return QG_SYS_PREFIX + String(text || '').trim();
  };

  function ensureClient() {
    if (_client) return _client;
    var create = global.supabase && global.supabase.createClient;
    if (typeof create !== 'function') return null;
    var url = cfgUrl();
    var key = cfgKey();
    if (!url || !key) return null;
    try {
      _client = create(url, key, {
        realtime: { params: { eventsPerSecond: 8 } }
      });
    } catch (e) {
      console.warn('[qg-chat] supabase client failed', e);
      _client = null;
    }
    return _client;
  }

  /**
   * Subscribe to new messages + conversation updates for one thread.
   * opts: { convId, onMessage, onConvUpdate, onTyping, pollFn, pollMs }
   */
  global.qgSubscribeChat = function (opts) {
    opts = opts || {};
    var convId = opts.convId;
    if (!convId) return { mode: 'none' };

    global.qgUnsubscribeChat();

    var client = ensureClient();
    var mode = 'poll';

    if (client) {
      try {
        var topic = 'qg-chat:' + convId;
        _channel = client.channel(topic, { config: { broadcast: { self: false } } });

        _channel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conv_id=eq.' + convId },
          function (payload) {
            if (typeof opts.onMessage === 'function') opts.onMessage(payload.new || payload.record || payload);
          }
        );

        _channel.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'conversations', filter: 'conv_id=eq.' + convId },
          function (payload) {
            var row = payload.new || payload.record || payload;
            if (typeof opts.onConvUpdate === 'function') opts.onConvUpdate(row);
          }
        );

        _channel.on('broadcast', { event: 'typing' }, function (payload) {
          if (typeof opts.onTyping === 'function') opts.onTyping(payload && payload.payload ? payload.payload : payload);
        });

        _channel.subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            mode = 'realtime';
            if (_pollFallback) {
              clearInterval(_pollFallback);
              _pollFallback = null;
            }
            // Light safety poll in case replication isn't enabled for the table
            _pollFallback = setInterval(function () {
              if (typeof opts.pollFn === 'function') opts.pollFn();
            }, opts.softPollMs || 20000);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            mode = 'poll';
          }
        });
      } catch (err) {
        console.warn('[qg-chat] realtime subscribe failed', err);
        _channel = null;
        mode = 'poll';
      }
    }

    if (mode === 'poll' || !client) {
      mode = 'poll';
      var ms = opts.pollMs || 3500;
      _pollFallback = setInterval(function () {
        if (typeof opts.pollFn === 'function') opts.pollFn();
      }, ms);
    }

    return { mode: mode };
  };

  global.qgUnsubscribeChat = function () {
    if (_pollFallback) {
      clearInterval(_pollFallback);
      _pollFallback = null;
    }
    if (_channel) {
      try {
        var client = ensureClient();
        if (client) client.removeChannel(_channel);
        else if (_channel.unsubscribe) _channel.unsubscribe();
      } catch (e) {}
      _channel = null;
    }
  };

  /** Broadcast typing (Realtime). Also mirrors to REST typing_by when available. */
  global.qgBroadcastTyping = function (convId, userId) {
    if (!convId || !userId) return;
    if (_channel && _channel.send) {
      try {
        _channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: userId, at: Date.now() }
        });
      } catch (e) {}
    }
    if (typeof global.qgSetTypingFlag === 'function') {
      clearTimeout(_typingLocalTimer);
      _typingLocalTimer = setTimeout(function () {
        global.qgSetTypingFlag(convId, userId);
      }, 280);
    }
  };

  global.qgGetChatRealtimeClient = ensureClient;
})(typeof window !== 'undefined' ? window : globalThis);
