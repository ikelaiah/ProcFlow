"use strict";
/* proc>flow v2.1.0 — shared resizable pane divider.
   Works on any page with a `.wrap` grid and a `#splitter` element between the
   two panes. Pointer, double-click reset, and arrow-key resizing; the width is
   session-only and never persisted. */
(function () {
    if (typeof document === 'undefined')
        return;
    var wrap = document.querySelector('.wrap');
    var splitter = document.getElementById('splitter');
    if (!wrap || !splitter)
        return;
    var MIN_LEFT = 240, MIN_RIGHT = 260, SPLITTER = 7;
    var dragging = false, startX = 0, startLeft = 0;
    function leftWidth() {
        var pane = wrap.querySelector('.pane');
        return pane ? pane.getBoundingClientRect().width : 0;
    }
    function setLeft(width) {
        var rect = wrap.getBoundingClientRect();
        var max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT - SPLITTER);
        var value = Math.max(MIN_LEFT, Math.min(width, max));
        wrap.style.setProperty('--pane-left', value + 'px');
    }
    function reset() {
        wrap.style.removeProperty('--pane-left');
    }
    splitter.addEventListener('pointerdown', function (event) {
        if (event.button !== 0)
            return;
        dragging = true;
        startX = event.clientX;
        startLeft = leftWidth();
        splitter.classList.add('active');
        event.preventDefault();
    });
    document.addEventListener('pointermove', function (event) {
        if (!dragging)
            return;
        setLeft(startLeft + event.clientX - startX);
    });
    var stop = function () {
        if (!dragging)
            return;
        dragging = false;
        splitter.classList.remove('active');
    };
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    splitter.addEventListener('dblclick', reset);
    splitter.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setLeft(leftWidth() - 24);
        }
        else if (event.key === 'ArrowRight') {
            event.preventDefault();
            setLeft(leftWidth() + 24);
        }
        else if (event.key === 'Home') {
            event.preventDefault();
            reset();
        }
    });
    window.addEventListener('resize', function () {
        if (wrap.style.getPropertyValue('--pane-left'))
            setLeft(leftWidth());
    });
})();
//# sourceMappingURL=splitter.js.map