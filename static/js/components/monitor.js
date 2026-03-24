// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import TraceTable from './trace-table.js';
import { getState, subscribe, setState } from '../app.js';
import { fmtDuration } from '../utils/formatters.js';

const html = htm.bind(h);

export default function Monitor() {
  const [state, setLocalState] = useState(getState());
  const [autoScroll, setAutoScroll] = useState(true);
  const [statsOpen, setStatsOpen] = useState(true);
  const [filters, setFilters] = useState({ idFilter: '', typeFilter: 'all', dirFilter: 'all', nameFilter: '' });

  useEffect(() => subscribe(() => setLocalState({ ...getState() })), []);

  // Space key to toggle capture
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        toggleCapture();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.captureRunning]);

  const toggleCapture = useCallback(async () => {
    const running = state.captureRunning;
    try {
      const endpoint = running ? '/api/can/stop' : '/api/can/start';
      const r = await fetch(endpoint, { method: 'POST' });
      const data = await r.json();
      if (data.ok !== false) setState({ captureRunning: !running });
    } catch(e) {
      console.error('Toggle capture failed:', e);
    }
  }, [state.captureRunning]);

  const clearTrace = useCallback(() => {
    setState({ messages: [] });
  }, []);

  const stats = state.stats || {};
  const busLoadClass = stats.load > 80 ? 'critical' : stats.load > 60 ? 'high' : '';

  return html`
    <div class="tab-pane">
      <div class="toolbar">
        <button
          class="btn ${state.captureRunning ? 'btn-danger' : 'btn-success'} ${state.captureRunning ? 'pulse' : ''}"
          onClick=${toggleCapture}
          style="min-width:100px"
        >
          ${state.captureRunning ? '■ Stop' : '▶ Start'}
        </button>
        <div class="separator"></div>
        <button class="btn btn-sm" onClick=${clearTrace}>Clear</button>
        <div class="flex-spacer"></div>
        <span class="text-muted text-small text-mono">${state.messages.length.toLocaleString()} msgs</span>
        <div class="separator"></div>
        <button class="btn btn-sm" onClick=${() => setStatsOpen(o => !o)}>
          ${statsOpen ? '▸ Stats' : '◂ Stats'}
        </button>
      </div>

      <div class="filter-bar">
        <label>ID:</label>
        <input
          placeholder="0x1A3, 0x100-0x1FF"
          value=${filters.idFilter}
          onInput=${e => setFilters(f => ({...f, idFilter: e.target.value}))}
          style="width:140px"
        />
        <label>Type:</label>
        <select value=${filters.typeFilter} onChange=${e => setFilters(f => ({...f, typeFilter: e.target.value}))}>
          <option value="all">All</option>
          <option value="classic">CAN 2.0</option>
          <option value="fd">CAN-FD</option>
        </select>
        <label>Dir:</label>
        <select value=${filters.dirFilter} onChange=${e => setFilters(f => ({...f, dirFilter: e.target.value}))}>
          <option value="all">All</option>
          <option value="rx">RX</option>
          <option value="tx">TX</option>
        </select>
        <label>Name:</label>
        <input
          placeholder="fuzzy match"
          value=${filters.nameFilter}
          onInput=${e => setFilters(f => ({...f, nameFilter: e.target.value}))}
          style="width:110px"
        />
        <button class="btn btn-sm" onClick=${() => setFilters({ idFilter: '', typeFilter: 'all', dirFilter: 'all', nameFilter: '' })}>
          Clear
        </button>
      </div>

      <div class="monitor-layout">
        <${TraceTable}
          messages=${state.messages}
          filters=${filters}
          config=${state.config}
          autoScroll=${autoScroll}
          onAutoScrollChange=${setAutoScroll}
        />

        ${statsOpen && html`
          <div class="stats-sidebar">
            <div class="panel-title">Bus Statistics</div>

            <div class="stat-item">
              <div class="stat-label">Bus Load</div>
              <div class="stat-value">${(stats.load || 0).toFixed(1)}%</div>
              <div class="bus-load-bar">
                <div class="bus-load-fill ${busLoadClass}" style="width:${Math.min(100,stats.load||0)}%"></div>
              </div>
            </div>

            <div class="stat-item">
              <div class="stat-label">Messages/s</div>
              <div class="stat-value">${(stats.rx_rate || 0).toFixed(0)}</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">RX Total</div>
              <div class="stat-value small">${(stats.rx_total || 0).toLocaleString()}</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">TX Total</div>
              <div class="stat-value small">${(stats.tx_total || 0).toLocaleString()}</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">Unique IDs</div>
              <div class="stat-value small">${stats.unique_ids || 0}</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">Bus State</div>
              <div>
                ${stats.state === 'ERROR-ACTIVE' || stats.state === 'active'
                  ? html`<span class="badge badge-green">${stats.state || 'Active'}</span>`
                  : stats.state === 'ERROR-WARNING'
                    ? html`<span class="badge badge-amber">${stats.state}</span>`
                    : stats.state === 'ERROR-PASSIVE'
                      ? html`<span class="badge badge-amber">${stats.state}</span>`
                      : stats.state === 'BUS-OFF'
                        ? html`<span class="badge badge-red">${stats.state}</span>`
                        : html`<span class="badge badge-muted">${stats.state || 'Unknown'}</span>`
                }
              </div>
            </div>

            <div class="stat-item">
              <div class="stat-label">TEC / REC</div>
              <div class="stat-value small text-mono">${stats.tec || 0} / ${stats.rec || 0}</div>
            </div>

            <div class="stat-item">
              <div class="stat-label">Uptime</div>
              <div class="stat-value small">${fmtDuration(stats.uptime || 0)}</div>
            </div>

            ${stats.top_ids?.length > 0 && html`
              <div>
                <div class="stat-label" style="margin-bottom:6px">Top IDs by Freq</div>
                ${stats.top_ids.map(({ id, count }) => html`
                  <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;font-family:'JetBrains Mono',monospace">
                    <span style="color:var(--accent-blue)">${id}</span>
                    <span style="color:var(--text-muted)">${count.toLocaleString()}</span>
                  </div>
                `)}
              </div>
            `}
          </div>
        `}
      </div>
    </div>
  `;
}
