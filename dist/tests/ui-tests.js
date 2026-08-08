"use strict";
(function () {
    var frame = document.getElementById('app'), output = document.getElementById('results');
    function finish(results) {
        var passed = results.filter(function (r) { return r.pass; }).length;
        document.body.className = passed === results.length ? 'pass' : 'fail';
        document.getElementById('summary').textContent = passed + '/' + results.length + ' tests passed';
        output.textContent = JSON.stringify(results, null, 2);
    }
    frame.addEventListener('load', function () {
        var w = frame.contentWindow, d = frame.contentDocument, results = [];
        var get = function (id) { return d.getElementById(id); };
        results.push({ name: 'compact local-processing header',
            pass: !!d.querySelector('.top .privacy-disclosure') &&
                !d.querySelector('.privacy-note') &&
                !!get('btn-draw').closest('.editor-head') &&
                !get('btn-draw').closest('.top') });
        results.push({ name: 'settings and export menus group secondary controls',
            pass: !!get('view-settings-menu').querySelector('#opt-group') &&
                !!get('view-settings-menu').querySelector('#opt-fanin') &&
                !!get('export-menu').querySelector('#btn-copy') &&
                !!get('export-menu').querySelector('#btn-drawio') });
        get('btn-analysis-details').click();
        results.push({ name: 'analysis details expand accessibly',
            pass: !get('analysis-details').hidden &&
                get('btn-analysis-details').getAttribute('aria-expanded') === 'true' });
        get('btn-analysis-details').click();
        var pastedSource = [
            'CREATE OR ALTER PROCEDURE dbo.pasted_once AS',
            'BEGIN',
            '  SELECT 1;',
            'END'
        ].join('\n');
        get('sql').value = pastedSource;
        get('sql').dispatchEvent(new Event('input'));
        get('btn-draw').click();
        results.push({ name: 'single modified CREATE paste remains one clean source',
            pass: get('object-select').options.length === 1 && get('sql').value === pastedSource,
            detail: { objectCount: get('object-select').options.length, source: get('sql').value } });
        var source = [
            'CREATE VIEW dbo.export_students AS SELECT id FROM dbo.student;',
            'GO',
            'CREATE PROCEDURE dbo.refresh_students AS',
            'BEGIN',
            '  EXEC dbo.audit_refresh;',
            '  UPDATE dbo.student SET refreshed = 1;',
            '  SELECT id FROM dbo.export_students;',
            'END'
        ].join('\n');
        get('sql').value = source;
        get('sql').dispatchEvent(new Event('input'));
        get('btn-draw').click();
        results.push({ name: 'multi-object picker',
            pass: get('object-select').options.length === 2 && !get('lbl-object').hidden });
        var scope = get('opt-scope');
        scope.value = 'dependencies';
        scope.dispatchEvent(new Event('change'));
        results.push({ name: 'dependency diagram',
            pass: /reads|writes|calls/.test(get('mermaid-out').textContent) &&
                /Estate/.test(get('proc-name').textContent) });
        var picker = get('object-select');
        picker.value = picker.options[1].value;
        picker.dispatchEvent(new Event('change'));
        scope.value = 'internal';
        scope.dispatchEvent(new Event('change'));
        results.push({ name: 'linked object selection',
            pass: /refresh_students/i.test(get('proc-name').textContent) &&
                /refresh_students/i.test(get('sql').value) });
        get('proc-name').textContent = 'Shortcut pending';
        get('sql').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        results.push({ name: 'Ctrl+Enter refresh shortcut',
            pass: get('proc-name').textContent !== 'Shortcut pending' &&
                /refresh_students/i.test(get('proc-name').textContent) });
        results.push({ name: 'confidence and coverage display',
            pass: get('coverage-val').textContent === '100%' &&
                /%$/.test(get('confidence-val').textContent) &&
                /^\d+$/.test(get('diagnostic-val').textContent) });
        results.push({ name: 'analysis health data-band derives from the confidence formula',
            pass: (function () {
                var pct = parseInt(get('confidence-val').textContent, 10);
                var expected = pct >= 85 ? 'high' : pct >= 60 ? 'medium' : 'low';
                return get('analysis-health').getAttribute('data-band') === expected;
            })(),
            detail: { band: get('analysis-health').getAttribute('data-band'),
                pct: get('confidence-val').textContent } });
        results.push({ name: 'construct coverage display',
            pass: /^\d+\/\d+$/.test(get('construct-val').textContent) &&
                /\d+ detected · \d+ resolved · \d+ opaque/.test(get('construct-note').textContent),
            detail: { val: get('construct-val').textContent,
                note: get('construct-note').textContent } });
        var view = get('opt-view');
        view.value = 'flow';
        view.dispatchEvent(new Event('change'));
        var flowCode = get('mermaid-out').textContent;
        view.value = 'query';
        view.dispatchEvent(new Event('change'));
        var queryCode = get('mermaid-out').textContent;
        results.push({ name: 'control flow and query structure selector',
            pass: flowCode !== queryCode && /dbo\.export_students/.test(queryCode) &&
                get('cc-label').textContent === 'Moving parts' });
        setTimeout(function () {
            var node = d.querySelector('#stage .node[data-source-start]'), before = get('sql').selectionEnd;
            if (node)
                node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            results.push({ name: 'diagram source selection',
                pass: !!node && get('sql').selectionEnd > get('sql').selectionStart &&
                    get('sql').selectionEnd !== before,
                detail: { nodeCount: d.querySelectorAll('#stage .node').length,
                    linkedCount: d.querySelectorAll('#stage .node[data-source-start]').length,
                    ids: Array.prototype.map.call(d.querySelectorAll('#stage .node'), function (n) { return n.id; }),
                    start: get('sql').selectionStart, end: get('sql').selectionEnd, before: before } });
            get('sql').value = 'END SELECT (1;';
            get('sql').dispatchEvent(new Event('input'));
            get('opt-dialect').value = 'tsql';
            get('btn-draw').click();
            results.push({ name: 'malformed input health warning',
                pass: parseInt(get('coverage-val').textContent, 10) < 100 &&
                    parseInt(get('diagnostic-val').textContent, 10) >= 2 &&
                    get('analysis-health').getAttribute('data-band') === 'low' });
            get('opt-dialect').value = 'tsql';
            get('sql').value = [
                'CREATE PROC dbo.rec_ui AS',
                'BEGIN',
                '  WITH r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r WHERE n<10)',
                '  SELECT n FROM r;',
                'END'
            ].join('\n');
            get('sql').dispatchEvent(new Event('input'));
            get('btn-draw').click();
            results.push({ name: 'informational annotations do not inflate findings count',
                pass: get('diagnostic-val').textContent === '0' &&
                    parseInt(get('confidence-val').textContent, 10) >= 85,
                detail: { diag: get('diagnostic-val').textContent,
                    conf: get('confidence-val').textContent } });
            results.push({ name: 'local Mermaid runtime',
                pass: !!w.mermaid && !Array.prototype.some.call(d.scripts, function (s) {
                    return /^https?:/i.test(s.getAttribute('src') || '');
                }) });
            /* v1.8.0 usable local workspace — dependency filtering and opt-in
               persistence (save → restore identical, explicit clear). */
            w.clearWorkspace();
            var depSource = [
                'CREATE VIEW dbo.dep_view AS SELECT id FROM dbo.student;',
                'GO',
                'CREATE PROC dbo.dep_proc AS',
                'BEGIN',
                '  EXEC dbo.dep_callee;',
                '  UPDATE dbo.student SET x = 1;',
                '  SELECT id FROM dbo.dep_view;',
                'END'
            ].join('\n');
            get('sql').value = depSource;
            get('sql').dispatchEvent(new Event('input'));
            get('btn-draw').click();
            get('object-select').options.length; /* analyse estate */
            get('opt-scope').value = 'dependencies';
            get('opt-scope').dispatchEvent(new Event('change'));
            var filterShown = get('filter-menu').style.display !== 'none';
            var fullDep = get('mermaid-out').textContent;
            get('f-w').checked = false;
            get('f-w').dispatchEvent(new Event('change'));
            var filteredDep = get('mermaid-out').textContent;
            get('btn-filter-reset').click();
            var resetDep = get('mermaid-out').textContent;
            results.push({ name: 'dependency filter panel shows only in dependency scope',
                pass: filterShown && fullDep.length > 0,
                detail: { shown: filterShown, full: fullDep.slice(0, 80) } });
            results.push({ name: 'dependency filtering is presentation-only in the UI',
                pass: fullDep !== filteredDep && filteredDep.length < fullDep.length &&
                    resetDep === fullDep,
                detail: { full: fullDep.slice(0, 120), filtered: filteredDep.slice(0, 120),
                    reset: resetDep.slice(0, 120) } });
            var persistenceSource = [
                'CREATE PROC dbo.ws_persist AS',
                'BEGIN',
                '  SELECT 1;',
                'END'
            ].join('\n');
            get('opt-scope').value = 'internal';
            get('opt-scope').dispatchEvent(new Event('change'));
            get('opt-dialect').value = 'tsql';
            get('sql').value = persistenceSource;
            get('sql').dispatchEvent(new Event('input'));
            get('btn-draw').click();
            var capturedCode = get('mermaid-out').textContent;
            get('btn-ws-save').click();
            get('sql').value = 'SELECT changed;';
            get('sql').dispatchEvent(new Event('input'));
            get('btn-draw').click();
            get('btn-ws-restore').click();
            var restoredCode = get('mermaid-out').textContent;
            results.push({ name: 'opt-in save then restore reproduces identical analysis',
                pass: get('sql').value.indexOf('ws_persist') >= 0 && capturedCode === restoredCode,
                detail: { captured: capturedCode.slice(0, 80), restored: restoredCode.slice(0, 80),
                    sql: get('sql').value.slice(0, 60) } });
            get('btn-ws-forget').click();
            results.push({ name: 'forgetting a saved workspace is explicit',
                pass: w.hasSavedWorkspace() === false &&
                    /No workspace is saved/i.test(get('ws-status').textContent || ''),
                detail: { saved: w.hasSavedWorkspace(), status: get('ws-status').textContent } });
            /* v1.9.0 resolve by catalogue — paste catalogue metadata, Apply, and
               verify the dependency view shows the verified object (no external
               label) while an unproven three-part name stays external. */
            get('opt-scope').value = 'internal';
            get('opt-dialect').value = 'tsql';
            get('sql').value = [
                'CREATE PROC dbo.cat_ui AS',
                'BEGIN',
                '  SELECT id FROM salesdb.dbo.orders;',
                '  SELECT id FROM readme.dbo.ghost;',
                'END'
            ].join('\n');
            get('sql').dispatchEvent(new Event('input'));
            get('catalogue-text').value = 'salesdb.dbo.orders TABLE';
            get('btn-catalogue-apply').click();
            get('opt-scope').value = 'dependencies';
            get('opt-scope').dispatchEvent(new Event('change'));
            var catalogued = get('mermaid-out').textContent;
            results.push({ name: 'catalogue verification in the dependency view',
                pass: catalogued.indexOf('salesdb.dbo.orders') >= 0 &&
                    catalogued.indexOf('external: salesdb.dbo.orders') < 0 &&
                    catalogued.indexOf('external: readme.dbo.ghost') >= 0 &&
                    /Loaded: 1 object/i.test(get('catalogue-status').textContent || ''),
                detail: { code: catalogued.slice(0, 160),
                    status: get('catalogue-status').textContent } });
            get('btn-catalogue-clear').click();
            results.push({ name: 'clearing the catalogue resets its status',
                pass: /No catalogue loaded/i.test(get('catalogue-status').textContent || ''),
                detail: { status: get('catalogue-status').textContent } });
            finish(results);
        }, 1200);
    });
})();
//# sourceMappingURL=ui-tests.js.map