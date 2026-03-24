// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

export default function DBCManager() {
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [signals, setSignals] = useState({}); // frameId -> signals[]
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => { loadFiles(); loadMessages(); }, []);

  async function loadFiles() {
    const r = await fetch('/api/dbc/files');
    const d = await r.json();
    setFiles(d.files || []);
  }

  async function loadMessages() {
    const r = await fetch('/api/dbc/messages');
    const d = await r.json();
    setMessages(d.messages || []);
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');

    const form = new FormData();
    form.append('file', file);

    try {
      const r = await fetch('/api/dbc/upload', { method: 'POST', body: form });
      const d = await r.json();
      if (d.error) {
        setUploadError(d.error);
      } else {
        await loadFiles();
        await loadMessages();
      }
    } catch(err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function deleteFile(id) {
    if (!confirm('Remove this DBC file?')) return;
    await fetch(`/api/dbc/files/${id}`, { method: 'DELETE' });
    loadFiles();
    loadMessages();
  }

  async function toggleMessage(frameId) {
    const key = String(frameId);
    if (expanded.has(key)) {
      const next = new Set(expanded);
      next.delete(key);
      setExpanded(next);
    } else {
      const next = new Set(expanded);
      next.add(key);
      setExpanded(next);
      if (!signals[key]) {
        const r = await fetch(`/api/dbc/messages/${frameId}/signals`);
        const d = await r.json();
        setSignals(s => ({ ...s, [key]: d.signals || [] }));
      }
    }
  }

  async function search(q) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    const r = await fetch(`/api/dbc/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    setSearchResults(d.results || []);
  }

  // Group messages by DBC file
  const messagesByFile = files.reduce((acc, f) => {
    acc[f.filename] = messages.filter(m => m.dbc_file === f.filename);
    return acc;
  }, {});

  return html`
    <div class="tab-pane" style="display:flex;overflow:hidden">
      <!-- Left: File list + upload -->
      <div style="width:260px;min-width:260px;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:12px;border-bottom:1px solid var(--border)">
          <div class="panel-title">DBC Files</div>
          <label class="btn btn-primary" style="width:100%;justify-content:center;cursor:pointer;margin-top:8px">
            ${uploading ? 'Uploading...' : '+ Upload DBC'}
            <input type="file" accept=".dbc" onChange=${uploadFile} style="display:none" disabled=${uploading} />
          </label>
          ${uploadError && html`<div class="warn-box" style="margin-top:8px">${uploadError}</div>`}
        </div>

        <div style="flex:1;overflow-y:auto">
          ${files.map(f => html`
            <div key=${f.id} style="padding:8px 12px;border-bottom:1px solid var(--border)">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <span style="flex:1;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  title=${f.filename}>📁 ${f.filename}</span>
                <button class="btn btn-sm" onClick=${() => deleteFile(f.id)} style="color:var(--accent-red)">✕</button>
              </div>
              <div style="font-size:11px;color:var(--text-muted)">
                ${f.message_count} messages
                ${f.error && html` — <span style="color:var(--accent-red)">${f.error}</span>`}
              </div>
            </div>
          `)}
          ${files.length === 0 && html`
            <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">
              No DBC files loaded.<br/>Upload a .dbc file to get started.
            </div>
          `}
        </div>
      </div>

      <!-- Right: Tree + search -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          <input
            placeholder="Search messages and signals..."
            value=${searchQuery}
            onInput=${e => search(e.target.value)}
            style="flex:1;max-width:300px"
          />
          ${searchQuery && html`
            <button class="btn btn-sm" onClick=${() => { setSearchQuery(''); setSearchResults([]); }}>✕</button>
          `}
          <span class="text-muted text-small">${messages.length} messages total</span>
        </div>

        <div style="flex:1;overflow-y:auto">
          ${searchQuery
            ? html`
              <div class="dbc-tree">
                ${searchResults.length === 0 && html`
                  <div style="padding:16px;color:var(--text-muted);font-size:12px">No results for "${searchQuery}"</div>
                `}
                ${searchResults.map(r => html`
                  <div key=${r.name + r.type} style="padding:6px 12px;border-bottom:1px solid var(--border);font-size:12px">
                    <div style="color:var(--accent-blue)">${r.type === 'message' ? '📨' : '📊'} ${r.name}</div>
                    <div class="text-muted text-small">
                      ${r.type === 'message' ? `ID: ${r.id}, DLC: ${r.dlc}` : `in ${r.message} · ${r.unit || 'no unit'}`}
                    </div>
                  </div>
                `)}
              </div>
            `
            : html`
              <div class="dbc-tree">
                ${files.map(f => html`
                  <div class="dbc-file" key=${f.id}>
                    <div class="dbc-file-header">
                      <span>📁 ${f.filename}</span>
                      <span class="text-muted text-small">(${f.message_count} msgs)</span>
                    </div>
                    ${(messagesByFile[f.filename] || []).map(msg => html`
                      <div key=${msg.frame_id}>
                        <div class="dbc-message" onClick=${() => toggleMessage(msg.frame_id)}>
                          <span>${expanded.has(String(msg.frame_id)) ? '▼' : '▶'}</span>
                          <span style="margin-left:4px">📨 ${msg.name}</span>
                          <span class="text-muted" style="margin-left:6px">(${msg.frame_id > 0x7FF ? msg.frame_id.toString(16).toUpperCase().padStart(8,'0') : msg.frame_id.toString(16).toUpperCase().padStart(3,'0')}x)</span>
                          <span class="text-muted" style="margin-left:6px">DLC: ${msg.length}</span>
                          ${msg.cycle_time ? html`<span class="text-muted"> · ${msg.cycle_time}ms</span>` : ''}
                        </div>
                        ${expanded.has(String(msg.frame_id)) && html`
                          <div>
                            ${(signals[String(msg.frame_id)] || []).map(sig => html`
                              <div class="dbc-signal" key=${sig.name}>
                                <span>📊</span>
                                <span style="color:var(--text-secondary)">${sig.name}</span>
                                <span class="text-muted">
                                  · bits:${sig.start_bit}|${sig.length}
                                  · ×${sig.factor}+${sig.offset}
                                  ${sig.unit ? ` · ${sig.unit}` : ''}
                                  ${sig.minimum !== null ? ` · [${sig.minimum}, ${sig.maximum}]` : ''}
                                </span>
                              </div>
                            `)}
                            ${signals[String(msg.frame_id)]?.length === 0 && html`
                              <div class="dbc-signal text-muted">No signals defined</div>
                            `}
                          </div>
                        `}
                      </div>
                    `)}
                  </div>
                `)}
              </div>
            `
          }
        </div>
      </div>
    </div>
  `;
}
