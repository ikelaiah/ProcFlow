"use strict";
/* proc>flow v1.13.0 — report intelligence (report → dataset → object → column
   dependency views, built on the v1.9.0 catalogue and the v1.11.0 column
   contract, with F export fidelity for report graphs).

   Fixtures assert the complete dependency chain: each report links to its
   datasets, each embedded dataset's SQL analysis links to the objects it
   reads/writes/calls (catalogue-verified where possible), and each object
   links to the columns its query actually references (from the column
   contract, never invented). Shared datasets keep their external shared
   identity and unresolved datasets stay explicit. Report graphs export to
   Mermaid and draw.io with provenance intact, `.drawio` round-trips preserve
   report/dataset source identity, and filtering is presentation-only — it
   derives a filtered view at render time and never mutates the underlying
   graph. A named `report` layout class meets its documented budget.

   After this suite runs, PROCFLOW_REPORTGRAPH_PASS and
   PROCFLOW_REPORTGRAPH_RESULT gate the golden suite (tests/tests.ts) and feed
   the fixture-corpus metrics (tests/metrics.ts). */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    var RDL_NS = 'http' + '://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition';
    function rdl(head, body) {
        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            '<Report xmlns="' + RDL_NS + '" xmlns:rd="http' + '://schemas.microsoft.com/SQLServer/reporting/reportdesigner">\n' +
            head + '\n' + body + '\n</Report>\n';
    }
    var DS_SCHOOL = '<DataSources>\n' +
        '  <DataSource Name="SchoolDB">\n' +
        '    <ConnectionProperties>\n' +
        '      <DataProvider>SQL</DataProvider>\n' +
        '      <ConnectString>Data Source=.;Initial Catalog=School</ConnectString>\n' +
        '    </ConnectionProperties>\n' +
        '  </DataSource>\n' +
        '</DataSources>';
    function nodeByText(graph, text) {
        var t = text.toLowerCase();
        var matches = (graph.nodes || []).filter(function (n) { return n.text.toLowerCase().indexOf(t) >= 0; });
        return matches.length ? matches[0] : null;
    }
    function hasEdge(graph, from, to, kind, label) {
        var fn = nodeByText(graph, from), tn = nodeByText(graph, to);
        if (!fn || !tn)
            return false;
        return (graph.edges || []).some(function (e) {
            return e.from === fn.id && e.to === tn.id &&
                (kind === undefined || e.kind === kind) &&
                (label === undefined || e.label === label);
        });
    }
    var PROCFLOW_REPORTGRAPH_FIXTURES = [
        {
            name: 'report → dataset → object → column complete chain',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Students">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT StudentId, StudentName FROM dbo.Student WHERE SchoolYear = @Year</CommandText>\n' +
                '    </Query>\n' +
                '    <Fields>\n' +
                '      <Field Name="StudentId"><DataField>StudentId</DataField></Field>\n' +
                '      <Field Name="StudentName"><DataField>StudentName</DataField></Field>\n' +
                '    </Fields>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 1, columnNodes: 2,
                required: [
                    { from: 'Report', to: 'Students', kind: 'dependency' },
                    { from: 'Students', to: 'dbo.student', kind: 'dependency', label: 'read' },
                    { from: 'dbo.student', to: 'StudentId', kind: 'data' },
                    { from: 'dbo.student', to: 'StudentName', kind: 'data' }
                ],
                identityOk: true
            }
        },
        {
            name: 'dataset write edges are data kind and dotted',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Loader">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT id INTO dbo.stage FROM dbo.src</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 2,
                required: [
                    { from: 'Loader', to: 'dbo.stage', kind: 'data', label: 'write' },
                    { from: 'Loader', to: 'dbo.src', kind: 'dependency', label: 'read' }
                ],
                identityOk: true
            }
        },
        {
            name: 'call edge from dataset SQL analysis',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Daily">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>EXEC dbo.refresh_summary</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 1,
                required: [
                    { from: 'Daily', to: 'dbo.refresh_summary', kind: 'call', label: 'call' }
                ],
                identityOk: true
            }
        },
        {
            name: 'shared dataset keeps external identity and no object edges',
            rdl: rdl('<DataSources></DataSources>', '<DataSets>\n' +
                '  <DataSet Name="Rollup">\n' +
                '    <SharedDataSet>\n' +
                '      <SharedDataSetReference>Shared/Rollup</SharedDataSetReference>\n' +
                '    </SharedDataSet>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 0, columnNodes: 0,
                required: [{ from: 'Report', to: 'Rollup', kind: 'dependency' }],
                forbidden: [{ from: 'Rollup', to: 'Shared' }],
                identityOk: true
            }
        },
        {
            name: 'unresolved dataset stays explicit without invented objects',
            rdl: rdl('<DataSources></DataSources>', '<DataSets>\n' +
                '  <DataSet Name="Orphan">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 0, columnNodes: 0,
                required: [{ from: 'Report', to: 'Orphan', kind: 'dependency' }],
                identityOk: true
            }
        },
        {
            name: 'catalogue-verified object resolves to canonical identity',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Students">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT StudentId FROM dbo.Student</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            catalogue: 'dbo.Student TABLE student\nCOL dbo.Student.StudentId',
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 1, columnNodes: 1,
                required: [{ from: 'Students', to: 'dbo.student', kind: 'dependency', label: 'read' }],
                identityOk: true,
                layout: { nodeLimit: 30, crossingBudget: 0 }
            }
        },
        {
            name: 'multi-dataset report chains each dataset to its own objects',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Students">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT StudentId FROM dbo.Student</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '  <DataSet Name="Courses">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT CourseId FROM dbo.Course</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '  <DataSet Name="Rollup">\n' +
                '    <SharedDataSet>\n' +
                '      <SharedDataSetReference>Shared/Rollup</SharedDataSetReference>\n' +
                '    </SharedDataSet>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 3, objectNodes: 2, columnNodes: 2,
                required: [
                    { from: 'Report', to: 'Students', kind: 'dependency' },
                    { from: 'Report', to: 'Courses', kind: 'dependency' },
                    { from: 'Report', to: 'Rollup', kind: 'dependency' },
                    { from: 'Students', to: 'dbo.student', kind: 'dependency' },
                    { from: 'Courses', to: 'dbo.course', kind: 'dependency' }
                ],
                identityOk: true,
                layout: { nodeLimit: 30, crossingBudget: 0 }
            }
        },
        /* ---- presentation-only filtering ---- */
        {
            name: 'report filter hides the column layer without mutating the graph',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Students">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT StudentId, StudentName FROM dbo.Student</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportNodes: 1, datasetNodes: 1, objectNodes: 1, columnNodes: 2,
                identityOk: true
            }
        }
    ];
    function runGraph(f) {
        var cat = null;
        if (f.catalogue)
            cat = parseCatalogue(f.catalogue).catalogue;
        var report = parseReport(f.rdl);
        return { graph: buildReportGraph(report, { catalogue: cat }), report: report, catalogue: cat };
    }
    var layoutPassed = 0, layoutTotal = 0;
    PROCFLOW_REPORTGRAPH_FIXTURES.forEach(function (f) {
        try {
            var got = runGraph(f);
            var graph = got.graph;
            var e = f.expect;
            var ok = true;
            var detail = { stats: graph.stats,
                nodes: graph.nodes.map(function (n) { return n.cls + ':' + n.text; }),
                edges: graph.edges.map(function (x) { return x.from + '->' + x.to + '[' + (x.kind || '') + '|' + (x.label || '') + ']'; }) };
            if (e.reportNodes !== undefined)
                ok = ok && graph.stats.reports === e.reportNodes;
            if (e.datasetNodes !== undefined)
                ok = ok && graph.stats.datasets === e.datasetNodes;
            if (e.objectNodes !== undefined)
                ok = ok && graph.stats.objects === e.objectNodes;
            if (e.columnNodes !== undefined)
                ok = ok && graph.stats.columns === e.columnNodes;
            (e.required || []).forEach(function (exp) {
                var hit = hasEdge(graph, exp.from, exp.to, exp.kind, exp.label);
                ok = ok && hit;
                detail['edge:' + exp.from + '->' + exp.to] = { found: hit };
            });
            (e.forbidden || []).forEach(function (exp) {
                var hit = hasEdge(graph, exp.from, exp.to);
                ok = ok && !hit;
            });
            /* Source identity: report/dataset nodes carry XML spans; object nodes
               carry objectId or a span; column nodes carry a span when known. */
            if (e.identityOk) {
                var identityOk = true;
                (got.report.reports || []).forEach(function (r) {
                    identityOk = identityOk && !!r.xmlSpan;
                });
                graph.nodes.forEach(function (n) {
                    if (n.cls === 'report' || n.cls === 'dsembedded' || n.cls === 'dsshared' ||
                        n.cls === 'dsunresolved') {
                        identityOk = identityOk && !!n.source && !!n.provenance;
                    }
                    else if (n.cls === 'repobj') {
                        identityOk = identityOk && (!!n.objectId || !!n.source) && !!n.provenance;
                    }
                });
                ok = ok && identityOk;
                detail.identityOk = identityOk;
            }
            /* ---- export parity: Mermaid and draw.io round-trip the report graph
                   with provenance and report/dataset source identity ---- */
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
                if (n.objectId)
                    metaOk = metaOk && back.meta.indexOf('object=' + n.objectId) >= 0;
                if (n.reason)
                    metaOk = metaOk && back.meta.indexOf('reason=' + n.reason) >= 0;
            });
            var exportOk = nodeOk && drawNodeOk && edgeOk && drawEdgeOk && metaOk && !dm.parsererror;
            ok = ok && exportOk;
            detail.export = { nodeOk: nodeOk, drawNodeOk: drawNodeOk, edgeOk: edgeOk,
                drawEdgeOk: drawEdgeOk, metaOk: metaOk, parsererror: dm.parsererror };
            record(f.name, ok, JSON.stringify(detail));
            /* ---- layout: named report class meets its documented budget ---- */
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
                    results.push({ name: f.name + ' · report layout', pass: false,
                        detail: JSON.stringify({ deterministic: deterministic, finite: finite,
                            overlaps: L.overlaps, monotonic: monotonic, crossings: L.crossings,
                            nodes: graph.nodes.length, budget: e.layout }) });
                }
            }
        }
        catch (err) {
            record(f.name, false, String(err && err.stack || err));
        }
    });
    /* ---- filtering is presentation-only ---- */
    try {
        var f8 = PROCFLOW_REPORTGRAPH_FIXTURES[7];
        var got8 = runGraph(f8);
        var full8 = got8.graph;
        var baseline8 = JSON.stringify({ nodes: full8.nodes, edges: full8.edges });
        var hiddenCols = filterReportGraph(full8, { columns: false });
        var hiddenExternal = filterReportGraph(full8, { external: false });
        var focused = filterReportGraph(full8, { focus: 'Students' });
        var untouched = JSON.stringify({ nodes: full8.nodes, edges: full8.edges }) === baseline8;
        var presOk = untouched &&
            hiddenCols.nodes.filter(function (n) { return n.cls === 'repcol'; }).length === 0 &&
            hiddenCols.nodes.length < full8.nodes.length &&
            hiddenExternal.nodes.filter(function (n) { return n.cls === 'repobj'; }).length === 0 &&
            focused.nodes.length >= 1 && focused.nodes.length <= full8.nodes.length &&
            !!hiddenCols.stats && hiddenCols.stats.columns === 2;
        record('v1.13.0 report filtering is presentation-only (never mutates the graph)', presOk, JSON.stringify({ full: full8.nodes.length, hiddenCols: hiddenCols.nodes.length,
            hiddenExternal: hiddenExternal.nodes.length, focused: focused.nodes.length,
            stats: hiddenCols.stats }));
    }
    catch (err) {
        record('v1.13.0 report filtering is presentation-only (never mutates the graph)', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (r) { return r.pass; }).length;
    window.PROCFLOW_REPORTGRAPH_RESULT = { passed: passed, total: results.length,
        layoutPassed: layoutPassed, layoutTotal: layoutTotal };
    window.PROCFLOW_REPORTGRAPH_PASS = passed === results.length;
    window.PROCFLOW_REPORTGRAPH_DETAIL = results;
    var out = document.getElementById('reportgraph-results');
    if (out)
        out.textContent = JSON.stringify({
            graphs: passed + '/' + results.length,
            layout: layoutPassed + '/' + layoutTotal,
            failures: results.filter(function (r) { return !r.pass; }).map(function (r) {
                return { name: r.name, detail: r.detail };
            })
        }, null, 2);
    var sum = document.getElementById('reportgraph-summary');
    if (sum)
        sum.textContent = 'v1.13.0 reports · graph ' + (passed + '/' + results.length) +
            ' · layout ' + (layoutPassed + '/' + layoutTotal);
})();
//# sourceMappingURL=report-graph.js.map