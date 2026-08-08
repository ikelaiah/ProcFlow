"use strict";
/* proc>flow v1.8.0 — usable local workspace (README post-v1.0.0 item 7).
   Fixtures for the two v1.8.0 features:
     1. Persistence — opt-in, versioned, exportable. Save → reload reproduces
        an identical analysis; schema-version migration and corrupt-state
        recovery behave; clearing is explicit.
     2. Dependency filtering — presentation-only. A filter derives a filtered
        view at render time and never mutates the underlying analysis graph.
   The pure serialization, migration, and filtering logic is unit-tested here;
   browser-storage round-trips (write/read/clear) are exercised when the test
   page runs in a browser that provides localStorage.

   After this suite runs, PROCFLOW_WORKSPACE_PASS and PROCFLOW_WORKSPACE_RESULT
   gate the golden suite (tests/tests.ts) and feed the fixture-corpus metrics. */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    var src = [
        'CREATE VIEW dbo.export_students AS SELECT id FROM dbo.student;',
        'GO',
        'CREATE PROCEDURE dbo.refresh_students AS',
        'BEGIN',
        '  EXEC dbo.audit_refresh;',
        '  UPDATE dbo.student SET refreshed = 1;',
        '  SELECT id FROM dbo.export_students;',
        'END'
    ].join('\n');
    var files = [{ name: 'report.sql', text: src }];
    var optionsRecord = {
        dialect: 'tsql', scope: 'dependencies', view: 'flow', detail: 'full',
        dir: 'LR', group: true, number: true, fanIn: true, sources: true
    };
    var activeObjectId = 'object-2';
    /* optsFromSnapshot mirrors app.ts's analysisOptions() so a restored snapshot
       can be re-analysed identically. */
    function optsFromSnapshot(snap) {
        var o = snap.options;
        return { dialect: o.dialect, mode: o.view,
            dir: o.dir, detail: o.detail,
            group: o.group, number: o.number, fanIn: o.fanIn, sources: o.sources };
    }
    function graphKey(graph) {
        return JSON.stringify([graph.nodes, graph.edges]);
    }
    try {
        var snap = buildWorkspaceSnapshot({ files: files, options: optionsRecord,
            activeObjectId: activeObjectId });
        var serialized = serializeWorkspace(snap);
        var parsed = parseWorkspace(serialized);
        record('v1.8.0 snapshot round-trip preserves every field', parsed.snapshot !== null && !parsed.error && parsed.migrated === false &&
            parsed.snapshot.version === snap.version &&
            parsed.snapshot.files.length === 1 &&
            parsed.snapshot.files[0].name === 'report.sql' &&
            parsed.snapshot.files[0].text === src &&
            parsed.snapshot.options.dialect === 'tsql' &&
            parsed.snapshot.options.scope === 'dependencies' &&
            parsed.snapshot.options.view === 'flow' &&
            parsed.snapshot.options.detail === 'full' &&
            parsed.snapshot.options.dir === 'LR' &&
            parsed.snapshot.options.group === true &&
            parsed.snapshot.options.number === true &&
            parsed.snapshot.options.fanIn === true &&
            parsed.snapshot.options.sources === true &&
            parsed.snapshot.activeObjectId === 'object-2' &&
            parsed.snapshot.files[0].text === snap.files[0].text, { serialized: serialized });
        record('v1.8.0 save → reload reproduces an identical analysis', (function () {
            var r1 = analyseEstate(files, optsFromSnapshot(snap));
            if (!parsed.error && parsed.snapshot) {
                var r2 = analyseEstate(parsed.snapshot.files, optsFromSnapshot(parsed.snapshot));
                return graphKey(r1.graph) === graphKey(r2.graph) &&
                    JSON.stringify(r1.objects) === JSON.stringify(r2.objects) &&
                    JSON.stringify(r1.diagnostics) === JSON.stringify(r2.diagnostics);
            }
            return false;
        })(), { graph: (parsed.snapshot ? graphKey(analyseEstate(parsed.snapshot.files, optsFromSnapshot(parsed.snapshot)).graph) : ''),
            graph2: (parsed.snapshot ? graphKey(analyseEstate(files, optsFromSnapshot(snap)).graph) : '') });
    }
    catch (err) {
        record('v1.8.0 snapshot round-trip preserves every field', false, String(err && err.stack || err));
        record('v1.8.0 save → reload reproduces an identical analysis', false, String(err && err.stack || err));
    }
    /* Schema-version migration: older/missing versions + missing option fields
       migrate forward to the current schema with safe defaults. */
    try {
        var legacyRaw = JSON.stringify({ savedAt: '2026-01-01T00:00:00.000Z',
            files: [{ name: 'old.sql', text: 'SELECT 1;' }],
            options: { dialect: 'tsql', scope: 'internal' } });
        var legacy = parseWorkspace(legacyRaw);
        record('v1.8.0 older-version snapshots migrate forward with defaults', !!legacy.snapshot && legacy.migrated === true && legacy.snapshot.version === WORKSPACE_SCHEMA_VERSION &&
            legacy.snapshot.options.view === 'auto' &&
            legacy.snapshot.options.group === true &&
            legacy.snapshot.options.sources === true &&
            legacy.snapshot.files[0].name === 'old.sql', legacy);
        record('v1.8.0 current-version snapshots are not migrated', (function () {
            var cur = parseWorkspace(serializeWorkspace(buildWorkspaceSnapshot({ files: files, options: optionsRecord, activeObjectId: null })));
            return cur.snapshot !== null && cur.migrated === false;
        })());
    }
    catch (err) {
        record('v1.8.0 older-version snapshots migrate forward with defaults', false, String(err && err.stack || err));
        record('v1.8.0 current-version snapshots are not migrated', false, String(err && err.stack || err));
    }
    /* Corrupt-state recovery: bad input yields an error and no snapshot. */
    try {
        var corruptJson = parseWorkspace('{not valid json');
        var corruptType = parseWorkspace('[1,2,3]');
        var corruptEmpty = parseWorkspace(JSON.stringify({ version: 1, files: [], activeObjectId: null }));
        record('v1.8.0 corrupt-state recovery returns an error instead of throwing', corruptJson.error === 'corrupt_json' && corruptJson.snapshot === null &&
            corruptType.error === 'not_workspace' && corruptType.snapshot === null &&
            corruptEmpty.error === 'empty_workspace' && corruptEmpty.snapshot === null, { corruptJson: corruptJson, corruptType: corruptType, corruptEmpty: corruptEmpty });
    }
    catch (err) {
        record('v1.8.0 corrupt-state recovery returns an error instead of throwing', false, String(err && err.stack || err));
    }
    /* Browser-storage round-trip (opt-in save/restore), exercised only when the
       page runs somewhere localStorage is available. Clearing is explicit. */
    try {
        var storageAvailable = true;
        try {
            var probe = window.localStorage.getItem('procflow.probe');
        }
        catch (e) {
            storageAvailable = false;
        }
        if (storageAvailable) {
            clearWorkspace();
            var before = hasSavedWorkspace();
            var wrote = writeWorkspace(snap);
            var read = readWorkspace();
            var stored = hasSavedWorkspace();
            clearWorkspace();
            var after = hasSavedWorkspace();
            record('v1.8.0 opt-in storage round-trip and explicit clear', wrote === true && before === false && stored === true &&
                !!read && read.files.length === 1 && read.files[0].name === 'report.sql' &&
                after === false, { wrote: wrote, before: before, stored: stored,
                read: read && read.files && read.files[0] && read.files[0].name, after: after });
        }
        else {
            record('v1.8.0 opt-in storage round-trip and explicit clear', true, 'localStorage unavailable in this environment; skipped');
        }
    }
    catch (err) {
        record('v1.8.0 opt-in storage round-trip and explicit clear', false, String(err && err.stack || err));
    }
    /* Dependency filtering — presentation only. Build a synthetic dependency
       graph spanning object (source), external, and temp (synthetic) nodes with
       data/dependency/call edges, then assert each toggle and that the input
       graph is never mutated. */
    try {
        var da = 'da', db = 'db', de = 'de', dt = 'dt';
        var depGraph = {
            nodes: [
                { id: da, shape: 'rect', text: 'alpha', cls: 'call', source: null, objectId: 'object-1', provenance: 'source' },
                { id: db, shape: 'rect', text: 'beta', cls: 'call', source: null, objectId: 'object-2', provenance: 'source' },
                { id: de, shape: 'io', text: 'external: server.dbo.t', cls: 'src', source: null, objectId: 'server.dbo.t', provenance: 'external' },
                { id: dt, shape: 'io', text: '#tmp', cls: 'src', source: null, objectId: null, provenance: 'synthetic', reason: 'temporary table placeholder' }
            ],
            edges: [
                { from: da, to: dt, label: 'writes', style: 'dotted', kind: 'data' },
                { from: dt, to: db, label: 'reads', style: 'solid', kind: 'dependency' },
                { from: da, to: de, label: 'reads', style: 'solid', kind: 'dependency' },
                { from: db, to: de, label: 'calls', style: 'solid', kind: 'call' }
            ],
            stats: { objects: 2, external: 1, reads: 2, writes: 1, calls: 1 }
        };
        var baseline = clone(depGraph);
        var allOn = filterDependencyGraph(depGraph, null);
        var noWrites = filterDependencyGraph(depGraph, { writes: false });
        var noExternal = filterDependencyGraph(depGraph, { external: false });
        var noTemp = filterDependencyGraph(depGraph, { temp: false });
        var focusAlpha = filterDependencyGraph(depGraph, { focus: 'alpha' });
        var noneMatch = filterDependencyGraph(depGraph, { focus: 'zzz' });
        record('v1.8.0 dependency filter default shows the whole graph', allOn.nodes.length === 4 && allOn.edges.length === 4, { nodes: allOn.nodes.length, edges: allOn.edges.length });
        record('v1.8.0 dependency filter hides write edges without dropping nodes', noWrites.edges.length === 3 &&
            !noWrites.edges.some(function (e) { return e.kind === 'data'; }) &&
            noWrites.nodes.length === 4, { nodes: noWrites.nodes.length, edges: noWrites.edges.length,
            kinds: noWrites.edges.map(function (e) { return e.kind; }) });
        record('v1.8.0 dependency filter drops external nodes and their incident edges', noExternal.nodes.length === 3 && noExternal.edges.length === 2 &&
            !noExternal.nodes.some(function (n) { return n.provenance === 'external'; }), { nodes: noExternal.nodes.length,
            edges: noExternal.edges.map(function (e) { return e.kind; }) });
        record('v1.8.0 dependency filter drops temp-table nodes and their incident edges', noTemp.nodes.length === 3 && noTemp.edges.length === 2 &&
            !noTemp.nodes.some(function (n) { return n.provenance === 'synthetic'; }), { nodes: noTemp.nodes.length,
            edges: noTemp.edges.map(function (e) { return e.kind; }) });
        record('v1.8.0 dependency filter focus keeps the matching neighbourhood', (function () {
            var ids = focusAlpha.nodes.map(function (n) { return n.id; }).sort();
            return focusAlpha.nodes.length === 3 &&
                ids.indexOf(da) >= 0 && ids.indexOf(de) >= 0 && ids.indexOf(dt) >= 0 &&
                ids.indexOf(db) < 0 &&
                focusAlpha.edges.length === 2;
        })(), { nodes: focusAlpha.nodes.map(function (n) { return n.id; }).sort(),
            edges: focusAlpha.edges });
        record('v1.8.0 a focus matching nothing shows an empty view', noneMatch.nodes.length === 0 && noneMatch.edges.length === 0, { nodes: noneMatch.nodes.length, edges: noneMatch.edges.length });
        record('v1.8.0 dependency filtering never mutates the analysis graph', JSON.stringify(baseline) === JSON.stringify(depGraph) &&
            allOn.nodes !== depGraph.nodes && allOn.edges !== depGraph.edges, { unchanged: JSON.stringify(baseline) === JSON.stringify(depGraph),
            sameNodeRef: allOn.nodes === depGraph.nodes,
            sameEdgeRef: allOn.edges === depGraph.edges });
    }
    catch (err) {
        record('v1.8.0 dependency filter default shows the whole graph', false, String(err && err.stack || err));
        record('v1.8.0 dependency filter hides write edges without dropping nodes', false, String(err && err.stack || err));
        record('v1.8.0 dependency filter drops external nodes and their incident edges', false, String(err && err.stack || err));
        record('v1.8.0 dependency filter drops temp-table nodes and their incident edges', false, String(err && err.stack || err));
        record('v1.8.0 dependency filter focus keeps the matching neighbourhood', false, String(err && err.stack || err));
        record('v1.8.0 a focus matching nothing shows an empty view', false, String(err && err.stack || err));
        record('v1.8.0 dependency filtering never mutates the analysis graph', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (r) { return r.pass; }).length;
    window.PROCFLOW_WORKSPACE_RESULT = { passed: passed, total: results.length };
    window.PROCFLOW_WORKSPACE_PASS = passed === results.length;
})();
//# sourceMappingURL=workspace.js.map