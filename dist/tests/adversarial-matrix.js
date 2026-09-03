"use strict";
/* v2.0.0 semantic qualification matrix. Fixtures are synthetic and deterministic.
   Required assertions prove supported facts; forbidden assertions guard against
   false semantic claims that ordinary attribution/coverage cannot detect. */
(function () {
    var fixtures = [
        { name: 'dynamic EXEC has no static call or object dependency', dialect: 'tsql',
            sql: 'CREATE PROCEDURE dbo.dynamic_exec AS BEGIN DECLARE @q nvarchar(max); EXEC(@q); EXEC @q; END', checks: [
                { kind: 'opaque', must: 'present', text: 'Dynamic SQL — EXEC(@q)', span: true },
                { kind: 'opaque', must: 'present', text: 'Dynamic SQL — EXEC @q', span: true },
                { kind: 'diagnostic', must: 'present', code: 'dynamic_sql', scope: 'region', severity: 'warning', span: true },
                { kind: 'estate', must: 'absent', relation: 'calls', object: '@q' },
                { kind: 'estate', must: 'absent', relation: 'reads', object: '@q' },
                { kind: 'edge', must: 'present', from: 'DECLARE @q', to: 'Dynamic SQL — EXEC(@q)', edgeKind: 'control' }
            ] },
        { name: 'branch reaching definitions do not invent temp data flow', dialect: 'tsql',
            sql: 'CREATE PROCEDURE dbo.branch_temp AS BEGIN IF @x=1 SELECT id INTO #t FROM dbo.a; ELSE SELECT id INTO #t FROM dbo.b; SELECT id FROM #t; END', checks: [
                { kind: 'diagnostic', must: 'present', code: 'temp_flow_ambiguous', scope: 'region', severity: 'info', span: true },
                { kind: 'diagnostic', must: 'present', code: 'column_flow_opaque', scope: 'region', severity: 'warning', span: true },
                { kind: 'edge', must: 'absent', from: 'SELECT … INTO #t', to: 'SELECT … FROM #t', edgeKind: 'data' },
                { kind: 'estate', must: 'present', relation: 'reads', object: 'dbo.a' },
                { kind: 'estate', must: 'present', relation: 'reads', object: 'dbo.b' }
            ] },
        { name: 'ambiguous column names remain unbound', dialect: 'tsql',
            sql: 'SELECT id FROM dbo.a a JOIN dbo.b b ON a.id = b.aid;', checks: [
                { kind: 'columnRef', must: 'present', text: 'id', resolution: 'ambiguous', span: true },
                { kind: 'columnOutput', must: 'present', text: 'id', resolution: 'ambiguous' },
                { kind: 'columnOutput', must: 'absent', text: 'id', binding: 'a.id' },
                { kind: 'diagnostic', must: 'present', code: 'column_ambiguous', scope: 'region', severity: 'warning', span: true }
            ] },
        { name: 'UPDATE FROM retains both read sources', dialect: 'tsql',
            sql: 'UPDATE t SET x=s.x FROM dbo.target t JOIN dbo.source s ON s.id=t.id;', checks: [
                { kind: 'estate', must: 'present', relation: 'reads', object: 'dbo.target' },
                { kind: 'estate', must: 'present', relation: 'reads', object: 'dbo.source' },
                { kind: 'estate', must: 'present', relation: 'writes', object: 't' },
                { kind: 'diagnostic', must: 'absent', code: 'dynamic_sql' }
            ] },
        { name: 'static procedure invocation creates a call edge', dialect: 'tsql',
            sql: 'CREATE PROCEDURE dbo.static_call AS BEGIN EXEC dbo.audit_refresh; END', checks: [
                { kind: 'estate', must: 'present', relation: 'calls', object: 'dbo.audit_refresh' },
                { kind: 'estateEdge', must: 'present', edgeKind: 'call' },
                { kind: 'diagnostic', must: 'absent', code: 'dynamic_sql' }
            ] },
        { name: 'resolved columns retain explicit bindings', dialect: 'tsql',
            sql: 'SELECT s.id FROM dbo.student s;', checks: [
                { kind: 'columnRef', must: 'present', text: 'id', resolution: 'exact', span: true },
                { kind: 'columnOutput', must: 'present', text: 'id', resolution: 'exact', binding: 's.id' }
            ] },
        { name: 'named LATERAL source and recursive CTE remain visible', dialect: 'plpgsql',
            sql: 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<3) SELECT x.id FROM (SELECT id FROM app.base) x JOIN LATERAL app.expand_rows(x.id) e ON true;', checks: [
                { kind: 'estate', must: 'present', relation: 'reads', object: 'app.base' },
                { kind: 'estate', must: 'present', relation: 'reads', object: 'app.expand_rows' },
                { kind: 'diagnostic', must: 'present', code: 'cte_recursive', scope: 'region', severity: 'info', span: true },
                { kind: 'diagnostic', must: 'absent', code: 'source_opaque' }
            ] },
        { name: 'PL/pgSQL EXECUTE remains opaque', dialect: 'plpgsql',
            sql: 'CREATE FUNCTION app.run_dynamic(q text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; END; $$;', checks: [
                { kind: 'opaque', must: 'present', text: 'Dynamic SQL — EXECUTE q', span: true },
                { kind: 'diagnostic', must: 'present', code: 'dynamic_sql', scope: 'region', severity: 'warning', span: true },
                { kind: 'estate', must: 'absent', relation: 'calls', object: 'q' },
                { kind: 'estate', must: 'absent', relation: 'reads', object: 'q' }
            ] },
        { name: 'PL/pgSQL handler edge is explicitly exceptional', dialect: 'plpgsql',
            sql: 'CREATE FUNCTION app.handle() RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN RAISE unique_violation; EXCEPTION WHEN unique_violation THEN PERFORM app.log_unique(); END; END; $$;', checks: [
                { kind: 'edge', must: 'present', from: 'RAISE unique_violation', to: 'EXCEPTION WHEN unique_violation', edgeKind: 'exception' },
                { kind: 'estate', must: 'present', relation: 'calls', object: 'app.log_unique' }
            ] },
        { name: 'DELETE USING preserves static source', dialect: 'plpgsql',
            sql: 'DELETE FROM app.target t USING app.source s WHERE s.id=t.id;', checks: [
                { kind: 'estate', must: 'present', relation: 'reads', object: 'app.source' },
                { kind: 'estate', must: 'present', relation: 'writes', object: 'app.target' },
                { kind: 'diagnostic', must: 'absent', code: 'dynamic_sql' }
            ] },
        { name: 'PREPARE EXECUTE forbids invented statement objects', dialect: 'db2',
            sql: 'CREATE PROCEDURE APP.PREPARED() LANGUAGE SQL BEGIN PREPARE stmt FROM statement_text; EXECUTE stmt; END', checks: [
                { kind: 'opaque', must: 'present', text: 'Dynamic SQL — EXECUTE stmt', span: true },
                { kind: 'diagnostic', must: 'present', code: 'dynamic_sql', scope: 'region', severity: 'warning', span: true },
                { kind: 'edge', must: 'present', from: 'PREPARE stmt FROM statement_text', to: 'Dynamic SQL — EXECUTE stmt', edgeKind: 'control' },
                { kind: 'estate', must: 'absent', relation: 'calls', object: 'stmt' },
                { kind: 'estate', must: 'absent', relation: 'reads', object: 'statement_text' }
            ] },
        { name: 'SESSION temporary table has a unique producer data edge', dialect: 'db2',
            sql: 'CREATE PROCEDURE APP.TEMP_FLOW() LANGUAGE SQL BEGIN DECLARE GLOBAL TEMPORARY TABLE SESSION.WORK (ID INTEGER); INSERT INTO SESSION.WORK SELECT ID FROM APP.SOURCE_ROWS; SELECT ID FROM SESSION.WORK; END', checks: [
                { kind: 'edge', must: 'present', from: 'INSERT INTO SESSION.WORK', to: 'SELECT … FROM SESSION.WORK', edgeKind: 'data' },
                { kind: 'estate', must: 'present', relation: 'reads', object: 'APP.SOURCE_ROWS' },
                { kind: 'estate', must: 'present', relation: 'reads', object: 'SESSION.WORK' },
                { kind: 'estate', must: 'present', relation: 'writes', object: 'SESSION.WORK' }
            ] },
        { name: 'DB2 MERGE preserves target and source identities', dialect: 'db2',
            sql: 'MERGE INTO APP.TARGET t USING APP.SOURCE s ON t.ID=s.ID WHEN MATCHED THEN UPDATE SET VALUE=s.VALUE;', checks: [
                { kind: 'estate', must: 'present', relation: 'reads', object: 'APP.SOURCE' },
                { kind: 'estate', must: 'present', relation: 'writes', object: 'APP.TARGET' },
                { kind: 'diagnostic', must: 'absent', code: 'dynamic_sql' }
            ] },
        { name: 'SQLite savepoint and trigger update are source-traceable', dialect: 'sqlite',
            sql: 'CREATE TRIGGER audit_change AFTER UPDATE ON item BEGIN SAVEPOINT s; UPDATE item SET checked=1 WHERE id=NEW.id; RELEASE s; END;', checks: [
                { kind: 'node', must: 'present', text: 'SAVEPOINT s', provenance: 'source', span: true },
                { kind: 'edge', must: 'present', from: 'SAVEPOINT s', to: 'UPDATE item', edgeKind: 'control' },
                { kind: 'estate', must: 'present', relation: 'writes', object: 'item' },
                { kind: 'diagnostic', must: 'absent', code: 'dynamic_sql' }
            ] },
        { name: 'catalogue conflict remains explicit rather than verified', dialect: 'tsql', catalogue: 'dbo.a TABLE\ndbo.a TABLE',
            sql: 'SELECT id FROM dbo.a;', checks: [
                { kind: 'diagnostic', must: 'present', code: 'catalogue_conflict', scope: 'region', severity: 'warning', span: true },
                { kind: 'node', must: 'present', text: 'dbo.a' },
                { kind: 'diagnostic', must: 'absent', code: 'dynamic_sql' }
            ] }
    ];
    function same(a, b) { return String(a || '').toUpperCase() === String(b || '').toUpperCase(); }
    function spanOk(span, sql) { return !!span && span.start >= 0 && span.end > span.start && span.end <= sql.length; }
    function matchedNodes(g, text) { return g.nodes.filter(function (n) { return n.text.indexOf(text) >= 0; }); }
    function label(c) {
        if (c.kind === 'estate')
            return (c.relation || 'relation') + ' ' + (c.object || '');
        if (c.kind === 'estateEdge')
            return 'estate ' + (c.edgeKind || 'edge');
        if (c.kind === 'edge')
            return (c.edgeKind || 'edge') + ' ' + (c.from || '') + ' -> ' + (c.to || '');
        if (c.kind === 'diagnostic')
            return 'diagnostic ' + (c.code || '');
        return c.kind + ' ' + (c.text || '');
    }
    function check(c, r, e, f) {
        if (c.kind === 'node' || c.kind === 'opaque') {
            var ns = matchedNodes(r.graph, c.text || '').filter(function (n) {
                return (c.kind !== 'opaque' || n.cls === 'opaque') &&
                    (c.provenance === undefined || n.provenance === c.provenance) && (!c.span || spanOk(n.source, f.sql));
            });
            return { found: ns.length > 0, actual: ns.map(function (n) { return { text: n.text, cls: n.cls, provenance: n.provenance, source: n.source }; }) };
        }
        if (c.kind === 'edge') {
            var from = matchedNodes(r.graph, c.from || ''), to = matchedNodes(r.graph, c.to || '');
            var es = r.graph.edges.filter(function (x) { return from.some(function (n) { return n.id === x.from; }) && to.some(function (n) { return n.id === x.to; }) && (!c.edgeKind || x.kind === c.edgeKind); });
            return { found: es.length > 0, actual: es };
        }
        if (c.kind === 'estate') {
            var values = [];
            e.objects.forEach(function (o) { values = values.concat(o[c.relation || 'reads'] || []); });
            return { found: values.some(function (v) { return same(v, c.object); }), actual: values };
        }
        if (c.kind === 'estateEdge') {
            var estateEdges = e.graph.edges.filter(function (x) { return !c.edgeKind || x.kind === c.edgeKind; });
            return { found: estateEdges.length > 0, actual: estateEdges };
        }
        if (c.kind === 'diagnostic') {
            var ds = r.diagnostics.filter(function (d) { return d.code === c.code && (!c.scope || d.scope === c.scope) && (!c.severity || d.severity === c.severity) && (!c.span || spanOk(d.span, f.sql)); });
            return { found: ds.length > 0, actual: r.diagnostics };
        }
        var l = r.columns || [];
        if (c.kind === 'columnRef') {
            var refs = [];
            l.forEach(function (x) { refs = refs.concat(x.references || []); });
            var rs = refs.filter(function (x) { return same(x.name, c.text) && (!c.resolution || x.resolution === c.resolution) && (!c.span || spanOk(x.span, f.sql)); });
            return { found: rs.length > 0, actual: refs };
        }
        var out = [];
        l.forEach(function (x) { out = out.concat(x.outputs || []); });
        var os = out.filter(function (x) { var bs = x.bindings.map(function (b) { return b.source + '.' + b.column; }); return same(x.name, c.text) && (!c.resolution || x.resolution === c.resolution) && (!c.binding || bs.some(function (b) { return same(b, c.binding); })); });
        return { found: os.length > 0, actual: out };
    }
    var passed = 0, total = 0, required = 0, forbidden = 0, failures = [];
    var byDialect = {};
    fixtures.forEach(function (f) {
        if (!byDialect[f.dialect])
            byDialect[f.dialect] = { cases: 0, assertions: 0, required: 0, forbidden: 0 };
        byDialect[f.dialect].cases++;
        var cat = f.catalogue ? parseCatalogue(f.catalogue) : null;
        var opts = { dialect: f.dialect, mode: 'flow', group: false, sources: true, fanIn: true, catalogue: cat && cat.catalogue, catalogueDiagnostics: cat && cat.diagnostics };
        var r = analyse(f.sql, opts), e = analyseEstate([{ name: 'matrix.sql', text: f.sql }], opts);
        f.checks.forEach(function (c) {
            total++;
            byDialect[f.dialect].assertions++;
            if (c.must === 'present') {
                required++;
                byDialect[f.dialect].required++;
            }
            else {
                forbidden++;
                byDialect[f.dialect].forbidden++;
            }
            var result = check(c, r, e, f), ok = c.must === 'present' ? result.found : !result.found;
            if (ok) {
                passed++;
                return;
            }
            failures.push({ dialect: f.dialect, case: f.name, assertion: label(c), expected: c.must, actual: result.actual });
        });
    });
    window.PROCFLOW_ADVERSARIAL_RESULT = { passed: passed, total: total, rate: total ? passed / total : 1, caseCount: fixtures.length, required: required, forbidden: forbidden, byDialect: byDialect };
    window.PROCFLOW_ADVERSARIAL_FAILURES = failures;
    window.PROCFLOW_ADVERSARIAL_PASS = passed === total;
})();
//# sourceMappingURL=adversarial-matrix.js.map