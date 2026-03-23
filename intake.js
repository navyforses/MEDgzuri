// ═══════════════ LANGUAGE SYSTEM ═══════════════
let currentLang = 'ka';

function detectLang() {
  // 1. URL query param: ?lang=en
  const params = new URLSearchParams(window.location.search);
  const urlLang = params.get('lang');
  if (urlLang && brandConfig[urlLang]) return urlLang;

  // 2. URL path: /en/, /ru/, /ka/
  const path = window.location.pathname;
  if (path.startsWith('/ru')) return 'ru';
  if (path.startsWith('/en')) return 'en';
  if (path.startsWith('/ka')) return 'ka';

  // 3. Saved preference
  const saved = localStorage.getItem('medGzuriLang');
  if (saved && brandConfig[saved]) return saved;

  // 4. Browser language
  const bl = (navigator.language || '').toLowerCase();
  if (bl.startsWith('ka')) return 'ka';
  if (bl.startsWith('ru') || bl.startsWith('kk') || bl.startsWith('uk') || bl.startsWith('uz')) return 'ru';

  // 5. Default: en for international visitors
  return 'en';
}

function setLang(lang) {
  if (!brandConfig[lang]) return;
  currentLang = lang;

  // Set data-lang on <html> for CSS theming
  const root = document.documentElement;
  root.setAttribute('data-lang', lang);
  root.setAttribute('lang', lang === 'ka' ? 'ka' : lang === 'ru' ? 'ru' : 'en');

  // Persist
  localStorage.setItem('medGzuriLang', lang);

  // Update URL without reload
  const url = new URL(window.location);
  url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);

  // Update active button state (all switchers)
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang-btn') === lang);
  });

  // Render intake content
  renderIntake(lang);

  // Update document title
  const cfg = brandConfig[lang];
  const intake = cfg.intake;
  document.title = cfg.name + ' — ' + intake.pageTitle;
}

// Lang-switcher click handlers
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.getAttribute('data-lang-btn'));
    });
  });
});

// ═══════════════ RENDER HELPERS ═══════════════

function renderCheckboxGrid(containerId, items, groupName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Save current checked state by value
  const checked = new Set();
  container.querySelectorAll('input[type="checkbox"]:checked').forEach(input => {
    checked.add(input.value);
  });

  container.innerHTML = '';

  items.forEach(item => {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    label.setAttribute('data-id', item.id);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = groupName;
    input.value = item.id;

    const mark = document.createElement('span');
    mark.className = 'checkbox-mark';
    mark.textContent = '✓';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'checkbox-label';
    labelSpan.textContent = item.label;

    label.appendChild(input);
    label.appendChild(mark);
    label.appendChild(labelSpan);

    // Restore checked state
    if (checked.has(item.id)) {
      input.checked = true;
      label.classList.add('checked');
    }

    // Toggle checked class on click
    label.addEventListener('click', () => {
      // Defer until after checkbox state updates
      setTimeout(() => {
        label.classList.toggle('checked', input.checked);
        // For diagnosis grid, show/hide other field
        if (groupName === 'diagnosis' && item.id === 'other') {
          const diagOtherGroup = document.getElementById('diagOtherGroup');
          if (diagOtherGroup) {
            diagOtherGroup.style.display = input.checked ? 'block' : 'none';
          }
        }
      }, 0);
    });

    container.appendChild(label);
  });
}

function renderRadioGroup(containerId, options, groupName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Save current selected value
  let selectedValue = null;
  const existing = container.querySelector('input[type="radio"]:checked');
  if (existing) selectedValue = existing.value;

  container.innerHTML = '';

  options.forEach(opt => {
    let value, labelText;
    if (typeof opt === 'string') {
      value = opt;
      labelText = opt;
    } else if (opt.v !== undefined) {
      // prefer options with v/l
      value = opt.v;
      labelText = opt.l;
    } else {
      // value/label format
      value = opt.value;
      labelText = opt.label;
    }

    const label = document.createElement('label');
    label.className = 'radio-item';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = value;

    const mark = document.createElement('span');
    mark.className = 'radio-mark';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'radio-label';
    labelSpan.textContent = labelText;

    label.appendChild(input);
    label.appendChild(mark);
    label.appendChild(labelSpan);

    // Restore selected state
    if (value === selectedValue) {
      input.checked = true;
      label.classList.add('selected');
    }

    // Toggle selected class on click
    label.addEventListener('click', () => {
      container.querySelectorAll('.radio-item').forEach(item => item.classList.remove('selected'));
      setTimeout(() => {
        if (input.checked) label.classList.add('selected');
      }, 0);
    });

    container.appendChild(label);
  });
}

