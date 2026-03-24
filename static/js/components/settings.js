// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import TimingCalc from './timing-calc.js';
import FilterConfig from './filter-config.js';
import { BITRATE_PRESETS, DATA_BITRATE_PRESETS, OPERATING_MODES } from '../utils/can-constants.js';

const html = htm.bind(h);

const NAV_ITEMS = ['Interface', 'CAN Filters', 'Application'];

export default function Settings({ onConfigChange }) {
  const [activeSection, setActiveSection] = useState('Interface');
  const [config, setConfig] = useState({});
  const [pending, setPending] = useState({});
  const [interfaces, setInterfaces] = useState([]);
  const [hwStatus, setHwStatus] = useState({});
  const [filters, setFilters] = useState([]);
  const [showModeWarning, setShowModeWarning] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    loadConfig();
    loadInterfaces();
    loadStatus();
  }, []);

  async function loadConfig() {
    const r = await fetch('/api/config');
    const d = await r.json();
    setConfig(d);
    setPending(d);
  }

  async function loadInterfaces() {
    const r = await fetch('/api/can/interfaces');
    const d = await r.json();
    setInterfaces(d.interfaces || []);
  }

  async function loadStatus() {
    const r = await fetch('/api/can/status');
    const d = await r.json();
    setHwStatus(d);
  }

  function setPendingField(field, value) {
    setPending(p => ({ ...p, [field]: value }));
  }

  async function applyInterfaceSettings() {
    setSaving(true);
    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending),
      });
      if (!r.ok) { setSaveMsg('Failed to save config'); return; }

      // Restart interface
      const r2 = await fetch('/api/can/restart', { method: 'POST' });
      const d2 = await r2.json();
      setSaveMsg(d2.ok ? 'Interface restarted successfully' : `Error: ${d2.message || d2.error}`);
      loadStatus();
      onConfigChange && onConfigChange();
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 5000);
    }
  }

  async function applyAppSettings() {
    setSaving(true);
    try {
      const appKeys = ['buffer_size', 'auto_scroll', 'timestamp_format', 'hex_uppercase', 'theme', 'ws_interval_ms', 'graph_hz'];
      const updates = Object.fromEntries(appKeys.map(k => [k, pending[k]]).filter(([k,v]) => v !== undefined));
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (r.ok) {
        setSaveMsg('Settings saved');
        // Apply theme immediately
        document.documentElement.setAttribute('data-theme', pending.theme || 'dark');
        const link = document.getElementById('theme-css');
        if (link) link.href = `/css/theme-${pending.theme || 'dark'}.css`;
        onConfigChange && onConfigChange();
      } else {
        setSaveMsg('Failed to save settings');
      }
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 5000);
    }
  }

  async function resetConfig() {
    if (!confirm('Reset all settings to factory defaults?')) return;
    await fetch('/api/config/reset', { method: 'POST' });
    loadConfig();
    setSaveMsg('Reset to defaults');
    setTimeout(() => setSaveMsg(''), 3000);
  }

  const modeInfo = OPERATING_MODES.find(m => m.value === (pending.mode || 'normal'));

  return html`
    <div class="tab-pane">
      <div class="settings-layout">
        <div class="settings-nav">
          ${NAV_ITEMS.map(item => html`
            <div
              class="settings-nav-item ${activeSection === item ? 'active' : ''}"
              onClick=${() => setActiveSection(item)}
              key=${item}
            >${item}</div>
          `)}
        </div>

        <div class="settings-content">
          ${saveMsg && html`
            <div class="${saveMsg.startsWith('Error') ? 'warn-box' : 'info-box'}" style="margin-bottom:12px">
              ${saveMsg}
            </div>
          `}

          ${activeSection === 'Interface' && html`
            <div class="settings-section">
              <h3>CAN Interface</h3>

              <div class="form-row">
                <label>Interface</label>
                <select value=${pending.interface || 'can0'} onChange=${e => setPendingField('interface', e.target.value)} style="width:120px">
                  ${interfaces.map(iface => html`<option value=${iface} key=${iface}>${iface}</option>`)}
                  <option value="can0">can0</option>
                  <option value="vcan0">vcan0</option>
                </select>
                <button class="btn btn-sm" onClick=${loadStatus}>Refresh</button>
              </div>

              <div class="form-row">
                <label>Mode</label>
                <select value=${pending.mode || 'normal'} onChange=${e => {
                  const val = e.target.value;
                  if (val !== config.mode) {
                    setPendingMode(val);
                    setShowModeWarning(true);
                  } else {
                    setPendingField('mode', val);
                  }
                }} style="width:200px">
                  ${OPERATING_MODES.map(m => html`<option value=${m.value} key=${m.value}>${m.label}</option>`)}
                </select>
              </div>
              ${modeInfo && html`<div class="text-muted text-small" style="margin-left:152px;margin-top:-4px">${modeInfo.description}</div>`}

              <div class="form-row" style="margin-top:16px">
                <label>CAN-FD</label>
                <label class="toggle">
                  <input type="checkbox" checked=${pending.fd_enabled} onChange=${e => setPendingField('fd_enabled', e.target.checked)} />
                  <div class="toggle-track"><div class="toggle-thumb"></div></div>
                  <span>${pending.fd_enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>

              <div class="form-row">
                <label>Bitrate</label>
                <select value=${pending.bitrate || 500000} onChange=${e => setPendingField('bitrate', parseInt(e.target.value))} style="width:150px">
                  ${BITRATE_PRESETS.map(p => html`<option value=${p.value} key=${p.value}>${p.label}</option>`)}
                </select>
              </div>

              <${TimingCalc} bitrate=${pending.bitrate} label="Arbitration Phase Timing" />

              ${pending.fd_enabled && html`
                <div class="form-row" style="margin-top:12px">
                  <label>Data Bitrate</label>
                  <select value=${pending.dbitrate || 2000000} onChange=${e => setPendingField('dbitrate', parseInt(e.target.value))} style="width:150px">
                    ${DATA_BITRATE_PRESETS.map(p => html`<option value=${p.value} key=${p.value}>${p.label}</option>`)}
                  </select>
                </div>
                <${TimingCalc} bitrate=${pending.dbitrate} label="Data Phase Timing" />
                ${pending.dbitrate < pending.bitrate && html`
                  <div class="warn-box">Data bitrate must be ≥ arbitration bitrate.</div>
                `}
              `}

              <div style="margin-top:16px">
                <div class="info-box">
                  <strong>Bus Status:</strong>
                  ${hwStatus.up ? html`<span style="color:var(--accent-green)"> UP</span>` : html`<span style="color:var(--accent-red)"> DOWN</span>`}
                  — State: ${hwStatus.bus_state || '—'}
                  — Mode: ${hwStatus.mode || '—'}
                  ${hwStatus.bitrate ? html` — ${hwStatus.bitrate/1000} kbit/s` : ''}
                </div>
              </div>

              <div style="margin-top:16px">
                <div class="info-box" style="color:var(--accent-amber);border-color:rgba(210,153,34,0.3);background:rgba(210,153,34,0.08)">
                  ⚠ Ensure the 120Ω termination jumper is set on the Soldered board if this node is at the end of the CAN bus.
                </div>
              </div>

              <div style="margin-top:20px;display:flex;gap:8px">
                <button class="btn btn-primary" onClick=${applyInterfaceSettings} disabled=${saving}>
                  ${saving ? 'Applying...' : 'Apply & Restart Interface'}
                </button>
              </div>
            </div>
          `}

          ${activeSection === 'CAN Filters' && html`
            <div class="settings-section">
              <h3>Hardware Acceptance Filters</h3>
              <p class="text-muted text-small" style="margin-bottom:12px">
                Applied at the SocketCAN kernel layer. Up to 32 filters supported by MCP2518FD.
              </p>
              <${FilterConfig} filters=${filters} onChange=${setFilters} />
              <div style="margin-top:16px">
                <button class="btn btn-primary" onClick=${() => {}}>Apply Filters</button>
              </div>
            </div>
          `}

          ${activeSection === 'Application' && html`
            <div class="settings-section">
              <h3>Application Settings</h3>

              <div class="form-row">
                <label>Message Buffer</label>
                <input type="range" min="1000" max="20000" step="1000"
                  value=${pending.buffer_size || 10000}
                  onInput=${e => setPendingField('buffer_size', parseInt(e.target.value))}
                />
                <span class="text-mono text-small">${(pending.buffer_size || 10000).toLocaleString()} msgs</span>
              </div>

              <div class="form-row">
                <label>Auto-scroll</label>
                <label class="toggle">
                  <input type="checkbox" checked=${pending.auto_scroll !== false}
                    onChange=${e => setPendingField('auto_scroll', e.target.checked)} />
                  <div class="toggle-track"><div class="toggle-thumb"></div></div>
                </label>
              </div>

              <div class="form-row">
                <label>Timestamp Format</label>
                <div style="display:flex;gap:12px">
                  ${['relative', 'absolute', 'delta'].map(f => html`
                    <label key=${f} style="display:flex;gap:4px;align-items:center;cursor:pointer">
                      <input type="radio" name="ts_format" value=${f} checked=${pending.timestamp_format === f}
                        onChange=${() => setPendingField('timestamp_format', f)} />
                      ${f.charAt(0).toUpperCase() + f.slice(1)}
                    </label>
                  `)}
                </div>
              </div>

              <div class="form-row">
                <label>Hex Format</label>
                <div style="display:flex;gap:12px">
                  <label style="display:flex;gap:4px;align-items:center;cursor:pointer">
                    <input type="radio" name="hex_fmt" checked=${pending.hex_uppercase !== false}
                      onChange=${() => setPendingField('hex_uppercase', true)} />
                    UPPERCASE
                  </label>
                  <label style="display:flex;gap:4px;align-items:center;cursor:pointer">
                    <input type="radio" name="hex_fmt" checked=${pending.hex_uppercase === false}
                      onChange=${() => setPendingField('hex_uppercase', false)} />
                    lowercase
                  </label>
                </div>
              </div>

              <div class="form-row">
                <label>Theme</label>
                <div style="display:flex;gap:12px">
                  ${['dark', 'light'].map(t => html`
                    <label key=${t} style="display:flex;gap:4px;align-items:center;cursor:pointer">
                      <input type="radio" name="theme" value=${t} checked=${pending.theme === t}
                        onChange=${() => setPendingField('theme', t)} />
                      ${t.charAt(0).toUpperCase() + t.slice(1)}
                    </label>
                  `)}
                </div>
              </div>

              <div class="form-row">
                <label>WS Interval</label>
                <input type="range" min="20" max="200" step="10"
                  value=${pending.ws_interval_ms || 50}
                  onInput=${e => setPendingField('ws_interval_ms', parseInt(e.target.value))}
                />
                <span class="text-mono text-small">${pending.ws_interval_ms || 50} ms</span>
              </div>

              <div class="form-row">
                <label>Graph Update Rate</label>
                <input type="range" min="5" max="30" step="1"
                  value=${pending.graph_hz || 10}
                  onInput=${e => setPendingField('graph_hz', parseInt(e.target.value))}
                />
                <span class="text-mono text-small">${pending.graph_hz || 10} Hz</span>
              </div>

              <div style="margin-top:8px;padding:8px 0">
                <div class="text-muted text-small">Network</div>
                <div class="text-mono" style="margin-top:4px">${window.location.hostname} — port 8080</div>
              </div>

              <div style="margin-top:16px;display:flex;gap:8px">
                <button class="btn btn-primary" onClick=${applyAppSettings} disabled=${saving}>
                  ${saving ? 'Saving...' : 'Save Settings'}
                </button>
                <button class="btn" onClick=${resetConfig}>Reset to Defaults</button>
              </div>
            </div>
          `}
        </div>
      </div>

      ${showModeWarning && html`
        <div class="dialog-overlay">
          <div class="dialog">
            <div class="dialog-title">Changing Operating Mode</div>
            <p style="font-size:13px;color:var(--text-secondary)">
              Changing the mode to <strong>${OPERATING_MODES.find(m => m.value === pendingMode)?.label}</strong>
              requires restarting the CAN interface. Active capture will be stopped.
            </p>
            <div class="dialog-actions">
              <button class="btn" onClick=${() => { setShowModeWarning(false); setPendingMode(null); }}>Cancel</button>
              <button class="btn btn-primary" onClick=${() => {
                setPendingField('mode', pendingMode);
                setShowModeWarning(false);
                setPendingMode(null);
              }}>Continue</button>
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
