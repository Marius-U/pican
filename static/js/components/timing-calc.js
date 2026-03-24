// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

export default function TimingCalc({ bitrate, label = 'Timing' }) {
  const [timing, setTiming] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bitrate) return;
    setLoading(true);
    fetch(`/api/config/timing?bitrate=${bitrate}&clock=40000000`)
      .then(r => r.json())
      .then(d => { setTiming(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [bitrate]);

  if (loading) return html`<div class="text-muted text-small">Calculating...</div>`;
  if (!timing) return null;

  const spOk = timing.sample_point >= 75 && timing.sample_point <= 87.5;

  return html`
    <div class="panel" style="margin-top:8px">
      <div class="panel-title">${label} Parameters (40 MHz clock)</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:12px">
        <div>
          <div class="text-muted">BRP</div>
          <div class="text-mono">${timing.brp}</div>
        </div>
        <div>
          <div class="text-muted">TSEG1</div>
          <div class="text-mono">${timing.tseg1}</div>
        </div>
        <div>
          <div class="text-muted">TSEG2</div>
          <div class="text-mono">${timing.tseg2}</div>
        </div>
        <div>
          <div class="text-muted">SJW</div>
          <div class="text-mono">${timing.sjw}</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:16px;font-size:12px">
        <div>
          <span class="text-muted">Sample Point: </span>
          <span class="text-mono ${!spOk ? 'badge badge-amber' : ''}">${timing.sample_point}%</span>
          ${!spOk && html`<span class="text-muted" style="margin-left:4px">(rec: 75–87.5%)</span>`}
        </div>
        <div>
          <span class="text-muted">Actual: </span>
          <span class="text-mono">${(timing.actual_bitrate/1000).toFixed(3)} kbit/s</span>
        </div>
        <div>
          <span class="text-muted">Error: </span>
          <span class="text-mono">${timing.error_pct}%</span>
        </div>
      </div>
      ${!spOk && html`
        <div class="warn-box" style="margin-top:8px">
          Sample point ${timing.sample_point}% is outside the recommended 75–87.5% range.
        </div>
      `}
    </div>
  `;
}