// ═══════════════ MAIN RENDER FUNCTION ═══════════════

function renderIntake(lang) {
  const cfg = brandConfig[lang];
  if (!cfg) return;
  const intake = cfg.intake;

  // Brand name
  const brandNameEl = document.getElementById('brandName');
  if (brandNameEl) brandNameEl.textContent = cfg.name;

  // Badge
  const badgeEl = document.getElementById('intakeBadge');
  if (badgeEl) badgeEl.textContent = intake.badge;

  // Progress bar step labels
  const progressSteps = document.querySelectorAll('[data-progress-step]');
  progressSteps.forEach(el => {
    const idx = parseInt(el.getAttribute('data-progress-step'), 10);
    if (intake.steps[idx]) {
      el.textContent = intake.steps[idx].label;
    }
  });

  // ── Intro panel ──
  const intro = intake.intro;
  setText('introTitle', intro.title);
  setText('introDesc', intro.desc);
  setText('howTitle', intro.howTitle);

  const howStepsList = document.getElementById('howStepsList');
  if (howStepsList) {
    howStepsList.innerHTML = '';
    const lines = intro.howSteps.split('\n').filter(Boolean);
    lines.forEach(line => {
      const li = document.createElement('li');
      li.textContent = line;
      howStepsList.appendChild(li);
    });
  }

  setText('howNote', intro.howNote);

  const statsContainer = document.getElementById('introStats');
  if (statsContainer && intro.stats) {
    statsContainer.innerHTML = '';
    intro.stats.forEach(stat => {
      const div = document.createElement('div');
      div.className = 'stat-item';
      div.innerHTML = '<span class="stat-number">' + stat.n + '</span><span class="stat-text">' + stat.t + '</span>';
      statsContainer.appendChild(div);
    });
  }

  const btnStart = document.getElementById('btnStart');
  if (btnStart) btnStart.textContent = intake.nav.start;

  // ── Child panel ──
  const child = intake.child;
  setText('childTitle', child.title);
  setText('childSubtitle', child.subtitle);
  setLabel('childNameLabel', child.nameLabel);
  setPlaceholder('childName', child.namePlaceholder);
  setLabel('childAgeLabel', child.ageLabel);

  const ageUnitEl = document.getElementById('ageUnit');
  if (ageUnitEl && child.ageUnits) {
    // Save current selection
    const currentVal = ageUnitEl.value;
    ageUnitEl.innerHTML = '';
    child.ageUnits.forEach((unit, idx) => {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.textContent = unit;
      ageUnitEl.appendChild(opt);
    });
    if (currentVal) ageUnitEl.value = currentVal;
  }

  setLabel('countryLabel', child.countryLabel);

  const countrySelect = document.getElementById('countrySelect');
  if (countrySelect && child.countries) {
    // Save current selection
    const currentCountry = countrySelect.value;
    countrySelect.innerHTML = '';
    // Default empty option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '—';
    countrySelect.appendChild(defaultOpt);

    child.countries.forEach((country, idx) => {
      const opt = document.createElement('option');
      // Last item in list is "other"
      opt.value = idx === child.countries.length - 1 ? 'other' : country;
      opt.textContent = country;
      countrySelect.appendChild(opt);
    });

    if (currentCountry) countrySelect.value = currentCountry;
  }

  setPlaceholder('otherCountry', child.otherCountryPlaceholder);

  // ── Diagnosis panel ──
  const diagnosis = intake.diagnosis;
  setText('diagTitle', diagnosis.title);
  setText('diagSubtitle', diagnosis.subtitle);
  renderCheckboxGrid('diagGrid', diagnosis.items, 'diagnosis');
  setPlaceholder('diagOther', diagnosis.otherPlaceholder);
  setLabel('detailsLabel', diagnosis.detailsLabel);
  setPlaceholder('conditionDetails', diagnosis.detailsPlaceholder);
  setLabel('treatmentLabel', diagnosis.treatmentLabel);
  setPlaceholder('treatmentDetails', diagnosis.treatmentPlaceholder);
  setLabel('mriLabel', diagnosis.mriLabel);
  renderRadioGroup('mriOptions', diagnosis.mriOptions, 'mri');

  // Documents upload
  setText('documentsLabel', diagnosis.documentsLabel);
  setText('documentsHint', diagnosis.documentsHint);
  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) uploadBtn.textContent = diagnosis.documentsBtnText || '';
  setText('documentsFormats', diagnosis.documentsFormats);

  // ── Goals panel ──
  const goals = intake.goals;
  setText('goalsTitle', goals.title);
  setText('goalsSubtitle', goals.subtitle);
  renderCheckboxGrid('goalsGrid', goals.items, 'goals');
  setLabel('goalsOtherLabel', goals.otherLabel);
  setPlaceholder('goalsOther', goals.otherPlaceholder);

  // ── Survey panel ──
  const survey = intake.survey;
  setText('surveyTitle', survey.title);
  setText('surveySubtitle', survey.subtitle);
  setText('surveyQuestion', survey.question);
  renderRadioGroup('pricingOptions', survey.ranges, 'pricing');
  setLabel('surveyValueLabel', survey.valueLabel);
  setPlaceholder('surveyValue', survey.valuePlaceholder);
  setLabel('sourceLabel', survey.sourceLabel);
  renderRadioGroup('sourceOptions', survey.sources, 'source');

  // ── Contact panel ──
  const contact = intake.contact;
  setText('contactTitle', contact.title);
  setText('contactSubtitle', contact.subtitle);
  setLabel('contactNameLabel', contact.nameLabel);
  setPlaceholder('contactName', contact.namePlaceholder);
  setLabel('contactEmailLabel', contact.emailLabel);
  setPlaceholder('contactEmail', contact.emailPlaceholder);
  setLabel('contactPhoneLabel', contact.phoneLabel);
  setPlaceholder('contactPhone', contact.phonePlaceholder);
  setLabel('contactMessengerLabel', contact.messengerLabel);
  setPlaceholder('contactMessenger', contact.messengerPlaceholder);
  setLabel('preferLabel', contact.preferLabel);
  renderRadioGroup('preferOptions', contact.preferOptions, 'prefer');
  setText('consentText', contact.consent);

  // ── Done panel ──
  const done = intake.done;
  setText('doneTitle', done.title);
  setText('doneMessage', done.message);
  setText('doneNextTitle', done.nextTitle);

  const nextStepsList = document.getElementById('nextStepsList');
  if (nextStepsList) {
    nextStepsList.innerHTML = '';
    const lines = done.nextSteps.split('\n').filter(Boolean);
    lines.forEach(line => {
      const li = document.createElement('li');
      li.textContent = line;
      nextStepsList.appendChild(li);
    });
  }

  setText('telegramTitle', done.telegramTitle);
  setText('telegramDesc', done.telegramDesc);
  const telegramBtn = document.getElementById('telegramBtn');
  if (telegramBtn) {
    telegramBtn.textContent = done.telegramBtn;
    telegramBtn.href = done.telegramLink;
  }

  // ── Nav buttons ──
  const btnBack = document.getElementById('btnBack');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  if (btnBack) btnBack.textContent = intake.nav.back;
  if (btnNext) btnNext.textContent = intake.nav.next;
  if (btnSubmit) btnSubmit.textContent = intake.nav.submit;

  // Update progress text for current step
  updateProgressText();
}

