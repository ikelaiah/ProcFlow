"use strict";
/* proc>flow v1.7.0 — clear deterministic exports (ROADMAP workstream F).
   Export-parity fixtures parse each generated Mermaid and draw.io output back
   into a semantic manifest (exportManifest / mermaidManifest / drawioManifest,
   defined at the top level so tests/metrics.ts can reuse them) and compare with
   the input Graph: same nodes, edges, labels, and edge meaning, plus draw.io
   provenance round-trip and well-formed XML. Layout fixtures assert named graph
   classes meet their overlap, monotonic-spine, label-bound, and crossing
   budgets at documented size limits, and that large/non-planar graphs degrade
   honestly without ever claiming zero crossings.

   After the suites run, the page-level globals PROCFLOW_PARITY_PASS and
   PROCFLOW_LAYOUT_PASS gate the golden suite (tests/tests.ts) and feed the
   v1.7.0 fixture-corpus metrics (tests/metrics.ts). */
/* ---------- canonical export contract (semantic manifest) ---------- */
function normText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
/* Meaning of an edge as both exporters express it. 'data' beats 'dotted'
   because a dependency-graph write edge is data with a dotted style. */
function exportEdgeMeaning(style, kind, dashed) {
    if (kind === 'data')
        return 'data';
    if ((style && style === 'dotted') || dashed)
        return 'dotted';
    return 'plain';
}
function exportManifest(graph) {
    return {
        nodes: (graph.nodes || []).map(function (n) {
            return { id: n.id, text: normText(n.text), cls: n.cls };
        }),
        edges: (graph.edges || []).map(function (e) {
            return { from: e.from, to: e.to, label: normText(e.label),
                meaning: exportEdgeMeaning(e.style, e.kind) };
        })
    };
}
function mermaidUnescape(s) {
    return String(s)
        .replace(/#35;/g, '#').replace(/#amp;/g, '&').replace(/#quot;/g, '"')
        .replace(/#lt;/g, '<').replace(/#gt;/g, '>').replace(/#124;/g, '|')
        .replace(/#37;#37;/g, '%%')
        .replace(/<br\/>/gi, '\n').replace(/<BR>/g, '\n');
}
function clsFromClassDef(name) {
    return name.replace(/^pf/, '').replace(/^./, function (c) { return c.toLowerCase(); });
}
/* Parse a generated Mermaid flowchart back into a semantic manifest. The
   class and linkStyle lines appear after the node/edge lines, so parsing is
   two-pass: collect metadata and raw lines first, then resolve. */
function mermaidManifest(src) {
    var classes = {};
    var dataLinks = {};
    var nodeLines = [];
    var edgeLines = [];
    var edgeOrdinal = 0;
    src.split('\n').forEach(function (raw) {
        var line = raw.trim();
        if (!line)
            return;
        if (/^classDef\s+\S+/.test(line))
            return;
        var classm = /^class\s+([\w,]+)\s+(\w+);?$/.exec(line);
        if (classm) {
            var clsName = clsFromClassDef(classm[2]);
            classm[1].split(',').forEach(function (id) { classes[id] = clsName; });
            return;
        }
        var ls = /^linkStyle\s+([\d,]+)/.exec(line);
        if (ls) {
            (ls[1] || '').split(',').forEach(function (x) { dataLinks[parseInt(x, 10)] = 1; });
            return;
        }
        if (/^(flowchart|%%)/.test(line))
            return;
        var edge = /^([\w]+)\s+((?:-->|-\.->))\s*(?:\|([^|]*)\|)?\s*([\w]+)$/.exec(line);
        if (edge) {
            edgeLines.push({ from: edge[1], to: edge[4], label: edge[3] || '',
                arrow: edge[2], ordinal: edgeOrdinal++ });
            return;
        }
        var node = /^([\w]+)(.*)$/.exec(line);
        if (!node)
            return;
        nodeLines.push({ id: node[1], rest: node[2] });
    });
    var nodes = nodeLines.map(function (nl) {
        var q1 = nl.rest.indexOf('"'), q2 = nl.rest.lastIndexOf('"');
        var label = q1 < 0 || q2 <= q1 ? '' : nl.rest.slice(q1 + 1, q2);
        return { id: nl.id, text: normText(mermaidUnescape(label)), cls: classes[nl.id] || '' };
    });
    var edges = edgeLines.map(function (el) {
        var meaning = el.arrow === '-.->'
            ? (dataLinks[el.ordinal] ? 'data' : 'dotted')
            : (dataLinks[el.ordinal] ? 'data' : 'plain');
        return { from: el.from, to: el.to, label: normText(mermaidUnescape(el.label)),
            meaning: meaning };
    });
    return { nodes: nodes, edges: edges };
}
/* Parse generated draw.io XML back into a semantic manifest, recovering
   provenance metadata and data-edge routing from the round-trip. */
function drawioManifest(xml) {
    var nodes = [];
    var edges = [];
    var parsererror = null;
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var pe = doc.querySelector('parsererror');
    if (pe)
        parsererror = (pe.textContent || '').slice(0, 240);
    Array.prototype.forEach.call(doc.querySelectorAll('mxCell[vertex="1"]'), function (cell) {
        var rawId = cell.getAttribute('id') || '';
        var geo = cell.querySelector('mxGeometry');
        var style = cell.getAttribute('style') || '';
        var m = /fillColor=(#[0-9a-fA-F]{6})/.exec(style);
        var meta = cell.getAttribute('data-procflow') || '';
        var metaCls = /cls=([A-Za-z_]+)/.exec(meta);
        nodes.push({
            id: rawId.replace(/^pf-/, ''),
            text: normText((cell.getAttribute('value') || '').replace(/\n/g, ' ')),
            /* Class is carried explicitly in metadata because several classes share
               a fill colour; the fill is only a fallback. */
            cls: metaCls ? metaCls[1] : (m ? m[1].toLowerCase() : ''),
            meta: meta,
            x: parseFloat(geo && geo.getAttribute('x') || '0'),
            y: parseFloat(geo && geo.getAttribute('y') || '0'),
            w: parseFloat(geo && geo.getAttribute('width') || '0'),
            h: parseFloat(geo && geo.getAttribute('height') || '0')
        });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('mxCell[edge="1"]'), function (cell) {
        var style = cell.getAttribute('style') || '';
        var dashed = /dashed=1/.test(style);
        var kind = cell.getAttribute('data-procflow-kind') || '';
        var waypoints = [];
        Array.prototype.forEach.call(cell.querySelectorAll('mxPoint'), function (p) {
            waypoints.push({ x: parseFloat(p.getAttribute('x') || '0'),
                y: parseFloat(p.getAttribute('y') || '0') });
        });
        edges.push({
            from: (cell.getAttribute('source') || '').replace(/^pf-/, ''),
            to: (cell.getAttribute('target') || '').replace(/^pf-/, ''),
            label: normText((cell.getAttribute('value') || '').replace(/\n/g, ' ')),
            meaning: exportEdgeMeaning('', (kind || undefined), dashed),
            kind: kind,
            waypoints: waypoints
        });
    });
    return { nodes: nodes, edges: edges, parsererror: parsererror };
}
/* Class sign is recovered from the canonical fill registration both exporters
   source from (exporters.ts CANONICAL_NODE_STYLE); used only as a fallback when
   the metadata `cls=` attribute is absent. */
var PROCFLOW_FILL_TO_CLS = (function () {
    var out = {};
    Object.keys(CANONICAL_NODE_STYLE).forEach(function (cls) {
        out[CANONICAL_NODE_STYLE[cls].fill.toLowerCase()] = cls;
    });
    return out;
})();
function clsAreEqual(a, b) {
    if (a === b)
        return true;
    /* Legacy fallback: recover the class from the canonical fill registration
       when the metadata `cls=` attribute is absent. */
    if (a && a.charAt(0) === '#')
        return (PROCFLOW_FILL_TO_CLS[a] || '') === b;
    return false;
}
/* ---------- parity fixture list (one per graph construct) ---------- */
var PROCFLOW_PARITY_FIXTURES = [
    { name: 'control: procedure with IF/WHILE/try-catch/tx',
        dialect: 'tsql', cls: 'control', mode: 'flow', nodeLimit: 36, crossingBudget: 0,
        sql: [
            'CREATE PROCEDURE dbo.sync_students AS',
            'BEGIN',
            '  SET NOCOUNT ON;',
            '  BEGIN TRY',
            '    BEGIN TRANSACTION;',
            '    SELECT id INTO #work FROM dbo.Queue;',
            '    IF @@ROWCOUNT = 0',
            '      THROW 50001, \'empty\', 1;',
            '    WHILE EXISTS (SELECT 1 FROM #work)',
            '    BEGIN',
            '      UPDATE #work TOP (100) SET status = 1;',
            '    END',
            '    COMMIT;',
            '  END TRY',
            '  BEGIN CATCH',
            '    IF @@TRANCOUNT > 0 ROLLBACK;',
            '    THROW;',
            '  END CATCH;',
            'END'
        ].join('\n') },
    { name: 'control: GOTO with unresolved label and label span',
        dialect: 'tsql', cls: 'control', mode: 'flow', nodeLimit: 12, crossingBudget: 0,
        sql: [
            'CREATE PROC dbo.flow AS BEGIN',
            '  GOTO done;',
            '  done: RETURN 0;',
            '  GOTO missing;',
            'END'
        ].join('\n') },
    { name: 'control: DB2 ATOMIC rollback scope with handler',
        dialect: 'db2', cls: 'control', mode: 'flow', nodeLimit: 16, crossingBudget: 0,
        sql: [
            'CREATE PROCEDURE APP.AX() LANGUAGE SQL BEGIN',
            '  BEGIN ATOMIC',
            '    DECLARE EXIT HANDLER FOR SQLEXCEPTION',
            '      SET V_ERR = 1;',
            '    UPDATE APP.T SET X = 1;',
            '    SIGNAL SQLSTATE \'75001\' SET MESSAGE_TEXT = \'oo\';',
            '  END;',
            'END'
        ].join('\n') },
    { name: 'control: PL/pgSQL EXCEPTION handler + transaction assessment',
        dialect: 'plpgsql', cls: 'control', mode: 'flow', nodeLimit: 16, crossingBudget: 0,
        sql: [
            'CREATE OR REPLACE FUNCTION app.sync(p integer) RETURNS integer AS $$',
            'BEGIN',
            '  BEGIN',
            '    INSERT INTO app.log (j) VALUES (p);',
            '  EXCEPTION WHEN unique_violation THEN',
            '    RAISE NOTICE \'dup\';',
            '  END;',
            '  RETURN p;',
            'END;',
            '$$ LANGUAGE plpgsql;'
        ].join('\n') },
    { name: 'control: SQLite trigger RAISE terminal flow',
        dialect: 'sqlite', cls: 'control', mode: 'flow', nodeLimit: 12, crossingBudget: 0,
        sql: [
            'CREATE TRIGGER trg_reject BEFORE UPDATE ON item',
            'BEGIN',
            "  SELECT RAISE(ABORT, 'no') WHERE OLD.quantity < 0;",
            '  UPDATE item SET checked = 1;',
            'END;'
        ].join('\n') },
    { name: 'control: dynamic SQL opaque + grouped statement run',
        dialect: 'tsql', cls: 'control', mode: 'flow', nodeLimit: 14, crossingBudget: 0,
        sql: [
            'CREATE PROC dbo.dyn AS BEGIN',
            '  EXEC(\'SELECT 1\');',
            '  SELECT 1; SELECT 2; SELECT 3;',
            'END'
        ].join('\n') },
    { name: 'query: recursive CTE chain with shared sources',
        dialect: 'tsql', cls: 'query', mode: 'query', nodeLimit: 18, crossingBudget: 1,
        sql: [
            'CREATE PROCEDURE dbo.q AS',
            'BEGIN',
            '  WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n < 10),',
            '       s AS (SELECT id, x FROM dbo.src WHERE x IS NOT NULL)',
            '  SELECT r.n, s.x FROM r JOIN s ON s.id = r.n;',
            'END'
        ].join('\n') },
    { name: 'query: APPLY + tabular function + comma sources',
        dialect: 'tsql', cls: 'query', mode: 'query', nodeLimit: 16, crossingBudget: 1,
        sql: [
            'CREATE PROC dbo.q2 AS BEGIN',
            '  SELECT a.id, f.v, b.id',
            '  FROM dbo.a a',
            '  CROSS APPLY dbo.fn(a.id) f, dbo.b b',
            '  WHERE a.id > 0;',
            'END'
        ].join('\n') },
    { name: 'data: temp-table producer→consumer data edges',
        dialect: 'tsql', cls: 'data', mode: 'flow', nodeLimit: 20, crossingBudget: 0,
        sql: [
            'CREATE PROCEDURE dbo.stage AS',
            'BEGIN',
            '  SELECT id INTO #stage FROM dbo.source;',
            '  UPDATE #stage SET id = id + 1;',
            '  SELECT id FROM #stage;',
            'END'
        ].join('\n') },
    { name: 'dependencies: estate reads/writes/calls with external node',
        dialect: 'tsql', cls: 'dependencies', mode: 'flow', nodeLimit: 14, crossingBudget: 1,
        sql: [
            'CREATE VIEW dbo.export_students AS SELECT id FROM dbo.student;',
            'GO',
            'CREATE PROCEDURE dbo.refresh AS BEGIN',
            '  EXEC dbo.audit_refresh;',
            '  UPDATE dbo.student SET refreshed = 1;',
            '  SELECT id INTO #t FROM remotesrv.salesdb.dbo.orders;',
            'END'
        ].join('\n') }
];
/* Named layout classes with documented size limits and crossing budgets. */
var PROCFLOW_LAYOUT_CLASSES = [
    { cls: 'control', nodeLimit: 36, crossingBudget: 0, large: false },
    { cls: 'query', nodeLimit: 18, crossingBudget: 1, large: false },
    { cls: 'data', nodeLimit: 20, crossingBudget: 0, large: false },
    { cls: 'dependencies', nodeLimit: 14, crossingBudget: 1, large: false },
    { cls: 'nonplanar', nodeLimit: 80, crossingBudget: 30, large: true }
];
/* ---------- export-parity runner ---------- */
function parityGraphFor(fixture) {
    return fixture.cls === 'dependencies'
        ? analyseEstate([{ name: fixture.name + '.sql', text: fixture.sql }], { dialect: fixture.dialect, mode: 'auto', group: false, sources: true }).graph
        : analyse(fixture.sql, { dialect: fixture.dialect, mode: fixture.mode,
            group: true, sources: true, fanIn: true }).graph;
}
function parityFor(fixture, dir) {
    var r = parityGraphFor(fixture);
    var expected = exportManifest(r);
    var expectedNode = {};
    expected.nodes.forEach(function (n) { expectedNode[n.id] = n; });
    var mm = mermaidManifest(toMermaid(r, dir));
    var dm = drawioManifest(toDrawio(r, { title: fixture.name, dir: dir }));
    var nodeOk = mm.nodes.length === expected.nodes.length &&
        mm.nodes.every(function (n) {
            var exp = expectedNode[n.id];
            return !!exp && exp.text === n.text && exp.cls === n.cls;
        });
    var edgeSig = function (e) {
        return e.from + '|' + e.to + '|' + e.label + '|' + e.meaning;
    };
    var mmSigns = {};
    mm.edges.forEach(function (e) { mmSigns[edgeSig(e)] = 1; });
    var expEdges = expected.edges.map(function (e) { return edgeSig(e); });
    var expSigns = {};
    expEdges.forEach(function (s) { expSigns[s] = 1; });
    var edgeOk = mm.edges.length === expected.edges.length &&
        expEdges.every(function (s) { return !!mmSigns[s]; }) &&
        mm.edges.every(function (e) { return !!expSigns[edgeSig(e)]; });
    var dmNode = {};
    dm.nodes.forEach(function (n) { dmNode[n.id] = n; });
    var drawNodeOk = dm.nodes.length === expected.nodes.length &&
        dm.nodes.every(function (n) {
            var exp = expectedNode[n.id];
            return !!exp && exp.text === n.text && clsAreEqual(n.cls, exp.cls);
        });
    var dmSigns = {};
    dm.edges.forEach(function (e) { dmSigns[edgeSig(e)] = 1; });
    var drawEdgeOk = dm.edges.length === expected.edges.length &&
        expEdges.every(function (s) { return !!dmSigns[s]; }) &&
        dm.edges.every(function (e) { return !!expSigns[edgeSig(e)]; });
    var metaOk = true;
    r.nodes.forEach(function (n) {
        var back = dmNode[n.id];
        if (!back)
            return;
        if (n.provenance)
            metaOk = metaOk && back.meta.indexOf('provenance=' + n.provenance) >= 0;
        if (n.source)
            metaOk = metaOk && back.meta.indexOf('span=' + n.source.start + '-' + n.source.end) >= 0;
        if (n.objectId)
            metaOk = metaOk && back.meta.indexOf('object=' + n.objectId) >= 0;
        if (n.reason)
            metaOk = metaOk && back.meta.indexOf('reason=' + n.reason) >= 0;
    });
    var dataEdges = r.edges.filter(function (e) { return e.kind === 'data' && e.style !== 'dotted'; });
    var routedOk = dataEdges.every(function (e) {
        return dm.edges.some(function (de) {
            return de.from === e.from && de.to === e.to && de.waypoints.length >= 2;
        });
    });
    return {
        ok: nodeOk && edgeOk && drawNodeOk && drawEdgeOk && metaOk && routedOk && !dm.parsererror,
        detail: { nodeOk: nodeOk, edgeOk: edgeOk, drawNodeOk: drawNodeOk, drawEdgeOk: drawEdgeOk,
            metaOk: metaOk, routedOk: routedOk, parsererror: dm.parsererror,
            nodeCount: r.nodes.length, edgeCount: r.edges.length,
            mmNodes: mm.nodes.length, mmEdges: mm.edges.length,
            dmNodes: dm.nodes.length, dmEdges: dm.edges.length }
    };
}
/* ---------- layout runner (named classes + honest degradation) ---------- */
function layoutFor(fixture) {
    var graph = parityGraphFor(fixture);
    var A = layoutAnalysis(graph, 'TD');
    var B = layoutAnalysis(graph, 'TD');
    var deterministic = JSON.stringify(A.positions) === JSON.stringify(B.positions);
    var finite = Object.keys(A.positions).every(function (id) {
        var p = A.positions[id];
        return isFinite(p.x) && isFinite(p.y) && p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0;
    });
    return { graph: graph, A: A, deterministic: deterministic, finite: finite,
        noOverlap: A.overlaps === 0,
        /* The control spine is monotonic when every backbone edge is either
           strictly forward in rank or a recognised loop back edge. */
        monotonic: A.monotonicEdges + A.backEdges.length === A.backboneEdges };
}
/* ---------- run both suites ---------- */
(function () {
    var parityPassed = 0, parityTotal = 0, layoutPassed = 0, layoutTotal = 0;
    var traceOk = 0, traceTotal = 0;
    var failures = [];
    PROCFLOW_PARITY_FIXTURES.forEach(function (fixture) {
        parityTotal += 2;
        ['TD', 'LR'].forEach(function (dir) {
            var p = parityFor(fixture, dir);
            if (p.ok)
                parityPassed++;
            else
                failures.push('parity ' + fixture.name + ' [' + dir + ']: ' + JSON.stringify(p.detail));
        });
        var graph = parityGraphFor(fixture);
        graph.nodes.forEach(function (n) {
            traceTotal++;
            var compliant = n.provenance === 'synthetic'
                ? !!n.reason
                : (!!n.source || !!n.objectId || (n.sources && n.sources.length > 0));
            if (compliant)
                traceOk++;
        });
        var l = layoutFor(fixture);
        layoutTotal++;
        var clsBudget = PROCFLOW_LAYOUT_CLASSES.filter(function (c) {
            return c.cls === fixture.cls;
        })[0];
        var withinLimit = clsBudget && l.graph.nodes.length <= clsBudget.nodeLimit;
        var withinBudget = clsBudget && l.A.crossings <= clsBudget.crossingBudget;
        if (l.deterministic && l.noOverlap && l.monotonic && l.finite &&
            withinLimit && withinBudget) {
            layoutPassed++;
        }
        else {
            failures.push('layout ' + fixture.name + ': ' + JSON.stringify({
                deterministic: l.deterministic, noOverlap: l.noOverlap, monotonic: l.monotonic,
                finite: l.finite, withinLimit: withinLimit, withinBudget: withinBudget,
                crossings: l.A.crossings, overlaps: l.A.overlaps,
                nodes: l.graph.nodes.length, budget: clsBudget
            }));
        }
    });
    /* Large / non-planar graph: honest degradation. Overlaps must stay zero and
       output deterministic, but no zero-crossing claim is made: a crossing count
       above the documented budget is allowed only with an explicit warning. */
    var bigStatement = [];
    for (var k = 1; k <= 40; k++) {
        bigStatement.push('  SELECT ' + k + ' AS c' + (k + 1) + ' INTO #t' + (k % 5) + ' FROM dbo.src' + k + ';');
    }
    var bigSrc = 'CREATE PROCEDURE dbo.big AS BEGIN\n' + bigStatement.join('\n') + '\nEND';
    try {
        var bigBig = analyse(bigSrc, { dialect: 'tsql', mode: 'flow', group: false, sources: true });
        var bigCls = PROCFLOW_LAYOUT_CLASSES.filter(function (c) { return c.cls === 'nonplanar'; })[0];
        var bigA = layoutAnalysis(bigBig.graph, 'TD');
        var bigB = layoutAnalysis(bigBig.graph, 'TD');
        var bigOk = bigBig.graph.nodes.length <= bigCls.nodeLimit &&
            bigA.overlaps === 0 &&
            JSON.stringify(bigA.positions) === JSON.stringify(bigB.positions) &&
            (bigA.crossings > bigCls.crossingBudget
                ? bigA.warnings.length > 0
                : bigA.warnings.length === 0);
        if (bigOk)
            layoutPassed++;
        else
            failures.push('layout nonplanar: ' + JSON.stringify({
                nodes: bigBig.graph.nodes.length, crossings: bigA.crossings, overlaps: bigA.overlaps,
                warnings: bigA.warnings
            }));
        layoutTotal++;
    }
    catch (err) {
        failures.push('layout nonplanar threw: ' + String(err && err.stack || err));
        layoutTotal++;
    }
    var parityPass = parityPassed === parityTotal && failures.length === 0;
    window.PROCFLOW_PARITY_PASS = parityPass;
    window.PROCFLOW_PARITY_RESULT = { passed: parityPassed, total: parityTotal,
        traceabilityPassed: traceOk, traceabilityTotal: traceTotal };
    window.PROCFLOW_LAYOUT_PASS = layoutPassed === layoutTotal && failures.length === 0;
    window.PROCFLOW_LAYOUT_RESULT = { passed: layoutPassed, total: layoutTotal };
    window.PROCFLOW_PARITY_FAILURES = failures;
    var out = document.getElementById('parity-results');
    if (out)
        out.textContent = JSON.stringify({
            parity: parityPassed + '/' + parityTotal,
            layout: layoutPassed + '/' + layoutTotal,
            traceability: traceOk + '/' + traceTotal,
            failures: failures
        }, null, 2);
    var sum = document.getElementById('parity-summary');
    if (sum)
        sum.textContent = 'v1.7.0 exports · parity ' + (parityPassed + '/' + parityTotal) + ' · layout ' + (layoutPassed + '/' + layoutTotal);
})();
//# sourceMappingURL=parity.js.map