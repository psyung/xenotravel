const normalize = (value) => value.trim().normalize('NFKC').toLowerCase();

export function matchSuggestions(options, value) {
  const q = normalize(value);
  if (!q) return [];
  return options.flatMap((option) => {
    const fields = [option.value, option.detail, ...(option.keywords ?? [])].map(normalize);
    const rank = fields[0].startsWith(q) ? 0 : fields.some((field) => field.startsWith(q)) ? 1 :
      fields.some((field) => field.includes(q)) ? 2 : -1;
    return rank < 0 ? [] : [{ option, rank }];
  }).sort((a, b) => a.rank - b.rank).slice(0, 8).map(({ option }) => option);
}

export function enhanceSuggestions(input, options) {
  const list = document.createElement('ul');
  list.id = `${input.id}-suggestions`;
  list.className = 'suggestions';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', input.getAttribute('aria-label') || input.labels[0].firstChild.textContent.trim());
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.after(list);
  let matches = [];
  let active = -1;

  function setActive(index) {
    active = index;
    for (const [i, row] of [...list.children].entries()) row.setAttribute('aria-selected', String(i === index));
    const row = list.children[index];
    if (row) {
      input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function render() {
    matches = matchSuggestions(options(), input.value);
    list.replaceChildren(...matches.map(({ value, detail }, index) => {
      const row = document.createElement('li');
      row.id = `${list.id}-${index}`;
      row.dataset.index = index;
      row.setAttribute('role', 'option');
      const name = document.createElement('strong');
      name.textContent = value;
      const meta = document.createElement('small');
      meta.textContent = detail;
      row.append(name, meta);
      return row;
    }));
    close();
    if (!matches.length) return;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function select(index) {
    input.value = matches[index].value;
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  close();
  input.addEventListener('input', render);
  input.addEventListener('compositionend', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) render();
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = active < 0 && e.key === 'ArrowUp' ? matches.length - 1 : active + (e.key === 'ArrowDown' ? 1 : -1);
      setActive((next + matches.length) % matches.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      select(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-index]');
    if (row) select(Number(row.dataset.index));
  });
}
