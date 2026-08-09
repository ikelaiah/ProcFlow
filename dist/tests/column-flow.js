"use strict";
/* proc>flow v1.11.0 — column lineage pipelines.
   Fixtures assert, end to end, that `SELECT col INTO #t` flows through
   transformations (UPDATE / INSERT … SELECT / CREATE TABLE) to later outputs
   with the column origin traced to its source object; that ambiguous reaching
   definitions (conditional writes and branch merges) stay opaque with a
   region-scoped `column_flow_opaque` diagnostic and never invent a binding;
   that view/CTE boundaries resolve within one script and catalogue-proven
   object boundaries resolve by catalogue evidence; and that the exported
   column-flow graph round-trips through Mermaid and draw.io with provenance
   intact and meets its bounded column layout budgets.

   After this suite runs, PROCFLOW_COLUMNFLOW_PASS and
   PROCFLOW_COLUMNFLOW_RESULT gate the golden suite (tests/tests.ts) and feed
   the fixture-corpus metrics (tests/metrics.ts). */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    function hasDiag(list, code) {
        return (list || []).some(function (d) { return d.code === code; });
    }
    var PROCFLOW_COLUMNFLOW_FIXTURES = [
        /* ---- end-to-end through a temporary-table pipeline ---- */
        {
            name: 'end-to-end: SELECT col INTO #t through UPDATE to outputs',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.stage AS BEGIN\n' +
                '  SELECT id, name INTO #stage FROM dbo.student;\n' +
                '  UPDATE #stage SET id = id + 1;\n' +
                '  SELECT id + 1 AS y FROM #stage;\n' +
                'END',
            expect: {
                objectColumns: [
                    { object: '#stage', columns: [
                            { name: 'id', resolution: 'exact', source: 'dbo.student', sourceColumn: 'id' },
                            { name: 'name', resolution: 'exact', source: 'dbo.student', sourceColumn: 'name' }
                        ] }
                ],
                edges: [
                    { from: 's1', to: 's2', object: '#stage', resolution: 'exact', columns: ['id'] },
                    { from: 's2', to: 's3', object: '#stage', resolution: 'exact', columns: ['id'] }
                ],
                noDiags: true,
                layout: { nodeLimit: 8, crossingBudget: 0 }
            }
        },
        {
            name: 'end-to-end: two-hop temp chain flattens to the source',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.chain AS BEGIN\n' +
                '  SELECT a, b INTO #t1 FROM dbo.src1;\n' +
                '  SELECT a AS x INTO #t2 FROM #t1;\n' +
                '  SELECT x FROM #t2;\n' +
                'END',
            expect: {
                objectColumns: [
                    { object: '#t2', columns: [
                            { name: 'x', resolution: 'exact', source: 'dbo.src1', sourceColumn: 'a' }
                        ] }
                ],
                edges: [
                    { from: 's1', to: 's2', object: '#t1', resolution: 'exact', columns: ['a'] },
                    { from: 's2', to: 's3', object: '#t2', resolution: 'exact', columns: ['x'] }
                ],
                noDiags: true
            }
        },
        {
            name: 'end-to-end: CREATE TABLE schema then INSERT … SELECT defines columns',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.schemad AS BEGIN\n' +
                '  CREATE TABLE #t (a int, b varchar(20));\n' +
                '  INSERT INTO #t SELECT x, y FROM dbo.src2;\n' +
                '  SELECT a FROM #t;\n' +
                'END',
            expect: {
                objectColumns: [
                    { object: '#t', columns: [
                            { name: 'a', resolution: 'exact', source: 'dbo.src2', sourceColumn: 'x' },
                            { name: 'b', resolution: 'exact', source: 'dbo.src2', sourceColumn: 'y' }
                        ] }
                ],
                edges: [
                    { from: 's2', to: 's3', object: '#t', resolution: 'exact', columns: ['a'] }
                ],
                noDiags: true
            }
        },
        {
            name: 'end-to-end: INSERT … SELECT into a temp with an explicit column list',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.explicit AS BEGIN\n' +
                '  SELECT v INTO #tmp FROM dbo.src3;\n' +
                '  INSERT INTO #tmp (k) SELECT wide FROM dbo.src4;\n' +
                '  SELECT k FROM #tmp;\n' +
                'END',
            expect: {
                objectColumns: [
                    { object: '#tmp', columns: [
                            { name: 'k', resolution: 'exact', source: 'dbo.src4', sourceColumn: 'wide' }
                        ] }
                ],
                noDiags: true
            }
        },
        {
            name: 'end-to-end: WITH CTE feeds a temp (CTE boundary origin)',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.cteflow AS BEGIN\n' +
                '  WITH c AS (SELECT id, name FROM dbo.student)\n' +
                '    SELECT id INTO #t FROM c;\n' +
                '  SELECT id FROM #t;\n' +
                'END',
            expect: {
                objectColumns: [
                    { object: '#t', columns: [
                            { name: 'id', resolution: 'exact', source: 'c', sourceColumn: 'id' }
                        ] }
                ],
                edges: [
                    { from: 's1', to: 's2', object: '#t', resolution: 'exact', columns: ['id'] }
                ],
                noDiags: true
            }
        },
        /* ---- ambiguous reaching definitions stay opaque ---- */
        {
            name: 'ambiguous: IF/ELSE both produce #t → consumer stays opaque',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.branch AS BEGIN\n' +
                '  IF @x = 1 SELECT id INTO #t FROM dbo.a;\n' +
                '  ELSE SELECT id, name INTO #t FROM dbo.b;\n' +
                '  SELECT id FROM #t;\n' +
                'END',
            expect: {
                objectCount: 1,
                edges: [{ from: 's2', to: 's3', object: '#t', resolution: 'opaque', columns: ['id'] }],
                diags: ['column_flow_opaque'],
                layout: { nodeLimit: 8, crossingBudget: 0 }
            }
        },
        {
            name: 'ambiguous: temp written only inside a conditional reads opaque',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.onebranch AS BEGIN\n' +
                '  IF @x = 1 SELECT id INTO #t FROM dbo.a;\n' +
                '  SELECT id FROM #t;\n' +
                'END',
            expect: {
                diags: ['column_flow_opaque'],
                noEdgesExact: true
            }
        },
        {
            name: 'ambiguous: temp written inside a loop reads opaque',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.loopwrite AS BEGIN\n' +
                '  WHILE @i < 10\n' +
                '    SELECT id INTO #t FROM dbo.a;\n' +
                '  SELECT id FROM #t;\n' +
                'END',
            expect: {
                diags: ['column_flow_opaque'],
                noEdgesExact: true
            }
        },
        {
            name: 'reaching definition: a later sequential producer is not multi',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.sequential AS BEGIN\n' +
                '  IF @x = 1 SELECT id INTO #t FROM dbo.a;\n' +
                '  SELECT id, name INTO #t FROM dbo.b;\n' +
                '  SELECT id FROM #t;\n' +
                'END',
            expect: {
                objectColumns: [
                    { object: '#t', columns: [
                            { name: 'id', resolution: 'exact', source: 'dbo.b', sourceColumn: 'id' }
                        ] }
                ],
                noDiags: true
            }
        },
        /* ---- object boundaries ---- */
        {
            name: 'view boundary: same-script view columns resolve by definition',
            dialect: 'tsql',
            estate: true,
            files: [{ name: 'x.sql', text: 'CREATE VIEW dbo.v_students AS SELECT id, name FROM dbo.student;\n' +
                        'GO\n' +
                        'CREATE PROC dbo.use_v AS BEGIN\n  SELECT id FROM dbo.v_students;\nEND' }],
            expect: {
                objectColumns: [
                    { object: 'dbo.v_students', columns: [
                            { name: 'id', resolution: 'exact', source: 'dbo.student', sourceColumn: 'id' },
                            { name: 'name', resolution: 'exact', source: 'dbo.student', sourceColumn: 'name' }
                        ] }
                ],
                noDiags: true
            }
        },
        {
            name: 'catalogue boundary: catalogue-proven external columns resolve exactly',
            dialect: 'tsql',
            catalogue: 'dbo.student TABLE\nCOL dbo.student.id\nCOL dbo.student.name\nCOL dbo.student.grade',
            sql: 'CREATE PROC dbo.cat AS BEGIN\n  SELECT grade FROM dbo.student;\nEND',
            expect: {
                objectColumns: [
                    { object: 'dbo.student', columns: [
                            { name: 'grade', resolution: 'exact', source: 'dbo.student', sourceColumn: 'grade' }
                        ] }
                ],
                noDiags: true
            }
        },
        /* ---- clean invariants ---- */
        {
            name: 'clean: a plain table read emits no column-flow diagnostics',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.plain AS BEGIN\n  SELECT id FROM dbo.student;\nEND',
            expect: {
                edgeCount: 0,
                noDiags: true,
                graphNodes: 1
            }
        },
        {
            name: 'clean: dynamic SQL stays opaque without inventing an object',
            dialect: 'tsql',
            sql: 'CREATE PROC dbo.dyn AS BEGIN\n  EXEC(\'SELECT 1\');\n  SELECT 1;\nEND',
            expect: {
                stepCount: 2,
                edgeCount: 0,
                noDiags: true
            }
        }
    ];
    function runCF(f) {
        var cat = null;
        if (f.catalogue)
            cat = parseCatalogue(f.catalogue).catalogue;
        if (f.estate && f.files) {
            var est = analyseEstate(f.files, { dialect: f.dialect, mode: 'flow', group: false,
                sources: true, catalogue: cat });
            var proc = est.objects.filter(function (o) { return o.kind === 'PROCEDURE'; })[0]
                || est.objects[est.objects.length - 1];
            return { cf: proc && proc.result && proc.result.columnFlow || null, diags: est.diagnostics || [] };
        }
        var r = analyse(f.sql || '', { dialect: f.dialect, mode: 'flow', group: false,
            sources: true, catalogue: cat });
        return { cf: r.columnFlow || null, diags: r.diagnostics || [] };
    }
    var layoutPassed = 0, layoutTotal = 0;
    PROCFLOW_COLUMNFLOW_FIXTURES.forEach(function (f) {
        try {
            var got = runCF(f);
            var cf = got.cf;
            var ok = !!cf;
            var detail = {};
            if (!cf) {
                record(f.name + ' · column flow', false, 'column flow was not produced');
                return;
            }
            var e = f.expect;
            if (e.stepCount !== undefined) {
                detail.stepCount = cf.steps.length;
                ok = ok && cf.steps.length === e.stepCount;
            }
            if (e.objectCount !== undefined) {
                detail.objectCount = Object.keys(cf.objects).length;
                ok = ok && Object.keys(cf.objects).length === e.objectCount;
            }
            (e.objectColumns || []).forEach(function (exp) {
                var O = cf.objects[String(exp.object).toUpperCase()];
                var missing = !O;
                var colOk = true, colDetail = {};
                exp.columns.forEach(function (c) {
                    var def = null;
                    (O && O.columns || []).forEach(function (x) { if (x.name === c.name)
                        def = x; });
                    var dOk = !!def &&
                        (c.resolution === undefined || def.resolution === c.resolution) &&
                        (c.source === undefined || def.source === c.source) &&
                        (c.sourceColumn === undefined || def.sourceColumn === c.sourceColumn);
                    colOk = colOk && dOk;
                    colDetail[c.name] = def && { res: def.resolution, src: def.source, sc: def.sourceColumn };
                });
                ok = ok && !missing && colOk;
                detail['object:' + exp.object] = { found: !missing, cols: colDetail };
            });
            if (e.edgeCount !== undefined)
                ok = ok && cf.edges.length === e.edgeCount;
            var hasExactEdge = false;
            (e.edges || []).forEach(function (exp) {
                var hit = cf.edges.some(function (ed) {
                    return ed.fromStep === exp.from && ed.toStep === exp.to && ed.object === exp.object &&
                        (exp.resolution === undefined || ed.resolution === exp.resolution) &&
                        (exp.columns === undefined || exp.columns.every(function (cn) {
                            return ed.columns.some(function (c) { return c.name === cn; });
                        }));
                });
                if (exp.resolution === 'exact' && hit)
                    hasExactEdge = true;
                ok = ok && hit;
            });
            if (e.noEdgesExact) {
                var anyExact = cf.edges.some(function (ed) { return ed.resolution === 'exact'; });
                ok = ok && !anyExact;
            }
            if (e.diags) {
                (e.diags || []).forEach(function (code) { ok = ok && hasDiag(got.diags, code); });
            }
            if (e.noDiags) {
                var cfdiags = got.diags.filter(function (d) { return d.code === 'column_flow_opaque'; });
                ok = ok && cfdiags.length === 0;
                detail.cfDiags = cfdiags;
            }
            var spanOk = (got.diags || []).every(function (d) {
                if (d.code !== 'column_flow_opaque')
                    return true;
                return d.scope === 'region' && !!d.span && d.span.start >= 0 && d.span.end > d.span.start &&
                    d.span.end <= (f.sql || f.files && f.files[0].text || '').length;
            });
            ok = ok && spanOk;
            /* ---- exported column graph ---- */
            var graph = buildColumnGraph(cf);
            if (e.graphNodes !== undefined)
                ok = ok && graph.nodes.length === e.graphNodes;
            if (e.graphEdges !== undefined)
                ok = ok && graph.edges.length === e.graphEdges;
            if (e.dataEdges !== undefined) {
                ok = ok && graph.edges.filter(function (x) { return x.kind === 'data'; }).length === e.dataEdges;
            }
            /* column graph exports with provenance metadata and data-edge routing */
            var expected = exportManifest(graph);
            var expectedNode = {};
            expected.nodes.forEach(function (n) { expectedNode[n.id] = n; });
            var mm = mermaidManifest(toMermaid(graph, 'TD'));
            var dm = drawioManifest(toDrawio(graph, { title: f.name, dir: 'TD' }));
            var nodeOk = mm.nodes.length === expected.nodes.length &&
                mm.nodes.every(function (n) {
                    var exp = expectedNode[n.id];
                    return !!exp && exp.text === n.text && exp.cls === n.cls;
                });
            var drawNodeOk = dm.nodes.length === expected.nodes.length &&
                dm.nodes.every(function (n) {
                    var exp = expectedNode[n.id];
                    return !!exp && exp.text === n.text && clsAreEqual(n.cls, exp.cls);
                });
            var edgeSig = function (x) { return x.from + '|' + x.to + '|' + x.label + '|' + x.meaning; };
            var mmSigns = {};
            mm.edges.forEach(function (x) { mmSigns[edgeSig(x)] = 1; });
            var expEdges = expected.edges.map(edgeSig);
            var expSigns = {};
            expEdges.forEach(function (s) { expSigns[s] = 1; });
            var edgeOk = mm.edges.length === expected.edges.length &&
                expEdges.every(function (s) { return !!mmSigns[s]; }) &&
                mm.edges.every(function (x) { return !!expSigns[edgeSig(x)]; });
            var dmSigns = {};
            dm.edges.forEach(function (x) { dmSigns[edgeSig(x)] = 1; });
            var drawEdgeOk = dm.edges.length === expected.edges.length &&
                expEdges.every(function (s) { return !!dmSigns[s]; }) &&
                dm.edges.every(function (x) { return !!expSigns[edgeSig(x)]; });
            var dmNode = {};
            dm.nodes.forEach(function (n) { dmNode[n.id] = n; });
            var metaOk = true;
            graph.nodes.forEach(function (n) {
                var back = dmNode[n.id];
                if (!back)
                    return;
                if (n.provenance)
                    metaOk = metaOk && back.meta.indexOf('provenance=' + n.provenance) >= 0;
                if (n.source)
                    metaOk = metaOk && back.meta.indexOf('span=' + n.source.start + '-' + n.source.end) >= 0;
                if (n.reason)
                    metaOk = metaOk && back.meta.indexOf('reason=' + n.reason) >= 0;
            });
            var dataEdges = graph.edges.filter(function (x) { return x.kind === 'data' && x.style !== 'dotted'; });
            var routedOk = dataEdges.every(function (x) {
                return dm.edges.some(function (de) {
                    return de.from === x.from && de.to === x.to && de.waypoints.length >= 2;
                });
            });
            var exportOk = nodeOk && drawNodeOk && edgeOk && drawEdgeOk && metaOk && routedOk && !dm.parsererror;
            ok = ok && exportOk;
            detail.export = { nodeOk: nodeOk, drawNodeOk: drawNodeOk, edgeOk: edgeOk,
                drawEdgeOk: drawEdgeOk, metaOk: metaOk, routedOk: routedOk, parsererror: dm.parsererror };
            record(f.name + ' · column flow', ok, JSON.stringify(detail));
            /* ---- layout: named column class meets its documented budget ---- */
            if (e.layout) {
                layoutTotal++;
                var L = layoutAnalysis(graph, 'TD');
                var L2 = layoutAnalysis(graph, 'TD');
                var deterministic = JSON.stringify(L.positions) === JSON.stringify(L2.positions);
                var finite = Object.keys(L.positions).every(function (id) {
                    var p = L.positions[id];
                    return isFinite(p.x) && isFinite(p.y) && p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0;
                });
                var monotonic = L.monotonicEdges + L.backEdges.length === L.backboneEdges;
                var layOk = deterministic && finite && L.overlaps === 0 && monotonic &&
                    graph.nodes.length <= e.layout.nodeLimit && L.crossings <= e.layout.crossingBudget;
                if (layOk)
                    layoutPassed++;
                else {
                    results.push({ name: f.name + ' · column layout', pass: false,
                        detail: JSON.stringify({ deterministic: deterministic, finite: finite,
                            overlaps: L.overlaps, monotonic: monotonic, crossings: L.crossings,
                            nodes: graph.nodes.length, budget: e.layout }) });
                }
            }
        }
        catch (err) {
            record(f.name + ' · column flow', false, String(err && err.stack || err));
        }
    });
    /* ---- integration: analyse() attaches the column-flow model and graph ---- */
    try {
        var ir = analyse('CREATE PROC dbo.pipeline AS BEGIN\n' +
            '  SELECT id INTO #t FROM dbo.student;\n' +
            '  SELECT id FROM #t;\nEND', { dialect: 'tsql', mode: 'flow', group: false, sources: true });
        var integrated = !!ir.columnFlow && !!ir.columnFlowGraph &&
            ir.columnFlow.steps.length === 2 && ir.columnFlowGraph.nodes.length >= 3 &&
            ir.constructCoverage.byKind['column_flow'] &&
            ir.constructCoverage.byKind['column_flow'].detected > 0;
        record('v1.11.0 analyse() attaches columnFlow, graph, and coverage', integrated);
    }
    catch (err) {
        record('v1.11.0 analyse() attaches columnFlow, graph, and coverage', false, String(err && err.stack || err));
    }
    /* ---- E: a clean pipeline keeps informational annotation count flat ---- */
    try {
        var clean = analyse('CREATE PROC dbo.clean AS BEGIN\n' +
            '  WITH r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 10)\n' +
            '    SELECT n INTO #n FROM r;\n' +
            '  SELECT n FROM #n;\n' +
            'END', { dialect: 'tsql', mode: 'flow', group: false, sources: true });
        var cleanOk = !clean.diagnostics.some(function (d) {
            return d.code === 'column_flow_opaque';
        }) && (clean.columns || []).length >= 1 && !!clean.columnFlow;
        record('v1.11.0 clean temp pipeline carries no column-flow diagnostics', cleanOk, JSON.stringify({
            diags: clean.diagnostics.map(function (d) { return d.code; }),
            flows: clean.columnFlow && clean.columnFlow.stats
        }));
    }
    catch (err) {
        record('v1.11.0 clean temp pipeline carries no column-flow diagnostics', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (r) { return r.pass; }).length;
    window.PROCFLOW_COLUMNFLOW_RESULT = { passed: passed, total: results.length,
        layoutPassed: layoutPassed, layoutTotal: layoutTotal };
    window.PROCFLOW_COLUMNFLOW_PASS = passed === results.length;
    window.PROCFLOW_COLUMNFLOW_DETAIL = results;
    var out = document.getElementById('columnflow-results');
    if (out)
        out.textContent = JSON.stringify({
            flows: passed + '/' + results.length,
            layout: layoutPassed + '/' + layoutTotal,
            failures: results.filter(function (r) { return !r.pass; }).map(function (r) {
                return { name: r.name, detail: r.detail };
            })
        }, null, 2);
    var sum = document.getElementById('columnflow-summary');
    if (sum)
        sum.textContent = 'v1.11.0 columns · flow ' + (passed + '/' + results.length) +
            ' · layout ' + (layoutPassed + '/' + layoutTotal);
})();
//# sourceMappingURL=column-flow.js.map