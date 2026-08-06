"use strict";
/* proc>flow: query and CTE lineage */
/* ---------- query structure (CTE lineage) ---------- */
var NOT_TABLE = S(['SELECT', 'LATERAL', 'ONLY', 'TABLE', 'UNNEST', 'VALUES', 'FINAL', 'OLD', 'NEW',
    'XMLTABLE', 'JSON_TABLE', 'GENERATE_SERIES', 'DUAL']);
function splitCTEs(toks) {
    var res = { ctes: [], finalStart: 0 };
    if (!toks.length)
        return res;
    if (toks[0].u !== 'WITH')
        return res;
    var i = 1;
    if (toks[i] && toks[i].u === 'RECURSIVE') {
        res.recursive = true;
        i++;
    }
    while (i < toks.length) {
        var nameTok = toks[i];
        if (!nameTok || nameTok.type !== 'word')
            break;
        var name = nameTok.v;
        i++;
        if (toks[i] && toks[i].v === '(') { /* optional column list */
            var d0 = 0;
            while (i < toks.length) {
                if (toks[i].v === '(')
                    d0++;
                else if (toks[i].v === ')') {
                    d0--;
                    if (d0 === 0) {
                        i++;
                        break;
                    }
                }
                i++;
            }
        }
        if (!(toks[i] && toks[i].u === 'AS'))
            break;
        i++;
        while (toks[i] && ['MATERIALIZED', 'NOT'].indexOf(toks[i].u) >= 0)
            i++;
        if (!(toks[i] && toks[i].v === '('))
            break;
        var start = i, d = 0;
        while (i < toks.length) {
            if (toks[i].v === '(')
                d++;
            else if (toks[i].v === ')') {
                d--;
                if (d === 0) {
                    i++;
                    break;
                }
            }
            i++;
        }
        res.ctes.push({ name: name, body: toks.slice(start + 1, i - 1) });
        if (toks[i] && toks[i].v === ',') {
            i++;
            continue;
        }
        break;
    }
    res.finalStart = i;
    return res;
}
/* Return the query tokens that follow a DECLARE … CURSOR FOR (T-SQL) or a
   FOR … CURSOR FOR (DB2) declaration, so cursor queries can join the query
   graph. Falls back to the full token list when no CURSOR/FOR pair is found. */
