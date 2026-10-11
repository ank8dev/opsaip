// dash-shim.js — a small stand-in for the dashboard runtime, so the page runs as a plain local file.
// The page talks to `window.dash`: data(id), onData(fn), calc(id, def) and a few no-ops.
// Data comes from window.OPSAIP_DATA (the files in data/). To use live data later,
// fill OPSAIP_DATA from your API and call dash.reload().
(function () {
  var DATA = window.OPSAIP_DATA || {};
  var calcs = {}, listeners = [], params = {}, t = 0;
  function compute(id, depth) {
    if (Object.prototype.hasOwnProperty.call(DATA, id)) return DATA[id];
    var c = calcs[id];
    if (!c || (depth || 0) > 8) return null;
    try { return c.fn.apply(null, (c.inputs || []).map(function (i) { return compute(i, (depth || 0) + 1) || []; })); }
    catch (e) { console.error('calc ' + id + ' failed', e); return null; }
  }
  function fire() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  window.dash = {
    data: function (id) {
      var rows = compute(id);
      if (rows == null) return { status: 'missing', data: [], rows: [], columns: [], message: 'No data for ' + id, refreshing: false, meta: [] };
      var cols = Array.isArray(rows) && rows.length && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
      return { status: 'ok', data: rows, rows: rows, value: rows, columns: cols, message: '', refreshing: false, meta: [] };
    },
    onData: function (fn) { listeners.push(fn); try { fn(); } catch (e) { console.error(e); } },
    calc: function (id, def) { calcs[id] = def; },
    loader: function () {},
    colors: ['#C8F03C', '#7DD3FC', '#F9A8D4', '#FCD34D', '#A7F3D0', '#C4B5FD', '#FDBA74', '#94A3B8'],
    refresh: function () {},
    params: function () { return Object.assign({}, params); },
    setParams: function (p) { Object.assign(params, p || {}); fire(); },
    resetParams: function () { params = {}; fire(); },
    setLink: function () {},
    reload: function (next) { if (next) DATA = window.OPSAIP_DATA = next; fire(); }
  };
  window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fire, 150); });
})();
