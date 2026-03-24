// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import SignalGraph from './signal-graph.js';
import { getState, subscribe } from '../app.js';

const html = htm.bind(h);

export default function SignalMonitor() {
  const [dbcFiles, setDbcFiles] = useState([]);
  const [dbcMessages, setDbcMessages] = useState([]);
  const [watchList, setWatchList] = useState([]);
  const [latestValues, setLatestValues] = useState({});
  const [graphSignals, setGraphSignals] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [config, setConfig] = useState({});

  useEffect(() => {
    loadDbcFiles();
    loadConfig();
    const pollInterval = setInterval(pollValues, 200);
    return () => clearInterval(pollInterval);
  }, []);

  useEffect(() => {
    return subscribe(() => setConfig(getState().config));
  }, []);

  async function loadConfig() {
    const r = await fetch('/api/config');
    const d = await r.json();
    setConfig(d);
  }

  async function loadDbcFiles() {
    const r = await fetch('/api/dbc/files');
    const d = await r.json();
    setDbcFiles(d.files || []);
  }

  async function pollValues() {
    try {
      const r = await fetch('/api/signals/latest');
      const d = await r.json();
      setLatestValues(d);
    } catch(e) {}
  }

  async function search(query) {
    setSearchQuery(query);
    if (!query.trim()) { setSearchResults([]); return; }
    const r = await fetch(`/api/dbc/search?q=${encodeURIComponent(query)}`);
    const d = await r.json();
    setSearchResults(d.results || []);
  }

  function addToWatch(signal) {
    const key = `${signal.message}.${signal.name}`;
    if (!watchList.find(w => w.key === key)) {
      setWatchList(w => [...w, { key, ...signal }]);
    }
  }

  function removeFromWatch(key) {
    setWatchList(w => w.filter(s => s.key !== key));
    setGraphSignals(g => g.filter(s => s !== key));
  }

  function toggleGraph(key) {
    if (graphSignals.includes(key)) {
      setGraphSignals(g => g.filter(s => s !== key));
    } else if (graphSignals.length < 6) {
      setGraphSignals(g => [...g, key]);
    }
  }

  if (dbcFiles.length === 0) {
    return html`
      <div class="tab-pane" style="display:flex;align-items:center;justify-content:center">
        <div style="text-align:center;color:var(--text-muted)">
          <div style="font-size:40px;margin-bottom:12px">📁</div>
          <div style="font-size:14px;margin-bottom:6px">No DBC file loaded</div>
          <div style="font-size:12px">Load a DBC file in the DBC Manager tab to start monitoring signals.</div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="tab-pane">
      <div class="signal-layout">
        <!-- Search & Add Signals -->
        <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0">
          <span class="text-muted text-small">Add Signal:</span>
          <input
            placeholder="Search signals..."
            value=${searchQuery}
            onInput=${e => search(e.target.value)}
            style="width:200px"
          />
          ${searchResults.length > 0 && html`
            <div style="position:relative">
              <div style="position:absolute;top:4px;left:-200px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;min-width:300px;max-height:200px;overflow-y:auto;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
                ${searchResults.filter(r => r.type === 'signal').map(r => html`
                  <div
                    key=${r.message_id + r.name}
                    style="padding:6px 10px;cursor:pointer;font-size:12px"
                    class="dbc-signal"
                    onClick=${() => { addToWatch(r); setSearchQuery(''); setSearchResults([]); }}
                  >
                    <span style="color:var(--accent-blue)">${r.message}</span>
                    <span class="text-muted"> › </span>
                    <span>${r.name}</span>
                    ${r.unit && html`<span class="text-muted"> (${r.unit})</span>`}
                  </div>
                `)}
              </div>
            </div>
          `}
        </div>

        <!-- Watch List -->
        <div class="signal-watch-table">
          <table>
            <thead>
              <tr>
                <th>Message</th><th>Signal</th><th>Raw</th><th>Physical</th>
                <th>Unit</th><th>Min</th><th>Max</th><th>Updated</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${watchList.map(sig => {
                const val = latestValues[sig.key];
                const phys = val?.phys;
                const rangeMin = val?.range_min;
                const rangeMax = val?.range_max;
                const pct = (rangeMin !== null && rangeMax !== null && phys !== null && rangeMax !== rangeMin)
                  ? Math.max(0, Math.min(100, ((phys - rangeMin) / (rangeMax - rangeMin)) * 100))
                  : null;

                return html`
                  <tr key=${sig.key}>
                    <td class="text-small">${sig.message}</td>
                    <td>${sig.name}</td>
                    <td class="text-mono">—</td>
                    <td class="text-mono" style="min-width:80px">
                      ${phys !== undefined ? phys?.toFixed(3) : '—'}
                      ${pct !== null && html`
                        <div class="bus-load-bar" style="height:3px;margin-top:2px">
                          <div class="bus-load-fill" style="width:${pct}%"></div>
                        </div>
                      `}
                    </td>
                    <td class="text-muted text-small">${val?.unit || sig.unit || ''}</td>
                    <td class="text-muted text-small">${rangeMin ?? '—'}</td>
                    <td class="text-muted text-small">${rangeMax ?? '—'}</td>
                    <td class="text-muted text-small">${val?.ts ? new Date(val.ts * 1000).toLocaleTimeString() : '—'}</td>
                    <td style="display:flex;gap:4px">
                      <button class="btn btn-sm ${graphSignals.includes(sig.key) ? 'btn-primary' : ''}"
                        onClick=${() => toggleGraph(sig.key)}
                        title="${graphSignals.length >= 6 && !graphSignals.includes(sig.key) ? 'Max 6 signals' : ''}"
                        disabled=${graphSignals.length >= 6 && !graphSignals.includes(sig.key)}
                      >📈</button>
                      <button class="btn btn-sm" onClick=${() => removeFromWatch(sig.key)}>✕</button>
                    </td>
                  </tr>
                `;
              })}
              ${watchList.length === 0 && html`
                <tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:16px">
                  Search for signals above and add them to the watch list.
                </td></tr>
              `}
            </tbody>
          </table>
        </div>

        <!-- Graph -->
        ${graphSignals.length > 0 && html`
          <div class="graph-area" style="flex:1;overflow:hidden">
            <${SignalGraph} signals=${graphSignals} graphHz=${config.graph_hz || 10} />
          </div>
        `}
      </div>
    </div>
  `;
}
