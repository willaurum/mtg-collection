/* Window collection rows while keeping the complete filtered order in app state. */
class CollectionWindow {
  constructor(root, tileHtml, onRender) {
    this.root = root;
    this.scroller = root.closest('.view-body');
    this.tileHtml = tileHtml;
    this.onRender = onRender;
    this.entries = [];
    this.nodes = new Map();
    this.heights = new Map();
    root.classList.add('windowed-collection');
    root.setAttribute('role', 'list');
    this.schedule = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
    };
    this.scroller.addEventListener('scroll', this.schedule, {passive: true});
    this.observer = new ResizeObserver(this.schedule);
    this.observer.observe(root);
    this.observer.observe(this.scroller);
    root.addEventListener('keydown', event => {
      const tile = event.target.closest('.coll-card');
      if (!tile) return;
      const index = Number(tile.dataset.windowIndex);
      let next;
      if (event.target === tile && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        next = event.key === 'Home' ? 0 : event.key === 'End' ? this.entries.length - 1 :
          index + ({ArrowDown: this.columns, ArrowUp: -this.columns, ArrowLeft: -1, ArrowRight: 1}[event.key]);
      } else if (event.key === 'Tab') {
        const stops = [tile, ...tile.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
        if (event.shiftKey && event.target === tile) next = index - 1;
        if (!event.shiftKey && event.target === stops.at(-1)) next = index + 1;
      }
      if (next === undefined || next < 0 || next >= this.entries.length) return;
      event.preventDefault();
      this.focusIndex(next);
    });
  }

  setEntries(entries) {
    const active = document.activeElement?.closest('.coll-card');
    const focusedId = active && this.root.contains(active) ? active.dataset.id : null;
    this.entries = entries;
    this.nodes.clear();
    this.heights.clear();
    this.root.replaceChildren();
    this.render();
    if (focusedId) {
      const index = entries.findIndex(entry => entry.id === focusedId);
      if (index >= 0) this.focusIndex(index);
    }
  }

  offsets() {
    const offsets = [0];
    for (let row = 0; row < Math.ceil(this.entries.length / this.columns); row++) {
      offsets.push(offsets[row] + (this.heights.get(row) || this.estimate) + this.gap);
    }
    return offsets;
  }

  focusIndex(index) {
    const offsets = this.offsets();
    this.scroller.scrollTop = this.scroller.scrollTop + this.root.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + offsets[Math.floor(index / this.columns)];
    this.render(index);
    this.nodes.get(index)?.focus({preventScroll: true});
  }

  render(forceIndex) {
    if (!this.root.getClientRects().length) return;
    const style = getComputedStyle(this.root);
    const list = this.root.classList.contains('list-view');
    const widths = style.gridTemplateColumns.split(' ').map(Number.parseFloat).filter(Number.isFinite);
    const columns = list ? 1 : Math.max(1, widths.length);
    const width = this.root.clientWidth;
    const scale = Number.parseFloat(style.getPropertyValue('--text-scale')) || 1;
    const layout = `${columns}:${width}:${list}:${scale}:${style.rowGap}`;
    if (this.layout !== layout) { this.heights.clear(); this.layout = layout; }
    this.columns = columns;
    this.gap = Number.parseFloat(style.rowGap) || 0;
    const columnGap = Number.parseFloat(style.columnGap) || 0;
    const tileWidth = (width - columnGap * (columns - 1)) / columns;
    this.estimate = list ? 84 * scale : tileWidth * 680 / 488 + 80 * scale;
    const top = this.scroller.getBoundingClientRect().top - this.root.getBoundingClientRect().top;
    let offsets = this.offsets();
    const rows = offsets.length - 1;
    let start = 0;
    while (start < rows - 1 && offsets[start + 1] < top) start++;
    let end = start;
    while (end < rows && offsets[end] < top + this.scroller.clientHeight) end++;
    start = Math.max(0, start - 2);
    end = Math.min(rows, end + 2);
    const wanted = new Set();
    for (let i = start * columns; i < Math.min(this.entries.length, end * columns); i++) wanted.add(i);
    const active = document.activeElement?.closest('.coll-card');
    const pinned = forceIndex ?? (active && this.root.contains(active) ? Number(active.dataset.windowIndex) : null);
    if (pinned !== null) {
      const rowStart = Math.floor(pinned / columns) * columns;
      for (let i = rowStart; i < Math.min(rowStart + columns, this.entries.length); i++) wanted.add(i);
    }
    let changed = false;
    for (const [index, node] of this.nodes) {
      if (!wanted.has(index)) { node.remove(); this.nodes.delete(index); changed = true; }
    }
    for (const index of [...wanted].sort((a, b) => a - b)) {
      if (!this.nodes.has(index)) {
        const template = document.createElement('template');
        template.innerHTML = this.tileHtml(this.entries[index]);
        const node = template.content.firstElementChild;
        node.dataset.windowIndex = index;
        node.setAttribute('role', 'listitem');
        node.setAttribute('aria-posinset', index + 1);
        node.setAttribute('aria-setsize', this.entries.length);
        this.nodes.set(index, node);
        const after = [...this.root.children].find(child => Number(child.dataset.windowIndex) > index);
        this.root.insertBefore(node, after || null);
        changed = true;
      }
      const node = this.nodes.get(index);
      node.style.width = `${tileWidth}px`;
      node.style.left = `${(index % columns) * (tileWidth + columnGap)}px`;
    }
    if (changed) this.onRender();
    const measured = new Map();
    for (const [index, node] of this.nodes) {
      const row = Math.floor(index / columns);
      measured.set(row, Math.max(measured.get(row) || 0, node.getBoundingClientRect().height));
    }
    for (const [row, height] of measured) this.heights.set(row, height);
    offsets = this.offsets();
    this.root.style.height = `${Math.max(0, offsets.at(-1) - this.gap)}px`;
    for (const [index, node] of this.nodes) node.style.top = `${offsets[Math.floor(index / columns)]}px`;
    // Also synchronize selections when filtering produces no mounted cards.
    if (!changed) this.onRender();
  }
}
