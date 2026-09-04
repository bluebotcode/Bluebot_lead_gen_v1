(() => {
  'use strict';

  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
    'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
    'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ];

  const stateOptions = document.getElementById('state-options');
  for (const abbr of US_STATES) {
    const opt = document.createElement('option');
    opt.value = abbr;
    stateOptions.appendChild(opt);
  }

  const form = document.getElementById('search-form');
  const submitBtn = document.getElementById('submit-btn');
  const statusLine = document.getElementById('status-line');
  const resultsBody = document.getElementById('results-body');
  const resultCount = document.getElementById('result-count');
  const exportBtn = document.getElementById('export-btn');
  const scoreHeader = document.querySelector('th[data-sort="score"]');

  /** Current in-memory leads, kept in sync with any in-app edits. */
  let leads = [];
  let sortDir = 'desc';

  const EDITABLE_FIELDS = new Set(['category_flag', 'owner_name', 'email', 'notes']);

  function statusBadgeClass(status) {
    switch (status) {
      case 'Qualified': return 'qualified';
      case 'Marginal': return 'marginal';
      case 'Skip': return 'skip';
      default: return 'not-scored';
    }
  }

  function categoryFlagClass(flag) {
    if (flag === 'Vertical mismatch') return 'mismatch';
    if (flag === 'Rubric gap') return 'rubric-gap';
    return '';
  }

  function cell(text, { editableField, className } = {}) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (editableField) {
      td.contentEditable = 'true';
      td.dataset.field = editableField;
    }
    td.textContent = text == null || text === '' ? '' : String(text);
    return td;
  }

  function renderRow(lead, index) {
    const tr = document.createElement('tr');
    tr.dataset.index = String(index);

    tr.appendChild(cell(lead.city));
    tr.appendChild(cell(lead.business_name));
    tr.appendChild(cell(lead.category_flag || '', { editableField: 'category_flag', className: `category-flag ${categoryFlagClass(lead.category_flag)}` }));
    tr.appendChild(cell(lead.rating != null ? lead.rating.toFixed(1) : 'N/A'));

    const reviewTd = document.createElement('td');
    reviewTd.textContent = String(lead.review_count ?? 0);
    if (!lead.review_count || lead.review_count < 10) {
      const warn = document.createElement('span');
      warn.className = 'warn-icon';
      warn.title = 'Fewer than 10 reviews (or none)';
      warn.textContent = '⚠';
      reviewTd.appendChild(warn);
    }
    tr.appendChild(reviewTd);

    tr.appendChild(cell(lead.score != null ? lead.score : ''));

    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status-badge ${statusBadgeClass(lead.status)}`;
    badge.textContent = lead.status;
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);

    tr.appendChild(cell(lead.address));
    tr.appendChild(cell(lead.phone));

    const websiteTd = document.createElement('td');
    if (lead.website) {
      const a = document.createElement('a');
      a.href = lead.website;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = lead.website;
      websiteTd.appendChild(a);
    } else {
      websiteTd.textContent = 'Not found';
      const warn = document.createElement('span');
      warn.className = 'warn-icon';
      warn.title = 'No website found';
      warn.textContent = '⚠';
      websiteTd.appendChild(warn);
    }
    tr.appendChild(websiteTd);

    tr.appendChild(cell(lead.owner_name, { editableField: 'owner_name' }));
    tr.appendChild(cell(lead.email, { editableField: 'email' }));

    const gmbTd = document.createElement('td');
    const gmbLink = document.createElement('a');
    gmbLink.href = lead.gmb_link;
    gmbLink.target = '_blank';
    gmbLink.rel = 'noopener noreferrer';
    gmbLink.textContent = 'View on Maps';
    gmbTd.appendChild(gmbLink);
    tr.appendChild(gmbTd);

    tr.appendChild(
      cell((lead.notes || []).join(' '), { editableField: 'notes', className: 'notes-cell' })
    );

    return tr;
  }

  function render() {
    resultsBody.innerHTML = '';
    if (leads.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 14;
      td.textContent = 'No results yet. Run a search above.';
      tr.appendChild(td);
      resultsBody.appendChild(tr);
      resultCount.textContent = '';
      exportBtn.disabled = true;
      return;
    }

    leads.forEach((lead, i) => resultsBody.appendChild(renderRow(lead, i)));
    resultCount.textContent = `${leads.length} result${leads.length === 1 ? '' : 's'}`;
    exportBtn.disabled = false;
  }

  function sortByScore() {
    leads.sort((a, b) => {
      const aScore = a.score == null ? -Infinity : a.score;
      const bScore = b.score == null ? -Infinity : b.score;
      return sortDir === 'desc' ? bScore - aScore : aScore - bScore;
    });
    render();
  }

  scoreHeader.addEventListener('click', () => {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    scoreHeader.querySelector('.sort-indicator').textContent = sortDir === 'desc' ? '▼' : '▲';
    sortByScore();
  });

  resultsBody.addEventListener('blur', (e) => {
    const td = e.target;
    if (!(td instanceof HTMLTableCellElement)) return;
    const field = td.dataset.field;
    if (!field || !EDITABLE_FIELDS.has(field)) return;
    const tr = td.closest('tr');
    const index = Number(tr.dataset.index);
    if (Number.isNaN(index) || !leads[index]) return;

    if (field === 'notes') {
      leads[index].notes = td.textContent ? [td.textContent] : [];
    } else {
      leads[index][field] = td.textContent;
    }
  }, true);

  resultsBody.addEventListener('focus', (e) => {
    const td = e.target;
    if (!(td instanceof HTMLTableCellElement) || !EDITABLE_FIELDS.has(td.dataset.field)) return;
    // Select the existing placeholder/value so typing replaces it instead of
    // inserting into the middle (e.g. "Not found").
    const range = document.createRange();
    range.selectNodeContents(td);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, true);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const city = document.getElementById('city').value.trim();
    const state = document.getElementById('state').value.trim();
    const industry = document.getElementById('industry').value.trim();

    if (!city || !state || !industry) return;

    submitBtn.disabled = true;
    statusLine.textContent = `Searching for ${industry} businesses in ${city}, ${state}...`;
    statusLine.classList.remove('error');

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, state, industry })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      leads = data.leads || [];
      sortDir = 'desc';
      sortByScore();
      statusLine.textContent = `Found ${leads.length} businesses.`;
    } catch (err) {
      statusLine.textContent = `Error: ${err.message}`;
      statusLine.classList.add('error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  exportBtn.addEventListener('click', () => {
    const exportRows = leads.map((lead) => ({
      city: lead.city,
      business_name: lead.business_name,
      category_flag: lead.category_flag || null,
      rating: lead.rating,
      review_count: lead.review_count,
      score: lead.score,
      status: lead.status,
      address: lead.address,
      phone: lead.phone,
      website: lead.website,
      owner_name: lead.owner_name,
      email: lead.email,
      gmb_link: lead.gmb_link,
      notes: Array.isArray(lead.notes) ? lead.notes.join(' ') : lead.notes
    }));

    const blob = new Blob([JSON.stringify(exportRows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluebot-leads-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  render();
})();