// Helper: set text content safely
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

// Helper: set label text (looks for element with matching id or for label[for=id])
function setLabel(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text || '';
    return;
  }
  // Try as label[for=...]
  const labelEl = document.querySelector('label[for="' + id + '"]');
  if (labelEl) labelEl.textContent = text || '';
}

// Helper: set placeholder
function setPlaceholder(id, text) {
  const el = document.getElementById(id);
  if (el) el.placeholder = text || '';
}

function updateProgressText() {
  const cfg = brandConfig[currentLang];
  if (!cfg) return;
  const intake = cfg.intake;
  const progressText = document.getElementById('progressText');
  if (progressText && intake.progress) {
    const displayStep = Math.max(1, Math.min(currentStep + 1, 6)); // steps 1-6 (exclude done)
    progressText.textContent = intake.progress.step + ' ' + displayStep + ' ' + intake.progress.of + ' 6';
  }
}

// ═══════════════ WIZARD NAVIGATION ═══════════════

let currentStep = 0;
const STEP_IDS = ['intro', 'child', 'medical', 'goals', 'survey', 'contact', 'done'];

function goToStep(n) {
  // Hide all step panels
  document.querySelectorAll('.step-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Show the target step
  const targetPanel = document.getElementById('step-' + STEP_IDS[n]);
  if (targetPanel) targetPanel.classList.add('active');

  // Update progress bar
  document.querySelectorAll('[data-progress-step]').forEach(el => {
    const idx = parseInt(el.getAttribute('data-progress-step'), 10);
    el.classList.remove('active', 'completed');
    if (idx < n) el.classList.add('completed');
    if (idx === n) el.classList.add('active');
  });

  // Update progress text
  currentStep = n;
  updateProgressText();

  // Update nav button visibility
  const btnBack = document.getElementById('btnBack');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  const navBar = document.getElementById('wizardNav');

  if (n === 0) {
    // Intro: hide all nav (has its own Start button)
    if (btnBack) btnBack.style.display = 'none';
    if (btnNext) btnNext.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'none';
    if (navBar) navBar.style.display = 'none';
  } else if (n === 6) {
    // Done panel: hide all nav
    if (btnBack) btnBack.style.display = 'none';
    if (btnNext) btnNext.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'none';
    if (navBar) navBar.style.display = 'none';
  } else if (n === 5) {
    // Contact: show back and submit, hide next
    if (navBar) navBar.style.display = 'flex';
    if (btnBack) btnBack.style.display = 'inline-flex';
    if (btnNext) btnNext.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'inline-flex';
  } else {
    // Steps 1-4: show back and next, hide submit
    if (navBar) navBar.style.display = 'flex';
    if (btnBack) {
      btnBack.style.display = n > 0 ? 'inline-flex' : 'none';
    }
    if (btnNext) btnNext.style.display = 'inline-flex';
    if (btnSubmit) btnSubmit.style.display = 'none';
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function nextStep() {
  if (currentStep === 5) {
    submitForm();
    return;
  }
  if (validateStep(currentStep)) {
    goToStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep > 0) {
    goToStep(currentStep - 1);
  }
}

// ═══════════════ VALIDATION ═══════════════

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.remove());
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
}

function showError(inputEl, message) {
  if (!inputEl) return;
  inputEl.classList.add('input-error');
  const errDiv = document.createElement('div');
  errDiv.className = 'field-error';
  errDiv.textContent = message;
  if (inputEl.parentNode) {
    inputEl.parentNode.insertBefore(errDiv, inputEl.nextSibling);
  }
}

function validateStep(stepIndex) {
  clearErrors();
  const cfg = brandConfig[currentLang];
  const intake = cfg ? cfg.intake : null;

  switch (stepIndex) {
    case 0:
      // Intro: always valid
      return true;

    case 1: {
      // Child: age required (non-empty, > 0), country required
      let valid = true;
      const childAge = document.getElementById('childAge');
      const countrySelect = document.getElementById('countrySelect');

      if (!childAge || !childAge.value || parseFloat(childAge.value) <= 0) {
        showError(childAge, intake ? intake.child.ageLabel.replace(' *', '') + ' — required' : 'Age is required');
        valid = false;
      }

      if (!countrySelect || !countrySelect.value) {
        showError(countrySelect, intake ? intake.child.countryLabel.replace(' *', '') + ' — required' : 'Country is required');
        valid = false;
      } else if (countrySelect.value === 'other') {
        const otherCountry = document.getElementById('otherCountry');
        if (!otherCountry || !otherCountry.value.trim()) {
          showError(otherCountry, 'Please specify country');
          valid = false;
        }
      }

      return valid;
    }

    case 2: {
      // Diagnosis: at least one checkbox checked; if "other" checked, other text required
      const checkedBoxes = getCheckedValues('diagnosis');
      if (checkedBoxes.length === 0) {
        const diagGrid = document.getElementById('diagGrid');
        showError(diagGrid, intake ? intake.diagnosis.subtitle : 'Please select at least one diagnosis');
        return false;
      }
      if (checkedBoxes.includes('other')) {
        const diagOther = document.getElementById('diagOther');
        if (!diagOther || !diagOther.value.trim()) {
          showError(diagOther, 'Please specify diagnosis');
          return false;
        }
      }
      return true;
    }

    case 3:
      // Goals: always valid (lenient)
      return true;

    case 4:
      // Survey: always valid (lenient)
      return true;

    case 5: {
      // Contact: name required, at least one of email/phone/messenger required, consent required
      let valid = true;
      const contactName = document.getElementById('contactName');
      const contactEmail = document.getElementById('contactEmail');
      const contactPhone = document.getElementById('contactPhone');
      const contactMessenger = document.getElementById('contactMessenger');
      const consentCheck = document.getElementById('consentCheck');

      if (!contactName || !contactName.value.trim()) {
        showError(contactName, intake ? intake.contact.nameLabel.replace(' *', '') + ' — required' : 'Name is required');
        valid = false;
      }

      const hasContact = (contactEmail && contactEmail.value.trim()) ||
                         (contactPhone && contactPhone.value.trim()) ||
                         (contactMessenger && contactMessenger.value.trim());
      if (!hasContact) {
        const refEl = contactEmail || contactPhone || contactMessenger;
        showError(refEl, intake ? 'Please provide at least one contact method' : 'At least one contact method is required');
        valid = false;
      }

      if (!consentCheck || !consentCheck.checked) {
        showError(consentCheck, intake ? intake.contact.consent.replace(' *', '').substring(0, 60) + '...' : 'Consent is required');
        valid = false;
      }

      return valid;
    }

    default:
      return true;
  }
}

// ═══════════════ FORM SUBMISSION ═══════════════

function getCheckedValues(name) {
  const checked = [];
  document.querySelectorAll('input[type="checkbox"][name="' + name + '"]:checked').forEach(input => {
    checked.push(input.value);
  });
  return checked;
}

function getRadioValue(name) {
  const radio = document.querySelector('input[type="radio"][name="' + name + '"]:checked');
  return radio ? radio.value : '';
}

function showToast(msg, type) {
  // Remove existing toasts
  document.querySelectorAll('.toast-notification').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'toast-notification toast-' + (type || 'error');
  toast.textContent = msg;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('toast-visible'), 10);

  // Auto-hide after 4s
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function submitForm() {
  if (!validateStep(5)) return;

  const btnSubmit = document.getElementById('btnSubmit');
  const cfg = brandConfig[currentLang];
  const intake = cfg ? cfg.intake : null;

  // Disable button, show loading state
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.classList.add('btn-loading');
    btnSubmit.textContent = '...';
  }

  // Collect form data
  const contactName = document.getElementById('contactName');
  const contactPhone = document.getElementById('contactPhone');
  const contactEmail = document.getElementById('contactEmail');
  const contactMessenger = document.getElementById('contactMessenger');
  const childName = document.getElementById('childName');
  const childAge = document.getElementById('childAge');
  const ageUnit = document.getElementById('ageUnit');
  const countrySelect = document.getElementById('countrySelect');
  const otherCountry = document.getElementById('otherCountry');
  const diagOther = document.getElementById('diagOther');
  const conditionDetails = document.getElementById('conditionDetails');
  const treatmentDetails = document.getElementById('treatmentDetails');
  const goalsOther = document.getElementById('goalsOther');
  const surveyValue = document.getElementById('surveyValue');

  const data = {
    action: 'create',
    name: contactName ? contactName.value : '',
    phone: contactPhone ? contactPhone.value : '',
    email: contactEmail ? contactEmail.value : '',
    message: JSON.stringify({
      child: {
        name: childName ? childName.value : '',
        age: childAge ? childAge.value : '',
        ageUnit: ageUnit ? ageUnit.value : '',
        country: countrySelect && countrySelect.value === 'other'
          ? (otherCountry ? otherCountry.value : '')
          : (countrySelect ? countrySelect.value : ''),
      },
      diagnosis: {
        selected: getCheckedValues('diagnosis'),
        other: diagOther ? diagOther.value : '',
        details: conditionDetails ? conditionDetails.value : '',
        treatment: treatmentDetails ? treatmentDetails.value : '',
        mri: getRadioValue('mri'),
      },
      goals: {
        selected: getCheckedValues('goals'),
        other: goalsOther ? goalsOther.value : '',
      },
      survey: {
        pricing: getRadioValue('pricing'),
        mostValuable: surveyValue ? surveyValue.value : '',
        source: getRadioValue('source'),
      },
      messenger: contactMessenger ? contactMessenger.value : '',
      preferredContact: getRadioValue('prefer'),
      language: currentLang,
    }),
    source: 'intake_form',
  };

  try {
    let response;
    if (uploadedFiles.length > 0) {
      // Use FormData to include files
      const formData = new FormData();
      formData.append('data', JSON.stringify(data));
      uploadedFiles.forEach(file => {
        formData.append('documents', file);
      });
      response = await fetch('/api/leads', {
        method: 'POST',
        body: formData,
      });
    } else {
      response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || 'Submission failed');
    }

    // Success: go to done panel
    goToStep(6);

  } catch (err) {
    showToast(err.message || 'An error occurred. Please try again.', 'error');

    // Re-enable button
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.classList.remove('btn-loading');
      if (intake) btnSubmit.textContent = intake.nav.submit;
    }
  }
}

