// SPDX-License-Identifier: AGPL-3.0-or-later
import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import { WSClient } from './ws.js';
import Monitor from './components/monitor.js';
import Transmit from './components/transmit.js';
import SignalMonitor from './components/signal-monitor.js';
import Settings from './components/settings.js';
import Logging from './components/logging.js';
import DBCManager from './components/dbc-manager.js';

const html = htm.bind(h);

const TABS = [
  { id: 'monitor',  label: 'Monitor',  icon: '📊', shortcut: '1' },
  { id: 'transmit', label: 'Transmit', icon: '📤', shortcut: '2' },
  { id: 'signals',  label: 'Signals',  icon: '📈', shortcut: '3' },
  { id: 'settings', label: 'Settings', icon: '⚙️',  shortcut: '4' },
  { id: 'logging',  label: 'Logging',  icon: '💾', shortcut: '5' },
  { id: 'dbc',      label: 'DBC',      icon: '📁', shortcut: '6' },
];

// Global WebSocket client (singleton)
export const ws = new WSClient();

// Global shared state store (simple signals pattern)
let _listeners = [];
const _state = {
  messages: [],       // trace buffer (max buffer_size)
  stats: {},
  wsState: 'disconnected',
  config: {},
  dbcLoaded: false,
  signalData: {},     // latest signal values
  captureRunning: false,
  errorBanner: null,
  bufferSize: 10000,
};

export function getState() { return _state; }

export function setState(updates) {
  Object.assign(_state, updates);
  _listeners.forEach(fn => fn());
}

export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}

// Setup WebSocket handlers
ws.on('msg', ({ d }) => {
  if (!Array.isArray(d)) return;
  const msgs = _state.messages;
  const newMsgs = msgs.length + d.length > _state.bufferSize
    ? [...msgs.slice(-((_state.bufferSize - d.length))), ...d]
    : [...msgs, ...d];
  setState({ messages: newMsgs });
});

ws.on('stat', ({ d }) => {
  setState({ stats: d });
});

ws.on('err', ({ m }) => {
  setState({ errorBanner: m });
  setTimeout(() => setState({ errorBanner: null }), 8000);
});

ws.onStateChange(state => {
  setState({ wsState: state });
});

// Load initial capture state
async function loadCaptureState() {
  try {
    const r = await fetch('/api/can/status');
    const d = await r.json();
    setState({ captureRunning: d.capturing || false });
  } catch(e) {}
}

// Load config on start
async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    setState({ config: cfg, bufferSize: cfg.buffer_size || 10000 });
    // Apply theme
    document.documentElement.setAttribute('data-theme', cfg.theme || 'dark');
    const link = document.getElementById('theme-css');
    if (link) link.href = `/css/theme-${cfg.theme || 'dark'}.css`;
  } catch(e) {
    console.error('Failed to load config:', e);
  }
}

// App root component
function App() {
  const [activeTab, setActiveTab] = useState('monitor');
  const [wsState, setWsState] = useState('disconnected');
  const [errorBanner, setErrorBanner] = useState(null);
  const [ip, setIp] = useState(window.location.hostname);

  useEffect(() => {
    loadConfig();
    loadCaptureState();
    const wsUrl = `ws://${window.location.host}/ws`;
    ws.connect(wsUrl);

    const unsub = subscribe(() => {
      const s = getState();
      if (s.wsState !== wsState) setWsState(s.wsState);
      if (s.errorBanner !== errorBanner) setErrorBanner(s.errorBanner);
    });

    // Keyboard shortcuts: Ctrl+1-6 for tabs
    const onKey = (e) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (TABS[idx]) setActiveTab(TABS[idx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { unsub(); window.removeEventListener('keydown', onKey); };
  }, []);

  const wsDotClass = { connected: 'connected', connecting: 'connecting', error: 'error' }[wsState] || '';

  return html`
    <div id="app">
      <div class="titlebar">
        <div class="titlebar-logo">PiCAN <span>Studio</span></div>
        <div class="titlebar-spacer"></div>
        ${errorBanner && html`
          <div style="color:var(--accent-red);font-size:12px;padding:0 12px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ⚠ ${errorBanner}
          </div>
        `}
        <div class="ws-dot ${wsDotClass}" title="WebSocket: ${wsState}"></div>
        <div class="titlebar-ip">${ip}:8080</div>
      </div>

      <div class="tabbar">
        ${TABS.map(tab => html`
          <div
            class="tab ${activeTab === tab.id ? 'active' : ''}"
            onClick=${() => setActiveTab(tab.id)}
            title="Ctrl+${tab.shortcut}"
          >
            <span>${tab.icon}</span>
            <span>${tab.label}</span>
          </div>
        `)}
      </div>

      <div class="content">
        ${activeTab === 'monitor'  && html`<${Monitor} />`}
        ${activeTab === 'transmit' && html`<${Transmit} />`}
        ${activeTab === 'signals'  && html`<${SignalMonitor} />`}
        ${activeTab === 'settings' && html`<${Settings} onConfigChange=${loadConfig} />`}
        ${activeTab === 'logging'  && html`<${Logging} />`}
        ${activeTab === 'dbc'      && html`<${DBCManager} />`}
      </div>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
