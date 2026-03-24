// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WebSocket client with auto-reconnect and message dispatch.
 */

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;

export class WSClient {
  constructor() {
    this._ws = null;
    this._reconnectDelay = RECONNECT_BASE;
    this._reconnectTimer = null;
    this._handlers = {}; // type -> callback
    this._onStateChange = null;
    this._state = 'disconnected'; // disconnected | connecting | connected
    this._url = null;
  }

  connect(url) {
    this._url = url;
    this._doConnect();
  }

  _doConnect() {
    if (this._ws) {
      try { this._ws.close(); } catch(e) {}
    }
    this._setState('connecting');
    try {
      this._ws = new WebSocket(this._url);
      this._ws.onopen = () => {
        this._setState('connected');
        this._reconnectDelay = RECONNECT_BASE;
      };
      this._ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const handler = this._handlers[msg.t];
          if (handler) handler(msg);
        } catch(err) {
          console.warn('WS parse error:', err);
        }
      };
      this._ws.onclose = () => {
        this._setState('disconnected');
        this._scheduleReconnect();
      };
      this._ws.onerror = () => {
        this._setState('error');
      };
    } catch(e) {
      this._setState('error');
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX);
      this._doConnect();
    }, this._reconnectDelay);
  }

  _setState(state) {
    this._state = state;
    if (this._onStateChange) this._onStateChange(state);
  }

  on(type, handler) {
    this._handlers[type] = handler;
    return this;
  }

  onStateChange(cb) {
    this._onStateChange = cb;
    return this;
  }

  send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
    }
  }

  get state() { return this._state; }

  disconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._ws) { this._ws.close(); this._ws = null; }
    this._setState('disconnected');
  }
}