function queryTokensBehindCursor(toks) {
    if (!toks || !toks.length)
        return toks || [];
    var cursor = -1;
    for (var k = 0; k < toks.length; k++)
        if (toks[k].u === 'CURSOR') {
            cursor = k;
            break;
        }
    if (cursor < 0)
        return toks;
    var f = cursor + 1;
    while (f < toks.length && toks[f].u !== 'FOR')
        f++;
    if (f >= toks.length)
        return toks;
    return toks.slice(f + 1);
}
function refsIn(toks) {
    var refs = [], structuredRefs = [], joins = 0, unions = 0, subs = 0, filtered = false, d = 0, agg = false;
    for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (t.v === '(') {
            d++;
            if (toks[i + 1] && toks[i + 1].u === 'SELECT')
                subs++;
            continue;
        }
        if (t.v === ')') {
            d--;
            continue;
        }
        if (t.type !== 'word')
            continue;
        if (t.u === 'JOIN')
            joins++;
        else if (t.u === 'UNION')
            unions++;
        else if (t.u === 'WHERE' && d === 0)
            filtered = true;
        else if ((t.u === 'GROUP' || t.u === 'DISTINCT') && d === 0)
            agg = true;
        if (t.u === 'FROM' || t.u === 'JOIN') {
            var n = toks[i + 1];
            if (!n || n.type !== 'word' || n.v === '(' || NOT_TABLE[n.u])
                continue;
            var name = qname(toks, i + 1);
            refs.push(name);
            /* Build a structured reference with span, role, and resolution. */
            var nameStart = i + 1, nameEnd = i + 1;
            while (toks[nameEnd] && (toks[nameEnd].v === '.' ||
                (toks[nameEnd].type === 'word' && toks[nameEnd - 1] && toks[nameEnd - 1].v === '.')))
                nameEnd++;
            if (toks[nameEnd] && toks[nameEnd].type === 'word' &&
                !(toks[nameEnd - 1] && toks[nameEnd - 1].v === '.'))
                nameEnd++;
            var span = null;
            if (toks[nameStart] && toks[nameEnd - 1])
                span = { start: toks[nameStart].pos, end: toks[nameEnd - 1].end };
            structuredRefs.push({
                name: name, span: span, role: 'read',
                resolution: name.split('.').length >= 3 ? 'heuristic' : 'exact'
            });
        }
    }
    return { refs: refs, structuredRefs: structuredRefs,
        joins: joins, unions: unions, subs: subs, filtered: filtered, agg: agg };
}
function buildQueryGraph(stmtToks, header, opts) {
    opts = opts || {};
    var showSrc = opts.sources !== false;
    var split = splitCTEs(stmtToks);
    var finalToks = stmtToks.slice(split.finalStart);
    var nodes = [], edges = [], seq = 0, srcIds = {}, cteIds = {}, byName = {};
    var stats = { ctes: split.ctes.length, tables: 0, joins: 0, unions: 0, subs: 0, depth: 0 };
    function add(shape, text, cls, source) {
        var id = 'q' + (++seq);
        nodes.push({ id: id, shape: shape, text: (text && String(text).trim()) || '…',
            cls: cls, source: source || null,
            provenance: source ? 'source' : 'synthetic' });
        return id;
    }
    function link(a, b, label) {
        if (a && b && a !== b)
            edges.push({ from: a, to: b, label: label || '', style: 'solid',
                kind: 'dependency' });
    }
    function descr(r) {
        var bits = [];
        if (r.joins)
            bits.push(r.joins + ' join' + (r.joins > 1 ? 's' : ''));
        if (r.unions)
            bits.push(r.unions + ' union' + (r.unions > 1 ? 's' : ''));
        if (r.subs)
            bits.push(r.subs + ' subquer' + (r.subs > 1 ? 'ies' : 'y'));
        if (r.filtered)
            bits.push('filtered');
        if (r.agg)
            bits.push('grouped');
        return bits.join(' · ');
    }
    split.ctes.forEach(function (c) {
        c.info = refsIn(c.body);
        stats.joins += c.info.joins;
        stats.unions += c.info.unions;
        stats.subs += c.info.subs;
        var d = descr(c.info);
        cteIds[c.name.toUpperCase()] = add('rect', c.name + (d ? '\u0001' + d : ''), 'cte', spanOfTokens(c.body));
        byName[c.name.toUpperCase()] = c;
    });
    var fi = refsIn(finalToks);
    stats.joins += fi.joins;
    stats.unions += fi.unions;
    stats.subs += fi.subs;
    var fd = descr(fi);
    var finalLabel = opts.finalLabel || header.name || 'Final SELECT';
    var finalId = add('round', finalLabel + (fd ? '\u0001' + fd : ''), 'final', spanOfTokens(finalToks));
    function srcNode(name) {
        var k = name.toUpperCase();
        if (!srcIds[k]) {
            srcIds[k] = add('io', name, 'src');
            stats.tables++;
        }
        return srcIds[k];
    }
    function wire(refs, toId) {
        var seen = {};
        refs.forEach(function (r) {
            var k = r.toUpperCase();
            if (seen[k])
                return;
            seen[k] = 1;
            if (cteIds[k])
                link(cteIds[k], toId);
            else if (showSrc)
                link(srcNode(r), toId);
            else
                stats.tables = Object.keys(srcIds).length;
        });
    }
    split.ctes.forEach(function (c) { wire(c.info.refs, cteIds[c.name.toUpperCase()]); });
    wire(fi.refs, finalId);
    if (!showSrc) {
        var all = {};
        split.ctes.forEach(function (c) { c.info.refs.forEach(function (r) { if (!cteIds[r.toUpperCase()])
            all[r.toUpperCase()] = 1; }); });
        fi.refs.forEach(function (r) { if (!cteIds[r.toUpperCase()])
            all[r.toUpperCase()] = 1; });
        stats.tables = Object.keys(all).length;
    }
    /* longest chain through the CTE graph */
    var memo = {};
    function depthOf(id, guard) {
        if (memo[id] !== undefined)
            return memo[id];
        if ((guard || 0) > 60)
            return 0;
        var best = 0;
        edges.forEach(function (e) { if (e.to === id)
            best = Math.max(best, depthOf(e.from, (guard || 0) + 1) + 1); });
        return (memo[id] = best);
    }
    stats.depth = depthOf(finalId, 0);
    stats.parts = stats.ctes + stats.joins + stats.unions + stats.subs;
    return { nodes: nodes, edges: edges, stats: stats, empty: split.ctes.length === 0 && fi.refs.length === 0 };
}
/*
 * Build one query/data-structure view for a whole procedure or script.
 * Control-flow constructs are deliberately ignored here: each query-bearing
 * statement becomes an operation, with its CTEs and source objects wired in.
 */
