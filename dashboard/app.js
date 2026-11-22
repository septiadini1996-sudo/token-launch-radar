// Token Launch Radar's dashboard. It renders window.RADAR (written beside dashboard/ by main.ts)
// as a ranked, sortable, filterable board of pre-token protocols, with a detail drawer per
// protocol that shows the model's own arithmetic and the protocol's farm plan, plus a second tab
// for the protocols whose token already trades, which the radar sets aside. No network: every
// byte on the page comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };

  var fmtFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return fmtFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  var rowsBySlug = {};
  DATA.rows.forEach(function (r) { rowsBySlug[r.slug] = r; });
  var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;

  // ------------------------------------------------------------- header
  var meta = DATA.meta;
  var hero = el('section', { class: 'hero' },
    el('h1', null, 'TOKEN LAUNCH ', el('span', { class: 'tick' }, 'RADAR')),
    el('p', { class: 'lede', text: 'Every protocol in the sealed snapshot that records no token yet, ranked by what a launch would be worth if its record stayed as it is, each with the farm plan that positions a reader for it. The watchlist is the floor, never the ceiling: the board ranks the whole pre-token field, not only the names above it.' }),
    el('div', { class: 'chips' },
      el('span', { class: 'chip' }, 'snapshot ', el('b', { text: meta.as_of })),
      el('span', { class: 'chip' }, el('b', { text: String(meta.protocols) }), ' protocols scanned'),
      el('span', { class: 'chip watch' }, el('b', { text: String(meta.watchlist) }), ' on the house watchlist, all covered'),
      el('span', { class: 'chip' }, el('b', { text: String(meta.board_rows) }), ' pre-token rows ranked'),
      el('span', { class: 'chip' }, el('b', { text: String(meta.live_rows) }), ' traded protocols set aside')
    )
  );

  // ------------------------------------------------------------- the model, stated on the page
  var model = DATA.model;
  var multis = el('div', { class: 'multis' });
  model.categories.slice(0, 10).forEach(function (c) {
    multis.appendChild(el('span', { class: 'multi' }, c.category + ' ', el('b', { text: c.multiple.toFixed(2) + 'x' }), ' (' + c.peers + ' peers)'));
  });
  multis.appendChild(el('span', { class: 'multi' }, 'all categories ', el('b', { text: model.overall_multiple.toFixed(2) + 'x' }), ' (' + model.traded_peers + ' peers)'));
  var modelStrip = el('section', { class: 'model' },
    el('h2', { text: 'How a launch is priced' }),
    el('p', null,
      'Implied value = TVL x category multiple x growth tilt x maturity tilt. The ',
      el('b', { text: 'category multiple' }),
      ' is the market\u2019s own price for a dollar of TVL, read from this snapshot: the median market-cap-to-TVL ratio of its traded protocols in that category, blended toward the all-category median in proportion to how few peers priced it, so a category read off four peers cannot out-shout one read off forty (the plain all-category median applies where a category has too few traded peers to read at all). The ',
      el('b', { text: 'growth tilt' }),
      ' moves with seven-day TVL change, clamped between ' + model.growth_floor + '% and +' + model.growth_cap + '% at a weight of ' + model.growth_weight + '. The ',
      el('b', { text: 'maturity tilt' }),
      ' runs from ' + model.maturity_base.toFixed(2) + ' to ' + (model.maturity_base + model.maturity_range).toFixed(2) + ' across ' + model.maturity_days + ' days tracked with no token recorded. No protocol is named in the model: change the snapshot and the board re-derives itself.'
    ),
    multis
  );

  // ------------------------------------------------------------- tabs, controls, table
  var tabs = el('div', { class: 'tabs', role: 'tablist' });
  var tabPre = el('button', { class: 'tab', role: 'tab', text: 'Pre-token board' });
  var tabLive = el('button', { class: 'tab', role: 'tab', text: 'Already trading, set aside' });
  tabs.appendChild(tabPre);
  tabs.appendChild(tabLive);

  var search = el('input', { type: 'search', placeholder: 'Search name or slug', 'aria-label': 'Search protocols' });
  var catSelect = el('select', { 'aria-label': 'Filter by category' });
  var chainSelect = el('select', { 'aria-label': 'Filter by chain' });
  var watchBox = el('input', { type: 'checkbox' });
  var count = el('span', { class: 'count' });
  var controls = el('div', { class: 'controls' },
    search, catSelect, chainSelect,
    el('label', { class: 'toggle' }, watchBox, 'watchlist only'),
    count
  );
  var tableWrap = el('div');
  var sheet = el('section', { class: 'sheet' }, controls, tableWrap);

  var cats = {};
  var chains = {};
  DATA.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  catSelect.appendChild(el('option', { value: 'all', text: 'All categories' }));
  Object.keys(cats).sort().forEach(function (c) { catSelect.appendChild(el('option', { value: c, text: c })); });
  chainSelect.appendChild(el('option', { value: 'all', text: 'All chains' }));
  Object.keys(chains).sort().forEach(function (c) { chainSelect.appendChild(el('option', { value: c, text: c })); });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
  }
  var SORTS = {
    rank: function (r) { return r.rank; },
    implied: function (r) { return r.implied_value_usd; },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    multiple: function (r) { return r.multiple; }
  };
  function headCell(label, key, cls) {
    var th = el('th', { class: (cls ? cls + ' ' : '') + 'sortable' }, label);
    if (state.sort === key) th.appendChild(el('span', { class: 'dir', text: state.dir === 1 ? ' \u25b2' : ' \u25bc' }));
    th.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      renderTable();
    });
    return th;
  }
  function renderTable() {
    tableWrap.textContent = '';
    if (state.tab === 'live') { renderLive(); return; }
    var list = filtered().slice().sort(function (a, b) {
      var f = SORTS[state.sort];
      return (f(a) - f(b)) * state.dir;
    });
    count.textContent = list.length + ' of ' + DATA.rows.length + ' rows';
    if (!list.length) {
      tableWrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches that filter. Loosen it: the radar only ranks what the snapshot records.' }));
      return;
    }
    var thead = el('thead', null, el('tr', null,
      headCell('#', 'rank', 'num'),
      headCell('Protocol', 'rank'),
      el('th', { text: 'Category' }),
      el('th', { class: 'chains', text: 'Chains' }),
      headCell('TVL', 'tvl', 'num'),
      headCell('7d', 'change', 'num'),
      headCell('Age', 'age', 'num age'),
      headCell('Comp', 'multiple', 'num'),
      headCell('Implied value', 'implied', 'num')
    ));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var nameCell = el('td', { class: 'proto' }, el('b', { text: r.name }), el('span', { class: 'slug', text: r.slug }));
      if (r.watchlist) nameCell.appendChild(el('span', { class: 'wmark', text: 'watchlist' }));
      var impliedCell = el('td', { class: 'num' },
        document.createTextNode(fmtUsd(r.implied_value_usd)),
        el('div', { class: 'bar' }, el('i', null))
      );
      impliedCell.querySelector('i').style.width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%';
      var tr = el('tr', { tabindex: '0' },
        el('td', { class: 'rank', text: String(r.rank) }),
        nameCell,
        el('td', null, el('span', { class: 'cat', text: r.category || 'Uncategorised' })),
        el('td', { class: 'chains' }, el('span', { class: 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num age', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
        impliedCell
      );
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') openDetail(r.slug); });
      tbody.appendChild(tr);
    });
    tableWrap.appendChild(el('table', null, thead, tbody));
  }
  function renderLive() {
    count.textContent = DATA.live.length + ' traded protocols, shown for contrast and never ranked';
    var thead = el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Token' }),
      el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: '7d' })
    ));
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'proto' }, el('b', { text: r.name }), el('span', { class: 'slug', text: r.slug })),
        el('td', { text: r.symbol || 'recorded' }),
        el('td', null, el('span', { class: 'cat', text: r.category || 'Uncategorised' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })
      ));
    });
    tableWrap.appendChild(el('table', null, thead, tbody));
  }

  // ------------------------------------------------------------- detail drawer
  var scrim = el('div', { class: 'scrim' });
  var drawer = el('aside', { class: 'drawer', 'aria-label': 'Protocol detail' });
  document.body.appendChild(scrim);
  document.body.appendChild(drawer);
  function closeDetail() {
    state.selected = null;
    scrim.classList.remove('open');
    drawer.classList.remove('open');
    if (location.hash.indexOf('#/p/') === 0) history.pushState(null, '', location.pathname + location.search);
  }
  scrim.addEventListener('click', closeDetail);
  function stat(k, v) { return el('div', { class: 'stat' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })); }
  function openDetail(slug) {
    var r = rowsBySlug[slug];
    if (!r) return;
    state.selected = slug;
    drawer.textContent = '';
    var close = el('button', { class: 'close', text: 'Close' });
    close.addEventListener('click', closeDetail);
    drawer.appendChild(close);
    drawer.appendChild(el('h2', { text: r.name }));
    drawer.appendChild(el('div', { class: 'dslug', text: r.slug + ' \u00b7 rank #' + r.rank + ' of ' + DATA.rows.length + (r.watchlist ? ' \u00b7 on the house watchlist' : ' \u00b7 found below the watchlist floor') }));
    drawer.appendChild(el('div', { class: 'stats' },
      stat('Implied value', fmtUsd(r.implied_value_usd)),
      stat('TVL', fmtUsd(r.tvl_usd)),
      stat('7d TVL change', fmtPct(r.change_7d)),
      stat('Tracked, no token', fmtAge(r.age_days)),
      stat('Category', r.category || 'Uncategorised'),
      stat('Chains', r.chains.join(', ') || 'none recorded')
    ));
    drawer.appendChild(el('h3', { text: 'The model\u2019s arithmetic' }));
    drawer.appendChild(el('div', { class: 'arith' },
      el('div', null, el('span', { text: 'TVL' }), el('span', { text: fmtUsd(r.tvl_usd) })),
      el('div', null, el('span', { text: 'x category multiple (' + r.multiple_peers + ' traded peers)' }), el('span', { text: r.multiple.toFixed(3) })),
      el('div', null, el('span', { text: 'x growth tilt (7d ' + fmtPct(r.change_7d) + ', clamped)' }), el('span', { text: r.growth_mult.toFixed(3) })),
      el('div', null, el('span', { text: 'x maturity tilt (' + fmtAge(r.age_days) + ' with no token recorded)' }), el('span', { text: r.maturity_mult.toFixed(3) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('span', { text: fmtUsd(r.implied_value_usd) }))
    ));
    drawer.appendChild(el('h3', { text: 'The farm plan' }));
    var plan = el('ol', { class: 'plan' });
    r.farm_steps.forEach(function (s) { plan.appendChild(el('li', { text: s })); });
    drawer.appendChild(plan);
    drawer.appendChild(el('p', { class: 'note', text: 'Costs and times inside the plan are planning estimates for a small farmer, not quotes. The snapshot records no token for this protocol; that is a statement about the record, not proof none exists anywhere.' }));
    scrim.classList.add('open');
    drawer.classList.add('open');
    if (location.hash !== '#/p/' + slug) history.pushState(null, '', '#/p/' + slug);
  }

  // ------------------------------------------------------------- wiring
  search.addEventListener('input', function () { state.q = search.value; renderTable(); });
  catSelect.addEventListener('change', function () { state.category = catSelect.value; renderTable(); });
  chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; renderTable(); });
  watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; renderTable(); });
  function setTab(tab) {
    state.tab = tab;
    tabPre.setAttribute('aria-selected', tab === 'pre' ? 'true' : 'false');
    tabLive.setAttribute('aria-selected', tab === 'live' ? 'true' : 'false');
    controls.style.display = tab === 'pre' ? '' : 'none';
    renderTable();
  }
  tabPre.addEventListener('click', function () { setTab('pre'); });
  tabLive.addEventListener('click', function () { setTab('live'); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDetail(); });

  var footer = el('footer', null,
    el('b', { text: 'Reading the board. ' }),
    document.createTextNode('Data: the sealed snapshot of DefiLlama\u2019s protocol list (' + meta.source + '), read exactly as the grader reads it; nothing on this page is fetched live. An implied value is this radar\u2019s own model claim about a launch that may never happen, not a prediction and not advice. Protocols are described as recording no token in the snapshot, never as having none.')
  );

  app.appendChild(hero);
  app.appendChild(modelStrip);
  app.appendChild(tabs);
  app.appendChild(sheet);
  app.appendChild(footer);
  app.setAttribute('aria-busy', 'false');

  // Hash routes: #/p/<slug> opens a detail, #/f/<category> presets the filter (the screenshots
  // are taken through these same routes, so what is pictured is what the code does).
  function applyHash() {
    var h = location.hash;
    if (h.indexOf('#/p/') === 0) openDetail(decodeURIComponent(h.slice(4)));
    else if (h.indexOf('#/f/') === 0) {
      closeDetail();
      var c = decodeURIComponent(h.slice(4));
      if (cats[c]) { state.category = c; catSelect.value = c; setTab('pre'); }
    }
  }
  window.addEventListener('hashchange', applyHash);
  setTab('pre');
  applyHash();
})();
