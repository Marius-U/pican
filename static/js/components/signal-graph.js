// SPDX-License-Identifier: AGPL-3.0-or-later
import { h } from 'https://esm.sh/preact@10.19.3';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

// Chart.js loaded from CDN
let Chart;
async function getChart() {
  if (Chart) return Chart;
  const module = await import('https://esm.sh/chart.js@4.4.0/auto');
  Chart = module.default;
  return Chart;
}

const COLORS = [
  '#58a6ff', '#3fb950', '#f78166', '#d2a8ff', '#ffa657', '#bc8cff',
];

const TIME_WINDOWS = [10, 30, 60, 300];

export default function SignalGraph({ signals, graphHz = 10 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [timeWindow, setTimeWindow] = useState(60);
  const intervalRef = useRef(null);

  useEffect(() => {
    let destroyed = false;
    getChart().then(C => {
      if (destroyed || !canvasRef.current) return;

      const datasets = signals.map((sig, i) => ({
        label: sig,
        data: [],
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2,
      }));

      chartRef.current = new C(canvasRef.current, {
        type: 'line',
        data: { datasets },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false },
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'Time (s)', color: '#8b949e' },
              ticks: { color: '#8b949e' },
              grid: { color: '#30363d' },
            },
            y: {
              title: { display: false },
              ticks: { color: '#8b949e' },
              grid: { color: '#30363d' },
            },
          },
          plugins: {
            legend: {
              labels: { color: '#e6edf3', font: { size: 11 } },
            },
          },
        },
      });
    });

    return () => {
      destroyed = true;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    };
  }, [signals.join(',')]);

  // Poll signal history at graphHz
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (paused || !chartRef.current) return;

    intervalRef.current = setInterval(async () => {
      if (!chartRef.current) return;
      const chart = chartRef.current;

      for (let i = 0; i < signals.length; i++) {
        const sig = signals[i];
        try {
          const r = await fetch(`/api/signals/history?signal=${encodeURIComponent(sig)}&window=${timeWindow}`);
          const d = await r.json();
          if (!d.data) continue;

          const now = d.data.length > 0 ? d.data[d.data.length - 1][0] : Date.now() / 1000;
          chart.data.datasets[i].data = d.data.map(([ts, v]) => ({
            x: ts - now + timeWindow,
            y: v,
          }));
        } catch(e) {}
      }

      chart.update('none');
    }, 1000 / graphHz);

    return () => clearInterval(intervalRef.current);
  }, [signals.join(','), paused, timeWindow, graphHz]);

  async function exportCsv() {
    const lines = ['signal,timestamp,value'];
    for (const sig of signals) {
      const r = await fetch(`/api/signals/history?signal=${encodeURIComponent(sig)}&window=${timeWindow}`);
      const d = await r.json();
      (d.data || []).forEach(([ts, v]) => lines.push(`${sig},${ts},${v}`));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'signals.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return html`
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="display:flex;gap:8px;align-items:center;padding:8px 0;flex-shrink:0">
        <button class="btn btn-sm" onClick=${() => setPaused(p => !p)}>
          ${paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <span class="text-muted text-small">Window:</span>
        ${TIME_WINDOWS.map(w => html`
          <button key=${w} class="btn btn-sm ${timeWindow === w ? 'btn-primary' : ''}"
            onClick=${() => setTimeWindow(w)}>${w}s</button>
        `)}
        <div class="flex-spacer"></div>
        <button class="btn btn-sm" onClick=${exportCsv}>↓ CSV</button>
      </div>
      <div style="flex:1;position:relative;min-height:200px">
        <canvas ref=${canvasRef}></canvas>
      </div>
    </div>
  `;
}
