// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { fmtBytes, fmtDuration } from '../utils/formatters.js';

const html = htm.bind(h);

export default function Logging() {
  const [status, setStatus] = useState({ active: false });
  const [files, setFiles] = useState([]);
  const [storage, setStorage] = useState({});
  const [format, setFormat] = useState('asc');
  const [prefix, setPrefix] = useState('pican');
  const [selected, setSelected] = useState(new Set());
  const timerRef = useRef(null);

  useEffect(() => {
    loadStatus();
    loadFiles();
    loadStorage();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (status.active) {
      timerRef.current = setInterval(loadStatus, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [status.active]);

  async function loadStatus() {
    const r = await fetch('/api/log/status');
    const d = await r.json();
    setStatus(d);
  }

  async function loadFiles() {
    const r = await fetch('/api/log/files');
    const d = await r.json();
    setFiles(d.files || []);
  }

  async function loadStorage() {
    const r = await fetch('/api/log/storage');
    const d = await r.json();
    setStorage(d);
  }

  async function startLogging() {
    const r = await fetch('/api/log/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, prefix }),
    });
    const d = await r.json();
    loadStatus();
  }

  async function stopLogging() {
    await fetch('/api/log/stop', { method: 'POST' });
    loadStatus();
    loadFiles();
    loadStorage();
  }

  async function deleteFile(filename) {
    if (!confirm(`Delete ${filename}?`)) return;
    await fetch(`/api/log/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    loadFiles();
    loadStorage();
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} file(s)?`)) return;
    await Promise.all([...selected].map(f => fetch(`/api/log/files/${encodeURIComponent(f)}`, { method: 'DELETE' })));
    setSelected(new Set());
    loadFiles();
    loadStorage();
  }

  const usedPct = storage.total_bytes ? Math.round((storage.used_bytes / storage.total_bytes) * 100) : 0;

  return html`
    <div class="tab-pane">
      <div class="logging-layout">
        <div class="logging-controls">
          <div class="panel-title">Log Controls</div>

          <div style="margin-bottom:16px">
            <button
              class="btn ${status.active ? 'btn-danger' : 'btn-success'}"
              style="width:100%;justify-content:center;gap:8px"
              onClick=${status.active ? stopLogging : startLogging}
            >
              ${status.active && html`<div class="rec-dot"></div>`}
              ${status.active ? 'Stop Logging' : '⏺ Start Logging'}
            </button>
          </div>

          <div class="form-group">
            <label>Format</label>
            <select value=${format} onChange=${e => setFormat(e.target.value)} style="width:100%">
              <option value="asc">ASC (Vector-compatible)</option>
              <option value="csv">CSV</option>
              <option value="blf">BLF (Binary)</option>
            </select>
          </div>

          <div class="form-group">
            <label>File Prefix</label>
            <input value=${prefix} onInput=${e => setPrefix(e.target.value)} style="width:100%" />
            <div class="text-muted text-small" style="margin-top:3px">${prefix}_YYYYMMDD_HHmmss.${format}</div>
          </div>

          ${status.active && html`
            <div class="panel" style="margin-top:12px">
              <div class="panel-title">Recording</div>
              <div class="stat-item">
                <div class="stat-label">Duration</div>
                <div class="stat-value small">${fmtDuration(status.duration || 0)}</div>
              </div>
              <div class="stat-item" style="margin-top:8px">
                <div class="stat-label">Messages</div>
                <div class="stat-value small">${(status.message_count || 0).toLocaleString()}</div>
              </div>
              <div class="stat-item" style="margin-top:8px">
                <div class="stat-label">File Size</div>
                <div class="stat-value small">${fmtBytes(status.size_bytes || 0)}</div>
              </div>
              <div style="margin-top:8px;font-size:11px;color:var(--text-muted);word-break:break-all">
                ${status.filename}
              </div>
            </div>
          `}

          ${storage.total_bytes && html`
            <div style="margin-top:16px">
              <div class="panel-title">Storage</div>
              <div class="bus-load-bar" style="height:8px">
                <div class="bus-load-fill ${usedPct > 90 ? 'critical' : usedPct > 75 ? 'high' : ''}"
                  style="width:${usedPct}%"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;color:var(--text-muted)">
                <span>Used: ${fmtBytes(storage.used_bytes)}</span>
                <span>Free: ${fmtBytes(storage.free_bytes)}</span>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                Logs: ${fmtBytes(storage.log_size_bytes || 0)}
              </div>
            </div>
          `}
        </div>

        <div class="logging-files">
          <div class="logging-files-header">
            <span class="panel-title" style="margin:0">Log Files</span>
            <div class="flex-spacer"></div>
            ${selected.size > 0 && html`
              <button class="btn btn-sm btn-danger" onClick=${deleteSelected}>
                Delete ${selected.size} selected
              </button>
            `}
            <button class="btn btn-sm" onClick=${loadFiles}>↻ Refresh</button>
          </div>

          <div class="logging-files-body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" onChange=${e => {
                      if (e.target.checked) setSelected(new Set(files.map(f => f.filename)));
                      else setSelected(new Set());
                    }} /></th>
                    <th>Filename</th>
                    <th>Size</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${files.map(f => html`
                    <tr key=${f.filename}>
                      <td><input type="checkbox" checked=${selected.has(f.filename)}
                        onChange=${e => {
                          const s = new Set(selected);
                          if (e.target.checked) s.add(f.filename); else s.delete(f.filename);
                          setSelected(s);
                        }}
                      /></td>
                      <td class="text-mono text-small">${f.filename}</td>
                      <td>${fmtBytes(f.size_bytes)}</td>
                      <td class="text-small">${f.modified?.replace('T', ' ').slice(0, 19)}</td>
                      <td style="display:flex;gap:4px">
                        <a href=${`/api/log/files/${encodeURIComponent(f.filename)}`}
                          download=${f.filename} class="btn btn-sm">↓</a>
                        <button class="btn btn-sm" onClick=${() => deleteFile(f.filename)}
                          style="color:var(--accent-red)">✕</button>
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
              ${files.length === 0 && html`
                <div style="padding:24px;text-align:center;color:var(--text-muted)">No log files yet.</div>
              `}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
