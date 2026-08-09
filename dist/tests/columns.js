"use strict";
/* proc>flow v1.10.0 — column lineage foundations.
   Fixtures assert exact input→output mappings and spans for qualified
   references, aliases, projections, CTEs, derived tables, and catalogue-backed
   wildcard expansion; that ambiguity never invents a column binding; and that
   unsupported expressions become opaque with region-scoped diagnostics.
   Multi-statement temp-table and inter-object column flow (v1.11.0) is out of
   scope here; every fixture is a single query statement.

   After this suite runs, PROCFLOW_COLUMN_PASS and PROCFLOW_COLUMN_RESULT gate
   the golden suite (tests/tests.ts) and feed the fixture-corpus metrics. */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    function hasDiag(list, code) {
        return (list || []).some(function (d) { return d.code === code; });
    }
    var PROCFLOW_COLUMN_FIXTURES = [
        {
            name: 'qualified references, aliases, and JOIN predicates',
            dialect: 'tsql',
            sql: 'SELECT s.id AS sid, s.name, sc.name AS school FROM dbo.student s JOIN dbo.school sc ON sc.id = s.school_id;',
            expect: {
                sourceKeys: ['s', 'sc'],
                outputs: [
                    { name: 'sid', resolution: 'exact', bindings: ['s.id'], spanText: 's.id AS sid' },
                    { name: 'name', resolution: 'exact', bindings: ['s.name'], spanText: 's.name' },
                    { name: 'school', resolution: 'exact', bindings: ['sc.name'], spanText: 'sc.name AS school' }
                ],
                refs: [
                    { text: 's.id', resolution: 'exact' },
                    { text: 'sc.id', resolution: 'exact' },
                    { text: 's.school_id', resolution: 'exact' }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'unqualified reference to a single source binds exactly',
            dialect: 'tsql',
            sql: 'SELECT id FROM dbo.student;',
            expect: {
                outputs: [{ name: 'id', resolution: 'exact', bindings: ['dbo.student.id'] }],
                refs: [{ text: 'id', resolution: 'exact' }],
                noDiagnostics: true
            }
        },
        {
            name: 'ambiguous unqualified reference invents no binding',
            dialect: 'tsql',
            sql: 'SELECT id FROM dbo.a a JOIN dbo.b b ON a.id = b.aid;',
            expect: {
                outputs: [{ name: 'id', resolution: 'ambiguous', bindings: [] }],
                refs: [{ text: 'id', resolution: 'ambiguous' }],
                diagnostics: ['column_ambiguous']
            }
        },
        {
            name: 'expression-level provenance maps every referenced column',
            dialect: 'tsql',
            sql: 'SELECT s.a + s.b AS total, s.a * 2 AS doubled, COUNT(*) AS n FROM dbo.t s;',
            expect: {
                outputs: [
                    { name: 'total', resolution: 'exact', bindings: ['s.a', 's.b'], spanText: 's.a + s.b AS total' },
                    { name: 'doubled', resolution: 'exact', bindings: ['s.a'] },
                    { name: 'n', resolution: 'exact', bindings: [] }
                ],
                refs: [
                    { text: 's.a', resolution: 'exact' },
                    { text: 's.b', resolution: 'exact' }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'CTE scopes carry explicit and computed column lists',
            dialect: 'tsql',
            sql: 'WITH c(i, j) AS (SELECT 1, 2), d AS (SELECT i AS a, j AS b FROM c) SELECT a, b FROM d;',
            expect: {
                sourceOf: { key: 'd', kind: 'cte', columns: ['a', 'b'] },
                outputs: [
                    { name: 'a', resolution: 'exact', bindings: ['d.a'] },
                    { name: 'b', resolution: 'exact', bindings: ['d.b'] }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'derived-table inner sources provide the column scope',
            dialect: 'tsql',
            sql: 'SELECT x.id, x.name FROM (SELECT id, name FROM dbo.inner) x;',
            expect: {
                sourceOf: { key: 'x', kind: 'derived', columns: ['id', 'name'] },
                outputs: [
                    { name: 'id', resolution: 'exact', bindings: ['x.id'] },
                    { name: 'name', resolution: 'exact', bindings: ['x.name'] }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'catalogue-backed wildcard expansion (qualified)',
            dialect: 'tsql',
            catalogue: 'dbo.student TABLE\nCOL dbo.student.Id\nCOL dbo.student.Name\nCOL dbo.student.Grade',
            sql: 'SELECT s.* FROM dbo.student s;',
            expect: {
                wildcards: [{ source: 's', expanded: true, columns: ['Id', 'Name', 'Grade'] }],
                outputs: [
                    { name: 'Id', resolution: 'exact', bindings: ['s.Id'] },
                    { name: 'Name', resolution: 'exact', bindings: ['s.Name'] },
                    { name: 'Grade', resolution: 'exact', bindings: ['s.Grade'] }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'catalogue-backed wildcard expansion (bare star)',
            dialect: 'tsql',
            catalogue: 'dbo.student TABLE\nCOL dbo.student.Id\nCOL dbo.student.Name',
            sql: 'SELECT * FROM dbo.student;',
            expect: {
                wildcards: [{ source: null, expanded: true, columns: ['Id', 'Name'] }],
                outputs: [
                    { name: 'Id', resolution: 'exact', bindings: ['dbo.student.Id'] },
                    { name: 'Name', resolution: 'exact', bindings: ['dbo.student.Name'] }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'wildcard without catalogue stays unexpanded',
            dialect: 'tsql',
            sql: 'SELECT t.* FROM dbo.student t;',
            expect: {
                wildcards: [{ source: 't', expanded: false, columns: [] }],
                outputCount: 0,
                noDiagnostics: true
            }
        },
        {
            name: 'scalar subquery projection is opaque with a region diagnostic',
            dialect: 'tsql',
            sql: 'SELECT s.id, (SELECT MAX(x) FROM dbo.meta) AS latest FROM dbo.student s;',
            expect: {
                outputs: [
                    { name: 'id', resolution: 'exact', bindings: ['s.id'] },
                    { name: 'latest', resolution: 'opaque', bindings: [] }
                ],
                diagnostics: ['column_opaque']
            }
        },
        {
            name: 'reference to a column outside a provable scope is opaque',
            dialect: 'tsql',
            sql: 'WITH c(i) AS (SELECT 1) SELECT c.nope FROM c;',
            expect: {
                outputs: [{ name: 'nope', resolution: 'opaque', bindings: [] }],
                diagnostics: ['column_opaque']
            }
        },
        {
            name: 'predicate references bind with spans inside WHERE clauses',
            dialect: 'tsql',
            sql: 'SELECT s.id FROM dbo.student s WHERE s.active = 1 AND s.school_id IN (1, 2);',
            expect: {
                outputs: [{ name: 'id', resolution: 'exact', bindings: ['s.id'] }],
                refs: [
                    { text: 's.id', resolution: 'exact' },
                    { text: 's.active', resolution: 'exact' },
                    { text: 's.school_id', resolution: 'exact' }
                ],
                noDiagnostics: true
            }
        },
        {
            name: 'recursive CTE binds its recursion column exactly',
            dialect: 'tsql',
            sql: 'WITH r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 10) SELECT n FROM r;',
            expect: {
                outputs: [{ name: 'n', resolution: 'exact', bindings: ['r.n'] }],
                refs: [{ text: 'n', resolution: 'exact' }],
                noDiagnostics: true
            }
        },
        {
            name: 'SELECT DISTINCT TOP projection region',
            dialect: 'tsql',
            sql: 'SELECT DISTINCT TOP 5 s.id FROM dbo.student s ORDER BY s.id;',
            expect: {
                outputs: [{ name: 'id', resolution: 'exact', bindings: ['s.id'] }],
                noDiagnostics: true
            }
        },
        {
            name: 'SELECT … INTO binds the projected columns',
            dialect: 'tsql',
            sql: 'SELECT id, name INTO #stage FROM dbo.student;',
            expect: {
                outputs: [
                    { name: 'id', resolution: 'exact', bindings: ['dbo.student.id'] },
                    { name: 'name', resolution: 'exact', bindings: ['dbo.student.name'] }
                ],
                noDiagnostics: true
            }
        }
    ];
    function spanText(sql, span) {
        return span ? sql.slice(span.start, span.end) : '';
    }
    PROCFLOW_COLUMN_FIXTURES.forEach(function (f) {
        try {
            var cat = null;
            if (f.catalogue)
                cat = parseCatalogue(f.catalogue).catalogue;
            var lin = analyseColumns(tokenize(f.sql), { catalogue: cat, dialect: f.dialect });
            if (!lin) {
                record(f.name + ' · mappings', false, 'column lineage was not produced');
                return;
            }
            var e = f.expect, ok = true, detail = {};
            if (e.sourceKeys) {
                var keys = lin.sources.map(function (s) { return s.key.toUpperCase(); });
                detail.sources = lin.sources.map(function (s) { return { key: s.key, kind: s.kind, cols: s.columns }; });
                ok = ok && e.sourceKeys.every(function (k) { return keys.indexOf(k.toUpperCase()) >= 0; });
            }
            if (e.sourceOf) {
                var src = null;
                lin.sources.forEach(function (s) { if (s.key.toUpperCase() === e.sourceOf.key.toUpperCase())
                    src = s; });
                detail.sourceOf = src && { key: src.key, kind: src.kind, cols: src.columns };
                ok = ok && !!src && src.kind === e.sourceOf.kind &&
                    (e.sourceOf.columns === undefined || src.columns.join(',') === e.sourceOf.columns.join(','));
            }
            if (e.outputCount !== undefined) {
                detail.outputCount = lin.outputs.length;
                ok = ok && lin.outputs.length === e.outputCount;
            }
            (e.outputs || []).forEach(function (exp) {
                var out = null;
                lin.outputs.forEach(function (o) { if (o.name === exp.name)
                    out = o; });
                var bindingTexts = (out ? out.bindings : []).map(function (b) { return b.source + '.' + b.column; });
                var outputOk = !!out && (exp.resolution === undefined || out.resolution === exp.resolution) &&
                    (exp.bindings === undefined || bindingTexts.join('|') === exp.bindings.join('|')) &&
                    (exp.spanText === undefined || spanText(f.sql, out.span) === exp.spanText);
                ok = ok && outputOk;
                detail['output:' + exp.name] = out && { res: out.resolution, bindings: bindingTexts,
                    span: spanText(f.sql, out.span) };
            });
            (e.refs || []).forEach(function (exp) {
                var ref = null;
                lin.references.forEach(function (r) {
                    if (spanText(f.sql, r.span) === exp.text)
                        ref = r;
                });
                var refOk = !!ref && ref.resolution === exp.resolution &&
                    !!ref.span && ref.span.start >= 0 && ref.span.end > ref.span.start &&
                    ref.span.end <= f.sql.length;
                ok = ok && refOk;
                detail['ref:' + exp.text] = ref && { res: ref.resolution,
                    span: spanText(f.sql, ref.span) };
            });
            (e.wildcards || []).forEach(function (exp) {
                var wc = null;
                lin.wildcards.forEach(function (w) {
                    if ((w.source || null) === (exp.source || null))
                        wc = w;
                });
                var wcOk = !!wc && wc.expanded === exp.expanded &&
                    (exp.columns === undefined || wc.columns.join(',') === exp.columns.join(',')) &&
                    !!wc.span && wc.span.start >= 0 && wc.span.end > wc.span.start &&
                    wc.span.end <= f.sql.length;
                ok = ok && wcOk;
                detail['wildcard:' + (exp.source || '*')] = wc && { expanded: wc.expanded, cols: wc.columns,
                    span: spanText(f.sql, wc.span) };
            });
            if (e.diagnostics) {
                (e.diagnostics || []).forEach(function (code) {
                    ok = ok && hasDiag(lin.diagnostics, code);
                });
            }
            if (e.noDiagnostics) {
                ok = ok && lin.diagnostics.length === 0;
                detail.diagnostics = lin.diagnostics;
            }
            /* every region-scoped column diagnostic carries a valid span */
            var spanOk = lin.diagnostics.every(function (d) {
                return d.scope === 'region' && !!d.span && d.span.start >= 0 && d.span.end > d.span.start &&
                    d.span.end <= f.sql.length;
            });
            ok = ok && spanOk;
            record(f.name + ' · mappings', ok, JSON.stringify(detail));
        }
        catch (err) {
            record(f.name + ' · mappings', false, String(err && err.stack || err));
        }
    });
    /* ---- integration: analyse() attaches column lineage and surfaces its
       diagnostics as region-scoped findings ---- */
    try {
        var r = analyse('SELECT id FROM dbo.a a JOIN dbo.b b ON a.id = b.aid;', { dialect: 'tsql', mode: 'auto', group: false, sources: true });
        var integrated = !!r.columns && r.columns.length === 1 &&
            r.diagnostics.some(function (d) {
                return d.code === 'column_ambiguous' && d.scope === 'region' &&
                    !!d.span && r.diagnostics.indexOf(d) >= 0 &&
                    'SELECT id FROM dbo.a a JOIN dbo.b b ON a.id = b.aid;'
                        .slice(d.span.start, d.span.end) === 'id';
            });
        record('v1.10.0 analyse() attaches column lineage and findings', integrated, JSON.stringify({ columnCount: r.columns && r.columns.length,
            diagnostics: r.diagnostics.map(function (d) { return d.code; }) }));
    }
    catch (err) {
        record('v1.10.0 analyse() attaches column lineage and findings', false, String(err && err.stack || err));
    }
    try {
        var clean = analyse('CREATE PROC dbo.clean_cols AS BEGIN\n' +
            '  WITH r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<10)\n' +
            '  SELECT n FROM r;\n' +
            'END', { dialect: 'tsql', mode: 'flow', group: false, sources: true });
        var cleanOk = !clean.diagnostics.some(function (d) {
            return d.code.indexOf('column_') === 0;
        }) && (clean.columns || []).length === 1;
        record('v1.10.0 clean single-statement column bindings emit no diagnostics', cleanOk, JSON.stringify({ diags: clean.diagnostics.map(function (d) { return d.code; }),
            columns: clean.columns && clean.columns.length }));
    }
    catch (err) {
        record('v1.10.0 clean single-statement column bindings emit no diagnostics', false, String(err && err.stack || err));
    }
    try {
        var probe = analyse('SELECT s.id FROM dbo.student s WHERE s.active = 1;', { dialect: 'tsql', mode: 'auto', group: false, sources: true });
        var columns = probe.columns && probe.columns[0];
        var binding = columns && columns.outputs[0] && columns.outputs[0].bindings[0];
        var provenanceOk = !!columns && columns.outputs.length === 1 &&
            columns.outputs[0].resolution === 'exact' && !!binding &&
            binding.source === 's' && binding.column === 'id' && !!binding.span;
        record('v1.10.0 output binding carries source, column, and span', provenanceOk, JSON.stringify(columns && columns.outputs));
    }
    catch (err) {
        record('v1.10.0 output binding carries source, column, and span', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (r) { return r.pass; }).length;
    window.PROCFLOW_COLUMN_RESULT = { passed: passed, total: results.length };
    window.PROCFLOW_COLUMN_PASS = passed === results.length;
    window.PROCFLOW_COLUMN_DETAIL = results;
})();
//# sourceMappingURL=columns.js.map