function buildObjectQueryGraph(ast, header, opts) {
    opts = opts || {};
    var statements = [];
    var QUERY_HEAD = S(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'COPY']);
    function collect(list) {
        (list || []).forEach(function (st) {
            if (st.toks && st.type !== 'unknown') {
                var split = splitCTEs(st.toks);
                var finalToks = st.toks.slice(split.finalStart);
                var head = finalToks[0] ? finalToks[0].u : '';
                var isCursor = head === 'DECLARE' && st.toks.some(function (x) { return x.u === 'CURSOR'; });
                if (split.ctes.length || QUERY_HEAD[head] || isCursor) {
                    if (isCursor) {
                        var cq = queryTokensBehindCursor(st.toks);
                        var qh = cq[0] ? cq[0].u : '';
                        if (cq.length && QUERY_HEAD[qh])
                            statements.push(cq);
                        else
                            statements.push(st.toks);
                    }
                    else
                        statements.push(st.toks);
                }
            }
            if (st.type === 'block')
                collect(st.body);
            else if (st.type === 'if') {
                if (st.then)
                    collect([st.then]);
                if (st.else)
                    collect([st.else]);
            }
            else if (st.type === 'case') {
                st.branches.forEach(function (b) { collect(b.body); });
                collect(st.else);
            }
            else if (['while', 'for', 'loop', 'repeat'].indexOf(st.type) >= 0 && st.body) {
                if (st.type === 'for' && st.head && st.head.some(function (x) { return x.u === 'CURSOR'; })) {
                    var fq = queryTokensBehindCursor(st.head);
                    var fh = fq[0] ? fq[0].u : '';
                    if (fq.length && QUERY_HEAD[fh])
                        statements.push(fq);
                }
                collect([st.body]);
            }
            else if (st.type === 'try') {
                collect(st.body);
                st.handlers.forEach(function (h) { collect(h.body); });
            }
            else if (st.type === 'handler' && st.body)
                collect([st.body]);
        });
    }
    collect(ast);
    var nodes = [], edges = [], seq = 0, sourceIds = {};
    var stats = { ctes: 0, tables: 0, joins: 0, unions: 0, subs: 0, depth: 0, parts: 0 };
    statements.forEach(function (toks) {
        var split = splitCTEs(toks);
        var finalToks = toks.slice(split.finalStart);
        var childOpts = { sources: opts.sources };
        childOpts.finalLabel = summarise(finalToks, 64);
        var child = buildQueryGraph(toks, { name: '' }, childOpts);
        var remap = {};
        child.nodes.forEach(function (n) {
            if (n.cls === 'src') {
                var sourceKey = n.text.toUpperCase();
                if (!sourceIds[sourceKey]) {
                    sourceIds[sourceKey] = 'oq' + (++seq);
                    nodes.push({ id: sourceIds[sourceKey], shape: n.shape, text: n.text, cls: n.cls,
                        source: n.source || null, provenance: n.provenance || 'synthetic' });
                }
                remap[n.id] = sourceIds[sourceKey];
            }
            else {
                remap[n.id] = 'oq' + (++seq);
                nodes.push({ id: remap[n.id], shape: n.shape, text: n.text, cls: n.cls,
                    source: n.source || null, provenance: n.provenance || 'synthetic' });
            }
        });
        child.edges.forEach(function (e) {
            if (remap[e.from] && remap[e.to] && remap[e.from] !== remap[e.to])
                edges.push({ from: remap[e.from], to: remap[e.to], label: e.label || '',
                    style: e.style || 'solid', kind: e.kind || 'dependency' });
        });
        stats.ctes += child.stats.ctes;
        stats.joins += child.stats.joins;
        stats.unions += child.stats.unions;
        stats.subs += child.stats.subs;
        stats.depth = Math.max(stats.depth, child.stats.depth);
    });
    stats.tables = Object.keys(sourceIds).length;
    stats.parts = stats.ctes + stats.joins + stats.unions + stats.subs + statements.length;
    if (!nodes.length) {
        nodes.push({ id: 'oq1', shape: 'round', text: 'No query-bearing statements found',
            cls: 'final', source: null });
    }
    return { nodes: nodes, edges: edges, stats: stats, empty: statements.length === 0 };
}
//# sourceMappingURL=lineage.js.map