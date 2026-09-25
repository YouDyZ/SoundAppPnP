(function () {
  function getRoot() {
    return document.getElementById('modal-root');
  }

  function buildBox({ title, message }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    if (title) {
      const h = document.createElement('h2');
      h.textContent = title;
      box.appendChild(h);
    }
    if (message) {
      const p = document.createElement('p');
      p.textContent = message;
      box.appendChild(p);
    }
    overlay.appendChild(box);
    return { overlay, box };
  }

  /**
   * Shows a modal with arbitrary buttons; resolves with the clicked button's
   * `value` (or undefined if dismissed via Escape).
   * buttons: [{ label, value, variant: 'primary'|'danger'|undefined }]
   */
  function showModal({ title, message, buttons }) {
    return new Promise((resolve) => {
      const root = getRoot();
      root.innerHTML = '';
      const { overlay, box } = buildBox({ title, message });

      const actions = document.createElement('div');
      actions.className = 'modal-actions';

      function close(value) {
        root.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }

      function onKey(e) {
        if (e.key === 'Escape') close(undefined);
      }

      buttons.forEach((btn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = btn.label;
        b.className = `btn${btn.variant === 'primary' ? ' btn-primary' : ''}${btn.variant === 'danger' ? ' btn-danger' : ''}`;
        b.addEventListener('click', () => close(btn.value));
        actions.appendChild(b);
      });

      box.appendChild(actions);
      root.appendChild(overlay);
      document.addEventListener('keydown', onKey);
      actions.querySelector('button')?.focus();
    });
  }

  function confirmModal(message, opts = {}) {
    return showModal({
      title: opts.title,
      message,
      buttons: [
        { label: opts.cancelLabel || 'Abbrechen', value: false },
        { label: opts.confirmLabel || 'OK', value: true, variant: opts.danger ? 'danger' : 'primary' },
      ],
    }).then((v) => !!v);
  }

  function promptModal(message, opts = {}) {
    return new Promise((resolve) => {
      const root = getRoot();
      root.innerHTML = '';
      const { overlay, box } = buildBox({ title: opts.title, message });

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'modal-input';
      input.value = opts.defaultValue || '';
      box.appendChild(input);

      const actions = document.createElement('div');
      actions.className = 'modal-actions';

      function close(value) {
        root.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }

      function onKey(e) {
        if (e.key === 'Escape') close(null);
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn';
      cancelBtn.textContent = opts.cancelLabel || 'Abbrechen';
      cancelBtn.addEventListener('click', () => close(null));

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-primary';
      okBtn.textContent = opts.confirmLabel || 'Speichern';
      okBtn.addEventListener('click', () => close(input.value.trim() || null));

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(input.value.trim() || null);
      });

      actions.append(cancelBtn, okBtn);
      box.appendChild(actions);
      root.appendChild(overlay);
      document.addEventListener('keydown', onKey);
      input.focus();
      input.select();
    });
  }

  window.SB = window.SB || {};
  window.SB.modal = { showModal, confirmModal, promptModal };
})();
