"use strict";
/* proc>flow v1.9.0 — resolve by catalogue (README post-v1.0.0 item 5).
   Fixtures for catalogue metadata import (JSON + simple line format), exact
   synonym / linked-server / cross-database resolution replacing the v1.5.0
   external label where the catalogue proves the match, and E diagnostics for
   partial or conflicting catalogue data.

   Passing a catalogue never changes an analysis that did not pass one: every
   fixture here asserts the catalogue-verified behaviour with a catalogue
   present, plus one regression guard that the absent-catalogue output is the
   unchanged conservative path.

   After this suite runs, PROCFLOW_CATALOGUE_PASS and PROCFLOW_CATALOGUE_RESULT
   gate the golden suite (tests/tests.ts) and feed the fixture-corpus metrics. */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    function has(list, value) {
        return (list || []).some(function (v) { return v.toUpperCase() === value.toUpperCase(); });
    }
    var CATALOGUE_TXT = [
        '# demo catalogue',
        'salesdb.dbo.orders TABLE',
        'linksrv.warehouse.dbo.orders TABLE',
        'remotesrv.salesdb.dbo.pull_orders PROC',
        'dbo.student TABLE student',
        'COL salesdb.dbo.orders.OrderId'
    ].join('\n');
    /* ---- parsing: JSON and the simple line format ---- */
    try {
        var jp = parseCatalogue(JSON.stringify({ objects: [
                { name: 'dbo.student', kind: 'TABLE', synonyms: ['student'] },
                { name: 'salesdb.dbo.orders', kind: 'TABLE' }
            ], columns: [{ table: 'dbo.student', name: 'StudentId' }] }));
        record('v1.9.0 JSON catalogue parses objects, columns, synonyms, and kind', jp.format === 'json' && !jp.diagnostics.some(function (d) { return d.severity === 'error'; }) &&
            jp.objectCount === 2 && jp.columnCount === 1 &&
            jp.catalogue.byName['DBO.STUDENT'] != null &&
            resolveCatalogue(jp.catalogue, 'student').resolution === 'verified' &&
            resolveCatalogue(jp.catalogue, 'student').resolvedName === 'dbo.student' &&
            resolveCatalogue(jp.catalogue, 'salesdb.dbo.orders').resolution === 'verified' &&
            resolveCatalogue(jp.catalogue, 'dbo.nope').resolution === 'external', { format: jp.format, diagnostics: jp.diagnostics, resolved: resolveCatalogue(jp.catalogue, 'student') });
    }
    catch (err) {
        record('v1.9.0 JSON catalogue parses objects, columns, synonyms, and kind', false, String(err && err.stack || err));
    }
    try {
        var tp = parseCatalogue(CATALOGUE_TXT);
        record('v1.9.0 line catalogue parses objects, kinds, synonyms, and columns', tp.format === 'text' && tp.objectCount === 4 && tp.columnCount === 1 &&
            !tp.diagnostics.some(function (d) { return d.severity === 'error'; }) &&
            tp.catalogue.byName['SALESDB.DBO.ORDERS'] != null &&
            tp.catalogue.byName['REMOTESRV.SALESDB.DBO.PULL_ORDERS'] != null &&
            tp.catalogue.bySynonym['STUDENT'] != null &&
            resolveCatalogue(tp.catalogue, 'STUDENT').resolvedName === 'dbo.student' &&
            resolveCatalogue(tp.catalogue, 'remotesrv.salesdb.dbo.pull_orders')
                .resolution === 'verified', { format: tp.format, objects: tp.objectCount, columns: tp.columnCount,
            diagnostics: tp.diagnostics });
    }
    catch (err) {
        record('v1.9.0 line catalogue parses objects, kinds, synonyms, and columns', false, String(err && err.stack || err));
    }
    try {
        var badJson = parseCatalogue('{oops');
        record('v1.9.0 malformed catalogue JSON reports catalogue_parse_error', badJson.format === 'json' && badJson.objectCount === 0 &&
            badJson.diagnostics.some(function (d) {
                return d.code === 'catalogue_parse_error' && d.scope === 'document' && d.span === null;
            }), badJson.diagnostics);
    }
    catch (err) {
        record('v1.9.0 malformed catalogue JSON reports catalogue_parse_error', false, String(err && err.stack || err));
    }
    try {
        var emptyC = parseCatalogue('   \n\n  ');
        record('v1.9.0 empty catalogue input reports catalogue_empty', emptyC.objectCount === 0 && emptyC.diagnostics.some(function (d) {
            return d.code === 'catalogue_empty';
        }), emptyC.diagnostics);
    }
    catch (err) {
        record('v1.9.0 empty catalogue input reports catalogue_empty', false, String(err && err.stack || err));
    }
    /* ---- conflicting catalogue data is conservative ---- */
    try {
        var dup = parseCatalogue('dbo.orders TABLE\ndbo.orders VIEW');
        var dupResolve = resolveCatalogue(dup.catalogue, 'dbo.orders');
        var dupRegion = false;
        var dupAnalysis = analyse('SELECT id FROM dbo.orders;', { dialect: 'tsql', mode: 'query', sources: true,
            catalogue: dup.catalogue, catalogueDiagnostics: dup.diagnostics });
        dupRegion = dupAnalysis.diagnostics.some(function (d) {
            return d.code === 'catalogue_conflict' && d.scope === 'region' &&
                !!d.span && d.span.end > d.span.start;
        });
        record('v1.9.0 duplicate catalogue entries are conservative with a conflict diagnostic', dup.diagnostics.some(function (d) { return d.code === 'catalogue_conflict'; }) &&
            dupResolve.resolution === 'conflict' && dupRegion &&
            dupAnalysis.graph.nodes.some(function (n) {
                return n.text.indexOf('dbo.orders') >= 0 && n.resolution === 'conflict';
            }), { parse: dup.diagnostics, resolve: dupResolve,
            diags: dupAnalysis.diagnostics.map(function (d) { return d.code; }) });
    }
    catch (err) {
        record('v1.9.0 duplicate catalogue entries are conservative with a conflict diagnostic', false, String(err && err.stack || err));
    }
    try {
        var coll = parseCatalogue('dbo.a TABLE alias\nalias TABLE');
        record('v1.9.0 a synonym colliding with an object name is a conflict', coll.diagnostics.some(function (d) { return d.code === 'catalogue_conflict'; }) &&
            resolveCatalogue(coll.catalogue, 'alias').resolution === 'conflict', { diagnostics: coll.diagnostics });
    }
    catch (err) {
        record('v1.9.0 a synonym colliding with an object name is a conflict', false, String(err && err.stack || err));
    }
    /* ---- estate (object-dependency) resolution ---- */
    try {
        var pc = parseCatalogue(CATALOGUE_TXT);
        var estSql = [
            'CREATE PROC dbo.nightly AS',
            'BEGIN',
            '  EXEC remotesrv.salesdb.dbo.pull_orders;',
            '  SELECT id INTO #t FROM salesdb.dbo.orders;',
            '  SELECT id FROM dbo.student;',
            '  SELECT id FROM readme.dbo.ghost;',
            'END'
        ].join('\n');
        var est = analyseEstate([{ name: 'est.sql', text: estSql }], { dialect: 'tsql', mode: 'auto', group: false, sources: true,
            catalogue: pc.catalogue, catalogueDiagnostics: pc.diagnostics });
        var verified = est.graph.nodes.filter(function (n) { return n.resolution === 'verified'; });
        var verifiedTexts = verified.map(function (n) { return n.text; });
        var unverified = est.graph.nodes.filter(function (n) {
            return n.text.indexOf('external: ') === 0;
        });
        record('v1.9.0 estate external nodes verified by the catalogue', has(verifiedTexts, 'remotesrv.salesdb.dbo.pull_orders') &&
            has(verifiedTexts, 'salesdb.dbo.orders') &&
            has(verifiedTexts, 'dbo.student') &&
            verified.every(function (n) {
                return n.provenance === 'external' &&
                    n.resolvedName === n.text && typeof n.objectId === 'string';
            }) &&
            est.graph.nodes.some(function (n) {
                return n.text.indexOf('readme.dbo.ghost') >= 0 && n.resolution === undefined;
            }), { verified: verified.map(function (n) {
                return { text: n.text, prov: n.provenance, res: n.resolution, obj: n.objectId };
            }),
            external: unverified.map(function (n) { return n.text; }) });
    }
    catch (err) {
        record('v1.9.0 estate external nodes verified by the catalogue', false, String(err && err.stack || err));
    }
    /* ---- query-structure source resolution ---- */
    try {
        var qc = parseCatalogue('linksrv.warehouse.dbo.orders TABLE');
        var qr = analyse('SELECT ord.id FROM linksrv.warehouse.dbo.orders ord WHERE ord.id > 0;', { dialect: 'tsql', mode: 'query', sources: true,
            catalogue: qc.catalogue, catalogueDiagnostics: qc.diagnostics });
        var qNode = qr.graph.nodes.find(function (n) { return n.cls === 'src'; });
        record('v1.9.0 query sources verified by the catalogue', !!qNode && qNode.text === 'linksrv.warehouse.dbo.orders' &&
            qNode.resolution === 'verified' && qNode.provenance === 'external' &&
            qNode.resolvedName === 'linksrv.warehouse.dbo.orders', qNode);
    }
    catch (err) {
        record('v1.9.0 query sources verified by the catalogue', false, String(err && err.stack || err));
    }
    try {
        /* Cross-database: the reference carries a server prefix over a catalogue
           object sharing the trailing identity. That is not proof — the node stays
           external and a region-scoped catalogue_partial diagnostic is attached. */
        var partialC = parseCatalogue('salesdb.dbo.orders TABLE');
        var partialR = analyse('SELECT id FROM remotesrv.salesdb.dbo.orders;', { dialect: 'tsql', mode: 'query', sources: true,
            catalogue: partialC.catalogue, catalogueDiagnostics: partialC.diagnostics });
        var partialNode = partialR.graph.nodes.find(function (n) { return n.cls === 'src'; });
        var partialDiag = partialR.diagnostics.filter(function (d) {
            return d.code === 'catalogue_partial';
        })[0];
        record('v1.9.0 unproven cross-database matches stay external and region-scoped', !!partialNode && partialNode.text === 'remotesrv.salesdb.dbo.orders' &&
            partialNode.resolution === undefined &&
            partialNode.provenance === 'synthetic' &&
            !!partialDiag && partialDiag.scope === 'region' &&
            !!partialDiag.span && partialDiag.span.end > partialDiag.span.start &&
            partialDiag.message.indexOf('salesdb.dbo.orders') >= 0, { node: partialNode, diag: partialDiag });
    }
    catch (err) {
        record('v1.9.0 unproven cross-database matches stay external and region-scoped', false, String(err && err.stack || err));
    }
    try {
        var nonC = analyse('SELECT id FROM linksrv.warehouse.dbo.orders;', { dialect: 'tsql', mode: 'query', sources: true });
        var nonNode = nonC.graph.nodes.find(function (n) { return n.cls === 'src'; });
        record('v1.9.0 absent catalogue leaves the conservative path unchanged', !!nonNode && nonNode.text === 'linksrv.warehouse.dbo.orders' &&
            nonNode.resolution === undefined && nonNode.provenance === 'synthetic' &&
            nonNode.reason === 'external source object' &&
            !nonC.diagnostics.some(function (d) {
                return d.code.indexOf('catalogue_') === 0;
            }), nonNode);
    }
    catch (err) {
        record('v1.9.0 absent catalogue leaves the conservative path unchanged', false, String(err && err.stack || err));
    }
    /* ---- synonym resolution through the estate ---- */
    try {
        var synC = parseCatalogue('dbo.student TABLE student');
        var synSql = 'CREATE PROC dbo.by_syn AS BEGIN SELECT id FROM student; END';
        var synEst = analyseEstate([{ name: 'syn.sql', text: synSql }], { dialect: 'tsql', mode: 'auto', catalogue: synC.catalogue,
            catalogueDiagnostics: synC.diagnostics });
        var synLeaf = synEst.graph.nodes.filter(function (n) {
            return n.objectId === 'student' || n.text.toUpperCase().indexOf('STUDENT') >= 0;
        });
        record('v1.9.0 an unqualified synonym resolves to its canonical object', synEst.graph.nodes.some(function (n) {
            return n.text === 'dbo.student' && n.resolution === 'verified' &&
                n.resolvedName === 'dbo.student' && n.objectId === 'student';
        }) && synLeaf.every(function (n) { return n.resolution === 'verified'; }), synEst.graph.nodes.map(function (n) {
            return { text: n.text, res: n.resolution, obj: n.objectId };
        }));
    }
    catch (err) {
        record('v1.9.0 an unqualified synonym resolves to its canonical object', false, String(err && err.stack || err));
    }
    /* ---- export metadata survives the draw.io round-trip ---- */
    try {
        var ec = parseCatalogue('salesdb.dbo.orders TABLE');
        var eRef = analyse('SELECT id FROM salesdb.dbo.orders;', { dialect: 'tsql', mode: 'query', sources: true,
            catalogue: ec.catalogue, catalogueDiagnostics: ec.diagnostics });
        var eXml = toDrawio(eRef.graph, { title: 'catalogue', dir: 'TD' });
        var eDoc = new DOMParser().parseFromString(eXml, 'application/xml');
        var eVerified = eRef.graph.nodes.filter(function (n) { return n.resolution === 'verified'; });
        record('v1.9.0 catalogue resolution and provenance survive draw.io export', !eDoc.querySelector('parsererror') &&
            eVerified.length > 0 &&
            eXml.indexOf('resolution=verified') >= 0 &&
            eXml.indexOf('provenance=external') >= 0, { parsererror: eDoc.querySelector('parsererror') &&
                eDoc.querySelector('parsererror').textContent,
            verified: eVerified.map(function (n) {
                return { res: n.resolution, text: n.text };
            }) });
    }
    catch (err) {
        record('v1.9.0 catalogue resolution and provenance survive draw.io export', false, String(err && err.stack || err));
    }
    /* ---- workspace persistence carries the catalogue text ---- */
    try {
        var wsSnap = buildWorkspaceSnapshot({
            files: [{ name: 'est.sql', text: 'CREATE PROC dbo.one AS BEGIN SELECT 1; END' }],
            options: { dialect: 'tsql', scope: 'dependencies' }, activeObjectId: null,
            catalogue: CATALOGUE_TXT
        });
        var wsParsed = parseWorkspace(serializeWorkspace(wsSnap));
        var wsCatalogueRoundTrip = !wsParsed.error && wsParsed.snapshot !== null &&
            wsParsed.snapshot.catalogue === CATALOGUE_TXT &&
            wsParsed.snapshot.version === WORKSPACE_SCHEMA_VERSION &&
            !wsParsed.migrated;
        /* A v1 schema snapshot (no catalogue) migrates forward with a null/absent
           catalogue rather than corrupting the analysis. */
        var wsLegacy = parseWorkspace(JSON.stringify({ version: 1,
            savedAt: '2026-01-01T00:00:00.000Z',
            files: [{ name: 'old.sql', text: 'SELECT 1;' }],
            options: { dialect: 'tsql', scope: 'internal' } }));
        var wsLegacyOk = !!wsLegacy.snapshot && wsLegacy.snapshot.version ===
            WORKSPACE_SCHEMA_VERSION && wsLegacy.snapshot.catalogue === null;
        record('v1.9.0 workspace snapshot round-trips the catalogue text', wsCatalogueRoundTrip && wsLegacyOk, { roundTrip: wsCatalogueRoundTrip, legacy: wsLegacyOk,
            restored: wsParsed.snapshot && wsParsed.snapshot.catalogue,
            legacyCat: wsLegacy.snapshot && wsLegacy.snapshot.catalogue });
    }
    catch (err) {
        record('v1.9.0 workspace snapshot round-trips the catalogue text', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (r) { return r.pass; }).length;
    window.PROCFLOW_CATALOGUE_RESULT = { passed: passed, total: results.length };
    window.PROCFLOW_CATALOGUE_PASS = passed === results.length;
})();
//# sourceMappingURL=catalogue.js.map