// ═══════════════ CONDITIONAL FIELDS ═══════════════

function initConditionalFields() {
  // Country select: show/hide other country field
  const countrySelect = document.getElementById('countrySelect');
  const otherCountryGroup = document.getElementById('otherCountryGroup');
  if (countrySelect && otherCountryGroup) {
    countrySelect.addEventListener('change', () => {
      otherCountryGroup.style.display = countrySelect.value === 'other' ? 'block' : 'none';
    });
  }

  // Diagnosis "other" checkbox: show/hide other field
  // (Also handled inline in renderCheckboxGrid, this is a fallback delegation handler)
  const diagGrid = document.getElementById('diagGrid');
  const diagOtherGroup = document.getElementById('diagOtherGroup');
  if (diagGrid && diagOtherGroup) {
    diagGrid.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox' && e.target.name === 'diagnosis' && e.target.value === 'other') {
        diagOtherGroup.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }
}

// ═══════════════ FILE UPLOAD ═══════════════

let uploadedFiles = [];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function initFileUpload() {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');
  if (!uploadZone || !fileInput) return;

  // Click to upload
  uploadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  uploadZone.addEventListener('click', () => fileInput.click());

  // File selection
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // Drag & drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(fileList) {
  for (const file of fileList) {
    if (file.size > MAX_FILE_SIZE) {
      showToast(file.name + ' — too large (max 20MB)', 'error');
      continue;
    }
    // Avoid duplicates by name+size
    const exists = uploadedFiles.some(f => f.name === file.name && f.size === file.size);
    if (!exists) {
      uploadedFiles.push(file);
    }
  }
  renderFileList();
}

