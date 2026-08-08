"use strict";
/* proc>flow: query and CTE lineage */
/* ---------- query structure (CTE lineage) ---------- */
/* Tabular functions that act as table-valued sources in a FROM clause. */
var TABULAR_FUNCS = S(['UNNEST', 'XMLTABLE', 'JSON_TABLE', 'GENERATE_SERIES']);
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
/* Keywords that terminate a comma-separated FROM/JOIN source list. */
var FROM_CLAUSE_END = S(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET',
    'FETCH', 'RETURNING', 'UNION', 'EXCEPT', 'INTERSECT',
    'INTO', 'FOR', 'ON']);
function refsIn(toks) {
    var refs = [], structuredRefs = [], joins = 0, unions = 0, subs = 0, filtered = false, agg = false, d = 0;
    var fromDepth = -1, inList = false;
    function clauseSpan(i0, i1) {
        if (i1 <= i0 || !toks[i0] || !toks[i1 - 1])
            return null;
        return { start: toks[i0].pos, end: toks[i1 - 1].end };
    }
    function qnameEnd(i) {
        if (!toks[i] || toks[i].v === '(' || toks[i].type !== 'word')
            return i;
        var k = i + 1;
        while (toks[k] && toks[k].v === '.' && toks[k + 1] && toks[k + 1].type === 'word')
            k += 2;
        return k;
    }
    function resolutionOf(name, kind) {
        if (kind === 'opaque')
            return 'opaque';
        if (kind === 'heuristic')
            return 'heuristic';
        return name.split('.').length >= 3 ? 'heuristic' : 'exact';
    }
    function addSource(start, end, name, kind, apply) {
        if (!name)
            return;
        refs.push(name);
        structuredRefs.push({ name: name, span: clauseSpan(start, end), role: 'read',
            resolution: resolutionOf(name, kind), apply: !!apply });
    }
    function readSourceAt(s0, apply) {
        var st = toks[s0];
        if (!st || st.v === '(' || st.type !== 'word')
            return;
        if (st.u === 'LATERAL' || st.u === 'VALUES')
            return; /* inner subquery handled by the scan; VALUES is literal */
        if (TABULAR_FUNCS[st.u] > 0) {
            addSource(s0, s0 + 1, st.v, 'opaque', false);
            return;
        }
        var e = qnameEnd(s0);
        addSource(s0, e, qname(toks, s0), apply ? 'heuristic' : undefined, apply);
    }
    var i = 0;
    while (i < toks.length) {
        var t = toks[i];
        if (t.v === '(') {
            d++;
            if (toks[i + 1] && toks[i + 1].u === 'SELECT')
                subs++;
            i++;
            continue;
        }
        if (t.v === ')') {
            d--;
            if (inList && d < fromDepth) {
                inList = false;
                fromDepth = -1;
            }
            i++;
            continue;
        }
        if (t.v === ',') {
            if (inList && d === fromDepth)
                readSourceAt(i + 1);
            i++;
            continue;
        }
        if (t.type !== 'word') {
            i++;
            continue;
        }
        var u = t.u;
        if (u === 'JOIN') {
            joins++;
            fromDepth = d;
            inList = true;
        }
        else if (u === 'UNION')
            unions++;
        else if (u === 'WHERE' && d === 0)
            filtered = true;
        else if ((u === 'GROUP' || u === 'DISTINCT') && d === 0)
            agg = true;
        if (u === 'FROM' || u === 'JOIN' || u === 'APPLY' || u === 'USING') {
            fromDepth = d;
            inList = true;
            readSourceAt(i + 1, u === 'APPLY');
            i++;
            continue;
        }
        if (inList && d === fromDepth && FROM_CLAUSE_END[u] > 0) {
            inList = false;
            fromDepth = -1;
        }
        i++;
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
    var stats = { ctes: split.ctes.length, tables: 0, joins: 0, unions: 0,
        subs: 0, depth: 0, recursive: 0 };
    function add(shape, text, cls, source, lines, reason) {
        var id = 'q' + (++seq);
        var label = (text && String(text).trim()) || '…';
        var structured = lines && lines.length
            ? lines.map(function (l) { return String(l).trim(); }).filter(function (l) { return l.length > 0; })
            : undefined;
        nodes.push({ id: id, shape: shape, text: structured ? structured.join('\n') : label,
            cls: cls, source: source || null, lines: structured,
            provenance: source ? 'source' : 'synthetic',
            reason: source ? undefined : reason });
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
        var isRecursive = c.info.refs.some(function (r) {
            return r.toUpperCase() === c.name.toUpperCase();
        });
        if (isRecursive)
            stats.recursive = (stats.recursive || 0) + 1;
        var cteLines = [c.name];
        if (d)
            cteLines.push(d);
        if (isRecursive)
            cteLines.push('recursive CTE');
        cteIds[c.name.toUpperCase()] = add('rect', cteLines.join('\n'), 'cte', spanOfTokens(c.body), cteLines);
        byName[c.name.toUpperCase()] = c;
    });
    var fi = refsIn(finalToks);
    stats.joins += fi.joins;
    stats.unions += fi.unions;
    stats.subs += fi.subs;
    var fd = descr(fi);
    var finalLabel = opts.finalLabel || header.name || 'Final SELECT';
    var finalLines = [finalLabel];
    if (fd)
        finalLines.push(fd);
    var finalId = add('round', finalLines.join('\n'), 'final', spanOfTokens(finalToks), finalLines);
    function srcNode(name) {
        var k = name.toUpperCase();
        if (!srcIds[k]) {
            var res = opts.catalogue ? resolveCatalogue(opts.catalogue, name) : { resolution: 'external' };
            var verified = res.resolution === 'verified';
            var id = 'q' + (++seq);
            var label = verified && res.resolvedName ? res.resolvedName : name;
            /* Verified sources become 'external' nodes with exact identity; conflict
               stays conservative with a marker; everything unproven stays a synthetic
               leaf exactly as before the catalogue existed. */
            srcIds[k] = id;
            nodes.push({ id: id, shape: 'io', text: label, cls: 'src', source: null,
                provenance: verified ? 'external' : 'synthetic',
                resolution: (verified || res.resolution === 'conflict') ? res.resolution : undefined,
                resolvedName: verified && res.resolvedName ? res.resolvedName : undefined,
                reason: verified ? undefined : 'external source object' });
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
    var stats = { ctes: 0, tables: 0, joins: 0, unions: 0, subs: 0, depth: 0, parts: 0,
        recursive: 0 };
    statements.forEach(function (toks) {
        var split = splitCTEs(toks);
        var finalToks = toks.slice(split.finalStart);
        var childOpts = { sources: opts.sources, catalogue: opts.catalogue };
        childOpts.finalLabel = summarise(finalToks, 64);
        var child = buildQueryGraph(toks, { name: '' }, childOpts);
        var remap = {};
        child.nodes.forEach(function (n) {
            if (n.cls === 'src') {
                var sourceKey = n.text.toUpperCase();
                if (!sourceIds[sourceKey]) {
                    sourceIds[sourceKey] = 'oq' + (++seq);
                    nodes.push({ id: sourceIds[sourceKey], shape: n.shape, text: n.text, cls: n.cls,
                        source: n.source || null, provenance: n.provenance || 'synthetic',
                        lines: n.lines, reason: n.reason,
                        resolution: n.resolution, resolvedName: n.resolvedName });
                }
                remap[n.id] = sourceIds[sourceKey];
            }
            else {
                remap[n.id] = 'oq' + (++seq);
                nodes.push({ id: remap[n.id], shape: n.shape, text: n.text, cls: n.cls,
                    source: n.source || null, provenance: n.provenance || 'synthetic',
                    lines: n.lines, reason: n.reason,
                    resolution: n.resolution, resolvedName: n.resolvedName });
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
        stats.recursive = (stats.recursive || 0) + (child.stats.recursive || 0);
    });
    stats.tables = Object.keys(sourceIds).length;
    stats.parts = stats.ctes + stats.joins + stats.unions + stats.subs + statements.length;
    if (!nodes.length) {
        nodes.push({ id: 'oq1', shape: 'round', text: 'No query-bearing statements found',
            cls: 'final', source: null, provenance: 'synthetic',
            reason: 'no query-bearing statements in this object' });
    }
    return { nodes: nodes, edges: edges, stats: stats, empty: statements.length === 0 };
}
//# sourceMappingURL=lineage.js.map