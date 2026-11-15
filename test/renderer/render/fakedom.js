// A tiny DOM stand-in so the renderer's DOM building can run under node --test.
// It supports only what render/ and Temml use, plus helpers for assertions.

class FakeNode {
  constructor(nodeType, doc) {
    this.nodeType = nodeType;
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
  }

  appendChild(child) {
    if (child.nodeType === 11) {
      for (const c of [...child.childNodes]) this.appendChild(c);
      child.childNodes = [];
      return child;
    }
    if (child.parentNode) child.parentNode.childNodes = child.parentNode.childNodes.filter((c) => c !== child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n);
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }

  get firstChild() { return this.childNodes[0] || null; }

  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    if (this.nodeType === 3) { this.data = String(v); return; }
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
}

class FakeElement extends FakeNode {
  constructor(tag, doc, ns = null) {
    super(1, doc);
    this.tagName = ns ? tag : tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    const self = this;
    this.classList = {
      add: (...k) => { self.className = [...new Set([...self.classNames(), ...k])].join(' '); },
      remove: (...k) => { self.className = self.classNames().filter((c) => !k.includes(c)).join(' '); },
      contains: (k) => self.classNames().includes(k),
      toggle: (k, force) => {
        const on = force === undefined ? !self.classNames().includes(k) : !!force;
        if (on) self.classList.add(k); else self.classList.remove(k);
        return on;
      },
    };
  }

  classNames() { return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean); }

  get className() { return this.getAttribute('class') || ''; }

  set className(v) { this.setAttribute('class', String(v)); }

  setAttribute(k, v) { this.attributes.set(String(k).toLowerCase(), String(v)); }

  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }

  hasAttribute(k) { return this.attributes.has(k); }

  removeAttribute(k) { this.attributes.delete(k); }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }

  dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...event }); }

  click() { this.dispatch('click'); }

  /** All descendant elements matching a predicate. */
  findAll(pred) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) {
          if (pred(c)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }

  /** Very small selector support: 'tag', '.class', 'tag.class'. */
  querySelectorAll(sel) {
    const [tag, ...classes] = sel.split('.');
    return this.findAll((e) => (!tag || e.localName === tag) && classes.every((k) => e.classList.contains(k)));
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  /** Serialized markup, for assertions. */
  get outerHTML() {
    const attrs = [...this.attributes].map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`).join('');
    const inner = this.childNodes.map((c) => (c.nodeType === 3 ? c.data.replace(/&/g, '&amp;').replace(/</g, '&lt;') : c.outerHTML)).join('');
    return `<${this.localName}${attrs}>${inner}</${this.localName}>`;
  }
}

class FakeText extends FakeNode {
  constructor(data, doc) {
    super(3, doc);
    this.data = String(data);
  }
}

export function createFakeDocument() {
  const doc = {
    compatMode: 'CSS1Compat',
    createElement: (tag) => new FakeElement(tag, doc),
    createElementNS: (ns, tag) => new FakeElement(tag, doc, ns),
    createTextNode: (data) => new FakeText(data, doc),
    createDocumentFragment: () => {
      const f = new FakeNode(11, doc);
      return f;
    },
  };
  return doc;
}

/** Install a fake global document (Temml uses the global one). Call before importing render/. */
export function installFakeDocument() {
  const doc = createFakeDocument();
  globalThis.document = doc;
  return doc;
}
