"use strict";
/* proc>flow v2.4.0 — ERD query-builder panel.
   Query mode turns column rows on the diagram cards into checkboxes and shows
   a floating window with the SQL, the join plan, and any unjoinable picks.
   Join problems are never resolved silently: each one offers teach-the-join,
   an explicit CROSS JOIN, or leaving the table out. */
(function () {
    if (typeof document === 'undefined')
        return;
    var $ = function (id) { return document.getElementById(id); };
    var floatEl = $('qb-float'), bodyEl = $('qb-float-body'), planEl = $('qb-plan-body'), picksEl = $('qb-picks'), summaryEl = $('qb-summary'), sqlEl = $('qb-sql-out'), dialectEl = $('qb-dialect'), commentsEl = $('qb-comments'), copyBtn = $('btn-qb-copy'), clearBtn = $('btn-qb-clear'), toggleBtn = $('btn-erd-query'), countEl = $('erd-query-count'), closeBtn = $('btn-qb-close'), collapseBtn = $('btn-qb-collapse'), dragEl = $('qb-drag'), resizeEl = $('qb-resize'), distinctEl = $('qb-distinct'), limitEl = $('qb-limit'), onlyUsedEl = $('qb-only-used'), teachBtn = $('btn-qb-teach');
    if (!planEl || !sqlEl || !floatEl || !toggleBtn)
        return;
    var active = false;
    var schema = null;
    var graph = null;
    var entityById = {};
    var columnKeys = {};
    var picks = [];
    var manual = [];
    var cross = {};
    var excluded = {};
    var joinTypes = {};
    var pathChoices = {};
    var drafts = {};
    var dialect = 'tsql';
    var withComments = true;
    var distinct = false;
    var rowLimit = 0;
    var onlyUsed = false;
    var teaching = false;
    var teachFirst = null;
    var sorts = [];
    var plan = null;
    var focusEntity = null;
    var manualSeq = 0;
    function keyOf(entityId, column) {
        return entityId + '|' + schemaNormColumn(column);
    }
    function splitValue(value) {
        var cut = String(value || '').indexOf('|');
        if (cut < 0)
            return { id: '', column: '' };
        return { id: value.slice(0, cut), column: value.slice(cut + 1) };
    }
    function buildIndexes(result) {
        entityById = {};
        columnKeys = {};
        result.entities.forEach(function (entity) {
            entityById[entity.id] = entity;
            var columns = {};
            entity.columns.forEach(function (column) {
                columns[schemaNormColumn(column.name)] = 1;
            });
            columnKeys[entity.id] = columns;
        });
    }
    /* ===== diagram decoration ===== */
    function state() {
        var pickedKeys = {};
        var counted = {};
        picks.forEach(function (entry) {
            pickedKeys[keyOf(entry.entityId, entry.column)] = 1;
            counted[entry.entityId] = (counted[entry.entityId] || 0) + 1;
        });
        var usedEdges = {};
        var usedTables = {};
        var problemTables = {};
        if (active && plan && plan.fromId) {
            plan.usedIds.forEach(function (id) { usedTables[id] = 1; });
            plan.joins.forEach(function (join) {
                if (join.edgeId)
                    usedEdges[join.edgeId] = 1;
            });
            plan.problems.forEach(function (problem) {
                problem.entityIds.forEach(function (id) { problemTables[id] = 1; });
            });
        }
        return { active: active,
            teaching: active && teaching,
            teachFirstKey: active && teaching && teachFirst
                ? teachFirst.entityId + '|' + schemaNormColumn(teachFirst.column)
                : undefined,
            pickedKeys: active ? pickedKeys : {},
            picked: active ? counted : {},
            usedEdges: usedEdges,
            usedTables: usedTables,
            problemTables: problemTables };
    }
    /* Checkbox state, badges, and rings are applied here rather than at card
       build time, so a pick update never rebuilds the whole diagram. */
    function decorate() {
        var current = state();
        var filterUsed = active && onlyUsed;
        document.body.classList.toggle('qb-teaching', !!current.teaching);
        var cardsHost = document.getElementById('erd-cards');
        if (cardsHost)
            cardsHost.classList.toggle('qb-only-used', filterUsed);
        var cards = document.querySelectorAll('#erd-cards .erd-card');
        Array.prototype.forEach.call(cards, function (card) {
            var id = card.getAttribute('data-entity-id') || '';
            var pickedCount = current.picked[id] || 0;
            card.classList.toggle('qb-picked-card', pickedCount > 0);
            card.classList.toggle('qb-problem-card', !!current.problemTables[id]);
            card.classList.toggle('qb-used-card', filterUsed &&
                (!!current.usedTables[id] || !!current.problemTables[id]));
            Array.prototype.forEach.call(card.querySelectorAll('input.qb-pick'), function (box) {
                var column = box.getAttribute('data-column') || '';
                box.checked = !!current.pickedKeys[id + '|' + schemaNormColumn(column)];
            });
            Array.prototype.forEach.call(card.querySelectorAll('.erd-cols li[data-column]'), function (row) {
                var column = row.getAttribute('data-column') || '';
                row.classList.toggle('qb-picked', !!current.pickedKeys[id + '|' + schemaNormColumn(column)]);
                row.classList.toggle('qb-teach-first', !!current.teachFirstKey &&
                    current.teachFirstKey === id + '|' + schemaNormColumn(column));
            });
            var badge = card.querySelector('.erd-qbcount');
            if (pickedCount) {
                if (!badge) {
                    badge = document.createElement('b');
                    badge.className = 'erd-qbcount';
                    var head = card.querySelector('header');
                    var pin = head ? head.querySelector('.erd-pin') : null;
                    if (head) {
                        if (pin)
                            head.insertBefore(badge, pin);
                        else
                            head.appendChild(badge);
                    }
                }
                badge.textContent = pickedCount + ' picked';
            }
            else if (badge && badge.parentNode) {
                badge.parentNode.removeChild(badge);
            }
        });
    }
    /* ===== picking ===== */
    function togglePick(entityId, column, on) {
        var key = keyOf(entityId, column);
        var next = [];
        picks.forEach(function (entry) {
            if (keyOf(entry.entityId, entry.column) !== key)
                next.push(entry);
        });
        picks = next;
        if (on) {
            picks.push({ entityId: entityId, column: column });
            delete excluded[entityId];
        }
        if (!on && !picks.some(function (entry) { return entry.entityId === entityId; })) {
            delete cross[entityId];
        }
        if (!on) {
            sorts = sorts.filter(function (sort) {
                return !(sort.entityId === entityId &&
                    schemaNormColumn(sort.column) === schemaNormColumn(column));
            });
        }
        refresh();
    }
    function removePickAt(index) {
        if (index < 0 || index >= picks.length)
            return;
        var entry = picks[index];
        togglePick(entry.entityId, entry.column, false);
    }
    /* Chip sort cycles none → ascending → descending → none. */
    function cycleSort(index) {
        var entry = picks[index];
        if (!entry)
            return;
        var norm = schemaNormColumn(entry.column);
        var existing = sorts.filter(function (sort) {
            return sort.entityId === entry.entityId &&
                schemaNormColumn(sort.column) === norm;
        })[0];
        if (!existing) {
            sorts.push({ entityId: entry.entityId, column: entry.column, direction: 'asc' });
        }
        else if (existing.direction === 'asc') {
            existing.direction = 'desc';
        }
        else {
            sorts = sorts.filter(function (sort) { return sort !== existing; });
        }
        refresh();
    }
    function renderChips() {
        if (!picksEl)
            return;
        picksEl.textContent = '';
        picks.forEach(function (entry, index) {
            var entity = entityById[entry.entityId];
            var name = entity ? entity.name : entry.entityId;
            var chip = document.createElement('span');
            chip.className = 'qb-chip';
            var label = document.createElement('button');
            label.type = 'button';
            label.className = 'qb-chip-name';
            label.textContent = name + '.' + entry.column;
            label.title = 'Show ' + name + ' on the diagram';
            label.setAttribute('data-action', 'reveal');
            label.setAttribute('data-index', String(index));
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'qb-chip-x';
            remove.textContent = '×';
            remove.setAttribute('aria-label', 'Remove ' + name + '.' + entry.column);
            remove.setAttribute('data-action', 'remove');
            remove.setAttribute('data-index', String(index));
            var sort = sorts.filter(function (existing) {
                return existing.entityId === entry.entityId &&
                    schemaNormColumn(existing.column) === schemaNormColumn(entry.column);
            })[0];
            var sortBtn = document.createElement('button');
            sortBtn.type = 'button';
            sortBtn.className = 'qb-chip-sort' + (sort ? ' active' : '');
            sortBtn.textContent = sort ? (sort.direction === 'asc' ? '↑' : '↓') : '⇅';
            sortBtn.title = sort
                ? (sort.direction === 'asc'
                    ? 'Sorted ascending — click for descending'
                    : 'Sorted descending — click to clear')
                : 'Sort by this column';
            sortBtn.setAttribute('aria-label', sortBtn.title);
            sortBtn.setAttribute('data-action', 'sort');
            sortBtn.setAttribute('data-index', String(index));
            chip.appendChild(label);
            chip.appendChild(sortBtn);
            chip.appendChild(remove);
            picksEl.appendChild(chip);
        });
    }
    /* ===== join plan ===== */
    function joinConditionText(join) {
        if (join.kind === 'cross')
            return 'every row × every row';
        if (join.predicate)
            return join.predicate;
        var attachName = plan ? queryNameOf(plan.graph, join.attachToId) : join.attachToId;
        var targetName = plan ? queryNameOf(plan.graph, join.entityId) : join.entityId;
        var parts = [];
        var count = Math.min(join.leftColumns.length, join.rightColumns.length);
        for (var i = 0; i < count; i++) {
            parts.push(attachName + '.' + join.leftColumns[i] + ' = ' +
                targetName + '.' + join.rightColumns[i]);
        }
        return parts.join(' AND ');
    }
    function tag(text, className) {
        var tagEl = document.createElement('span');
        tagEl.className = 'qb-tag' + (className ? ' ' + className : '');
        tagEl.textContent = text;
        return tagEl;
    }
    function showButton(entityId) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn quiet';
        button.textContent = 'Show';
        button.setAttribute('data-action', 'focus');
        button.setAttribute('data-entity', entityId);
        button.title = 'Show this table on the diagram';
        return button;
    }
    function renderEmptyPlan() {
        var box = document.createElement('div');
        box.className = 'qb-empty';
        var title = document.createElement('h4');
        title.textContent = 'Pick columns on the diagram';
        var line = document.createElement('p');
        line.textContent = 'Every table card now shows a checkbox per column. ProcFlow follows declared FOREIGN KEY constraints to work out the joins while you pick.';
        var steps = document.createElement('ol');
        steps.className = 'qb-steps';
        ['Tick the columns you need.',
            'Watch the highlighted edges and the join plan below.',
            'Copy the SQL into your database client.'].forEach(function (text) {
            var item = document.createElement('li');
            item.textContent = text;
            steps.appendChild(item);
        });
        var hint = document.createElement('p');
        hint.className = 'qb-hint';
        hint.textContent = 'No foreign key between two tables? ProcFlow says so and lets you teach the join. It never invents one.';
        box.appendChild(title);
        box.appendChild(line);
        box.appendChild(steps);
        box.appendChild(hint);
        planEl.appendChild(box);
    }
    function renderAmbiguities() {
        if (!plan)
            return;
        plan.ambiguities.forEach(function (ambiguity) {
            var card = document.createElement('div');
            card.className = 'qb-join';
            var head = document.createElement('div');
            head.className = 'qb-join-head';
            var title = document.createElement('strong');
            title.className = 'qb-join-title';
            title.textContent = 'Two declared paths reach ' + queryNameOf(plan.graph, ambiguity.fromId);
            head.appendChild(title);
            head.appendChild(tag('choose a path', 'qb-tag-heuristic'));
            card.appendChild(head);
            var list = document.createElement('ul');
            list.className = 'qb-choices';
            var choiceKey = ambiguity.fromId + '=>' + ambiguity.toId;
            ambiguity.paths.forEach(function (path, index) {
                var item = document.createElement('li');
                var label = document.createElement('label');
                var radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'qb-ambiguity-' + choiceKey;
                radio.checked = index === ambiguity.chosenIndex;
                radio.setAttribute('data-role', 'path-choice');
                radio.setAttribute('data-key', choiceKey);
                radio.value = String(index);
                var text = document.createElement('span');
                text.textContent = ambiguity.summaries[index];
                label.appendChild(radio);
                label.appendChild(text);
                item.appendChild(label);
                list.appendChild(item);
            });
            card.appendChild(list);
            var note = document.createElement('p');
            note.className = 'qb-join-note';
            note.textContent = 'These joins mean different things. The first declared constraint is used until you pick another path.';
            card.appendChild(note);
            planEl.appendChild(card);
        });
    }
    function renderJoins() {
        if (!plan)
            return;
        plan.joins.forEach(function (join) {
            var card = document.createElement('div');
            card.className = 'qb-join';
            card.setAttribute('data-edge', join.edgeId || '');
            card.setAttribute('data-attach', join.attachToId);
            card.setAttribute('data-entity', join.entityId);
            var head = document.createElement('div');
            head.className = 'qb-join-head';
            if (join.kind === 'cross') {
                head.appendChild(tag('cross join', 'qb-tag-cross'));
            }
            else {
                var select = document.createElement('select');
                select.setAttribute('data-role', 'join-type');
                select.setAttribute('data-join', join.id);
                select.setAttribute('aria-label', 'Join type');
                [['inner', 'INNER JOIN'], ['left', 'LEFT JOIN']].forEach(function (option) {
                    var item = document.createElement('option');
                    item.value = option[0];
                    item.textContent = option[1];
                    select.appendChild(item);
                });
                select.value = join.joinType;
                head.appendChild(select);
            }
            var title = document.createElement('span');
            title.className = 'qb-join-title';
            title.textContent = queryNameOf(plan.graph, join.attachToId) + ' → ' +
                queryNameOf(plan.graph, join.entityId);
            head.appendChild(title);
            if (join.bridge)
                head.appendChild(tag('bridge', 'qb-tag-bridge'));
            if (join.kind === 'manual')
                head.appendChild(tag('taught · not declared', 'qb-tag-manual'));
            if (join.kind === 'declared' && join.resolution === 'heuristic') {
                head.appendChild(tag('name-matched FK', 'qb-tag-heuristic'));
            }
            head.appendChild(showButton(join.entityId));
            card.appendChild(head);
            var condition = document.createElement('p');
            condition.className = 'qb-join-cond';
            condition.textContent = joinConditionText(join);
            card.appendChild(condition);
            var note = document.createElement('p');
            note.className = 'qb-join-note';
            note.textContent = join.explanation;
            card.appendChild(note);
            if (join.selfJoin) {
                var pickedColumns = picks.filter(function (entry) {
                    return entry.entityId === join.entityId;
                });
                if (pickedColumns.length) {
                    var copyBox = document.createElement('div');
                    copyBox.className = 'qb-copy';
                    var copyLabel = document.createElement('p');
                    copyLabel.className = 'qb-copy-label';
                    copyLabel.textContent = 'Read from the second copy:';
                    copyBox.appendChild(copyLabel);
                    var copyList = document.createElement('ul');
                    copyList.className = 'qb-copy-list';
                    pickedColumns.forEach(function (entry) {
                        var item = document.createElement('li');
                        var label = document.createElement('label');
                        var box = document.createElement('input');
                        box.type = 'checkbox';
                        box.checked = (join.copyColumns || []).some(function (name) {
                            return schemaNormColumn(name) === schemaNormColumn(entry.column);
                        });
                        box.setAttribute('data-role', 'copy-column');
                        box.setAttribute('data-join', join.manualId || '');
                        box.setAttribute('data-column', entry.column);
                        var text = document.createElement('span');
                        text.textContent = entry.column;
                        label.appendChild(box);
                        label.appendChild(text);
                        item.appendChild(label);
                        copyList.appendChild(item);
                    });
                    copyBox.appendChild(copyList);
                    card.appendChild(copyBox);
                    if (!join.copyColumns || !join.copyColumns.length) {
                        var hint = document.createElement('p');
                        hint.className = 'qb-join-note';
                        hint.textContent = 'All picked columns currently come from the first copy.';
                        card.appendChild(hint);
                    }
                }
            }
            planEl.appendChild(card);
        });
    }
    function columnOptions() {
        var frag = document.createDocumentFragment();
        if (!graph)
            return frag;
        graph.order.forEach(function (id) {
            var node = graph.nodes[id];
            var group = document.createElement('optgroup');
            group.label = node.name;
            node.columns.forEach(function (column) {
                var option = document.createElement('option');
                option.value = id + '|' + column;
                option.textContent = column;
                group.appendChild(option);
            });
            frag.appendChild(group);
        });
        return frag;
    }
    function draftFor(problem) {
        var key = problem.entityIds[0];
        if (!drafts[key]) {
            var leftId = problem.entityIds[0];
            var leftEntity = entityById[leftId];
            var rightId = (plan && plan.usedIds.length ? plan.usedIds[0] : null) ||
                (graph ? graph.order.filter(function (id) {
                    return problem.entityIds.indexOf(id) < 0;
                })[0] : '') || '';
            var rightEntity = entityById[rightId];
            drafts[key] = {
                left: leftId + '|' + (leftEntity && leftEntity.columns.length ? leftEntity.columns[0].name : ''),
                right: rightId + '|' + (rightEntity && rightEntity.columns.length ? rightEntity.columns[0].name : ''),
                predicate: '',
                usePredicate: false
            };
        }
        return drafts[key];
    }
    function renderProblems() {
        if (!plan)
            return;
        plan.problems.forEach(function (problem) {
            var key = problem.entityIds[0];
            var draft = draftFor(problem);
            var card = document.createElement('div');
            card.className = 'qb-problem';
            var title = document.createElement('h4');
            title.textContent = problem.title;
            var message = document.createElement('p');
            message.textContent = problem.message;
            var education = document.createElement('p');
            education.textContent = problem.education;
            card.appendChild(title);
            card.appendChild(message);
            card.appendChild(education);
            var row = document.createElement('div');
            row.className = 'qb-resolve';
            var left = document.createElement('select');
            left.setAttribute('data-role', 'teach-left');
            left.setAttribute('data-problem', key);
            left.setAttribute('aria-label', 'Table and column on the left');
            left.appendChild(columnOptions());
            left.value = draft.left;
            var equals = document.createElement('span');
            equals.textContent = '=';
            var right = document.createElement('select');
            right.setAttribute('data-role', 'teach-right');
            right.setAttribute('data-problem', key);
            right.setAttribute('aria-label', 'Table and column on the right');
            right.appendChild(columnOptions());
            right.value = draft.right;
            var teach = document.createElement('button');
            teach.type = 'button';
            teach.className = 'btn primary';
            teach.textContent = 'Add taught join';
            teach.setAttribute('data-action', 'teach');
            teach.setAttribute('data-problem', key);
            row.appendChild(left);
            row.appendChild(equals);
            row.appendChild(right);
            row.appendChild(teach);
            card.appendChild(row);
            var predicateToggle = document.createElement('label');
            predicateToggle.className = 'opt';
            var predicateBox = document.createElement('input');
            predicateBox.type = 'checkbox';
            predicateBox.checked = !!draft.usePredicate;
            predicateBox.setAttribute('data-role', 'use-predicate');
            predicateBox.setAttribute('data-problem', key);
            var predicateText = document.createElement('span');
            predicateText.textContent = 'Use a typed predicate instead';
            predicateToggle.appendChild(predicateBox);
            predicateToggle.appendChild(predicateText);
            card.appendChild(predicateToggle);
            if (draft.usePredicate) {
                var predicate = document.createElement('input');
                predicate.type = 'text';
                predicate.className = 'qb-predicate';
                predicate.placeholder = 'e.g. a.CustomerId = b.CustomerId';
                predicate.value = draft.predicate;
                predicate.setAttribute('data-role', 'predicate');
                predicate.setAttribute('data-problem', key);
                predicate.setAttribute('aria-label', 'Join predicate');
                card.appendChild(predicate);
            }
            var actions = document.createElement('div');
            actions.className = 'qb-resolve';
            if (!teaching) {
                var teachClick = document.createElement('button');
                teachClick.type = 'button';
                teachClick.className = 'btn';
                teachClick.textContent = 'Teach by clicking columns';
                teachClick.setAttribute('data-action', 'teach-click');
                actions.appendChild(teachClick);
            }
            var crossBtn = document.createElement('button');
            crossBtn.type = 'button';
            crossBtn.className = 'btn';
            crossBtn.textContent = 'Every combination (CROSS JOIN)';
            crossBtn.setAttribute('data-action', 'cross');
            crossBtn.setAttribute('data-problem', key);
            var leaveBtn = document.createElement('button');
            leaveBtn.type = 'button';
            leaveBtn.className = 'btn quiet';
            leaveBtn.textContent = 'Leave these columns out';
            leaveBtn.setAttribute('data-action', 'exclude');
            leaveBtn.setAttribute('data-problem', key);
            actions.appendChild(crossBtn);
            actions.appendChild(leaveBtn);
            card.appendChild(actions);
            planEl.appendChild(card);
        });
    }
    function renderLearn() {
        if (!plan || !plan.education.length)
            return;
        var details = document.createElement('details');
        details.className = 'qb-learn';
        var summary = document.createElement('summary');
        summary.textContent = 'How these joins were chosen';
        details.appendChild(summary);
        var list = document.createElement('ul');
        plan.education.forEach(function (line) {
            var item = document.createElement('li');
            item.textContent = line;
            list.appendChild(item);
        });
        details.appendChild(list);
        planEl.appendChild(details);
    }
    function renderSummary() {
        if (!summaryEl)
            return;
        if (!plan || !plan.fromId) {
            summaryEl.textContent = '';
            return;
        }
        var parts = [];
        parts.push(plan.usedIds.length + ' table' + (plan.usedIds.length === 1 ? '' : 's'));
        parts.push(plan.joins.length + ' join' + (plan.joins.length === 1 ? '' : 's'));
        if (plan.bridges.length)
            parts.push(plan.bridges.length + ' bridge');
        if (plan.problems.length) {
            parts.push(plan.problems.length +
                (plan.problems.length === 1 ? ' table unjoined' : ' tables unjoined'));
        }
        summaryEl.textContent = parts.join(' · ');
    }
    function renderPlanBody() {
        planEl.textContent = '';
        if (!plan || !plan.fromId) {
            renderEmptyPlan();
            return;
        }
        if (teaching) {
            var banner = document.createElement('div');
            banner.className = 'qb-teach-banner';
            var bannerText = document.createElement('span');
            bannerText.textContent = teachFirst
                ? 'First column set (' + queryNameOf(plan.graph, teachFirst.entityId) + '.' +
                    teachFirst.column + '). Click the matching column on the other table — or on the same table for a self join.'
                : 'Click the first column of the join condition on the diagram.';
            var bannerCancel = document.createElement('button');
            bannerCancel.type = 'button';
            bannerCancel.className = 'qb-tip-action';
            bannerCancel.textContent = 'Cancel';
            bannerCancel.setAttribute('data-action', 'cancel-teach');
            banner.appendChild(bannerText);
            banner.appendChild(bannerCancel);
            planEl.appendChild(banner);
        }
        renderAmbiguities();
        renderJoins();
        renderProblems();
        if (plan.warnings.length) {
            plan.warnings.forEach(function (warning) {
                var line = document.createElement('p');
                line.className = 'qb-verify';
                line.textContent = '⚠ ' + warning;
                planEl.appendChild(line);
            });
        }
        if (!distinct && plan.warnings.some(function (warning) {
            return warning.indexOf('repeat rows') >= 0;
        })) {
            var tip = document.createElement('p');
            tip.className = 'qb-tip';
            var tipText = document.createElement('span');
            tipText.textContent = 'Tip: Distinct can collapse rows repeated by one-to-many joins. ';
            var tipAction = document.createElement('button');
            tipAction.type = 'button';
            tipAction.className = 'qb-tip-action';
            tipAction.textContent = 'Turn on Distinct';
            tipAction.setAttribute('data-action', 'set-distinct');
            tip.appendChild(tipText);
            tip.appendChild(tipAction);
            planEl.appendChild(tip);
        }
        renderLearn();
    }
    var QUERY_SQL_TOKEN_CLASSES = { keyword: 'sql-kw',
        comment: 'sql-comment', string: 'sql-str', ident: 'sql-ident', number: 'sql-num',
        punct: 'sql-punct' };
    function renderSql() {
        var text = '';
        if (plan && plan.fromId) {
            text = queryPlanSQL(plan, { dialect: dialect, comments: withComments,
                distinct: distinct, rowLimit: rowLimit, orderBy: sorts });
        }
        if (!text) {
            sqlEl.textContent = '-- Pick columns on the diagram to generate SQL.';
            if (copyBtn)
                copyBtn.disabled = true;
            return;
        }
        sqlEl.textContent = '';
        var frag = document.createDocumentFragment();
        queryTokenizeSQL(text).forEach(function (token) {
            var className = QUERY_SQL_TOKEN_CLASSES[token.kind];
            if (!className) {
                frag.appendChild(document.createTextNode(token.text));
                return;
            }
            var span = document.createElement('span');
            span.className = className;
            span.textContent = token.text;
            frag.appendChild(span);
        });
        sqlEl.appendChild(frag);
        if (copyBtn)
            copyBtn.disabled = false;
    }
    function renderCount() {
        if (!countEl)
            return;
        countEl.hidden = !picks.length;
        countEl.textContent = picks.length ? String(picks.length) : '';
        if (teachBtn) {
            teachBtn.disabled = !picks.length;
            if (!picks.length && teaching)
                cancelTeaching();
        }
    }
    function refresh() {
        var scrollTop = bodyEl ? bodyEl.scrollTop : 0;
        plan = active && schema ? queryBuildPlan({
            result: schema,
            selections: picks,
            manual: manual,
            cross: Object.keys(cross),
            excluded: Object.keys(excluded),
            joinTypes: joinTypes,
            pathChoices: pathChoices
        }) : null;
        renderSummary();
        renderChips();
        renderPlanBody();
        renderSql();
        renderCount();
        decorate();
        if (bodyEl)
            bodyEl.scrollTop = scrollTop;
        document.dispatchEvent(new CustomEvent('procflow-query-changed'));
    }
    /* ===== actions ===== */
    function startTeaching() {
        teaching = true;
        teachFirst = null;
        if (teachBtn)
            teachBtn.setAttribute('aria-pressed', 'true');
        refresh();
    }
    function cancelTeaching() {
        teaching = false;
        teachFirst = null;
        if (teachBtn)
            teachBtn.setAttribute('aria-pressed', 'false');
        refresh();
    }
    /* One diagram click sets the first column; the second click completes the
       join. Two clicks on the same table create a self join. */
    function teachColumn(entityId, column) {
        if (!teaching)
            return;
        if (!teachFirst) {
            teachFirst = { entityId: entityId, column: column };
            refresh();
            return;
        }
        if (teachFirst.entityId === entityId &&
            schemaNormColumn(teachFirst.column) === schemaNormColumn(column)) {
            return;
        }
        manualSeq++;
        manual.push({ id: 'm' + manualSeq,
            leftId: teachFirst.entityId, leftColumn: teachFirst.column,
            rightId: entityId, rightColumn: column,
            selfColumns: teachFirst.entityId === entityId ? [] : undefined });
        teaching = false;
        teachFirst = null;
        if (teachBtn)
            teachBtn.setAttribute('aria-pressed', 'false');
        refresh();
    }
    function teachJoin(problemKey) {
        var draft = drafts[problemKey];
        if (!draft)
            return;
        var left = splitValue(draft.left), right = splitValue(draft.right);
        if (!left.id || !right.id || !left.column || !right.column)
            return;
        manualSeq++;
        var entry = { id: 'm' + manualSeq,
            leftId: left.id, leftColumn: left.column,
            rightId: right.id, rightColumn: right.column };
        if (draft.usePredicate && draft.predicate.trim()) {
            entry.predicate = draft.predicate.trim();
        }
        manual.push(entry);
        delete drafts[problemKey];
        refresh();
    }
    function crossJoin(problemKey) {
        if (!plan)
            return;
        var problem = plan.problems.filter(function (entry) {
            return entry.entityIds[0] === problemKey;
        })[0];
        if (!problem)
            return;
        cross[problem.entityIds[0]] = 1;
        delete drafts[problemKey];
        refresh();
    }
    function excludeProblem(problemKey) {
        if (!plan)
            return;
        var problem = plan.problems.filter(function (entry) {
            return entry.entityIds[0] === problemKey;
        })[0];
        if (!problem)
            return;
        problem.entityIds.forEach(function (id) {
            excluded[id] = 1;
            picks = picks.filter(function (entry) { return entry.entityId !== id; });
            manual = manual.filter(function (entry) {
                return entry.leftId !== id && entry.rightId !== id;
            });
            delete cross[id];
        });
        delete drafts[problemKey];
        refresh();
    }
    function copySql() {
        var text = sqlEl.textContent || '';
        if (!text || text.indexOf('-- Pick') === 0)
            return;
        var done = function () {
            if (!copyBtn)
                return;
            var old = copyBtn.textContent;
            copyBtn.textContent = 'Copied';
            setTimeout(function () { copyBtn.textContent = old; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        }
        else
            fallbackCopy(text, done);
    }
    function fallbackCopy(text, done) {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'absolute';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
            done();
        }
        catch (err) { /* clipboard unavailable */ }
        document.body.removeChild(area);
    }
    /* ===== mode ===== */
    function setActive(on) {
        active = on;
        toggleBtn.setAttribute('aria-pressed', String(on));
        floatEl.hidden = !on;
        document.body.classList.toggle('qb-active', on);
        if (!on) {
            floatEl.classList.remove('collapsed');
            teaching = false;
            teachFirst = null;
            if (teachBtn)
                teachBtn.setAttribute('aria-pressed', 'false');
            if (collapseBtn) {
                collapseBtn.textContent = '−';
                collapseBtn.setAttribute('aria-label', 'Collapse query builder');
                collapseBtn.title = 'Collapse';
            }
            if (dialectEl)
                dialectEl.value = dialect;
            if (commentsEl)
                commentsEl.checked = withComments;
            sqlEl.textContent = '';
        }
        document.dispatchEvent(new CustomEvent('procflow-query-mode', { detail: { active: on } }));
        refresh();
    }
    /* ===== schema changes ===== */
    function setSchema(result) {
        schema = result || null;
        if (!schema) {
            graph = null;
            picks = [];
            manual = [];
            cross = {};
            excluded = {};
            drafts = {};
            pathChoices = {};
            joinTypes = {};
            refresh();
            return;
        }
        buildIndexes(schema);
        graph = queryBuildGraph(schema);
        var valid = {};
        graph.order.forEach(function (id) { valid[id] = 1; });
        picks = picks.filter(function (entry) {
            return valid[entry.entityId] && columnKeys[entry.entityId] &&
                columnKeys[entry.entityId][schemaNormColumn(entry.column)];
        });
        sorts = sorts.filter(function (sort) {
            return picks.some(function (entry) {
                return entry.entityId === sort.entityId &&
                    schemaNormColumn(entry.column) === schemaNormColumn(sort.column);
            });
        });
        manual = manual.filter(function (entry) {
            return valid[entry.leftId] && valid[entry.rightId] &&
                columnKeys[entry.leftId][schemaNormColumn(entry.leftColumn)] &&
                columnKeys[entry.rightId][schemaNormColumn(entry.rightColumn)];
        });
        var nextCross = {};
        Object.keys(cross).forEach(function (id) { if (valid[id])
            nextCross[id] = 1; });
        cross = nextCross;
        var nextExcluded = {};
        Object.keys(excluded).forEach(function (id) { if (valid[id])
            nextExcluded[id] = 1; });
        excluded = nextExcluded;
        var nextDrafts = {};
        Object.keys(drafts).forEach(function (key) {
            if (valid[key])
                nextDrafts[key] = drafts[key];
        });
        drafts = nextDrafts;
        if (teachFirst && (!valid[teachFirst.entityId] ||
            !columnKeys[teachFirst.entityId] ||
            !columnKeys[teachFirst.entityId][schemaNormColumn(teachFirst.column)])) {
            teachFirst = null;
        }
        refresh();
    }
    /* ===== floating window drag and resize ===== */
    var dragging = false, dragStartX = 0, dragStartY = 0, dragOriginLeft = 0, dragOriginTop = 0;
    var resizing = false, resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;
    var QB_MIN_WIDTH = 320, QB_MIN_HEIGHT = 200;
    /* The panel starts anchored to the right edge; once moved or resized it
       becomes freely positioned so both operations feel the same. */
    function anchorToLeftTop() {
        var parent = floatEl.offsetParent;
        var rect = floatEl.getBoundingClientRect();
        var parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
        floatEl.style.left = (rect.left - parentRect.left) + 'px';
        floatEl.style.top = (rect.top - parentRect.top) + 'px';
        floatEl.style.right = 'auto';
    }
    function beginDrag(event) {
        if (event.button !== 0)
            return;
        var target = event.target;
        if (target && target.closest && target.closest('button'))
            return;
        anchorToLeftTop();
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragOriginLeft = parseFloat(floatEl.style.left) || 0;
        dragOriginTop = parseFloat(floatEl.style.top) || 0;
        dragging = true;
        floatEl.classList.add('dragging');
        try {
            if (dragEl && dragEl.setPointerCapture)
                dragEl.setPointerCapture(event.pointerId);
        }
        catch (_err) { /* pointer capture is best-effort */ }
    }
    function moveDrag(event) {
        if (!dragging)
            return;
        var parent = floatEl.offsetParent;
        var maxLeft = parent ? parent.clientWidth - 60 : 0;
        var maxTop = parent ? parent.clientHeight - 60 : 0;
        var left = Math.max(-40, Math.min(maxLeft, dragOriginLeft + event.clientX - dragStartX));
        var top = Math.max(0, Math.min(maxTop, dragOriginTop + event.clientY - dragStartY));
        floatEl.style.left = left + 'px';
        floatEl.style.top = top + 'px';
    }
    function endDrag() {
        if (!dragging)
            return;
        dragging = false;
        floatEl.classList.remove('dragging');
    }
    function beginResize(event) {
        if (event.button !== 0)
            return;
        event.preventDefault();
        var rect = floatEl.getBoundingClientRect();
        anchorToLeftTop();
        floatEl.style.maxHeight = 'none';
        floatEl.style.width = rect.width + 'px';
        floatEl.style.height = rect.height + 'px';
        resizeStartX = event.clientX;
        resizeStartY = event.clientY;
        resizeStartW = rect.width;
        resizeStartH = rect.height;
        resizing = true;
        floatEl.classList.add('dragging');
        try {
            if (resizeEl && resizeEl.setPointerCapture)
                resizeEl.setPointerCapture(event.pointerId);
        }
        catch (_err) { /* pointer capture is best-effort */ }
    }
    function moveResize(event) {
        if (!resizing)
            return;
        var parent = floatEl.offsetParent;
        var maxWidth = parent ? parent.clientWidth - 20 : 1200;
        var maxHeight = parent ? parent.clientHeight - 20 : 1200;
        var width = Math.max(QB_MIN_WIDTH, Math.min(maxWidth, resizeStartW + event.clientX - resizeStartX));
        var height = Math.max(QB_MIN_HEIGHT, Math.min(maxHeight, resizeStartH + event.clientY - resizeStartY));
        floatEl.style.width = width + 'px';
        floatEl.style.height = height + 'px';
    }
    function endResize() {
        if (!resizing)
            return;
        resizing = false;
        floatEl.classList.remove('dragging');
    }
    /* Keyboard resize keeps the grip usable without a pointer. */
    function resizeByKey(event) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) < 0)
            return;
        var step = event.shiftKey ? 40 : 16;
        var rect = floatEl.getBoundingClientRect();
        var width = rect.width, height = rect.height;
        if (event.key === 'ArrowRight')
            width += step;
        else if (event.key === 'ArrowLeft')
            width -= step;
        else if (event.key === 'ArrowDown')
            height += step;
        else
            height -= step;
        event.preventDefault();
        anchorToLeftTop();
        floatEl.style.maxHeight = 'none';
        floatEl.style.width = Math.max(QB_MIN_WIDTH, width) + 'px';
        floatEl.style.height = Math.max(QB_MIN_HEIGHT, height) + 'px';
    }
    /* Hovering a join card lights up the exact edge and both endpoint cards,
       so the panel and the diagram stay one surface. */
    function highlightJoin(cardEl, on) {
        var edge = cardEl.getAttribute('data-edge');
        if (edge) {
            var path = document.querySelector('#erd-overlay path[data-relationship="' + edge + '"]');
            if (path)
                path.classList.toggle('qb-hover', on);
        }
        ['data-attach', 'data-entity'].forEach(function (attr) {
            var id = cardEl.getAttribute(attr);
            if (!id)
                return;
            var diagramCard = document.querySelector('#erd-cards .erd-card[data-entity-id="' + id + '"]');
            if (diagramCard)
                diagramCard.classList.toggle('qb-hover-card', on);
        });
    }
    function init(options) {
        focusEntity = (options && options.focusEntity) || null;
        toggleBtn.addEventListener('click', function () { setActive(!active); });
        if (closeBtn)
            closeBtn.addEventListener('click', function () { setActive(false); });
        if (collapseBtn)
            collapseBtn.addEventListener('click', function () {
                var collapsed = floatEl.classList.toggle('collapsed');
                collapseBtn.textContent = collapsed ? '+' : '−';
                collapseBtn.setAttribute('aria-label', collapsed ? 'Expand query builder' : 'Collapse query builder');
                collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
            });
        if (dialectEl)
            dialectEl.addEventListener('change', function () {
                dialect = dialectEl.value;
                renderSql();
            });
        if (commentsEl)
            commentsEl.addEventListener('change', function () {
                withComments = !!commentsEl.checked;
                renderSql();
            });
        if (distinctEl)
            distinctEl.addEventListener('change', function () {
                distinct = !!distinctEl.checked;
                refresh();
            });
        if (limitEl)
            limitEl.addEventListener('change', function () {
                rowLimit = parseInt(limitEl.value, 10) || 0;
                refresh();
            });
        if (onlyUsedEl)
            onlyUsedEl.addEventListener('change', function () {
                onlyUsed = !!onlyUsedEl.checked;
                refresh();
            });
        if (teachBtn)
            teachBtn.addEventListener('click', function () {
                if (teaching)
                    cancelTeaching();
                else
                    startTeaching();
            });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && teaching)
                cancelTeaching();
        });
        if (copyBtn)
            copyBtn.addEventListener('click', copySql);
        if (clearBtn)
            clearBtn.addEventListener('click', function () {
                picks = [];
                manual = [];
                cross = {};
                excluded = {};
                joinTypes = {};
                pathChoices = {};
                drafts = {};
                sorts = [];
                refresh();
            });
        if (dragEl) {
            dragEl.addEventListener('pointerdown', beginDrag);
            dragEl.addEventListener('pointermove', moveDrag);
            dragEl.addEventListener('pointerup', endDrag);
            dragEl.addEventListener('pointercancel', endDrag);
        }
        if (resizeEl) {
            resizeEl.addEventListener('pointerdown', beginResize);
            resizeEl.addEventListener('pointermove', moveResize);
            resizeEl.addEventListener('pointerup', endResize);
            resizeEl.addEventListener('pointercancel', endResize);
            resizeEl.addEventListener('keydown', resizeByKey);
        }
        if (picksEl)
            picksEl.addEventListener('click', function (event) {
                var target = event.target;
                if (!target || !target.getAttribute)
                    return;
                var index = parseInt(target.getAttribute('data-index') || '', 10);
                var action = target.getAttribute('data-action');
                if (action === 'remove')
                    removePickAt(index);
                else if (action === 'sort')
                    cycleSort(index);
                else if (action === 'reveal') {
                    var entry = picks[index];
                    if (entry && focusEntity)
                        focusEntity(entry.entityId);
                }
            });
        planEl.addEventListener('mouseover', function (event) {
            var target = event.target;
            var card = target && target.closest
                ? target.closest('.qb-join[data-edge]') : null;
            if (!card)
                return;
            var related = event.relatedTarget;
            if (related && card.contains(related))
                return;
            highlightJoin(card, true);
        });
        planEl.addEventListener('mouseout', function (event) {
            var target = event.target;
            var card = target && target.closest
                ? target.closest('.qb-join[data-edge]') : null;
            if (!card)
                return;
            var related = event.relatedTarget;
            if (related && card.contains(related))
                return;
            highlightJoin(card, false);
        });
        planEl.addEventListener('change', function (event) {
            var target = event.target;
            if (!target || !target.getAttribute)
                return;
            var role = target.getAttribute('data-role');
            if (role === 'join-type') {
                var joinId = target.getAttribute('data-join');
                if (joinId)
                    joinTypes[joinId] = target.value;
                refresh();
                return;
            }
            if (role === 'path-choice') {
                var choiceKey = target.getAttribute('data-key');
                if (choiceKey)
                    pathChoices[choiceKey] = parseInt(target.value, 10) || 0;
                refresh();
                return;
            }
            if (role === 'copy-column') {
                var manualId = target.getAttribute('data-join');
                var copyColumn = target.getAttribute('data-column') || '';
                var copyEntry = manual.filter(function (candidate) {
                    return candidate.id === manualId;
                })[0];
                if (copyEntry) {
                    var nextColumns = (copyEntry.selfColumns || []).filter(function (name) {
                        return schemaNormColumn(name) !== schemaNormColumn(copyColumn);
                    });
                    if (target.checked)
                        nextColumns.push(copyColumn);
                    copyEntry.selfColumns = nextColumns;
                    refresh();
                }
                return;
            }
            var problemKey = target.getAttribute('data-problem');
            if (!problemKey)
                return;
            var draft = drafts[problemKey];
            if (!draft)
                return;
            if (role === 'teach-left')
                draft.left = target.value;
            else if (role === 'teach-right')
                draft.right = target.value;
            else if (role === 'use-predicate') {
                draft.usePredicate = target.checked;
                refresh();
            }
        });
        planEl.addEventListener('input', function (event) {
            var target = event.target;
            if (!target || !target.getAttribute)
                return;
            if (target.getAttribute('data-role') !== 'predicate')
                return;
            var problemKey = target.getAttribute('data-problem');
            var draft = problemKey ? drafts[problemKey] : null;
            if (draft)
                draft.predicate = target.value;
        });
        planEl.addEventListener('click', function (event) {
            var target = event.target;
            if (!target || !target.getAttribute)
                return;
            var action = target.getAttribute('data-action');
            if (action === 'focus') {
                var entityId = target.getAttribute('data-entity');
                if (entityId && focusEntity)
                    focusEntity(entityId);
                return;
            }
            if (action === 'set-distinct') {
                distinct = true;
                if (distinctEl)
                    distinctEl.checked = true;
                refresh();
                return;
            }
            if (action === 'teach-click') {
                startTeaching();
                return;
            }
            if (action === 'cancel-teach') {
                cancelTeaching();
                return;
            }
            var problemKey = target.getAttribute('data-problem');
            if (!problemKey)
                return;
            if (action === 'teach')
                teachJoin(problemKey);
            else if (action === 'cross')
                crossJoin(problemKey);
            else if (action === 'exclude')
                excludeProblem(problemKey);
        });
    }
    window.erdQueryPanelInit = init;
    window.erdQueryPanelSetSchema = setSchema;
    window.erdQueryPanelState = state;
    window.erdQueryPanelDecorate = decorate;
    window.erdQueryPanelTogglePick = togglePick;
    window.erdQueryPanelTeachColumn = teachColumn;
})();
//# sourceMappingURL=erd-query.js.map