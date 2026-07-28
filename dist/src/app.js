"use strict";
/* ===== UI ===== */
(function () {
    if (typeof document === 'undefined')
        return;
    var $ = function (id) { return document.getElementById(id); };
    var sql = $('sql'), gutter = $('gutter'), out = $('mermaid-out'), stage = $('stage'), canvas = $('canvas'), msg = $('msg');
    var scale = 1, panX = 0, panY = 0, lastCode = '', lastDialect = 'tsql', lastGraph = null, lastTitle = '', lastDirection = 'TD', lastResult = null, estate = null, workspaceFiles = null, activeObjectId = null, renderSeq = 0;
    var SAMPLES = {};
    SAMPLES.tsql = [
        "CREATE PROCEDURE dbo.usp_SyncStudentPhotos",
        "    @SchoolYear INT,",
        "    @DryRun BIT = 0",
        "AS",
        "BEGIN",
        "    SET NOCOUNT ON;",
        "    DECLARE @StudentId INT, @Processed INT = 0;",
        "",
        "    IF @SchoolYear IS NULL",
        "    BEGIN",
        "        RAISERROR('SchoolYear is required', 16, 1);",
        "        RETURN -1;",
        "    END",
        "",
        "    BEGIN TRY",
        "        BEGIN TRANSACTION;",
        "",
        "        INSERT INTO dbo.PhotoSyncQueue (StudentId, QueuedUtc)",
        "        SELECT s.StudentId, SYSUTCDATETIME()",
        "        FROM dbo.Student s",
        "        WHERE s.SchoolYear = @SchoolYear AND s.PhotoHash IS NULL;",
        "",
        "        DECLARE photo_cur CURSOR LOCAL FAST_FORWARD FOR",
        "            SELECT StudentId FROM dbo.PhotoSyncQueue WHERE Processed = 0;",
        "",
        "        OPEN photo_cur;",
        "        FETCH NEXT FROM photo_cur INTO @StudentId;",
        "",
        "        WHILE @@FETCH_STATUS = 0",
        "        BEGIN",
        "            IF @DryRun = 1",
        "                PRINT 'Would sync ' + CAST(@StudentId AS VARCHAR(10));",
        "            ELSE",
        "            BEGIN",
        "                EXEC dbo.usp_FetchPhotoFromWonde @StudentId;",
        "                UPDATE dbo.Student SET PhotoHash = 0x00 WHERE StudentId = @StudentId;",
        "                SET @Processed = @Processed + 1;",
        "            END",
        "",
        "            IF @Processed > 5000 BREAK;",
        "",
        "            FETCH NEXT FROM photo_cur INTO @StudentId;",
        "        END",
        "",
        "        CLOSE photo_cur;",
        "        DEALLOCATE photo_cur;",
        "        COMMIT TRANSACTION;",
        "    END TRY",
        "    BEGIN CATCH",
        "        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;",
        "        INSERT INTO dbo.SyncErrorLog (Proc, Message)",
        "        VALUES ('usp_SyncStudentPhotos', ERROR_MESSAGE());",
        "        THROW;",
        "    END CATCH",
        "",
        "    SELECT @Processed AS Processed;",
        "    RETURN 0;",
        "END"
    ].join('\n');
    SAMPLES.db2 = [
        "CREATE PROCEDURE ADMIN.SYNC_ENROLMENT (IN P_YEAR INTEGER, OUT P_COUNT INTEGER)",
        "LANGUAGE SQL",
        "SPECIFIC SYNC_ENROLMENT",
        "BEGIN",
        "    DECLARE V_ID INTEGER DEFAULT 0;",
        "    DECLARE V_DONE SMALLINT DEFAULT 0;",
        "",
        "    DECLARE EXIT HANDLER FOR SQLEXCEPTION",
        "    BEGIN",
        "        ROLLBACK;",
        "        RESIGNAL;",
        "    END;",
        "",
        "    IF P_YEAR IS NULL THEN",
        "        SET P_COUNT = 0;",
        "    ELSEIF P_YEAR < 2000 THEN",
        "        SIGNAL SQLSTATE '75001' SET MESSAGE_TEXT = 'Year too early';",
        "    ELSE",
        "        FOR row AS c1 CURSOR FOR",
        "            SELECT ID FROM ADMIN.ENROLMENT WHERE SCHOOL_YEAR = P_YEAR",
        "        DO",
        "            UPDATE ADMIN.ENROLMENT SET SYNCED = 'Y' WHERE ID = row.ID;",
        "            SET V_ID = V_ID + 1;",
        "            IF V_ID > 10000 THEN",
        "                LEAVE;",
        "            END IF;",
        "        END FOR;",
        "",
        "        CASE",
        "            WHEN V_ID = 0 THEN CALL ADMIN.LOG_EMPTY(P_YEAR);",
        "            WHEN V_ID > 5000 THEN CALL ADMIN.LOG_LARGE(V_ID);",
        "            ELSE CALL ADMIN.LOG_OK(V_ID);",
        "        END CASE;",
        "",
        "        SET P_COUNT = V_ID;",
        "    END IF;",
        "",
        "    COMMIT;",
        "    RETURN 0;",
        "END"
    ].join('\n');
    SAMPLES.plpgsql = [
        "CREATE OR REPLACE FUNCTION app.sync_students(p_year integer, p_dry_run boolean DEFAULT false)",
        "RETURNS integer",
        "LANGUAGE plpgsql",
        "AS $$",
        "DECLARE",
        "    v_count integer := 0;",
        "    r record;",
        "BEGIN",
        "    IF p_year IS NULL THEN",
        "        RAISE EXCEPTION 'p_year is required';",
        "    ELSIF p_year < 2000 THEN",
        "        RETURN 0;",
        "    END IF;",
        "",
        "    FOR r IN SELECT id FROM app.student WHERE school_year = p_year LOOP",
        "        IF p_dry_run THEN",
        "            RAISE NOTICE 'would sync %', r.id;",
        "        ELSE",
        "            PERFORM app.fetch_photo(r.id);",
        "            UPDATE app.student SET photo_hash = NULL WHERE id = r.id;",
        "        END IF;",
        "",
        "        v_count := v_count + 1;",
        "        EXIT WHEN v_count > 5000;",
        "    END LOOP;",
        "",
        "    BEGIN",
        "        INSERT INTO app.sync_log (job, rows_done) VALUES ('photos', v_count);",
        "    EXCEPTION",
        "        WHEN unique_violation THEN",
        "            RAISE NOTICE 'log entry already exists';",
        "        WHEN others THEN",
        "            RAISE;",
        "    END;",
        "",
        "    RETURN v_count;",
        "END;",
        "$$;"
    ].join('\n');
    SAMPLES.sqlite = [
        "CREATE TRIGGER trg_student_audit",
        "AFTER UPDATE OF surname, given_name ON student",
        "FOR EACH ROW",
        "WHEN old.surname <> new.surname OR old.given_name <> new.given_name",
        "BEGIN",
        "    INSERT INTO audit (student_id, field, old_value, new_value, changed_at)",
        "    VALUES (old.id, 'name', old.surname, new.surname, datetime('now'));",
        "",
        "    UPDATE student SET revision = revision + 1 WHERE id = old.id;",
        "",
        "    INSERT OR IGNORE INTO sync_queue (student_id) VALUES (old.id);",
        "END;"
    ].join('\n');
    function drawGutter() {
        var n = sql.value.split('\n').length, s = '';
        for (var i = 1; i <= n; i++)
            s += i + '\n';
        gutter.textContent = s;
        gutter.scrollTop = sql.scrollTop;
    }
    sql.addEventListener('scroll', function () { gutter.scrollTop = sql.scrollTop; });
    sql.addEventListener('input', function () {
        workspaceFiles = null;
        estate = null;
        activeObjectId = null;
        drawGutter();
        schedule();
    });
    sql.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            run();
        }
        else if (e.key === 'Tab') {
            e.preventDefault();
            var s = sql.selectionStart, en = sql.selectionEnd;
            sql.value = sql.value.slice(0, s) + '    ' + sql.value.slice(en);
            sql.selectionStart = sql.selectionEnd = s + 4;
            drawGutter();
            schedule();
        }
    });
    var timer = null;
    function schedule() {
        if (timer !== null)
            clearTimeout(timer);
        timer = setTimeout(run, 350);
    }
    function ccNote(cc) {
        if (cc <= 5)
            return 'A gentle path or two. Most readers will hold it all in their head.';
        if (cc <= 10)
            return 'Moderate. Worth a comment block at the top explaining the branches.';
        if (cc <= 20)
            return 'Busy. Consider splitting the work into smaller procedures.';
        return 'Thorny. Every added branch doubles what a tester must remember.';
    }
    function qNote(n) {
        if (n <= 8)
            return 'A short pipeline. Easy to follow from source to result.';
        if (n <= 20)
            return 'Moderate. A comment naming what each CTE is for would repay itself.';
        if (n <= 40)
            return 'Heavy. Each CTE is re-read by its children — worth checking the plan for repeated scans.';
        return 'Very heavy. A materialised staging table may cost less than rebuilding this every run.';
    }
    function setStats(mode, s) {
        var q = mode === 'query', deps = mode === 'dependencies';
        var rows = deps
            ? [[s.objects, 'Objects'], [s.external, 'External objects'], [s.reads, 'Reads'],
                [s.writes, 'Writes'], [s.calls, 'Calls']]
            : q
                ? [[s.ctes, 'CTEs'], [s.tables, 'Source tables'], [s.joins, 'Joins'],
                    [s.unions, 'Unions'], [s.subs, 'Subqueries'], [s.depth, 'Chain depth']]
                : [[s.stmt, 'Statements'], [s.branch, 'Branches'], [s.loop, 'Loops'],
                    [s.cat, 'Try/catch'], [s.exit, 'Exit points'], [s.depth, 'Max nesting']];
        $('stats').innerHTML = rows.map(function (r) {
            return '<div class="stat"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>';
        }).join('');
        var val = deps ? s.objects + s.external : (q ? s.parts : s.cc);
        var band = (q || deps) ? (val <= 8 ? 1 : val <= 20 ? 2 : val <= 40 ? 3 : 4) :
            (val <= 5 ? 1 : val <= 10 ? 2 : val <= 20 ? 3 : 4);
        var filled = Math.max(1, Math.min(20, (q || deps) ? Math.round(val / 2) : val));
        $('cc-label').textContent = deps ? 'Estate objects' : (q ? 'Moving parts' : 'Cyclomatic complexity');
        $('cc-val').textContent = val;
        var meter = $('meter'), html = '';
        meter.setAttribute('data-band', String(band));
        $('complexity-status').setAttribute('data-band', String(band));
        for (var i = 1; i <= 20; i++)
            html += '<div class="seg' + (i <= filled ? ' on' : '') + '"></div>';
        meter.innerHTML = html;
        $('cc-note').textContent = deps
            ? 'Select an object to move from estate dependencies into its internal logic.'
            : (q ? qNote(val) : ccNote(val));
    }
    function showMsg(text, kind) {
        msg.textContent = text || '';
        msg.classList.toggle('show', !!text);
        msg.classList.toggle('warn', kind === 'warn');
    }
    function analysisOptions() {
        return {
            dialect: $('opt-dialect').value, mode: $('opt-view').value,
            dir: $('opt-dir').value, detail: $('opt-detail').value,
            group: $('opt-group').checked, number: $('opt-number').checked,
            fanIn: $('opt-fanin').checked, sources: $('opt-sources').checked
        };
    }
    function showDiagnostics(list, extra) {
        var lines = (list || []).map(function (d) { return d.message; });
        if (extra)
            lines.push(extra);
        showMsg(lines.join('\n'), 'warn');
    }
    function setAnalysisHealth(confidence, coverage, diagnosticCount) {
        confidence = isFinite(confidence) ? confidence : 0;
        coverage = isFinite(coverage) ? coverage : 0;
        diagnosticCount = diagnosticCount || 0;
        $('confidence-val').textContent = Math.round(confidence * 100) + '%';
        $('coverage-val').textContent = Math.round(coverage * 100) + '%';
        $('diagnostic-val').textContent = diagnosticCount;
        var score = Math.min(confidence, coverage);
        $('analysis-health').setAttribute('data-band', score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low');
        $('analysis-health').title = 'Confidence combines dialect certainty, parser coverage, and error diagnostics.';
    }
    function estateHealth(currentEstate) {
        var objects = currentEstate && currentEstate.objects || [];
        if (!objects.length)
            return { confidence: 0, coverage: 0, diagnostics: 0 };
        var confidence = 1, consumed = 0, total = 0, diagnostics = 0;
        objects.forEach(function (o) {
            var r = o.result;
            confidence = Math.min(confidence, r.confidence);
            consumed += r.consumedTokens;
            total += r.totalTokens;
            diagnostics += r.diagnostics.length;
        });
        return { confidence: confidence, coverage: total ? consumed / total : 1, diagnostics: diagnostics };
    }
    function populateObjects() {
        var picker = $('object-select'), label = $('lbl-object');
        picker.innerHTML = '';
        (estate && estate.objects || []).forEach(function (o) {
            var option = document.createElement('option');
            option.value = o.id;
            option.textContent = o.name + ' — ' + o.kind + (o.file ? ' · ' + o.file : '');
            picker.appendChild(option);
        });
        label.hidden = !(estate && estate.objects.length > 1);
        if (activeObjectId)
            picker.value = activeObjectId;
    }
    function activeObject() {
        if (!estate || !estate.objects.length)
            return null;
        return estate.objects.filter(function (o) { return o.id === activeObjectId; })[0] || estate.objects[0];
    }
    function loadObjectSource(object) {
        if (!object)
            return;
        sql.value = object.source;
        drawGutter();
        $('object-select').value = object.id;
    }
    function run() {
        var text = sql.value;
        if (!text.trim() && !(workspaceFiles && workspaceFiles.length)) {
            showMsg('');
            out.textContent = 'flowchart TD';
            stage.innerHTML = '<div class="empty"><p>Paste SQL on the left. The flowchart updates automatically as you work.</p></div>';
            stage.classList.add('empty-stage');
            setStats('flow', { stmt: 0, branch: 0, loop: 0, cat: 0, exit: 0, depth: 0, cc: 1 });
            setAnalysisHealth(0, 0, 0);
            $('proc-name').textContent = '';
            $('lbl-object').hidden = true;
            lastCode = '';
            lastGraph = null;
            lastTitle = '';
            lastResult = null;
            estate = null;
            return;
        }
        var opts = analysisOptions(), object, result, scope = $('opt-scope').value;
        try {
            if (!workspaceFiles)
                workspaceFiles = [{ name: 'Pasted SQL', text: text }];
            estate = analyseEstate(workspaceFiles, opts);
            if (!activeObjectId || !estate.objects.some(function (o) { return o.id === activeObjectId; }))
                activeObjectId = estate.objects.length ? estate.objects[0].id : null;
            populateObjects();
            object = activeObject();
            if (object && sql.value !== object.source)
                loadObjectSource(object);
        }
        catch (err) {
            showMsg('Could not read that SQL: ' + err.message);
            return;
        }
        if (scope === 'dependencies') {
            var dependencyCode = toMermaid(estate.graph, opts.dir || 'TD');
            $('opt-view').disabled = true;
            $('lbl-group').style.display = 'none';
            $('lbl-number').style.display = 'none';
            $('lbl-fanin').style.display = 'none';
            $('lbl-sources').style.display = 'none';
            $('proc-name').textContent = 'Estate · ' + estate.objects.length + ' object' + (estate.objects.length === 1 ? '' : 's');
            setStats('dependencies', estate.stats);
            var health = estateHealth(estate);
            setAnalysisHealth(health.confidence, health.coverage, health.diagnostics);
            showDiagnostics(estate.diagnostics);
            out.textContent = dependencyCode;
            lastCode = dependencyCode;
            lastGraph = estate.graph;
            lastResult = null;
            lastTitle = 'procflow-estate';
            lastDirection = opts.dir || 'TD';
            render(dependencyCode, estate.graph);
            return;
        }
        $('opt-view').disabled = false;
        if (!object)
            return;
        result = object.result;
        var st = result.stats;
        $('opt-dialect').options[0].textContent =
            'Detect — ' + (DIALECT_NAMES[result.detected.dialect] || 'T-SQL');
        $('opt-view').options[0].textContent =
            'Auto — ' + (result.mode === 'query' ? 'query structure' : 'control flow');
        var flow = result.mode !== 'query';
        $('lbl-group').style.display = flow ? '' : 'none';
        $('lbl-number').style.display = flow ? '' : 'none';
        $('lbl-fanin').style.display = flow ? '' : 'none';
        $('lbl-sources').style.display = flow ? 'none' : '';
        $('opt-fanin').disabled = flow && !st.cat;
        $('lbl-fanin').classList.toggle('off', flow && !st.cat);
        showDiagnostics(result.diagnostics, result.mode === 'flow' && result.dialect === 'sqlite' && st.branch + st.loop + st.cat === 0
            ? 'SQLite has no procedural language: only triggers with an optional WHEN, and plain statements. A straight line here is the truth, not a failure to read it.'
            : '');
        $('proc-name').textContent = result.header.name || '';
        setStats(result.mode, st);
        setAnalysisHealth(result.confidence, result.coverage, result.diagnostics.length);
        out.textContent = result.mermaid;
        lastCode = result.mermaid;
        lastDialect = result.dialect;
        lastGraph = result.graph;
        lastResult = result;
        lastTitle = result.header.name || 'procflow';
        lastDirection = opts.dir || 'TD';
        render(result.mermaid, result.graph);
    }
    function highlightSource(span) {
        if (!span || span.start === undefined || span.end === undefined)
            return;
        var start = Math.max(0, Math.min(sql.value.length, span.start));
        var end = Math.max(start, Math.min(sql.value.length, span.end));
        sql.focus();
        sql.setSelectionRange(start, end);
        var line = sql.value.slice(0, start).split('\n').length - 1;
        sql.scrollTop = Math.max(0, line * 20 - 80);
        gutter.scrollTop = sql.scrollTop;
    }
    function attachNodeLinks(graph) {
        var elements = stage.querySelectorAll('.node');
        Array.prototype.forEach.call(elements, function (el) {
            var node = (graph.nodes || []).filter(function (n) {
                return el.id === n.id || el.id.indexOf('-' + n.id + '-') >= 0;
            })[0];
            if (!node || (!node.source && !node.objectId))
                return;
            if (node.source) {
                el.setAttribute('data-source-start', String(node.source.start));
                el.setAttribute('data-source-end', String(node.source.end));
            }
            if (node.objectId)
                el.setAttribute('data-object-id', node.objectId);
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');
            var open = function (e) {
                e.stopPropagation();
                if (node.objectId) {
                    activeObjectId = node.objectId;
                    var object = activeObject();
                    loadObjectSource(object);
                    $('opt-scope').value = 'internal';
                    run();
                }
                else
                    highlightSource(node.source);
            };
            el.addEventListener('click', open);
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open(e);
                }
            });
        });
    }
    function render(code, graph) {
        if (typeof mermaid === 'undefined') {
            showMsg('Mermaid could not be loaded. The Mermaid tab still holds your diagram source.');
            return;
        }
        var ticket = ++renderSeq, id = 'g' + Date.now() + '-' + ticket;
        try {
            mermaid.render(id, code).then(function (res) {
                if (ticket !== renderSeq)
                    return;
                stage.classList.remove('empty-stage');
                stage.innerHTML = res.svg;
                attachNodeLinks(graph || lastGraph);
                fit();
            }).catch(function (e) {
                if (ticket !== renderSeq)
                    return;
                showMsg('Mermaid could not draw this chart: ' + (e && e.message ? e.message : e) +
                    '\n\nThe Mermaid tab still holds the source.');
            });
        }
        catch (e) {
            showMsg('Mermaid could not draw this chart: ' + e.message);
        }
    }
    /* zoom + pan */
    function apply() { stage.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')'; }
    function fit() {
        var svg = stage.querySelector('svg');
        scale = 1;
        panX = 0;
        panY = 0;
        if (svg) {
            var bb = svg.getBoundingClientRect(), cb = canvas.getBoundingClientRect();
            var s = Math.min(1, (cb.width - 40) / (bb.width || 1), (cb.height - 40) / (bb.height || 1));
            scale = Math.max(0.15, s);
        }
        apply();
    }
    $('z-in').onclick = function () { scale = Math.min(4, scale * 1.2); apply(); };
    $('z-out').onclick = function () { scale = Math.max(0.1, scale / 1.2); apply(); };
    $('z-fit').onclick = fit;
    var dragging = false, sx = 0, sy = 0;
    canvas.addEventListener('mousedown', function (e) { dragging = true; sx = e.clientX - panX; sy = e.clientY - panY; canvas.classList.add('dragging'); });
    window.addEventListener('mousemove', function (e) { if (!dragging)
        return; panX = e.clientX - sx; panY = e.clientY - sy; apply(); });
    window.addEventListener('mouseup', function () { dragging = false; canvas.classList.remove('dragging'); });
    canvas.addEventListener('wheel', function (e) {
        if (!e.ctrlKey && !e.metaKey)
            return;
        e.preventDefault();
        scale = Math.max(0.1, Math.min(4, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
        apply();
    }, { passive: false });
    /* tabs */
    function tab(which) {
        var chart = which === 'chart';
        $('tab-chart').setAttribute('aria-selected', String(chart));
        $('tab-code').setAttribute('aria-selected', String(!chart));
        $('view-chart').classList.toggle('active', chart);
        $('view-code').classList.toggle('active', !chart);
    }
    $('tab-chart').onclick = function () { tab('chart'); };
    $('tab-code').onclick = function () { tab('code'); };
    /* actions */
    $('btn-analysis-details').onclick = function () {
        var panel = $('analysis-details'), expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', String(!expanded));
        panel.hidden = expanded;
    };
    var commandMenus = document.querySelectorAll('.command-menu');
    Array.prototype.forEach.call(commandMenus, function (menu) {
        menu.addEventListener('toggle', function () {
            if (!menu.open)
                return;
            Array.prototype.forEach.call(commandMenus, function (other) {
                if (other !== menu)
                    other.open = false;
            });
        });
    });
    document.addEventListener('click', function (e) {
        if (e.target.closest('.command-menu'))
            return;
        Array.prototype.forEach.call(commandMenus, function (menu) { menu.open = false; });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape')
            return;
        Array.prototype.forEach.call(commandMenus, function (menu) { menu.open = false; });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.menu-action'), function (action) {
        action.addEventListener('click', function () {
            Array.prototype.forEach.call(commandMenus, function (menu) { menu.open = false; });
        });
    });
    $('btn-draw').onclick = run;
    $('btn-import').onclick = function () { $('file-input').click(); };
    $('file-input').onchange = function () {
        var files = Array.prototype.slice.call(this.files || []);
        if (!files.length)
            return;
        Promise.all(files.map(function (file) {
            return file.text().then(function (text) { return { name: file.name, text: text }; });
        })).then(function (loaded) {
            workspaceFiles = loaded;
            estate = null;
            activeObjectId = null;
            run();
        }).catch(function (err) { showMsg('Could not read those files: ' + err.message); });
        this.value = '';
    };
    $('btn-sample').onclick = function () {
        var d = $('opt-dialect').value;
        workspaceFiles = null;
        estate = null;
        activeObjectId = null;
        sql.value = SAMPLES[d] || SAMPLES.tsql;
        drawGutter();
        run();
    };
    $('btn-clear').onclick = function () {
        workspaceFiles = null;
        estate = null;
        activeObjectId = null;
        sql.value = '';
        drawGutter();
        run();
        sql.focus();
    };
    $('opt-dir').onchange = run;
    $('opt-detail').onchange = run;
    $('opt-group').onchange = run;
    $('opt-dialect').onchange = run;
    $('opt-view').onchange = run;
    $('opt-sources').onchange = run;
    $('opt-number').onchange = run;
    $('opt-fanin').onchange = run;
    $('opt-scope').onchange = run;
    $('object-select').onchange = function () {
        activeObjectId = this.value;
        loadObjectSource(activeObject());
        run();
    };
    $('btn-copy').onclick = function () {
        var b = $('btn-copy'), old = b.textContent;
        navigator.clipboard.writeText(lastCode || out.textContent).then(function () {
            b.textContent = 'Copied';
            setTimeout(function () { b.textContent = old; }, 1400);
        }, function () { b.textContent = 'Copy failed'; setTimeout(function () { b.textContent = old; }, 1400); });
    };
    function flash(btn, word) {
        var old = btn.textContent;
        btn.textContent = word;
        setTimeout(function () { btn.textContent = old; }, 1500);
    }
    $('btn-narrate').onclick = function () {
        var b = $('btn-narrate');
        if (!lastCode) {
            showMsg('Draw a chart first — the prompt carries the extracted structure with it.');
            return;
        }
        var selectedDialect = $('opt-dialect').value === 'auto'
            ? lastDialect : $('opt-dialect').value;
        var text = narrationPrompt(lastCode, sql.value, selectedDialect);
        navigator.clipboard.writeText(text).then(function () { flash(b, 'Copied — paste into any model'); }, function () { flash(b, 'Copy failed'); });
    };
    $('btn-svg').onclick = function () {
        var svg = stage.querySelector('svg');
        if (!svg) {
            showMsg('Draw a chart first, then it can be saved.');
            return;
        }
        var data = new XMLSerializer().serializeToString(svg);
        var blob = new Blob([data], { type: 'image/svg+xml' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ($('proc-name').textContent || 'procflow').replace(/[^\w.-]/g, '_') + '.svg';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    };
    $('btn-drawio').onclick = function () {
        if (!lastGraph) {
            showMsg('Draw a chart first, then it can be exported to draw.io.');
            return;
        }
        var data = toDrawio(lastGraph, { title: lastTitle, dir: lastDirection });
        var blob = new Blob([data], { type: 'application/xml' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (lastTitle || 'procflow').replace(/[^\w.-]/g, '_') + '.drawio';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    };
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
            startOnLoad: false, theme: 'base', securityLevel: 'strict',
            flowchart: { htmlLabels: true, curve: 'basis', nodeSpacing: 34, rankSpacing: 44, useMaxWidth: false },
            themeVariables: {
                background: '#111a21', primaryColor: '#1e2b35', primaryTextColor: '#e7eef3',
                primaryBorderColor: '#516878', lineColor: '#7c93a5', tertiaryColor: '#18232c',
                fontFamily: 'IBM Plex Sans, system-ui, sans-serif', fontSize: '13px'
            }
        });
    }
    drawGutter();
})();
//# sourceMappingURL=app.js.map