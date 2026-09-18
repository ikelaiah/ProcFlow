"use strict";
/* proc>flow v2.1.0 — ERD page controller.
   Parses schema DDL into the shared schema IR and draws an entity map of
   declared tables, views, and foreign keys. Declared constraints only: this
   page never infers a relationship from query text. */
(function () {
    if (typeof document === 'undefined')
        return;
    var $ = function (id) { return document.getElementById(id); };
    var sql = $('erd-sql'), gutter = $('erd-gutter'), msg = $('erd-msg'), cardsHost = $('erd-cards'), overlay = $('erd-overlay'), canvas = $('erd-canvas'), space = $('erd-space'), empty = $('erd-empty'), mermaidOut = $('erd-mermaid-out'), inspector = $('erd-inspector'), largeNotice = $('erd-large-notice'), findInput = $('erd-find'), findCount = $('erd-find-count'), compactInput = $('erd-compact');
    var result = null;
    var cardEls = {};
    var adjacency = {};
    var relCounts = {};
    var selectedId = null;
    var renderSeq = 0;
    var compactMode = false, compactTouched = false;
    var findMatches = [], findIndex = 0;
    var panning = false, panStartX = 0, panStartY = 0, panStartScrollLeft = 0, panStartScrollTop = 0, didPan = false;
    var dragMode = null, dragCardId = null, dragBaseX = 0, dragBaseY = 0, dragLastDx = 0, dragLastDy = 0;
    var cardPositions = {};
    var cardSizes = {};
    var layoutKind = 'default';
    var layoutOrientation = 'auto';
    var layoutOrientationUsed = 'LR';
    var layoutDensity = 'normal';
    var layoutBands = [];
    var columnOf = {};
    var bandOf = {};
    var pinned = {};
    var stageWidth = 0, stageHeight = 0;
    var overlayRaf = 0;
    function drawGutter() {
        if (!gutter || !sql)
            return;
        var lines = sql.value.split('\n').length, out = '';
        for (var i = 1; i <= lines; i++)
            out += (i > 1 ? '\n' : '') + i;
        gutter.textContent = out;
        gutter.scrollTop = sql.scrollTop;
    }
    function setStat(id, value) {
        var el = $(id);
        if (el)
            el.textContent = String(value);
    }
    function showDiagnostics() {
        if (!msg || !result)
            return;
        msg.textContent = '';
        msg.classList.remove('show', 'warn');
        var list = result.diagnostics || [];
        if (!list.length)
            return;
        var errors = list.filter(function (d) { return d.severity === 'error'; }).length;
        msg.classList.add('show');
        if (!errors)
            msg.classList.add('warn');
        list.forEach(function (d) {
            var line = document.createElement('span');
            line.className = 'diag' + (d.severity === 'info' ? ' info' : '');
            line.textContent = d.message + (d.span ? '  (' + d.span.start + '–' + d.span.end + ')' : '');
            msg.appendChild(line);
        });
    }
    function compactSummary(entity) {
        var fkColumns = {}, pkCount = 0;
        entity.keys.forEach(function (key) {
            if (key.kind === 'pk')
                pkCount++;
            if (key.kind === 'fk')
                key.columns.forEach(function (name) {
                    fkColumns[name.toUpperCase()] = 1;
                });
        });
        return entity.columns.length + ' cols \u00b7 ' + pkCount + ' PK \u00b7 ' +
            Object.keys(fkColumns).length + ' FK';
    }
    function buildCard(entity) {
        var card = document.createElement('article');
        card.className = 'erd-card' + (entity.unresolved ? ' unresolved' : '') +
            (entity.kind === 'view' ? ' erd-view' : '') + (compactMode ? ' compact' : '') +
            (pinned[entity.id] ? ' pinned' : '');
        card.setAttribute('data-entity-id', entity.id);
        var head = document.createElement('header');
        var kind = document.createElement('span');
        kind.className = 'erd-kind';
        kind.textContent = entity.unresolved ? 'external' : entity.kind;
        var title = document.createElement('h3');
        title.textContent = entity.name;
        head.appendChild(kind);
        head.appendChild(title);
        var count = relCounts[entity.id] || 0;
        if (count) {
            var badge = document.createElement('span');
            badge.className = 'erd-relcount';
            badge.title = count + ' declared relationship' + (count === 1 ? '' : 's');
            badge.textContent = String(count);
            head.appendChild(badge);
        }
        var pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'erd-pin' + (pinned[entity.id] ? ' pinned' : '');
        pin.textContent = '\u25C6';
        pin.title = pinned[entity.id] ? 'Unpin position (Auto arrange may move it)'
            : 'Pin position (Auto arrange keeps it)';
        pin.addEventListener('click', function (event) {
            event.stopPropagation();
            if (pinned[entity.id]) {
                delete pinned[entity.id];
                layoutStatus('Unpinned ' + entity.name + '.');
            }
            else {
                pinned[entity.id] = 1;
                layoutStatus('Pinned ' + entity.name + ' \u00b7 Auto arrange keeps this position.');
            }
            pin.classList.toggle('pinned', !!pinned[entity.id]);
            pin.title = pinned[entity.id] ? 'Unpin position (Auto arrange may move it)'
                : 'Pin position (Auto arrange keeps it)';
            card.classList.toggle('pinned', !!pinned[entity.id]);
        });
        head.appendChild(pin);
        card.appendChild(head);
        if (compactMode) {
            var summary = document.createElement('p');
            summary.className = 'erd-summary';
            summary.textContent = compactSummary(entity);
            card.appendChild(summary);
        }
        else {
            var list = document.createElement('ul');
            list.className = 'erd-cols';
            if (entity.columns.length) {
                var frag = document.createDocumentFragment();
                entity.columns.forEach(function (column) {
                    var row = document.createElement('li');
                    row.setAttribute('data-column', column.name);
                    var name = document.createElement('span');
                    name.className = 'erd-col-name';
                    name.textContent = column.name;
                    var type = document.createElement('span');
                    type.className = 'erd-col-type';
                    type.textContent = column.type || '—';
                    type.title = column.type || 'no declared type';
                    var flags = document.createElement('span');
                    flags.className = 'erd-badges';
                    erdColumnKeys(entity, column).forEach(function (key) {
                        var tag = document.createElement('b');
                        tag.className = 'erd-badge erd-badge-' + key.toLowerCase();
                        tag.textContent = key;
                        flags.appendChild(tag);
                    });
                    if (column.identity) {
                        var idTag = document.createElement('b');
                        idTag.className = 'erd-badge erd-badge-id';
                        idTag.textContent = 'ID';
                        idTag.title = 'identity / auto-increment';
                        flags.appendChild(idTag);
                    }
                    if (column.generated || column.computed) {
                        var genTag = document.createElement('b');
                        genTag.className = 'erd-badge erd-badge-gen';
                        genTag.textContent = column.computed ? 'COMP' : 'GEN';
                        genTag.title = column.computed ? 'computed column' : 'generated column';
                        flags.appendChild(genTag);
                    }
                    if (!column.nullable) {
                        var nnTag = document.createElement('b');
                        nnTag.className = 'erd-badge erd-badge-nn';
                        nnTag.textContent = 'NN';
                        nnTag.title = 'not null';
                        flags.appendChild(nnTag);
                    }
                    row.appendChild(name);
                    row.appendChild(type);
                    row.appendChild(flags);
                    frag.appendChild(row);
                });
                list.appendChild(frag);
            }
            else {
                var none = document.createElement('li');
                none.className = 'erd-no-cols';
                none.textContent = entity.unresolved ? 'referenced but not declared' : 'no declared columns';
                list.appendChild(none);
            }
            card.appendChild(list);
        }
        card.tabIndex = 0;
        card.addEventListener('click', function () {
            selectEntity(selectedId === entity.id ? null : entity.id);
        });
        card.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectEntity(selectedId === entity.id ? null : entity.id);
            }
        });
        return card;
    }
    function selectEntity(id) {
        selectedId = id;
        var related = {};
        if (selectedId) {
            (adjacency[selectedId] || []).forEach(function (other) { related[other] = 1; });
        }
        Object.keys(cardEls).forEach(function (entityId) {
            var card = cardEls[entityId];
            card.classList.toggle('focus', entityId === selectedId);
            card.classList.toggle('related', !!selectedId && entityId !== selectedId && related[entityId] === 1);
            card.classList.toggle('dim', !!selectedId && entityId !== selectedId && related[entityId] !== 1);
        });
        renderInspector();
        drawOverlay();
    }
    /* Find highlights matches and jumps between them (Enter / Shift+Enter). */
    function applyFind(jump) {
        Object.keys(cardEls).forEach(function (id) { cardEls[id].classList.remove('match'); });
        findMatches = [];
        var query = (findInput ? String(findInput.value || '') : '').trim().toUpperCase();
        if (!query || !result) {
            if (findCount)
                findCount.textContent = '';
            return;
        }
        result.entities.forEach(function (entity) {
            if (entity.name.toUpperCase().indexOf(query) >= 0 || entity.id.indexOf(query) >= 0) {
                findMatches.push(entity.id);
            }
        });
        findMatches.forEach(function (id) {
            if (cardEls[id])
                cardEls[id].classList.add('match');
        });
        if (findCount) {
            findCount.textContent = findMatches.length
                ? findMatches.length + ' match' + (findMatches.length === 1 ? '' : 'es')
                : '0 matches';
        }
        if (jump && findMatches.length) {
            var id = findMatches[findIndex % findMatches.length];
            var card = cardEls[id];
            if (card && card.scrollIntoView) {
                card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            }
        }
    }
    /* Selection inspector: every declared FK touching the selected entity, with
       direction, column mapping, cardinality, and constraint name. Never inferred. */
    function renderInspector() {
        if (!inspector || !result)
            return;
        inspector.textContent = '';
        var selected = selectedId ? result.entities.filter(function (entity) {
            return entity.id === selectedId;
        })[0] : null;
        if (!selected) {
            inspector.hidden = true;
            return;
        }
        inspector.hidden = false;
        var head = document.createElement('header');
        var title = document.createElement('h4');
        title.textContent = selected.name;
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'erd-inspector-close';
        clear.textContent = 'Clear';
        clear.addEventListener('click', function () { selectEntity(null); });
        head.appendChild(title);
        head.appendChild(clear);
        inspector.appendChild(head);
        function group(label, rows, outgoing) {
            if (!rows.length)
                return;
            var heading = document.createElement('p');
            heading.className = 'erd-inspector-group';
            heading.textContent = label;
            inspector.appendChild(heading);
            rows.forEach(function (rel) {
                var otherId = outgoing ? rel.fromId : rel.toId;
                var other = result.entities.filter(function (entity) {
                    return entity.id === otherId;
                })[0];
                var row = document.createElement('button');
                row.type = 'button';
                row.className = 'erd-rel-row';
                var arrow = document.createElement('span');
                arrow.className = 'erd-rel-arrow';
                arrow.textContent = outgoing ? '\u2192' : '\u2190';
                var name = document.createElement('span');
                name.className = 'erd-rel-name';
                name.textContent = other ? other.name : otherId;
                var detail = document.createElement('span');
                detail.className = 'erd-rel-detail';
                detail.textContent = rel.toColumns.join(',') + ' \u2192 ' +
                    (rel.fromColumns.join(',') || 'PK');
                var meta = document.createElement('span');
                meta.className = 'erd-rel-meta';
                meta.textContent = (rel.cardinality === 'one-to-one' ? '1:1' : '1:N') +
                    (rel.optional ? ' optional' : '') + (rel.name ? ' \u00b7 ' + rel.name : '');
                row.appendChild(arrow);
                row.appendChild(name);
                row.appendChild(detail);
                row.appendChild(meta);
                row.title = 'Select ' + name.textContent;
                row.addEventListener('click', function () {
                    selectEntity(otherId);
                    var card = cardEls[otherId];
                    if (card && card.scrollIntoView) {
                        card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                    }
                });
                inspector.appendChild(row);
            });
        }
        group('References (FK out)', result.relationships.filter(function (rel) {
            return rel.toId === selected.id;
        }), true);
        group('Referenced by (FK in)', result.relationships.filter(function (rel) {
            return rel.fromId === selected.id && rel.toId !== selected.id;
        }), false);
        if (!result.relationships.some(function (rel) {
            return rel.fromId === selected.id || rel.toId === selected.id;
        })) {
            var none = document.createElement('p');
            none.className = 'erd-inspector-empty';
            none.textContent = 'No declared foreign keys.';
            inspector.appendChild(none);
        }
    }
    /* Adjacency and degree are precomputed so selecting a hub table in an
       800-table estate stays O(degree) instead of O(tables × relationships). */
    function renderCards() {
        if (!cardsHost || !result)
            return;
        adjacency = {};
        relCounts = {};
        result.relationships.forEach(function (rel) {
            (adjacency[rel.fromId] = adjacency[rel.fromId] || []).push(rel.toId);
            (adjacency[rel.toId] = adjacency[rel.toId] || []).push(rel.fromId);
            relCounts[rel.fromId] = (relCounts[rel.fromId] || 0) + 1;
            relCounts[rel.toId] = (relCounts[rel.toId] || 0) + 1;
        });
        if (!compactTouched && result.entities.length > 150) {
            compactMode = true;
            if (compactInput)
                compactInput.checked = true;
        }
        cardsHost.classList.toggle('compact', compactMode);
        if (Object.keys(cardPositions).length) {
            var kept = {};
            result.entities.forEach(function (entity) {
                if (cardPositions[entity.id])
                    kept[entity.id] = cardPositions[entity.id];
            });
            cardPositions = kept;
        }
        cardEls = {};
        cardSizes = {};
        cardsHost.textContent = '';
        var frag = document.createDocumentFragment();
        result.entities.forEach(function (entity) {
            var card = buildCard(entity);
            cardEls[entity.id] = card;
            frag.appendChild(card);
        });
        cardsHost.appendChild(frag);
        if (empty)
            empty.hidden = result.entities.length > 0;
        result.entities.forEach(function (entity) {
            var card = cardEls[entity.id];
            cardSizes[entity.id] = { w: card.offsetWidth || 260, h: card.offsetHeight || 140 };
        });
        if (!Object.keys(cardPositions).length && result.entities.length) {
            /* First parse of a schema auto-arranges; Reset returns to declaration
               order, and any drag, restore, or import switches to manual. */
            var firstLayout = erdAutoLayout(result, cardSizes, { orientation: layoutOrientation, density: layoutDensity });
            applyLayout(firstLayout, 'auto');
            layoutStatus('Auto-arranged ' + result.entities.length + ' entities \u00b7 ' +
                (firstLayout.crossings || 0) + ' crossings \u00b7 ' + (firstLayout.orientation || 'LR') +
                ' \u00b7 Reset layout for declaration order.');
        }
        else {
            placeMissingEntities();
            applyPositions();
        }
    }
    function applyPositions() {
        if (!result)
            return;
        result.entities.forEach(function (entity) {
            var card = cardEls[entity.id], position = cardPositions[entity.id];
            if (!card || !position)
                return;
            card.style.left = Math.round(position.x) + 'px';
            card.style.top = Math.round(position.y) + 'px';
        });
        updateStageBounds();
    }
    function updateStageBounds() {
        if (!cardsHost || !result)
            return;
        var maxX = 0, maxY = 0;
        result.entities.forEach(function (entity) {
            var position = cardPositions[entity.id];
            if (!position)
                return;
            var size = cardSizes[entity.id] || { w: 260, h: 140 };
            maxX = Math.max(maxX, position.x + size.w);
            maxY = Math.max(maxY, position.y + size.h);
        });
        stageWidth = maxX + 40;
        stageHeight = maxY + 40;
        cardsHost.style.width = stageWidth + 'px';
        cardsHost.style.height = stageHeight + 'px';
        applyZoomLayout();
    }
    /* New or unmatched entities are appended below the current stage instead of
       being stacked on top of existing cards. */
    function placeMissingEntities() {
        if (!result)
            return;
        var bottom = 0;
        result.entities.forEach(function (entity) {
            var position = cardPositions[entity.id];
            if (!position)
                return;
            var size = cardSizes[entity.id] || { w: 260, h: 140 };
            bottom = Math.max(bottom, position.y + size.h);
        });
        var y = bottom ? bottom + 56 : 0;
        result.entities.forEach(function (entity) {
            if (cardPositions[entity.id])
                return;
            var size = cardSizes[entity.id] || { w: 260, h: 140 };
            cardPositions[entity.id] = { x: 0, y: y };
            y += size.h + 56;
        });
    }
    var cachedCanvasRect = null;
    function entityBox(entityId) {
        var el = cardEls[entityId], c = canvas;
        if (!el || !c)
            return null;
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height)
            return null;
        var cr = cachedCanvasRect || c.getBoundingClientRect();
        var left = r.left - cr.left + c.scrollLeft, top = r.top - cr.top + c.scrollTop;
        return { left: left, top: top, right: left + r.width, bottom: top + r.height,
            cx: left + r.width / 2, cy: top + r.height / 2 };
    }
    function svgEl(name, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', name);
        if (attrs)
            Object.keys(attrs).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
        return el;
    }
    function scheduleOverlay() {
        if (overlayRaf)
            return;
        overlayRaf = requestAnimationFrame(function () {
            overlayRaf = 0;
            drawOverlay();
        });
    }
    function setLayoutGeometry(layout) {
        layoutBands = layout.bands || [];
        layoutOrientationUsed = layout.orientation || 'LR';
        columnOf = {};
        bandOf = {};
        layoutBands.forEach(function (band, bandIndex) {
            band.forEach(function (column, columnIndex) {
                column.forEach(function (id) {
                    columnOf[id] = columnIndex;
                    bandOf[id] = bandIndex;
                });
            });
        });
    }
    function applyLayout(layout, kind) {
        cardPositions = layout.positions;
        layoutKind = kind;
        setLayoutGeometry(layout);
        applyPositions();
        scheduleOverlay();
    }
    function defaultLayout() {
        if (!result)
            return;
        pinned = {};
        Object.keys(cardEls).forEach(function (id) {
            cardEls[id].classList.remove('pinned');
            var pin = cardEls[id].querySelector('.erd-pin');
            if (pin)
                pin.classList.remove('pinned');
        });
        applyLayout(erdDefaultLayout(result, cardSizes), 'default');
        layoutStatus('Declaration-order layout \u00b7 pins cleared.');
    }
    function pinnedPositions() {
        var positions = {};
        Object.keys(pinned).forEach(function (id) {
            if (cardPositions[id])
                positions[id] = cardPositions[id];
        });
        return positions;
    }
    function autoArrange() {
        if (!result)
            return;
        var pins = pinnedPositions();
        var layout = erdAutoLayout(result, cardSizes, { orientation: layoutOrientation, density: layoutDensity, pinned: pins });
        applyLayout(layout, 'auto');
        layoutStatus('Auto-arranged ' + result.entities.length + ' entities \u00b7 ' +
            (layout.crossings || 0) + ' crossing' + ((layout.crossings || 0) === 1 ? '' : 's') +
            ' \u00b7 ' + (layout.orientation || 'LR') + ' \u00b7 ' + layoutDensity +
            (Object.keys(pins).length ? ' \u00b7 ' + Object.keys(pins).length + ' pinned' : '') + '.');
    }
    function layoutStatus(text) {
        var el = $('erd-layout-status');
        if (el)
            el.textContent = text;
    }
    /* Saved layouts are opt-in, versioned, and fingerprint-checked; unmatched
       entities are appended rather than dropped or overlapped. */
    function saveLayoutToBrowser() {
        if (!result)
            return;
        var ok = writeErdLayout(erdLayoutToJSON(result, cardPositions));
        layoutStatus(ok ? 'Layout saved to this browser.' : 'Could not save the layout in this browser.');
    }
    function restoreLayoutFromBrowser() {
        var raw = readErdLayout();
        if (!raw) {
            layoutStatus('No layout saved in this browser.');
            return;
        }
        var parsed = erdLayoutFromJSON(raw);
        if (!parsed.file) {
            layoutStatus(parsed.diagnostics[0] ? parsed.diagnostics[0].message : 'Saved layout is unreadable.');
            return;
        }
        applyLayoutFile(parsed.file, 'Restored');
    }
    function applyLayoutFile(file, source) {
        if (!result)
            return;
        var current = erdLayoutFingerprint(result);
        var applied = {};
        var matched = 0;
        result.entities.forEach(function (entity) {
            var position = file.positions[entity.id];
            if (position) {
                applied[entity.id] = position;
                matched++;
            }
        });
        if (!matched) {
            layoutStatus(source + ': no entity ids matched the current schema.');
            return;
        }
        cardPositions = applied;
        layoutKind = 'manual';
        placeMissingEntities();
        applyPositions();
        scheduleOverlay();
        var note = (file.fingerprint && file.fingerprint !== current)
            ? ' (schema changed since save; unmatched entities were appended)'
            : '';
        layoutStatus(source + ': ' + matched + ' positions applied' + note + '.');
    }
    function exportLayoutFile() {
        if (!result)
            return;
        var text = erdLayoutToJSON(result, cardPositions);
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'procflow-erd-layout-' + erdLayoutFingerprint(result) + '.json';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        layoutStatus('Layout exported.');
    }
    function importLayoutFile(file) {
        file.text().then(function (text) {
            var parsed = erdLayoutFromJSON(text);
            if (!parsed.file) {
                layoutStatus(parsed.diagnostics[0] ? parsed.diagnostics[0].message : 'Layout file is unreadable.');
                return;
            }
            applyLayoutFile(parsed.file, 'Imported');
        });
    }
    var ERD_MIN_ZOOM = 0.02, ERD_MAX_ZOOM = 2;
    function currentZoom() {
        if (!canvas)
            return 1;
        var value = parseFloat(canvas.style.getPropertyValue('--erd-zoom'));
        return isNaN(value) ? 1 : value;
    }
    /* Card positions are absolute canvas pixels at 100%; zoom scales the whole
       stage with a transform, so it never reflows while zooming. A spacer
       carries the scaled scroll area. */
    function applyZoomLayout() {
        if (!canvas || !cardsHost || !space)
            return;
        var zoom = currentZoom();
        var width = Math.ceil(cardsHost.offsetWidth * zoom) + 40;
        var height = Math.ceil(cardsHost.offsetHeight * zoom) + 40;
        space.style.width = Math.max(width, canvas.clientWidth) + 'px';
        space.style.height = Math.max(height, canvas.clientHeight) + 'px';
    }
    function setZoom(value) {
        if (!canvas)
            return;
        var zoom = Math.max(ERD_MIN_ZOOM, Math.min(ERD_MAX_ZOOM, value));
        canvas.style.setProperty('--erd-zoom', String(zoom));
        canvas.classList.toggle('zoomed-out', zoom < 0.5);
        var label = $('erd-zoom-val');
        if (label)
            label.textContent = Math.round(zoom * 100) + '%';
        applyZoomLayout();
        drawOverlay();
    }
    /* Zoom keeping the point under the cursor fixed. */
    function zoomAt(clientX, clientY, factor) {
        if (!canvas)
            return;
        var from = currentZoom();
        var to = Math.max(ERD_MIN_ZOOM, Math.min(ERD_MAX_ZOOM, from * factor));
        if (to === from)
            return;
        var rect = canvas.getBoundingClientRect();
        var offsetX = clientX - rect.left, offsetY = clientY - rect.top;
        var logicalX = (canvas.scrollLeft + offsetX) / from;
        var logicalY = (canvas.scrollTop + offsetY) / from;
        setZoom(to);
        canvas.scrollLeft = logicalX * to - offsetX;
        canvas.scrollTop = logicalY * to - offsetY;
    }
    function zoomBy(factor) {
        if (!canvas)
            return;
        var rect = canvas.getBoundingClientRect();
        zoomAt(rect.left + canvas.clientWidth / 2, rect.top + canvas.clientHeight / 2, factor);
    }
    /* Fit the whole estate, or — with a table selected — that table and its
       declared neighbours, so the highlighted entity is immediately readable. */
    function fitView() {
        if (!result || !canvas)
            return;
        var ids = selectedId
            ? [selectedId].concat(adjacency[selectedId] || [])
            : result.entities.map(function (entity) { return entity.id; });
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ids.forEach(function (id) {
            var box = entityBox(id);
            if (!box)
                return;
            minX = Math.min(minX, box.left);
            minY = Math.min(minY, box.top);
            maxX = Math.max(maxX, box.right);
            maxY = Math.max(maxY, box.bottom);
        });
        if (minX === Infinity)
            return;
        var pad = 40;
        var width = maxX - minX + pad * 2, height = maxY - minY + pad * 2;
        var from = currentZoom();
        var to = Math.max(ERD_MIN_ZOOM, Math.min(ERD_MAX_ZOOM, from * Math.min(canvas.clientWidth / width, canvas.clientHeight / height)));
        var ratio = to / from;
        setZoom(to);
        canvas.scrollLeft = (minX + maxX) / 2 * ratio - canvas.clientWidth / 2;
        canvas.scrollTop = (minY + maxY) / 2 * ratio - canvas.clientHeight / 2;
    }
    /* v2.3.0 — port-anchored orthogonal routing. Edges leave the card at the row
       of the referenced column and travel in the gutter between columns, with a
       per-parent stagger so hub fan-outs read as a bundle. */
    function portOffset(entityId, box, columnName) {
        if (!columnName)
            return box.cy;
        var card = cardEls[entityId];
        if (!card)
            return box.cy;
        var rows = card.querySelectorAll('.erd-cols li[data-column]');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].getAttribute('data-column') === columnName) {
                var rowRect = rows[i].getBoundingClientRect();
                var cardRect = card.getBoundingClientRect();
                return box.top + (rowRect.top + rowRect.height / 2 - cardRect.top);
            }
        }
        return box.cy;
    }
    var portCache = {};
    function portAt(entityId, box, columnName) {
        if (!columnName)
            return box.cy;
        var key = entityId + '|' + columnName;
        if (portCache[key] === undefined) {
            portCache[key] = portOffset(entityId, box, columnName);
        }
        return portCache[key];
    }
    function edgeDirection(from, to) {
        if (to.left - from.right >= 8)
            return 'right';
        if (from.left - to.right >= 8)
            return 'left';
        if (to.top - from.bottom >= 8)
            return 'down';
        if (from.top - to.bottom >= 8)
            return 'up';
        return 'around';
    }
    function routeFromPoints(points) {
        var d = 'M ' + points[0].x + ' ' + points[0].y;
        for (var i = 1; i < points.length; i++)
            d += ' L ' + points[i].x + ' ' + points[i].y;
        function along(a, b, distance) {
            var dx = b.x - a.x, dy = b.y - a.y;
            var length = Math.sqrt(dx * dx + dy * dy) || 1;
            return { x: a.x + dx / length * distance, y: a.y + dy / length * distance };
        }
        var last = points.length - 1, middle = Math.floor(last / 2);
        return { d: d,
            labelAt: [along(points[0], points[1], 16), along(points[last], points[last - 1], 16)],
            midAt: { x: (points[middle].x + points[middle + 1].x) / 2,
                y: (points[middle].y + points[middle + 1].y) / 2 } };
    }
    /* Card-safe routing for auto layouts: every bend travels in the card-free
       gutters between layout columns, or in the horizontal corridor between
       bands, so edge paths cannot cross an entity card. Manual layouts fall
       back to the best-effort router. */
    function structuredRoute(rel, from, to, stagger, bandExtents) {
        if (layoutOrientationUsed !== 'LR' || layoutKind === 'manual' || !layoutBands.length) {
            return null;
        }
        var bandA = bandOf[rel.fromId], bandB = bandOf[rel.toId];
        if (bandA === undefined || bandB === undefined)
            return null;
        var colA = columnOf[rel.fromId], colB = columnOf[rel.toId];
        if (colA === undefined || colB === undefined)
            return null;
        var fromY = portAt(rel.fromId, from, rel.fromColumns[0]);
        var toY = portAt(rel.toId, to, rel.toColumns[0]);
        function rightGutterSafe(ext, column) {
            var raw = ext.right[column] + 24 + stagger;
            if (column + 1 < ext.left.length) {
                raw = Math.min(raw, (ext.right[column] + ext.left[column + 1]) / 2);
            }
            return raw;
        }
        var points = [];
        if (bandA === bandB) {
            var ext = bandExtents[bandA];
            if (!ext)
                return null;
            if (colB === colA + 1) {
                var rightGutter = (ext.right[colA] + ext.left[colB]) / 2 + stagger;
                points = [{ x: from.right, y: fromY }, { x: rightGutter, y: fromY },
                    { x: rightGutter, y: toY }, { x: to.left, y: toY }];
            }
            else if (colB === colA - 1) {
                var leftGutter = (ext.right[colB] + ext.left[colA]) / 2 - stagger;
                points = [{ x: from.left, y: fromY }, { x: leftGutter, y: fromY },
                    { x: leftGutter, y: toY }, { x: to.right, y: toY }];
            }
            else {
                /* Same column or skipped columns: travel in the card-free right
                   gutters and use the corridor below the band, so the path never
                   crosses an intermediate column or negative canvas space. */
                var bandCorridor = (bandA + 1 < bandExtents.length)
                    ? (ext.bottom + bandExtents[bandA + 1].top) / 2
                    : ext.bottom + 24;
                var gutterFrom = rightGutterSafe(ext, colA);
                var gutterTo = rightGutterSafe(ext, colB);
                points = [{ x: from.right, y: fromY },
                    { x: gutterFrom, y: fromY },
                    { x: gutterFrom, y: bandCorridor },
                    { x: gutterTo, y: bandCorridor },
                    { x: gutterTo, y: toY },
                    { x: to.right, y: toY }];
            }
        }
        else {
            var extA = bandExtents[bandA], extB = bandExtents[bandB];
            if (!extA || !extB)
                return null;
            var delta = bandB - bandA;
            var gutterA = rightGutterSafe(extA, colA);
            var gutterB = rightGutterSafe(extB, colB);
            if (delta === 1 || delta === -1) {
                var corridorY = delta === 1 ? (extA.bottom + extB.top) / 2 : (extB.bottom + extA.top) / 2;
                points = [{ x: from.right, y: fromY },
                    { x: gutterA, y: fromY },
                    { x: gutterA, y: corridorY },
                    { x: gutterB, y: corridorY },
                    { x: gutterB, y: toY },
                    { x: to.right, y: toY }];
            }
            else {
                /* Non-adjacent bands: run long horizontal segments only through band
                   gaps, connect them with a vertical channel outside all cards. */
                var gapA = delta > 0 ? (extA.bottom + bandExtents[bandA + 1].top) / 2
                    : (bandExtents[bandA - 1].bottom + extA.top) / 2;
                var gapB = delta > 0 ? (bandExtents[bandB - 1].bottom + extB.top) / 2
                    : (extB.bottom + bandExtents[bandB + 1].top) / 2;
                var outerX = 0;
                bandExtents.forEach(function (band) {
                    band.right.forEach(function (right) { outerX = Math.max(outerX, right); });
                });
                outerX += 40 + stagger;
                points = [{ x: from.right, y: fromY },
                    { x: gutterA, y: fromY },
                    { x: gutterA, y: gapA },
                    { x: outerX, y: gapA },
                    { x: outerX, y: gapB },
                    { x: gutterB, y: gapB },
                    { x: gutterB, y: toY },
                    { x: to.right, y: toY }];
            }
        }
        return routeFromPoints(points);
    }
    function orthogonalRoute(rel, from, to, stagger) {
        var fromY = portAt(rel.fromId, from, rel.fromColumns[0]);
        var toY = portAt(rel.toId, to, rel.toColumns[0]);
        var direction = edgeDirection(from, to);
        var points = [];
        if (direction === 'right' || direction === 'left') {
            var right = direction === 'right';
            var gx = right ? (from.right + to.left) / 2 + stagger
                : (to.right + from.left) / 2 - stagger;
            points = [{ x: right ? from.right : from.left, y: fromY },
                { x: gx, y: fromY },
                { x: gx, y: toY },
                { x: right ? to.left : to.right, y: toY }];
        }
        else if (direction === 'down' || direction === 'up') {
            var down = direction === 'down';
            var gy = down ? (from.bottom + to.top) / 2 + stagger
                : (to.bottom + from.top) / 2 - stagger;
            points = [{ x: from.cx, y: down ? from.bottom : from.top },
                { x: from.cx, y: gy },
                { x: to.cx, y: gy },
                { x: to.cx, y: down ? to.top : to.bottom }];
        }
        else {
            var aroundX = Math.max(from.right, to.right) + 30 + stagger;
            points = [{ x: from.right, y: fromY },
                { x: aroundX, y: fromY },
                { x: aroundX, y: toY },
                { x: to.right, y: toY }];
        }
        return routeFromPoints(points);
    }
    function drawOverlay() {
        if (!overlay || !canvas || !result)
            return;
        while (overlay.firstChild)
            overlay.removeChild(overlay.firstChild);
        var width = Math.max(space ? space.scrollWidth : cardsHost.scrollWidth + 40, canvas.clientWidth);
        var height = Math.max(space ? space.scrollHeight : cardsHost.scrollHeight + 40, canvas.clientHeight);
        overlay.setAttribute('width', String(width));
        overlay.setAttribute('height', String(height));
        overlay.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        cachedCanvasRect = canvas.getBoundingClientRect();
        portCache = {};
        var boxCache = {};
        function boxOf(id) {
            if (!(id in boxCache))
                boxCache[id] = entityBox(id);
            return boxCache[id];
        }
        var bandExtents = [];
        if (layoutBands.length) {
            layoutBands.forEach(function (band) {
                var lefts = [], rights = [];
                var top = Infinity, bottom = -Infinity;
                band.forEach(function (column, columnIndex) {
                    var left = Infinity, right = -Infinity;
                    column.forEach(function (id) {
                        var box = boxOf(id);
                        if (!box)
                            return;
                        left = Math.min(left, box.left);
                        right = Math.max(right, box.right);
                        top = Math.min(top, box.top);
                        bottom = Math.max(bottom, box.bottom);
                    });
                    lefts[columnIndex] = left === Infinity ? 0 : left;
                    rights[columnIndex] = right === -Infinity ? 0 : right;
                });
                bandExtents.push({ left: lefts, right: rights,
                    top: top === Infinity ? 0 : top,
                    bottom: bottom === -Infinity ? 0 : bottom });
            });
        }
        var bundleCounts = {};
        result.relationships.forEach(function (rel) {
            var from = boxOf(rel.fromId), to = boxOf(rel.toId);
            if (!from || !to)
                return;
            var active = !!selectedId;
            var connected = !active || rel.fromId === selectedId || rel.toId === selectedId;
            var dash = rel.resolution === 'exact' ? '' : (rel.resolution === 'heuristic' ? '7 4' : '2 4');
            var color = rel.resolution === 'opaque' ? '#e4645e' :
                (rel.resolution === 'heuristic' ? '#e8a33d' : '#7ea6e0');
            var bundle = bundleCounts[rel.fromId] || 0;
            bundleCounts[rel.fromId] = bundle + 1;
            var stagger = (bundle % 6) * 6;
            var routed;
            if (rel.fromId === rel.toId) {
                var startY = portAt(rel.fromId, from, rel.fromColumns[0]);
                var endY = portAt(rel.toId, to, rel.toColumns[0]);
                var loopX = from.right + 10 + stagger;
                routed = {
                    d: 'M ' + from.right + ' ' + startY + ' C ' + (loopX + 40) + ' ' + (startY - 24) + ', ' +
                        (loopX + 40) + ' ' + (endY + 24) + ', ' + from.right + ' ' + endY,
                    labelAt: [{ x: loopX + 34, y: startY - 12 }, { x: loopX + 34, y: endY + 12 }],
                    midAt: { x: loopX + 40, y: (startY + endY) / 2 }
                };
            }
            else {
                routed = structuredRoute(rel, from, to, stagger, bandExtents) ||
                    orthogonalRoute(rel, from, to, stagger);
            }
            var d = routed.d, labelAt = routed.labelAt, midAt = routed.midAt;
            var path = svgEl('path', { d: d, fill: 'none', stroke: color,
                'stroke-width': active && connected ? 2.6 : (connected ? 2 : 1.4),
                'stroke-dasharray': dash, opacity: active ? (connected ? 0.95 : 0.07) : 0.95,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
            path.setAttribute('data-relationship', rel.id);
            overlay.appendChild(path);
            if (!active || connected) {
                var leftLabel = rel.optional ? '0..1' : '1', rightLabel = rel.unique ? '1' : 'N';
                [{ text: leftLabel, at: labelAt[0] }, { text: rightLabel, at: labelAt[1] }].forEach(function (item) {
                    var text = svgEl('text', { x: item.at.x, y: item.at.y, fill: color, 'font-size': 10,
                        'font-family': 'ui-monospace,Consolas,monospace',
                        opacity: active ? (connected ? 1 : 0.1) : 1,
                        'text-anchor': 'middle', 'dominant-baseline': 'middle' });
                    text.textContent = item.text;
                    overlay.appendChild(text);
                });
            }
            if (active && connected) {
                var label = rel.name || (rel.toColumns.join(',') + ' \u2192 ' +
                    (rel.fromColumns.join(',') || 'PK'));
                var mid = svgEl('text', { x: midAt.x, y: midAt.y, fill: color, 'font-size': 10,
                    'font-family': 'ui-monospace,Consolas,monospace',
                    stroke: '#101b23', 'stroke-width': 3, 'paint-order': 'stroke',
                    'text-anchor': 'middle', 'dominant-baseline': 'middle' });
                mid.textContent = label;
                overlay.appendChild(mid);
            }
        });
        /* At estate zoom the card ring scales away; the overlay is unzoomed, so
           draw the selection highlight here instead. */
        if (selectedId && currentZoom() < 0.5) {
            var ring = boxOf(selectedId);
            if (ring) {
                overlay.appendChild(svgEl('rect', { x: ring.left - 5, y: ring.top - 5,
                    width: ring.right - ring.left + 10, height: ring.bottom - ring.top + 10, rx: 6,
                    fill: 'none', stroke: '#e8a33d', 'stroke-width': 2, 'stroke-dasharray': '7 5' }));
            }
        }
    }
    function render() {
        if (!sql)
            return;
        var text = sql.value;
        result = parseSchema(text);
        setStat('erd-tables', result.stats.tables);
        setStat('erd-views', result.stats.views);
        setStat('erd-columns', result.stats.columns);
        setStat('erd-relationships', result.stats.relationships);
        setStat('erd-unresolved', result.stats.unresolved);
        setStat('erd-diagnostics', result.diagnostics.length);
        selectedId = null;
        renderCards();
        renderInspector();
        showDiagnostics();
        applyFind(false);
        updateLargeInputNotice();
        if (mermaidOut)
            mermaidOut.textContent = toMermaidER(result);
        var seq = ++renderSeq;
        requestAnimationFrame(function () {
            if (seq !== renderSeq)
                return;
            drawOverlay();
        });
    }
    /* Large, exported-estate DDL must not reparse and rebuild hundreds of cards
       on every keystroke: auto-draw pauses above the shared local threshold and
       resumes when the input shrinks or Refresh is pressed. */
    function updateLargeInputNotice() {
        if (!sql)
            return false;
        var policy = largeInputPolicy(sql.value.length);
        if (largeNotice) {
            largeNotice.hidden = !policy.large;
            if (policy.large) {
                largeNotice.textContent = 'Large DDL (' + policy.length.toLocaleString('en-US') +
                    ' characters). Auto-draw is paused — press Refresh (Ctrl+Enter) or edit below ' +
                    policy.threshold.toLocaleString('en-US') + ' characters to resume live updates.';
            }
        }
        return policy.large;
    }
    function schedule() {
        if (updateLargeInputNotice())
            return;
        if (scheduleTimer !== null)
            clearTimeout(scheduleTimer);
        scheduleTimer = setTimeout(render, 220);
    }
    var scheduleTimer = null;
    function tab(which) {
        var diagram = $('view-erd-diagram'), mermaid = $('view-erd-mermaid');
        var diagramTab = $('tab-erd-diagram'), mermaidTab = $('tab-erd-mermaid');
        if (!diagram || !mermaid || !diagramTab || !mermaidTab)
            return;
        var showDiagram = which === 'diagram';
        diagram.classList.toggle('active', showDiagram);
        mermaid.classList.toggle('active', !showDiagram);
        diagramTab.setAttribute('aria-selected', String(showDiagram));
        mermaidTab.setAttribute('aria-selected', String(!showDiagram));
        if (showDiagram)
            requestAnimationFrame(drawOverlay);
    }
    function flash(btn, word) {
        if (!btn)
            return;
        var old = btn.textContent;
        btn.textContent = word;
        setTimeout(function () { btn.textContent = old; }, 1400);
    }
    function copyMermaid() {
        var text = mermaidOut ? mermaidOut.textContent : '';
        var done = function () { flash($('btn-erd-copy'), 'Copied'); };
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
    if (sql) {
        sql.value = '';
        sql.addEventListener('input', schedule);
        sql.addEventListener('scroll', function () { if (gutter)
            gutter.scrollTop = sql.scrollTop; });
        sql.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                render();
            }
        });
    }
    var sample = $('btn-erd-sample');
    if (sample)
        sample.addEventListener('click', function () {
            if (!sql)
                return;
            sql.value = PROCFLOW_ERD_SAMPLE_TSQL;
            drawGutter();
            render();
            sql.focus();
        });
    var sampleDb2 = $('btn-erd-sample-db2');
    if (sampleDb2)
        sampleDb2.addEventListener('click', function () {
            if (!sql)
                return;
            sql.value = PROCFLOW_ERD_SAMPLE_DB2;
            drawGutter();
            render();
            sql.focus();
        });
    var clear = $('btn-erd-clear');
    if (clear)
        clear.addEventListener('click', function () {
            if (!sql)
                return;
            sql.value = '';
            drawGutter();
            render();
            sql.focus();
        });
    var draw = $('btn-erd-draw');
    if (draw)
        draw.addEventListener('click', render);
    var copy = $('btn-erd-copy');
    if (copy)
        copy.addEventListener('click', copyMermaid);
    var tabDiagram = $('tab-erd-diagram');
    if (tabDiagram)
        tabDiagram.addEventListener('click', function () { tab('diagram'); });
    var tabMermaid = $('tab-erd-mermaid');
    if (tabMermaid)
        tabMermaid.addEventListener('click', function () { tab('mermaid'); });
    if (findInput) {
        findInput.addEventListener('input', function () { findIndex = 0; applyFind(true); });
        findInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (findMatches.length) {
                    findIndex = event.shiftKey
                        ? (findIndex - 1 + findMatches.length) % findMatches.length
                        : (findIndex + 1) % findMatches.length;
                    applyFind(true);
                }
            }
            else if (event.key === 'Escape') {
                findInput.value = '';
                findIndex = 0;
                applyFind(false);
            }
        });
    }
    if (compactInput)
        compactInput.addEventListener('change', function () {
            compactTouched = true;
            compactMode = !!compactInput.checked;
            renderCards();
            if (layoutKind === 'auto' && result)
                autoArrange();
            else if (layoutKind === 'default' && result)
                applyLayout(erdDefaultLayout(result, cardSizes), 'default');
            else
                layoutStatus('Box sizes changed; use Auto arrange to re-pack.');
            applyFind(false);
            renderInspector();
            requestAnimationFrame(drawOverlay);
        });
    var autoArrangeBtn = $('btn-erd-auto-arrange');
    if (autoArrangeBtn)
        autoArrangeBtn.addEventListener('click', autoArrange);
    var resetLayoutBtn = $('btn-erd-reset-layout');
    if (resetLayoutBtn)
        resetLayoutBtn.addEventListener('click', defaultLayout);
    var saveLayoutBtn = $('btn-erd-save-layout');
    if (saveLayoutBtn)
        saveLayoutBtn.addEventListener('click', saveLayoutToBrowser);
    var restoreLayoutBtn = $('btn-erd-restore-layout');
    if (restoreLayoutBtn)
        restoreLayoutBtn.addEventListener('click', restoreLayoutFromBrowser);
    var forgetLayoutBtn = $('btn-erd-forget-layout');
    if (forgetLayoutBtn)
        forgetLayoutBtn.addEventListener('click', function () {
            clearErdLayout();
            layoutStatus('Saved layout forgotten.');
        });
    var exportLayoutBtn = $('btn-erd-export-layout');
    if (exportLayoutBtn)
        exportLayoutBtn.addEventListener('click', exportLayoutFile);
    var importLayoutBtn = $('btn-erd-import-layout');
    var layoutFileInput = $('erd-layout-file-input');
    if (importLayoutBtn && layoutFileInput)
        importLayoutBtn.addEventListener('click', function () {
            layoutFileInput.click();
        });
    if (layoutFileInput)
        layoutFileInput.addEventListener('change', function () {
            var files = Array.prototype.slice.call(layoutFileInput.files || []);
            if (files.length)
                importLayoutFile(files[0]);
            layoutFileInput.value = '';
        });
    var orientationSelect = $('erd-layout-orientation');
    if (orientationSelect) {
        layoutOrientation = orientationSelect.value;
        orientationSelect.addEventListener('change', function () {
            layoutOrientation = orientationSelect.value;
            if (layoutKind === 'auto')
                autoArrange();
            else
                layoutStatus('Direction ' + layoutOrientation + ': press Auto arrange to apply.');
        });
    }
    var densitySelect = $('erd-layout-density');
    if (densitySelect) {
        layoutDensity = densitySelect.value;
        densitySelect.addEventListener('change', function () {
            layoutDensity = densitySelect.value;
            if (layoutKind === 'auto')
                autoArrange();
            else
                layoutStatus('Spacing ' + layoutDensity + ': press Auto arrange to apply.');
        });
    }
    var unpinAll = $('btn-erd-unpin-all');
    if (unpinAll)
        unpinAll.addEventListener('click', function () {
            pinned = {};
            Object.keys(cardEls).forEach(function (id) {
                cardEls[id].classList.remove('pinned');
                var marker = cardEls[id].querySelector('.erd-pin');
                if (marker)
                    marker.classList.remove('pinned');
            });
            layoutStatus('All positions unpinned.');
        });
    var zoomOut = $('erd-z-out');
    if (zoomOut)
        zoomOut.addEventListener('click', function () { zoomBy(1 / 1.15); });
    var zoomIn = $('erd-z-in');
    if (zoomIn)
        zoomIn.addEventListener('click', function () { zoomBy(1.15); });
    var zoomFit = $('erd-z-fit');
    if (zoomFit)
        zoomFit.addEventListener('click', fitView);
    var fileInput = $('erd-file-input');
    var importBtn = $('btn-erd-import');
    if (importBtn && fileInput)
        importBtn.addEventListener('click', function () { fileInput.click(); });
    if (fileInput)
        fileInput.addEventListener('change', function () {
            var files = Array.prototype.slice.call(fileInput.files || []);
            if (!files.length)
                return;
            Promise.all(files.map(function (file) {
                return file.text();
            })).then(function (texts) {
                if (!sql)
                    return;
                var joined = sql.value.trim();
                texts.forEach(function (text) {
                    joined = (joined ? joined + '\nGO\n' : '') + text;
                });
                sql.value = joined;
                drawGutter();
                render();
                fileInput.value = '';
            });
        });
    window.addEventListener('resize', function () {
        applyZoomLayout();
        requestAnimationFrame(drawOverlay);
    });
    if (typeof ResizeObserver !== 'undefined' && cardsHost) {
        new ResizeObserver(function () { drawOverlay(); }).observe(cardsHost);
    }
    /* Drag on empty canvas pans; drag on a card moves that card so crowded
       relationships can be separated. Click still selects: a drag shorter than
       the threshold never suppresses the click, and a real drag always does. */
    if (canvas) {
        canvas.addEventListener('pointerdown', function (event) {
            if (event.button !== 0)
                return;
            var target = event.target;
            var cardEl = target && target.closest ? target.closest('.erd-card') : null;
            dragMode = cardEl ? 'card' : 'pan';
            dragCardId = cardEl ? cardEl.getAttribute('data-entity-id') : null;
            panning = true;
            didPan = false;
            dragLastDx = 0;
            dragLastDy = 0;
            panStartX = event.clientX;
            panStartY = event.clientY;
            panStartScrollLeft = canvas.scrollLeft;
            panStartScrollTop = canvas.scrollTop;
            if (dragMode === 'card' && dragCardId) {
                var position = cardPositions[dragCardId] || { x: 0, y: 0 };
                dragBaseX = position.x;
                dragBaseY = position.y;
                if (cardEl)
                    cardEl.classList.add('moving');
            }
            else {
                canvas.classList.add('dragging');
            }
        });
        document.addEventListener('pointermove', function (event) {
            if (!panning)
                return;
            var dx = event.clientX - panStartX, dy = event.clientY - panStartY;
            dragLastDx = dx;
            dragLastDy = dy;
            if (dragMode === 'card') {
                if (Math.abs(dx) > 4 || Math.abs(dy) > 4)
                    didPan = true;
                if (didPan && dragCardId && cardEls[dragCardId]) {
                    var zoom = currentZoom();
                    cardPositions[dragCardId] = { x: dragBaseX + dx / zoom, y: dragBaseY + dy / zoom };
                    applyPositions();
                    scheduleOverlay();
                }
                return;
            }
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6)
                didPan = true;
            canvas.scrollLeft = panStartScrollLeft - dx;
            canvas.scrollTop = panStartScrollTop - dy;
        });
        var endDrag = function () {
            if (!panning)
                return;
            if (dragMode === 'card' && dragCardId && didPan) {
                layoutKind = 'manual';
                if (cardEls[dragCardId])
                    cardEls[dragCardId].classList.remove('moving');
            }
            else if (dragCardId && cardEls[dragCardId]) {
                cardEls[dragCardId].classList.remove('moving');
            }
            panning = false;
            dragMode = null;
            dragCardId = null;
            canvas.classList.remove('dragging');
        };
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('click', function (event) {
            if (didPan) {
                didPan = false;
                event.stopPropagation();
                event.preventDefault();
            }
        }, true);
        /* Smooth wheel zoom: continuous and cursor-anchored, instead of stepped
           button jumps. Trackpad pinch (ctrl+wheel) works through the same path. */
        canvas.addEventListener('wheel', function (event) {
            event.preventDefault();
            zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
        }, { passive: false });
    }
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && selectedId)
            selectEntity(null);
    });
    drawGutter();
    render();
    document.documentElement.setAttribute('data-procflow-ready', String(typeof parseSchema === 'function' && typeof toMermaidER === 'function'));
})();
//# sourceMappingURL=erd-page.js.map