function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  if (!list) return;
  list.innerHTML = '';

  uploadedFiles.forEach((file, idx) => {
    const div = document.createElement('div');
    div.className = 'file-item';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'file-item-name';
    nameDiv.innerHTML = '<span>' + escapeHtml(file.name) + '</span>';

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-item-size';
    sizeSpan.textContent = formatFileSize(file.size);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-item-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', () => removeFile(idx));

    div.appendChild(nameDiv);
    div.appendChild(sizeSpan);
    div.appendChild(removeBtn);
    list.appendChild(div);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════ HAMBURGER MENU ═══════════════

function initHamburgerMenu() {
  const hamburgerMenu = document.getElementById('hamburgerMenu');
  const mobileMenu = document.getElementById('mobileMenu');
  if (!hamburgerMenu || !mobileMenu) return;

  hamburgerMenu.addEventListener('click', () => {
    hamburgerMenu.classList.toggle('active');
    mobileMenu.classList.toggle('open');
  });

  function closeMobileMenu() {
    hamburgerMenu.classList.remove('active');
    mobileMenu.classList.remove('open');
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.hamburger-menu') && !e.target.closest('.mobile-menu')) {
      closeMobileMenu();
    }
  });
}

// ═══════════════ NAV BUTTON HANDLERS ═══════════════

function initNavButtons() {
  const btnStart = document.getElementById('btnStart');
  const btnBack = document.getElementById('btnBack');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');

  if (btnStart) btnStart.addEventListener('click', () => goToStep(1));
  if (btnBack) btnBack.addEventListener('click', () => prevStep());
  if (btnNext) btnNext.addEventListener('click', () => nextStep());
  if (btnSubmit) btnSubmit.addEventListener('click', () => submitForm());
}

// ═══════════════ INITIALIZATION ═══════════════

document.addEventListener('DOMContentLoaded', () => {
  // Init hamburger menu
  initHamburgerMenu();

  // Init nav buttons
  initNavButtons();

  // Init conditional fields
  initConditionalFields();

  // Init file upload
  initFileUpload();

  // Detect and set language (also calls renderIntake)
  const lang = detectLang();
  setLang(lang);

  // Start at step 0
  goToStep(0);
});
