const $now = document.getElementById('now');
const $queue = document.getElementById('queue');
const $dot = document.getElementById('dot');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

const fmtUptime = (s) => {
  s = Math.floor(s || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const POLL_MS = 5000;
const STATS_MS = 10000;
const TICK_MS = 1000;

let pos = 0;
let dur = 0;
let trackId = null;
let playing = false;

const pct = () => (dur > 0 ? Math.min(100, (pos / dur) * 100) : 0);

function renderNow() {
  const np = window.__np;
  if (!np) {
    $now.innerHTML = '<span class="empty">Nothing playing</span>';
    return;
  }
  if (!document.getElementById('pos')) {
    $now.innerHTML = `
      <div class="title">${esc(np.title || 'Unknown')}</div>
      ${np.artist ? `<div class="artist">${esc(np.artist)}</div>` : ''}
      <div class="progress">
        <span class="t" id="pos"></span>
        <div class="bar"><span id="bar"></span></div>
        <span class="t" id="dur">${fmt(dur)}</span>
      </div>`;
  }
  document.getElementById('pos').textContent = fmt(pos);
  document.getElementById('bar').style.width = `${pct()}%`;
}

function renderQueue(upcoming, total, nowPlaying) {
  const listCount = upcoming?.length || 0;
  const queueTotal = Number(total) || listCount;

  if (listCount === 0 && queueTotal === 0) {
    $queue.innerHTML = '';
    return;
  }

  const isPlaylist = nowPlaying?.source === 'youtube' && queueTotal > listCount + 2;

  if (isPlaylist) {
    $queue.innerHTML = `
      <div class="queue">
        <h2><span>Playing playlist</span><span class="count">${queueTotal} tracks</span></h2>
        <div class="q-playlist">Now playing from a YouTube playlist</div>
      </div>`;
    return;
  }

  if (listCount === 0) {
    $queue.innerHTML = '';
    return;
  }

  $queue.innerHTML = `
    <div class="queue">
      <h2><span>Up Next</span><span class="count">${queueTotal}</span></h2>
      <ol>
        ${upcoming.slice(0, 5).map((i) => `
          <li>
            <div class="q-meta">
              <div class="q-title">${esc(i.title || 'Unknown')}</div>
              ${i.artist ? `<div class="q-artist">${esc(i.artist)}</div>` : ''}
            </div>
            ${i.duration ? `<div class="q-dur">${fmt(i.duration)}</div>` : ''}
          </li>`).join('')}
      </ol>
    </div>`;
}

function tick() {
  if (!playing || !window.__np) return;
  pos = Math.min(pos + 1, dur);
  document.getElementById('pos').textContent = fmt(pos);
  document.getElementById('bar').style.width = `${pct()}%`;
}

async function poll() {
  try {
    const r = await fetch('/data', { cache: 'no-store' });
    if (!r.ok) throw 0;
    const d = await r.json();
    const np = d.nowPlaying;
    const id = np ? `${np.title}|${np.artist || ''}` : null;

    if (id !== trackId) {
      trackId = id;
      pos = d.progress?.position ?? 0;
      dur = d.progress?.duration ?? np?.duration ?? 0;
      window.__np = np;
      $now.innerHTML = '';
      renderNow();
      renderQueue(d.upcoming, d.queueLength, np);
    } else {
      // 2s tolerance absorbs setInterval drift and server jitter without visibly snapping the bar
      const serverPos = d.progress?.position ?? 0;
      if (Math.abs(serverPos - pos) > 2) pos = serverPos;
      dur = d.progress?.duration ?? np?.duration ?? dur;
    }

    playing = d.status === 'playing';
    $dot.className = `dot ${playing ? 'playing' : d.status === 'paused' ? 'paused' : ''}`;
  } catch {
    $now.innerHTML = '<span class="empty">Unavailable</span>';
    $queue.innerHTML = '';
    $dot.className = 'dot';
    playing = false;
  }
}

function setBar(id, pct) {
  const bar = document.getElementById(`${id}-bar`);
  const cell = bar?.closest('.cell');
  if (!bar || !cell) return;
  if (pct == null) {
    bar.style.width = '0%';
    cell.classList.remove('warn', 'hot');
    return;
  }
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  cell.classList.toggle('warn', pct >= 60 && pct < 85);
  cell.classList.toggle('hot', pct >= 85);
}

function setCellState(id, value, warnAt, hotAt) {
  const cell = document.getElementById(id)?.closest('.cell');
  if (!cell) return;
  cell.classList.toggle('warn', value != null && value >= warnAt && value < hotAt);
  cell.classList.toggle('hot', value != null && value >= hotAt);
}

async function pollStats() {
  const el = (id) => document.getElementById(id);
  try {
    const r = await fetch('/stats', { cache: 'no-store' });
    if (!r.ok) throw 0;
    const d = await r.json();

    const online = !!d.ts?.online;
    el('s-ts-text').textContent = online ? 'online' : 'offline';
    el('s-ts-text').className = `server-status ${online ? 'ok' : 'bad'}`;
    $dot.className = `dot ${online ? 'playing' : ''}`;

    el('s-clients').textContent =
      d.ts?.clients != null
        ? `${d.ts.clients}${d.ts.maxClients ? '/' + d.ts.maxClients : ''}`
        : '—';

    const cpuPct = d.cpu?.percent ?? null;
    const ramPct = d.mem?.percent ?? null;
    const diskPct = d.disk?.percent ?? null;
    const tempC = d.temps?.[0]?.celsius ?? null;

    el('s-cpu').textContent = cpuPct != null ? `${cpuPct.toFixed(0)}%` : '—';
    el('s-ram').textContent = ramPct != null ? `${ramPct.toFixed(0)}%` : '—';
    el('s-disk').textContent = diskPct != null ? `${diskPct.toFixed(0)}%` : '—';
    el('s-temp').textContent = tempC != null ? `${tempC.toFixed(0)}°` : '—';
    el('s-uptime').textContent = d.uptime ? fmtUptime(d.uptime.host) : '—';
    el('s-clock').textContent = d.clock
      ? new Date(d.clock.iso).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: d.clock.timezone,
          timeZoneName: 'short',
        })
      : '—';

    setBar('s-cpu', cpuPct);
    setBar('s-ram', ramPct);
    setBar('s-disk', diskPct);
    setCellState('s-temp', tempC, 65, 80);
  } catch {
    el('s-ts-text').textContent = 'offline';
    el('s-ts-text').className = 'server-status bad';
    el('s-clients').textContent = '—';
    ['s-cpu', 's-ram', 's-disk', 's-temp', 's-uptime', 's-clock'].forEach((id) => {
      el(id).textContent = '—';
    });
    ['s-cpu', 's-ram', 's-disk'].forEach((id) => setBar(id, null));
    setCellState('s-temp', null, 65, 80);
  }
}

poll();
pollStats();
setInterval(tick, TICK_MS);
setInterval(poll, POLL_MS);
setInterval(pollStats, STATS_MS);