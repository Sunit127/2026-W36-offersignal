import { analyzeOffer, safeParse } from './logic.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#offer-form');
const STORAGE_KEY = 'offersignal-checks-v1';
const API_BASE = globalThis.OFFERSIGNAL_API_BASE || '';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentResult = null;

function values() {
  const formData = new FormData(form);

  return {
    label: formData.get('label'),
    channel: formData.get('channel'),
    senderEmail: formData.get('senderEmail'),
    message: formData.get('message'),
    applied: formData.get('applied') === 'on',
    interviewed: formData.get('interviewed') === 'on',
    verified: formData.get('verified') === 'on',
  };
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function initTiltForElement(element) {
  if (element.dataset.tiltBound === '1') {
    return;
  }

  element.dataset.tiltBound = '1';
  const depth = Number.parseFloat(element.dataset.depth || '1');

  let raf = null;

  const reset = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }

    element.style.removeProperty('--tilt-rotate-x');
    element.style.removeProperty('--tilt-rotate-y');
    element.style.removeProperty('--tilt-scale');
    element.style.removeProperty('--tilt-translate-z');
  };

  const move = (event) => {
    if (prefersReducedMotion.matches) {
      return;
    }

    if (raf) {
      cancelAnimationFrame(raf);
    }

    raf = requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const progressX = (event.clientX - rect.left) / rect.width;
      const progressY = (event.clientY - rect.top) / rect.height;

      const rotateX = (progressY - 0.5) * -9 * depth;
      const rotateY = (progressX - 0.5) * 11 * depth;
      const distance = Math.hypot(progressX - 0.5, progressY - 0.5);
      const translateZ = Math.max(5, 18 * (1 - distance) * depth);
      const scale = 1 + Math.min(0.025, distance * 0.035);

      element.style.setProperty('--tilt-rotate-x', `${rotateX.toFixed(2)}deg`);
      element.style.setProperty('--tilt-rotate-y', `${rotateY.toFixed(2)}deg`);
      element.style.setProperty('--tilt-translate-z', `${translateZ.toFixed(2)}px`);
      element.style.setProperty('--tilt-scale', scale.toFixed(3));
    });
  };

  element.addEventListener('pointermove', move, { passive: true });
  element.addEventListener('pointerleave', reset, { passive: true });
  element.addEventListener('pointerup', reset, { passive: true });
  element.addEventListener('pointercancel', reset, { passive: true });
}

function initTiltScenes(root = document) {
  root.querySelectorAll('[data-tilt]').forEach(initTiltForElement);
}

function renderResult(result) {
  currentResult = result;

  $('#empty-output').hidden = true;
  $('#output').hidden = false;
  $('#result-name').textContent = result.label;

  const tier = $('#result-tier');
  tier.textContent = result.title;
  tier.className = `tier tier-${result.level}`;

  $('#result-summary').textContent = result.summary;
  $('#score-bar').style.width = `${result.score}%`;

  const findings = $('#findings');

  if (!result.matches.length) {
    const item = document.createElement('div');
    item.className = 'finding none';

    item.innerHTML =
      '<div class="finding-mark">✓</div><div><strong>No listed patterns matched</strong><span>Continue with independent identity and role verification.</span></div>';
    findings.replaceChildren(item);
  } else {
    findings.replaceChildren(
      ...result.matches.map((match, index) => {
        const item = document.createElement('div');
        item.className = 'finding';

        const mark = document.createElement('div');
        mark.className = 'finding-mark';
        mark.textContent = String(index + 1).padStart(2, '0');

        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = match.title;

        const reason = document.createElement('span');
        reason.textContent = match.why;

        text.append(title, reason);
        item.append(mark, text);
        return item;
      }),
    );
  }

  $('#actions').replaceChildren(...result.actions.map((action) => {
    const item = document.createElement('li');
    item.textContent = action;
    return item;
  }));
}

