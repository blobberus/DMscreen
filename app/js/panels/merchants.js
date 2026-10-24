// Merchants: shops for the campaign, by kind of place (Collector's, Capital, Artisan, Town, Village,
// Street). A shop lists what it sells, each with a synopsis and a price; double-click an item (or press
// Enter, or its arrow) for the full detail. The premade shops are content/merchants.json (indexed from
// The Thieves Guild's shop pages, the words our own). Your own categories, shops and items are the
// 'merchants' state document: kept in the repo on the website (screen/setup.json), in data/ on the PC.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { state } from '../core/state.js';
import { uid } from '../core/util.js';
import { openDialog, confirmDialog, showMenu, toast } from '../core/ui.js';
import { SITE } from '../core/mode.js';

let premade = null;
const loadPremade = () => (premade ||= fetch('content/merchants.json').then((r) => {
  if (!r.ok) throw new Error(`The premade merchants didn't load (${r.status}).`);
  return r.json();
}));

export default function createMerchants({ el, getState, setState, workspace }) {
  const saved = getState();
  let shopId = saved.shop || null;
  let itemId = null;
  let view = shopId ? 'shop' : 'list';               // narrow panes show one of: list, shop, item
  const open = new Set(saved.open || []);
  let query = '';
  let base = null;
  let D = null;

  const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Search every shop', 'aria-label': 'Search items' });
  const tree = h('div', { class: 'mc-tree', role: 'tree', 'aria-label': 'Merchants' });
  const main = h('section', { class: 'mc-main' });
  const root = h('div', { class: 'mc' },
    h('aside', { class: 'mc-side' },
      h('div', { class: 'mc-tools' },
        h('label', { class: 'search mc-search' }, icon('search'), search),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'A category of your own, for shops of your own', onclick: () => editCategory() }, icon('plus'), 'Category')),
      tree),
    main);
  el.append(root);
  main.append(h('p', { class: 'meta mc-loading' }, 'Opening the market…'));

  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); itemId = null; if (query) view = 'shop'; render(); });

  // ---- data: the premade shops with yours added -----------------------------------------------
  function merge() {
    const mine = state.get('merchants') || { categories: [], shops: [], items: [] };
    const cats = base.categories.map((c) => ({ ...c, custom: false, shops: c.shops.map((s) => ({ ...s, custom: false, category: c.id, items: s.items.slice() })) }));
    for (const c of mine.categories || []) cats.push({ id: c.id, name: c.name, blurb: c.blurb || '', custom: true, shops: [] });
    const catById = new Map(cats.map((c) => [c.id, c]));
    for (const s of mine.shops || []) {
      const cat = catById.get(s.category);
      if (cat) cat.shops.push({ id: s.id, name: s.name, type: s.type || 'Shop', blurb: s.blurb || '', custom: true, category: cat.id, items: [] });
    }
    const shopById = new Map(cats.flatMap((c) => c.shops).map((s) => [s.id, s]));
    for (const it of mine.items || []) {
      const s = shopById.get(it.shop);
      if (s) s.items.push({ id: it.id, name: it.name, price: it.price || '', summary: it.summary || '', custom: true, shop: it.shop, details: { kind: it.kind || 'Your items', text: it.text || '', weight: it.weight || undefined } });
    }
    const itemById = new Map();
    for (const s of shopById.values()) for (const it of s.items) itemById.set(it.id, { it, shop: s });
    D = { cats, catById, shopById, itemById };
  }

  // ---- the list of categories and shops --------------------------------------------------------
  function renderTree() {
    clear(tree);
    for (const cat of D.cats) {
      const isOpen = open.has(cat.id);
      const head = h('div', {
        class: 'mc-cat', role: 'treeitem', tabindex: 0, 'aria-expanded': String(isOpen), title: isOpen ? `Fold ${cat.name} away` : `Show the shops in ${cat.name}`,
        onclick: (e) => { if (!e.target.closest('button')) toggle(cat.id, isOpen); },
        onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle(cat.id, isOpen); } },
      },
      icon(isOpen ? 'chevron-down' : 'chevron-right', 'icon-sm mc-chev'),
      h('span', { class: 'mc-catname truncate' }, cat.name),
      cat.custom ? h('span', { class: 'mc-tag' }, 'yours') : null,
      h('span', { class: 'meta num' }, String(cat.shops.length)),
      h('span', { class: 'mc-spacer' }),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: `More for ${cat.name}`, 'aria-label': `More for ${cat.name}`, onclick: (e) => showMenu(e.currentTarget, [
        { label: 'New shop here', icon: 'plus', onClick: () => editShop(null, cat.id) },
        cat.custom ? { label: 'Edit this category', icon: 'edit', onClick: () => editCategory(cat) } : null,
        cat.custom ? { label: 'Delete this category', icon: 'trash', onClick: () => deleteCategory(cat) } : null,
      ], { align: 'end' }) }, icon('more')));
      tree.append(head);
      if (!isOpen) continue;
      if (!cat.shops.length) tree.append(h('p', { class: 'meta mc-none' }, 'No shops yet. Use ⋯ to add one.'));
      for (const s of cat.shops) {
        tree.append(h('button', {
          class: `mc-shop ${s.id === shopId ? 'is-selected' : ''}`, type: 'button', role: 'treeitem', 'aria-selected': String(s.id === shopId),
          onclick: () => openShop(s.id),
        },
        h('span', { class: 'mc-shopname truncate' }, s.name, s.custom ? h('span', { class: 'mc-tag' }, 'yours') : null),
        h('span', { class: 'meta truncate' }, `${s.type} · ${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}`)));
      }
    }
  }
  function toggle(id, isOpen) {
    if (isOpen) open.delete(id); else open.add(id);
    setState({ open: [...open], shop: shopId });
    renderTree();
  }

  // ---- the main area: a shop, search results, or one item --------------------------------------
  function render() {
    if (!D) return;
    renderTree();
    clear(main);
    if (itemId && D.itemById.has(itemId)) renderItem(D.itemById.get(itemId));
    else if (query) renderSearch();
    else if (shopId && D.shopById.has(shopId)) renderShop(D.shopById.get(shopId));
    else renderIntro();
    layout();
  }

  // narrow panes only, except back from an item, which every pane needs
  function back(label, run, always = false) {
    return h('button', { class: `btn btn-sm mc-back ${always ? 'is-always' : ''}`, type: 'button', onclick: run }, icon('back'), label);
  }

  function renderIntro() {
    main.append(back('Merchants', () => { view = 'list'; layout(); }),
      h('div', { class: 'empty mc-intro' },
        h('strong', null, 'Choose a shop'),
        h('span', null, 'Six kinds of place, from a village store to a collector of magic items. Each shop lists what it sells and for how much; double-click an item for everything about it. Add categories, shops and items of your own with the buttons and ⋯ menus.'),
        h('span', { class: 'meta' }, base.about)));
  }

  function renderShop(s) {
    const cat = D.catById.get(s.category);
    main.append(back('Merchants', () => { view = 'list'; layout(); }),
      h('header', { class: 'mc-head' },
        h('div', { class: 'mc-titles' },
          h('p', { class: 'meta' }, `${cat?.name || ''} · ${s.type}`),
          h('h2', { class: 'mc-h' }, s.name, s.custom ? h('span', { class: 'mc-tag' }, 'yours') : null),
          s.blurb ? h('p', { class: 'mc-blurb' }, s.blurb) : null,
          s.links?.length ? h('p', { class: 'mc-links' }, s.links.map((l) => h('a', { href: l.url, onclick: (e) => { e.preventDefault(); workspace.openSite(l.url); } }, l.label))) : null),
        h('div', { class: 'mc-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editItem(null, s.id) }, icon('plus'), 'Add item'),
          s.custom ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'More', 'aria-label': `More for ${s.name}`, onclick: (e) => showMenu(e.currentTarget, [
            { label: 'Edit this shop', icon: 'edit', onClick: () => editShop(s) },
            { label: 'Delete this shop', icon: 'trash', onClick: () => deleteShop(s) },
          ], { align: 'end' }) }, icon('more')) : null)));
    const list = h('div', { class: 'mc-items', role: 'listbox', 'aria-label': `What ${s.name} sells` });
    if (!s.items.length) list.append(h('p', { class: 'meta mc-none' }, 'Nothing for sale yet. Add an item.'));
    let group = null;
    for (const it of s.items) {
      const kind = it.details?.kind || 'Goods';
      if (kind !== group) { group = kind; list.append(h('div', { class: 'mc-group' }, kind)); }
      list.append(itemRow(it, s));
    }
    main.append(list, h('p', { class: 'meta mc-hint' }, 'Double-click an item, or use its arrow, for the details.'));
  }

  function renderSearch() {
    const hits = [];
    for (const cat of D.cats) for (const s of cat.shops) for (const it of s.items) {
      const text = `${it.name} ${it.summary} ${it.details?.kind || ''}`.toLowerCase();
      if (text.includes(query)) hits.push([it, s, cat]);
    }
    main.append(back('Merchants', () => { search.value = ''; query = ''; view = 'list'; render(); }),
      h('header', { class: 'mc-head' }, h('div', { class: 'mc-titles' }, h('p', { class: 'meta' }, 'Search'), h('h2', { class: 'mc-h' }, `${hits.length} ${hits.length === 1 ? 'item matches' : 'items match'} “${search.value.trim()}”`))));
    const list = h('div', { class: 'mc-items', role: 'listbox', 'aria-label': 'Search results' });
    for (const [it, s, cat] of hits.slice(0, 300)) list.append(itemRow(it, s, `${s.name} · ${cat.name}`));
    if (hits.length > 300) list.append(h('p', { class: 'meta mc-none' }, `And ${hits.length - 300} more. Narrow the search to see them.`));
    main.append(list);
  }

  function itemRow(it, s, where = null) {
    const row = h('div', {
      class: 'mc-item', role: 'option', tabindex: 0, title: 'Double-click for the details',
      ondblclick: (e) => { if (!e.target.closest('button')) openItem(it.id); },
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openItem(it.id); },
    },
    h('span', { class: 'mc-iname' }, h('span', { class: 'truncate' }, it.name), it.custom ? h('span', { class: 'mc-tag' }, 'yours') : null),
    h('span', { class: 'mc-isum truncate' }, where ? h('span', { class: 'faint' }, `${where} · `) : null, it.summary),
    h('span', { class: 'mc-iprice num' }, it.price || '—'),
    h('span', { class: 'mc-ibtns' },
      it.custom ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit or delete', 'aria-label': `More for ${it.name}`, onclick: (e) => showMenu(e.currentTarget, [
        { label: 'Edit this item', icon: 'edit', onClick: () => editItem(it, s.id) },
        { label: 'Delete this item', icon: 'trash', onClick: () => deleteItem(it) },
      ], { align: 'end' }) }, icon('more')) : null,
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Details', 'aria-label': `Details of ${it.name}`, onclick: () => openItem(it.id) }, icon('chevron-right'))));
    return row;
  }

  function renderItem({ it, shop: s }) {
    const d = it.details || {};
    const facts = [];
    const fact = (label, value) => { if (value) facts.push(h('dt', null, label), h('dd', null, value)); };
    fact('Price here', it.price);
    if (d.prices) fact('Cheap / usual / dear', [d.prices.cheap, d.prices.normal, d.prices.expensive].map((p) => p || '—').join('  ·  '));
    fact('Weight', d.weight);
    fact('Rarity', d.rarity ? `${d.rarity}${d.attunement ? ', requires attunement' : ''}` : null);
    fact('Sold in', d.where?.length ? d.where.join(', ') : null);
    fact('Stock', d.limited ? 'Limited: may be sold out' : null);
    fact('Shop', s.name);
    main.append(back(query ? 'Search results' : s.name, () => { itemId = null; view = 'shop'; render(); }, true),
      h('article', { class: 'mc-detail' },
        h('p', { class: 'meta' }, [d.kind, d.stats].filter(Boolean).join(' · ')),
        h('div', { class: 'mc-dhead' }, h('h2', { class: 'mc-h' }, it.name), h('span', { class: 'mc-dprice num' }, it.price || '')),
        it.summary ? h('p', { class: 'mc-lead' }, it.summary) : null,
        d.text && d.text !== it.summary ? h('p', { class: 'mc-text' }, d.text) : null,
        h('dl', { class: 'mc-facts' }, facts),
        it.custom ? h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editItem(it, s.id) }, icon('edit'), 'Edit'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => deleteItem(it) }, icon('trash'), 'Delete')) : null));
  }

  function openShop(id) {
    shopId = id;
    itemId = null;
    const cat = D.shopById.get(id)?.category;
    if (cat) open.add(cat);
    view = 'shop';
    if (query) { search.value = ''; query = ''; }
    setState({ shop: id, open: [...open] });
    render();
    main.scrollTop = 0;
  }
  function openItem(id) {
    itemId = id;
    view = 'item';
    render();
    main.scrollTop = 0;
  }

  // In a narrow pane: the list, or the shop, or the item, each with a way back.
  function layout() {
    const narrow = root.clientWidth > 0 && root.clientWidth < 640;
    root.classList.toggle('is-narrow', narrow);
    root.classList.toggle('show-main', narrow && view !== 'list');
  }

  // ---- your own categories, shops and items --------------------------------------------------------
  function form(title, fields, values, onSave) {
    const inputs = {};
    const body = h('div', { class: 'stack mc-form' }, fields.map((f) => {
      const input = f.type === 'textarea' ? h('textarea', { class: 'input', rows: 4, placeholder: f.placeholder || '' })
        : f.type === 'select' ? h('select', { class: 'select' }, f.options.map(([v, l]) => h('option', { value: v, selected: values[f.key] === v }, l)))
          : h('input', { class: 'input', placeholder: f.placeholder || '', maxlength: f.max || 120 });
      if (f.type !== 'select') input.value = values[f.key] || '';
      inputs[f.key] = input;
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), input, f.hint ? h('span', { class: 'field-hint' }, f.hint) : null);
    }));
    openDialog({
      title, body,
      actions: [
        { label: 'Cancel' },
        { label: 'Save', kind: 'primary', onClick: () => {
          const out = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
          const missing = fields.find((f) => f.required && !out[f.key]);
          if (missing) { inputs[missing.key].focus(); return false; }
          onSave(out);
          return true;
        } },
      ],
    });
  }
  const savedNote = () => toast(SITE ? 'Saved. It goes to the repo with the rest of the setup.' : 'Saved.', { type: 'ok' });
  const change = (fn) => state.update('merchants', (d) => { d.categories ||= []; d.shops ||= []; d.items ||= []; fn(d); });

  function editCategory(cat = null) {
    form(cat ? 'Edit the category' : 'New category', [
      { key: 'name', label: 'Name', required: true, placeholder: 'Port District, Dwarven Hold, Night Market…' },
      { key: 'blurb', label: 'Description', type: 'textarea', placeholder: 'What kind of place this is' },
    ], cat || {}, (v) => {
      if (cat) change((d) => Object.assign(d.categories.find((c) => c.id === cat.id), v));
      else { const id = uid('mcat'); open.add(id); setState({ open: [...open] }); change((d) => d.categories.push({ id, ...v })); }
      savedNote();
    });
  }
  function editShop(s = null, category = null) {
    form(s ? 'Edit the shop' : 'New shop', [
      { key: 'name', label: 'Name', required: true, placeholder: 'The Rusty Nail' },
      { key: 'type', label: 'Kind of shop', placeholder: 'Blacksmith, tavern, jeweler…' },
      { key: 'category', label: 'Category', type: 'select', options: D.cats.map((c) => [c.id, c.name]) },
      { key: 'blurb', label: 'Description', type: 'textarea', placeholder: 'Who runs it and what it is like' },
    ], s ? { ...s } : { category, type: '' }, (v) => {
      if (s) change((d) => Object.assign(d.shops.find((x) => x.id === s.id), v));
      else {
        // open the new shop: set it before the change, which redraws
        const id = uid('mshop');
        open.add(v.category);
        shopId = id;
        itemId = null;
        view = 'shop';
        setState({ shop: id, open: [...open] });
        change((d) => d.shops.push({ id, ...v }));
      }
      savedNote();
    });
  }
  function editItem(it = null, shop = null) {
    const current = it ? { name: it.name, price: it.price, summary: it.summary, kind: it.details?.kind === 'Your items' ? '' : it.details?.kind, weight: it.details?.weight, text: it.details?.text, shop: it.shop || shop } : { shop };
    form(it ? 'Edit the item' : 'New item', [
      { key: 'name', label: 'Name', required: true, placeholder: 'Ironwood Shield' },
      { key: 'price', label: 'Price', placeholder: '25 gp', max: 40 },
      { key: 'summary', label: 'Synopsis', placeholder: 'One line: what it is' },
      { key: 'kind', label: 'Section', placeholder: 'Weapons, Armor, Food…', hint: 'Items are grouped by section in the shop.' },
      { key: 'weight', label: 'Weight', placeholder: '6 lb.', max: 40 },
      { key: 'text', label: 'Details', type: 'textarea', placeholder: 'Everything else: what it does, where it came from' },
      { key: 'shop', label: 'Shop', type: 'select', options: D.cats.flatMap((c) => c.shops.map((x) => [x.id, `${c.name} › ${x.name}`])) },
    ], current, (v) => {
      if (it) change((d) => Object.assign(d.items.find((x) => x.id === it.id), v));
      else change((d) => d.items.push({ id: uid('mitem'), ...v }));
      savedNote();
    });
  }
  async function deleteCategory(cat) {
    const shops = cat.shops.length;
    if (!(await confirmDialog(`Delete “${cat.name}”${shops ? ` and its ${shops} ${shops === 1 ? 'shop' : 'shops'}, with everything in them` : ''}?`, { okLabel: 'Delete', danger: true }))) return;
    const shopIds = new Set(cat.shops.map((s) => s.id));
    change((d) => {
      d.categories = d.categories.filter((c) => c.id !== cat.id);
      d.shops = d.shops.filter((s) => !shopIds.has(s.id));
      d.items = d.items.filter((i) => !shopIds.has(i.shop));
    });
    if (shopIds.has(shopId)) { shopId = null; view = 'list'; }
  }
  async function deleteShop(s) {
    const mine = (state.get('merchants').items || []).filter((i) => i.shop === s.id).length;
    if (!(await confirmDialog(`Delete “${s.name}”${mine ? ` and its ${mine} ${mine === 1 ? 'item' : 'items'}` : ''}?`, { okLabel: 'Delete', danger: true }))) return;
    change((d) => { d.shops = d.shops.filter((x) => x.id !== s.id); d.items = d.items.filter((i) => i.shop !== s.id); });
    shopId = null;
    view = 'list';
  }
  async function deleteItem(it) {
    if (!(await confirmDialog(`Delete “${it.name}”?`, { okLabel: 'Delete', danger: true }))) return;
    change((d) => { d.items = d.items.filter((x) => x.id !== it.id); });
    if (itemId === it.id) { itemId = null; view = 'shop'; }
  }

  // ---- start ---------------------------------------------------------------------------------------
  loadPremade().then((p) => {
    base = p;
    merge();
    if (shopId && D.shopById.has(shopId)) open.add(D.shopById.get(shopId).category);
    render();
  }).catch((e) => {
    clear(main);
    main.append(h('div', { class: 'empty' }, h('strong', null, 'The merchants didn’t load'), h('span', null, e.message)));
  });
  const offs = [bus.on('state:merchants', () => { if (base) { merge(); render(); } })];
  return {
    show: layout,
    resize: layout,
    destroy() { offs.forEach((off) => off()); },
  };
}
