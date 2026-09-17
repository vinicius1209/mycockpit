function () {
  const interessante = 'button,a[href],input,select,textarea,label,summary,[role],[aria-label],h1,h2,h3,img';
  let el = this.nodeType === 1 ? this : this.parentElement;
  const alvo = el && (el.closest(interessante) || el);
  if (!alvo) return null;
  const papelImplicito = { BUTTON: 'button', A: 'link', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', SUMMARY: 'button', LABEL: 'label' };
  const papel = alvo.getAttribute('role') || papelImplicito[alvo.tagName] || alvo.tagName.toLowerCase();
  const texto = (alvo.innerText || '').replace(/\s+/g, ' ').trim();
  const nome = (alvo.getAttribute('aria-label') || texto || alvo.getAttribute('title') || alvo.getAttribute('alt') || alvo.getAttribute('placeholder') || alvo.value || '').toString().slice(0, 120);
  const seletor = (() => {
    if (alvo.id) return '#' + CSS.escape(alvo.id);
    const partes = [];
    let n = alvo;
    while (n && n.nodeType === 1 && partes.length < 4) {
      let p = n.tagName.toLowerCase();
      if (n.id) { partes.unshift('#' + CSS.escape(n.id)); break; }
      const irmaos = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : [];
      if (irmaos.length > 1) p += ':nth-of-type(' + (irmaos.indexOf(n) + 1) + ')';
      partes.unshift(p);
      n = n.parentElement;
    }
    return partes.join(' > ');
  })();
  const r = alvo.getBoundingClientRect();
  return { papel, nome, seletor, tag: alvo.tagName.toLowerCase(), caixa: { x: r.x, y: r.y, largura: r.width, altura: r.height } };
}