function savedChecks() {
  return safeParse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveChecks(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  renderSavedChecks();
}

function renderSavedChecks() {
  const checks = savedChecks();
  const wrapper = $('#saved-list');

  if (!checks.length) {
    wrapper.innerHTML = '<div class="saved-empty">Nothing saved. Completed checks stay private unless you choose “Save locally.”</div>';
    return;
  }

  wrapper.replaceChildren(
    ...checks.map((check, index) => {
      const card = document.createElement('article');
      card.className = 'saved-card';
      card.setAttribute('data-tilt', '');
      card.dataset.depth = '0.7';

      const title = document.createElement('h3');
      title.textContent = check.label;

      const summary = document.createElement('p');
      summary.textContent = `${new Date(check.createdAt).toLocaleDateString()} · ${check.title} · ${check.matches.length} pattern${check.matches.length === 1 ? '' : 's'}`;

      const open = document.createElement('button');
      open.className = 'button ghost';
      open.textContent = 'Review';
      open.onclick = () => {
        renderResult(check);
        location.hash = 'checker';
      };

      const remove = document.createElement('button');
      remove.className = 'link-button danger';
      remove.textContent = 'Delete';
      remove.onclick = () => {
        const next = savedChecks();
        next.splice(index, 1);
        saveChecks(next);
      };

      card.append(title, summary, open, remove);
      initTiltForElement(card);
      return card;
    }),
  );
}

async function shareCheck() {
  if (!currentResult) {
    return;
  }

  if (!API_BASE) {
    showToast('Team saving unavailable offline');
    return;
  }

  const button = $('#share-check');
  button.disabled = true;

  try {
    const { message, ...privacySafe } = currentResult;
    const response = await fetch(`${API_BASE.replace(/\/$/, '')}/api/v1/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(privacySafe),
    });

    if (!response.ok) {
      throw new Error('Server rejected the result');
    }

    const data = await response.json();
    showToast(`Saved to team vault: ${data.id.slice(0, 8)}`);
  } catch (error) {
    showToast('Could not save; check remains local');
  } finally {
    button.disabled = false;
  }
}

function wireUpForm() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const error = $('#form-error');
    error.hidden = true;

    try {
      renderResult(analyzeOffer(values()));
    } catch (error) {
      error.textContent = error.message;
      error.hidden = false;
      error.scrollIntoView({ behavior: 'smooth' });
    }
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      currentResult = null;
      $('#output').hidden = true;
      $('#empty-output').hidden = false;
      $('#form-error').hidden = true;
    }, 0);
  });

  $('#sample-button').onclick = () => {
    form.elements.label.value = 'Catalog quality assistant — sample';
    form.elements.channel.value = 'whatsapp';
    form.elements.senderEmail.value = 'talentdesk2026@gmail.com';
    form.elements.message.value =
      'Urgent remote opportunity. Complete sets of product optimization tasks and earn $500 daily. Recharge your account with USDT to unlock your commission. Act now within 2 hours.';
    form.elements.applied.checked = false;
    form.elements.interviewed.checked = false;
    form.elements.verified.checked = false;
    renderResult(analyzeOffer(values()));
    location.hash = 'checker';
  };
}

function wireUpActions() {
  $('#save-check').onclick = () => {
    if (!currentResult) {
      return;
    }

    saveChecks([{ ...currentResult, id: crypto.randomUUID() }, ...savedChecks()].slice(0, 30));
    showToast('Saved on this device');
  };

  $('#copy-checklist').onclick = async () => {
    if (!currentResult) {
      return;
    }

    const text = `OfferSignal verification checklist — ${currentResult.label}\n\n${currentResult.actions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`;

    try {
      await navigator.clipboard.writeText(text);
      showToast('Checklist copied');
    } catch (error) {
      showToast('Clipboard unavailable');
    }
  };

  $('#export-checks').onclick = () => {
    const exportItems = savedChecks().map(({ message, ...rest }) => ({ ...rest, messageOmitted: true }));

    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            privacyNote: 'Message bodies are omitted from export.',
            checks: exportItems,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );

    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'offersignal-checks.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  $('#share-check').onclick = shareCheck;

  $('#clear-checks').onclick = () => {
    if (confirm('Delete all locally saved OfferSignal checks?')) {
      localStorage.removeItem(STORAGE_KEY);
      renderSavedChecks();
    }
  };
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function bootstrap() {
  if (!prefersReducedMotion.matches) {
    initTiltScenes();
  }

  wireUpForm();
  wireUpActions();
  renderSavedChecks();
  registerServiceWorker();
}

prefersReducedMotion.addEventListener('change', () => {
  if (!prefersReducedMotion.matches) {
    initTiltScenes();
  }
});

bootstrap();
