"use strict";
(function () {
    var output = document.getElementById('results');
    function rng(seed) {
        return function () {
            seed |= 0;
            seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    var random = rng(0x5052464c);
    function pick(a) { return a[Math.floor(random() * a.length)]; }
    var inserts = ['(', ')', ';', ' BEGIN ', ' END ', ' IF ', ' SELECT ', '/* fuzz */', '-- fuzz\n',
        "'", "[", ']', ' @x ', '\nGO\n', ' $$ ', ' <> ', ' , '];
    function mutate(sql) {
        if (!sql.length)
            return pick(inserts);
        var mode = Math.floor(random() * 7), at = Math.floor(random() * (sql.length + 1));
        if (mode === 0)
            return sql.slice(0, at) + pick(inserts) + sql.slice(at);
        if (mode === 1)
            return sql.slice(0, at) + sql.slice(Math.min(sql.length, at + 1 + Math.floor(random() * 8)));
        if (mode === 2) {
            var len = 1 + Math.floor(random() * Math.min(20, sql.length - at || 1));
            return sql.slice(0, at) + sql.slice(at, at + len) + sql.slice(at);
        }
        if (mode === 3)
            return sql.slice(0, at);
        if (mode === 4)
            return pick(inserts) + sql + pick(inserts);
        if (mode === 5)
            return sql.replace(/\b(SELECT|BEGIN|END|IF|FROM)\b/i, pick(['SELECT', 'BEGIN', 'END', 'IF', 'FROM']));
        return sql.split('').map(function (c) { return random() < 0.015 ? pick(['(', ')', "'", ';']) : c; }).join('');
    }
    function graphInvariant(result, sql) {
        var ids = {}, ok = true;
        result.graph.nodes.forEach(function (n) {
            if (ids[n.id])
                ok = false;
            ids[n.id] = 1;
            if (n.source && (n.source.start < 0 || n.source.end < n.source.start || n.source.end > sql.length))
                ok = false;
        });
        result.graph.edges.forEach(function (e) { if (!ids[e.from] || !ids[e.to])
            ok = false; });
        return ok;
    }
    function stableSummary(result) {
        return JSON.stringify({
            dialect: result.dialect, coverage: result.coverage, diagnostics: result.diagnostics,
            stats: result.stats, nodes: result.graph.nodes, edges: result.graph.edges
        });
    }
    var seeds = PROCFLOW_FIXTURES.map(function (f) { return { sql: f.sql, dialect: f.dialect }; });
    var failures = [], cases = 400;
    for (var i = 0; i < cases; i++) {
        var seed = seeds[i % seeds.length], sql = seed.sql;
        var rounds = 1 + Math.floor(random() * 4);
        while (rounds--)
            sql = mutate(sql);
        try {
            var opts = { dialect: seed.dialect || 'auto', mode: 'auto', group: false, sources: true };
            var a = analyse(sql, opts), b = analyse(sql, opts);
            if (!isFinite(a.coverage) || a.coverage < 0 || a.coverage > 1)
                failures.push({ case: i, reason: 'coverage out of range' });
            else if (!Array.isArray(a.diagnostics))
                failures.push({ case: i, reason: 'diagnostics missing' });
            else if (!graphInvariant(a, sql))
                failures.push({ case: i, reason: 'graph or source-span invariant failed' });
            else if (stableSummary(a) !== stableSummary(b))
                failures.push({ case: i, reason: 'analysis is not deterministic' });
            else if (!/^flowchart (TD|LR)/.test(a.mermaid))
                failures.push({ case: i, reason: 'Mermaid output missing' });
            else if (i % 20 === 0) {
                var xml = toDrawio(a.graph, { title: 'Fuzz ' + i, dir: 'TD' });
                var doc = new DOMParser().parseFromString(xml, 'application/xml');
                if (doc.querySelector('parsererror'))
                    failures.push({ case: i, reason: 'draw.io XML malformed' });
            }
        }
        catch (err) {
            failures.push({ case: i, reason: String(err && err.stack || err), sample: sql.slice(0, 300) });
        }
        if (failures.length >= 20)
            break;
    }
    var pass = failures.length === 0;
    document.body.className = pass ? 'pass' : 'fail';
    document.getElementById('summary').textContent =
        (pass ? 'PASS' : 'FAIL') + ' · ' + cases + ' deterministic mutation cases';
    output.textContent = JSON.stringify({ seed: '0x5052464c', cases: cases, failures: failures }, null, 2);
})();
//# sourceMappingURL=fuzz.js.map