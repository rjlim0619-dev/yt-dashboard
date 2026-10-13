(() => {
  "use strict";

  // ================= config & state =================
  const CFG = window.DASH_CONFIG || {};
  const CONFIGURED = !!CFG.CLIENT_ID && !CFG.CLIENT_ID.startsWith("PASTE");
  const SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ].join(" ");
  const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const state = {
    token: null, expiry: 0, tokenClient: null,
    mode: null,          // "live" | "demo"
    days: 28, metric: "views", data: null, busy: false,
  };
  const charts = {};

  // ================= helpers =================
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("en");
  const cf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const num = (n) => (n == null || isNaN(n)) ? "–" : (Math.abs(n) >= 10000 ? cf.format(n) : nf.format(Math.round(n)));
  const dur = (sec) => {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  };
  const hours = (min) => {
    const h = (min || 0) / 60;
    return h >= 100 ? num(h) : h.toFixed(1);
  };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isoDur = (iso) => {
    const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
    return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
  };
  const ago = (iso) => {
    const d = (Date.now() - new Date(iso)) / 86400000;
    if (d < 1) return "today";
    if (d < 2) return "yesterday";
    if (d < 30) return `${Math.floor(d)}d ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
  };
  const rows = (rep) => {
    const h = (rep.columnHeaders || []).map((c) => c.name);
    return (rep.rows || []).map((r) => Object.fromEntries(h.map((n, i) => [n, r[i]])));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ================= YouTube API =================
  class AuthError extends Error {
    constructor() { super("Session expired. Re-establish uplink to reload your data."); }
  }

  async function call(base, params) {
    if (!state.token || Date.now() > state.expiry - 30000) throw new AuthError();
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${state.token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new AuthError();
    if (!r.ok) throw new Error(j.error?.message || `${r.status} ${r.statusText}`);
    return j;
  }
  const yt = (path, p) => call(`https://www.googleapis.com/youtube/v3/${path}`, p);
  const ya = (p) => call("https://youtubeanalytics.googleapis.com/v2/reports", { ids: "channel==MINE", ...p });

  const TOTALS = "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments";

  async function fetchLive(days) {
    const end = new Date();
    const start = addDays(end, -(days - 1));
    const pEnd = addDays(start, -1);
    const pStart = addDays(pEnd, -(days - 1));
    const R = { startDate: ymd(start), endDate: ymd(end) };

    const ch = (await yt("channels", { part: "snippet,statistics,contentDetails", mine: "true" })).items?.[0];
    if (!ch) throw new Error("This Google account has no YouTube channel. Sign in with the account that owns your channel.");

    const [tot, prev, daily, top, traffic] = await Promise.all([
      ya({ ...R, metrics: TOTALS }),
      ya({ startDate: ymd(pStart), endDate: ymd(pEnd), metrics: TOTALS }),
      ya({ ...R, metrics: TOTALS, dimensions: "day", sort: "day" }),
      ya({ ...R, metrics: "views,estimatedMinutesWatched,averageViewDuration,likes", dimensions: "video", sort: "-views", maxResults: "10" }),
      ya({ ...R, metrics: "views", dimensions: "insightTrafficSourceType", sort: "-views" }),
    ]);

    let recentIds = [];
    try {
      const pl = await yt("playlistItems", {
        part: "contentDetails", maxResults: "12",
        playlistId: ch.contentDetails.relatedPlaylists.uploads,
      });
      recentIds = (pl.items || []).map((i) => i.contentDetails.videoId);
    } catch { /* channel has no uploads yet */ }

    const topRows = rows(top);
    const ids = [...new Set([...topRows.map((r) => r.video), ...recentIds])].slice(0, 50);
    const vids = ids.length
      ? (await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") })).items || []
      : [];
    const V = Object.fromEntries(vids.map((v) => [v.id, v]));
    const thumb = (v) => v?.snippet?.thumbnails?.medium?.url || v?.snippet?.thumbnails?.default?.url || "";

    return {
      channel: {
        id: ch.id,
        title: ch.snippet.title,
        handle: ch.snippet.customUrl || "",
        thumb: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || "",
        url: `https://www.youtube.com/channel/${ch.id}`,
        subs: ch.statistics.hiddenSubscriberCount ? null : +ch.statistics.subscriberCount,
        views: +ch.statistics.viewCount,
        videos: +ch.statistics.videoCount,
      },
      totals: rows(tot)[0] || {},
      prev: rows(prev)[0] || {},
      daily: rows(daily),
      top: topRows.map((r) => ({
        ...r, id: r.video,
        title: V[r.video]?.snippet?.title || "(private or deleted video)",
        thumb: thumb(V[r.video]),
      })),
      traffic: rows(traffic),
      recent: recentIds.map((id) => V[id]).filter(Boolean).map((v) => ({
        id: v.id, title: v.snippet.title, thumb: thumb(v), published: v.snippet.publishedAt,
        views: +(v.statistics.viewCount || 0), likes: +(v.statistics.likeCount || 0),
        comments: +(v.statistics.commentCount || 0), duration: isoDur(v.contentDetails.duration),
      })),
    };
  }

  // ================= sample data =================
  function fetchDemo(days) {
    let seed = 1234 + days;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const end = new Date(), start = addDays(end, -(days - 1));
    const daily = [];
    for (let i = 0; i < days; i++) {
      const base = 380 + i * (520 / days) + Math.sin(i / 2.5) * 70;
      const spike = rnd() < 0.07 ? 700 * rnd() : 0;
      const views = Math.round(base + rnd() * 140 + spike);
      daily.push({
        day: ymd(addDays(start, i)), views,
        estimatedMinutesWatched: Math.round(views * (2.4 + rnd())),
        averageViewDuration: Math.round(180 + rnd() * 50),
        subscribersGained: Math.round(views / 85 + rnd() * 4),
        subscribersLost: Math.round(rnd() * 3),
        likes: Math.round(views * (0.035 + rnd() * 0.02)),
        comments: Math.round(views * (0.004 + rnd() * 0.004)),
      });
    }
    const sum = (k) => daily.reduce((a, r) => a + r[k], 0);
    const totals = {
      views: sum("views"), estimatedMinutesWatched: sum("estimatedMinutesWatched"),
      averageViewDuration: Math.round(sum("averageViewDuration") / days),
      subscribersGained: sum("subscribersGained"), subscribersLost: sum("subscribersLost"),
      likes: sum("likes"), comments: sum("comments"),
    };
    const prev = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * (0.75 + rnd() * 0.35))]));
    const titles = [
      "Sample video: Beginner tutorial", "Sample video: Weekly vlog", "Sample video: Build with me",
      "Sample video: Q&A stream highlights", "Sample video: Top 5 tips", "Sample video: Behind the scenes",
      "Sample video: Reacting to comments", "Sample video: Setup tour", "Sample video: Short #1",
      "Sample video: Challenge part 2", "Sample video: Livestream recap", "Sample video: Quick fix",
    ];
    const top = titles.slice(0, 10).map((t, i) => {
      const v = Math.round(totals.views * 0.28 / (i + 1) ** 0.9);
      return { id: `demo${i}`, title: t, thumb: "", views: v, estimatedMinutesWatched: Math.round(v * 2.7), averageViewDuration: 150 + Math.round(rnd() * 200), likes: Math.round(v * 0.05) };
    });
    const traffic = [
      ["YT_SEARCH", .31], ["RELATED_VIDEO", .24], ["SHORTS", .16], ["SUBSCRIBER", .1],
      ["YT_CHANNEL", .07], ["EXT_URL", .05], ["PLAYLIST", .04], ["NOTIFICATION", .03],
    ].map(([k, p]) => ({ insightTrafficSourceType: k, views: Math.round(totals.views * p) }));
    const recent = titles.map((t, i) => ({
      id: `demo-r${i}`, title: t, thumb: "", published: addDays(end, -(i * 4 + 1)).toISOString(),
      views: Math.round(3000 / (i + 1) + rnd() * 600), likes: Math.round(150 / (i + 1) + rnd() * 30),
      comments: Math.round(rnd() * 40), duration: 60 + Math.round(rnd() * 900),
    }));
    return {
      channel: { id: "UC-SIMULATION-0001", title: "Sample Channel", handle: "@samplechannel", thumb: "", url: "#", subs: 12840, views: 1532900, videos: 86 },
      totals, prev, daily, top, traffic, recent,
    };
  }

  // ================= rendering =================
  const TRAFFIC = {
    YT_SEARCH: "YouTube search", RELATED_VIDEO: "Suggested videos", SUBSCRIBER: "Browse features",
    YT_CHANNEL: "Channel pages", EXT_URL: "External", PLAYLIST: "Playlists", NOTIFICATION: "Notifications",
    SHORTS: "Shorts feed", YT_OTHER_PAGE: "Other YouTube", NO_LINK_OTHER: "Direct / unknown",
    NO_LINK_EMBEDDED: "Embedded", END_SCREEN: "End screens", ANNOTATION: "Cards & annotations",
    CAMPAIGN_CARD: "Campaign cards", ADVERTISING: "YouTube ads", HASHTAGS: "Hashtag pages",
    YT_PLAYLIST_PAGE: "Playlist pages", SOUND_PAGE: "Sound pages", LIVE_REDIRECT: "Live redirects",
    VIDEO_REMIXES: "Remixes", PRODUCT_PAGE: "Product pages", PROMOTED: "Promoted",
  };
  const C = { cyan: "#00e5ff", magenta: "#ff2bd6", violet: "#7c5cff", lime: "#39ff88", amber: "#ffb020", red: "#ff3860" };
  const PALETTE = [C.cyan, C.magenta, C.violet, C.lime, C.amber, C.red, "#2bd9c8", "#5a6b85"];

  const thumbImg = (url, cls, i = 0) => url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`
    : `<div class="${cls} ph" style="background:linear-gradient(135deg, ${PALETTE[i % 6]}55, #070c16 55%, ${PALETTE[(i + 2) % 6]}44)"></div>`;
  const videoUrl = (id) => state.mode === "demo" ? "#" : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const linkAttrs = () => state.mode === "demo" ? "" : ` target="_blank" rel="noopener"`;

  // animated number counter
  function countUp(el, target, fmt) {
    if (REDUCED || target == null || isNaN(target)) { el.textContent = fmt(target); return; }
    const t0 = performance.now(), D = 900;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / D);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderChannel(c) {
    const avatar = c.thumb
      ? `<img class="avatar" src="${esc(c.thumb)}" alt="">`
      : `<div class="avatar fallback">${esc(c.title.charAt(0))}</div>`;
    $("#channel").innerHTML = `
      <div class="avatar-ring">${avatar}</div>
      <div class="ch-name">
        <div class="ch-id">ID // ${esc(c.id || "")}</div>
        <h1><a href="${esc(c.url)}"${linkAttrs()}>${esc(c.title)}</a></h1>
        <p>${esc(c.handle)}</p>
      </div>
      <div class="ch-stats">
        <div class="ch-stat"><b data-n="${c.subs ?? ""}">${c.subs == null ? "HIDDEN" : "0"}</b><span>Subscribers</span></div>
        <div class="ch-stat"><b data-n="${c.views}">0</b><span>Lifetime views</span></div>
        <div class="ch-stat"><b data-n="${c.videos}">0</b><span>Videos</span></div>
      </div>`;
    document.querySelectorAll("#channel b[data-n]").forEach((b) => {
      if (b.dataset.n !== "") countUp(b, +b.dataset.n, num);
    });
  }

  function delta(cur, prev) {
    if (!prev || cur == null) return `<span class="delta"><small>NO PRIOR DATA</small></span>`;
    const p = ((cur - prev) / Math.abs(prev)) * 100;
    if (!isFinite(p)) return `<span class="delta"><small>NO PRIOR DATA</small></span>`;
    const cls = p > 0.5 ? "up" : p < -0.5 ? "down" : "";
    const arrow = p > 0.5 ? "▲" : p < -0.5 ? "▼" : "■";
    return `<span class="delta ${cls}">${arrow} ${Math.abs(p).toFixed(1)}% <small>VS PREV</small></span>`;
  }

  let sparkId = 0;
  function spark(values, color) {
    if (!values.length) return "";
    const W = 200, H = 34, pad = 2;
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => [
      values.length === 1 ? W / 2 : (i / (values.length - 1)) * W,
      H - pad - ((v - min) / span) * (H - pad * 2),
    ]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const id = `sg${++sparkId}`;
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line}L${W},${H}L0,${H}Z" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 3px ${color})"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}" style="filter:drop-shadow(0 0 4px ${color})"/>
    </svg>`;
  }

  function renderKpis(t, p, daily) {
    const net = (o) => (o.subscribersGained || 0) - (o.subscribersLost || 0);
    const series = (f) => daily.map(f);
    const items = [
      ["Views", t.views, num, delta(t.views, p.views), series((r) => r.views), C.cyan],
      ["Watch time · hrs", (t.estimatedMinutesWatched || 0) / 60, (v) => hours(v * 60), delta(t.estimatedMinutesWatched, p.estimatedMinutesWatched), series((r) => r.estimatedMinutesWatched), C.violet],
      ["Avg. view duration", t.averageViewDuration, dur, delta(t.averageViewDuration, p.averageViewDuration), series((r) => r.averageViewDuration || 0), C.magenta],
      ["Net subscribers", net(t), (v) => (v > 0.5 ? "+" : "") + num(v), delta(net(t), net(p)), series(net), C.lime],
      ["Likes", t.likes, num, delta(t.likes, p.likes), series((r) => r.likes || 0), C.amber],
      ["Comments", t.comments, num, delta(t.comments, p.comments), series((r) => r.comments || 0), "#2bd9c8"],
    ];
    $("#kpis").innerHTML = items.map(([l, , , d, s, col], i) =>
      `<div class="panel kpi" style="animation-delay:${i * 0.05}s"><div class="label">${l}</div><div class="value" data-i="${i}">–</div>${d}${spark(s, col)}</div>`).join("");
    document.querySelectorAll("#kpis .value").forEach((el) => {
      const [, v, f] = items[+el.dataset.i];
      countUp(el, v, f);
    });
  }

  // Chart.js neon glow
  const glowPlugin = {
    id: "glow",
    beforeDatasetDraw(chart, args, opts) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.shadowColor = opts.color || C.cyan;
      ctx.shadowBlur = opts.blur ?? 14;
    },
    afterDatasetDraw(chart) { chart.ctx.restore(); },
  };

  function chartDefaults() {
    if (!window.Chart) return false;
    Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = "#6f8ba3";
    Chart.defaults.borderColor = "rgba(0, 229, 255, .08)";
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: "rgba(4, 10, 20, .95)", borderColor: "rgba(0, 229, 255, .5)", borderWidth: 1,
      titleColor: C.cyan, bodyColor: "#d8f6ff", cornerRadius: 0, padding: 10,
      titleFont: { family: "'JetBrains Mono', monospace", weight: "700" },
      bodyFont: { family: "'JetBrains Mono', monospace" },
    });
    return true;
  }

  function renderDaily(daily) {
    if (!chartDefaults()) return;
    const M = {
      views: { label: "Views", f: (r) => r.views, color: C.cyan },
      watch: { label: "Watch time (hrs)", f: (r) => +(r.estimatedMinutesWatched / 60).toFixed(1), color: C.violet },
      subs: { label: "Net subscribers", f: (r) => (r.subscribersGained || 0) - (r.subscribersLost || 0), color: C.lime },
    }[state.metric];
    const labels = daily.map((r) => new Date(r.day + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" }).toUpperCase());
    const canvas = $("#dailyChart");
    const ctx = canvas.getContext("2d");
    const h = canvas.parentElement.clientHeight || 300;
    const isBar = state.metric === "subs";
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    if (isBar) {
      fill.addColorStop(0, M.color);
      fill.addColorStop(1, C.cyan + "22");
    } else {
      fill.addColorStop(0, M.color + "66");
      fill.addColorStop(0.6, M.color + "10");
      fill.addColorStop(1, M.color + "00");
    }
    charts.daily?.destroy();
    charts.daily = new Chart(ctx, {
      type: isBar ? "bar" : "line",
      plugins: [glowPlugin],
      data: {
        labels,
        datasets: [{
          label: M.label, data: daily.map(M.f),
          borderColor: M.color, backgroundColor: fill,
          fill: true, tension: 0.35, borderWidth: isBar ? 0 : 2,
          pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: "#fff", pointHoverBorderColor: M.color, pointHoverBorderWidth: 2,
          maxBarThickness: 14,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: REDUCED ? false : { duration: 900, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { displayColors: false }, glow: { color: M.color, blur: isBar ? 10 : 16 } },
        scales: {
          x: { grid: { display: false }, border: { color: "rgba(0,229,255,.3)" }, ticks: { maxTicksLimit: innerWidth < 560 ? 4 : 8, maxRotation: 0 } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: "rgba(0,229,255,.07)" }, ticks: { maxTicksLimit: 6, callback: (v) => num(v) } },
        },
      },
    });
  }

  function renderTraffic(traffic) {
    const legend = $("#trafficLegend");
    charts.traffic?.destroy();
    if (!traffic.length) {
      legend.innerHTML = `<li class="empty">NO TRAFFIC DATA IN RANGE</li>`;
      $("#donutTotal").textContent = "0";
      return;
    }
    let items = traffic.map((r) => ({ name: TRAFFIC[r.insightTrafficSourceType] || r.insightTrafficSourceType, v: r.views }));
    if (items.length > 7) {
      const rest = items.slice(7).reduce((a, r) => a + r.v, 0);
      items = [...items.slice(0, 7), { name: "Other", v: rest }];
    }
    const total = items.reduce((a, r) => a + r.v, 0) || 1;
    countUp($("#donutTotal"), total, num);
    legend.innerHTML = items.map((r, i) => {
      const pc = (r.v / total) * 100;
      return `<li><span class="sw" style="background:${PALETTE[i]};box-shadow:0 0 6px ${PALETTE[i]}"></span><span class="nm">${esc(r.name)}</span><span class="pc">${pc.toFixed(1)}%</span><span class="bar"><i style="width:${pc}%;background:${PALETTE[i]}"></i></span></li>`;
    }).join("");
    if (!chartDefaults()) return;
    charts.traffic = new Chart($("#trafficChart"), {
      type: "doughnut",
      plugins: [glowPlugin],
      data: { labels: items.map((r) => r.name), datasets: [{ data: items.map((r) => r.v), backgroundColor: PALETTE, borderColor: "#04070d", borderWidth: 3, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "74%",
        animation: REDUCED ? false : { animateRotate: true, duration: 1000 },
        plugins: { legend: { display: false }, glow: { color: "rgba(0,229,255,.6)", blur: 12 }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${num(c.raw)} views` } } },
      },
    });
  }

  function renderTop(top) {
    $("#topLabel").textContent = `// LAST ${state.days} DAYS`;
    $("#topBody").innerHTML = top.length ? top.map((v, i) => `
      <tr>
        <td class="rank">${String(i + 1).padStart(2, "0")}</td>
        <td><a class="vid" href="${videoUrl(v.id)}"${linkAttrs()}>${thumbImg(v.thumb, "th", i)}<span class="tt">${esc(v.title)}</span></a></td>
        <td class="num"><b>${num(v.views)}</b></td>
        <td class="num hide-sm">${hours(v.estimatedMinutesWatched)} h</td>
        <td class="num hide-sm">${dur(v.averageViewDuration)}</td>
        <td class="num hide-xs">${num(v.likes)}</td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="empty">NO VIEWS IN RANGE</td></tr>`;
  }

  function renderUploads(recent) {
    $("#uploads").innerHTML = recent.length ? recent.map((v, i) => `
      <a class="up" href="${videoUrl(v.id)}"${linkAttrs()}>
        <div class="thumb-box">${thumbImg(v.thumb, "th", i + 3)}<span class="len">${dur(v.duration)}</span></div>
        <div class="tt">${esc(v.title)}</div>
        <div class="meta"><span><b>${num(v.views)}</b> views</span><span><b>${num(v.likes)}</b> likes</span><span>${ago(v.published)}</span></div>
      </a>`).join("")
      : `<div class="empty">NO TRANSMISSIONS YET</div>`;
  }

  function render(d) {
    renderChannel(d.channel);
    renderKpis(d.totals, d.prev, d.daily);
    renderDaily(d.daily);
    renderTraffic(d.traffic);
    renderTop(d.top);
    renderUploads(d.recent);
  }

  // ================= UI state =================
  function show(which) {
    $("#welcome").hidden = which !== "welcome";
    $("#dash").hidden = which !== "dash";
  }
  function banner(html, kind = "") {
    const b = $("#banner");
    if (!html) { b.hidden = true; return; }
    b.className = `banner ${kind}`;
    b.innerHTML = html;
    b.hidden = false;
  }
  function setStatus() {
    const s = $("#status");
    const [cls, txt] = state.mode === "live" ? ["live", "UPLINK ACTIVE"]
      : state.mode === "demo" ? ["demo", "SIMULATION"] : ["", "OFFLINE"];
    s.className = `status ${cls}`;
    s.querySelector("b").textContent = txt;
  }
  function updateAuthBtn() {
    const btn = $("#authBtn");
    if (state.token) { btn.textContent = "Disconnect"; btn.className = "btn"; }
    else { btn.textContent = "Connect"; btn.className = "btn primary"; }
    setStatus();
  }
  const setupHint = `Simulation mode. To connect your channel, add your OAuth Client ID to <code>config.js</code> (see the README).`;

  async function load() {
    if (state.busy || !state.mode) return;
    state.busy = true;
    setStatus();
    $("#loading").hidden = false;
    $("#dash").style.opacity = ".25";
    try {
      state.data = state.mode === "demo" ? fetchDemo(state.days) : await fetchLive(state.days);
      if (state.mode === "demo") await sleep(REDUCED ? 0 : 350);
      render(state.data);
      show("dash");
      if (state.mode === "live") banner("");
      $("#updated").textContent = `LAST SYNC ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`;
    } catch (e) {
      console.error(e);
      if (e instanceof AuthError) {
        state.token = null; state.mode = null; updateAuthBtn(); show("welcome");
        banner(esc(e.message));
      } else {
        banner(`Couldn't load data: ${esc(e.message)}`, "error");
      }
    } finally {
      state.busy = false;
      $("#loading").hidden = true;
      $("#dash").style.opacity = "";
    }
  }

  // ================= auth =================
  function initAuth() {
    if (!CONFIGURED) return;
    if (!window.google?.accounts?.oauth2) { setTimeout(initAuth, 150); return; }
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) { banner(`Sign-in failed: ${esc(resp.error_description || resp.error)}`, "error"); return; }
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES.split(" "))) {
          banner("Please allow both permissions (YouTube account + YouTube Analytics) so the dashboard can read your stats.", "error");
          return;
        }
        state.token = resp.access_token;
        state.expiry = Date.now() + (+resp.expires_in || 3600) * 1000;
        state.mode = "live";
        updateAuthBtn();
        load();
      },
      error_callback: (err) => {
        if (err?.type !== "popup_closed") banner(`Sign-in problem: ${esc(err?.message || err?.type || "unknown")}`, "error");
      },
    });
  }

  function signIn() {
    if (!CONFIGURED) { banner(setupHint); return; }
    if (!state.tokenClient) { banner("Google sign-in is still loading. Try again in a moment."); return; }
    state.tokenClient.requestAccessToken();
  }

  function signOut() {
    if (state.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(state.token, () => {});
    Object.assign(state, { token: null, expiry: 0, mode: null, data: null });
    updateAuthBtn();
    banner("");
    show("welcome");
  }

  // ================= HUD: clock + boot =================
  function startClock() {
    const el = $("#clock");
    const off = -new Date().getTimezoneOffset() / 60;
    const tz = `UTC${off >= 0 ? "+" : ""}${off}`;
    const tick = () => {
      el.textContent = `${new Date().toLocaleTimeString("en-GB", { hour12: false })} ${tz}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  async function boot() {
    const box = $("#boot");
    if (REDUCED) { box.remove(); return; }
    let seen = false;
    try { seen = sessionStorage.getItem("cp-booted") === "1"; } catch { /* storage unavailable */ }
    const log = $("#bootLog"), bar = $("#bootBar");
    const lines = seen
      ? [["RESUMING SESSION", "OK"]]
      : [
        ["INITIALIZING CORE MODULES", "OK"],
        ["LOADING VISUALIZATION ENGINE", "OK"],
        ["CALIBRATING TELEMETRY GRID", "OK"],
        [CONFIGURED ? "OAUTH HANDSHAKE MODULE ARMED" : "NO CLIENT ID · SIMULATION MODE", CONFIGURED ? "OK" : "WARN"],
        ["ALL SYSTEMS NOMINAL", "READY"],
      ];
    for (let i = 0; i < lines.length; i++) {
      const [txt, st] = lines[i];
      log.innerHTML += `&gt; ${txt.padEnd(34, ".")} <span class="${st === "WARN" ? "warn" : "ok"}">[${st}]</span>\n`;
      bar.style.width = `${((i + 1) / lines.length) * 100}%`;
      await sleep(seen ? 120 : 210);
    }
    await sleep(250);
    box.classList.add("done");
    setTimeout(() => box.remove(), 600);
    try { sessionStorage.setItem("cp-booted", "1"); } catch { /* storage unavailable */ }
  }

  // ================= events =================
  $("#authBtn").addEventListener("click", () => (state.token ? signOut() : signIn()));
  $("#welcomeSignIn").addEventListener("click", signIn);
  $("#demoBtn").addEventListener("click", () => {
    state.mode = "demo";
    banner(CONFIGURED ? "Running simulation. Connect to see your real channel." : setupHint);
    load();
  });
  $("#refreshBtn").addEventListener("click", load);
  $("#range").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-days]");
    if (!b || state.busy) return;
    document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("active", x === b));
    state.days = +b.dataset.days;
    load();
  });
  $("#metricToggle").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]");
    if (!b) return;
    document.querySelectorAll("#metricToggle button").forEach((x) => x.classList.toggle("active", x === b));
    state.metric = b.dataset.m;
    if (state.data) renderDaily(state.data.daily);
  });

  // ================= start =================
  startClock();
  boot();
  show("welcome");
  setStatus();
  if (!CONFIGURED) {
    $("#welcomeSignIn").textContent = "Establish uplink (needs setup)";
    state.mode = "demo";
    banner(setupHint);
    load();
  }
  initAuth();
})();
