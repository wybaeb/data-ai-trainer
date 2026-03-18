const registryUrl = "./data/cases/index.json";

const state = {
  registry: [],
  currentCase: null,
  selectedMetricId: null,
  selections: {},
  revealExpert: false,
};

const appEl = document.getElementById("app");
const caseSelectEl = document.getElementById("case-select");
const caseUrlHintEl = document.getElementById("case-url-hint");
const metricCardTemplate = document.getElementById("metric-card-template");
const sourcePickerTemplate = document.getElementById("source-picker-template");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getCaseIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("case");
}

function updateUrl(caseId) {
  const url = new URL(window.location.href);
  url.searchParams.set("case", caseId);
  window.history.replaceState({}, "", url);
  caseUrlHintEl.textContent = url.toString();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${path}: ${response.status}`);
  }
  return response.json();
}

function setDefaultSelections(metric) {
  state.selections = {};
  for (const signal of metric.signals) {
    state.selections[signal.id] = signal.choices[0]?.id || "";
  }
}

function getSelectedMetric() {
  return state.currentCase?.metricOptions.find((metric) => metric.id === state.selectedMetricId) || null;
}

function getSelectedChoice(signal) {
  return signal.choices.find((choice) => choice.id === state.selections[signal.id]) || null;
}

function computeMetricResult(metric, selectionMap) {
  const selectedChoices = metric.signals
    .map((signal) => signal.choices.find((choice) => choice.id === selectionMap[signal.id]))
    .filter(Boolean);

  if (selectedChoices.length !== metric.signals.length) {
    return null;
  }

  const devDays = selectedChoices.reduce((sum, choice) => sum + choice.devDays, 0);
  const evidenceDays = selectedChoices.reduce((max, choice) => Math.max(max, choice.evidenceDays), 0);
  const totalDays = devDays + evidenceDays;
  const stack = [...new Set(selectedChoices.flatMap((choice) => choice.stack))];
  const categories = [...new Set(selectedChoices.map((choice) => choice.dataCategory))];
  const masterSources = [...new Set(selectedChoices.map((choice) => choice.masterSource))];
  const backlog = [...new Set(selectedChoices.flatMap((choice) => choice.backlog))];
  const issues = [...new Set(selectedChoices.flatMap((choice) => choice.cons || []))];
  const pros = [...new Set(selectedChoices.flatMap((choice) => choice.pros || []))];
  const aiNeeded = selectedChoices.some((choice) => choice.aiBlock);

  return {
    metric,
    selectedChoices,
    devDays,
    evidenceDays,
    totalDays,
    stack,
    categories,
    masterSources,
    backlog,
    issues,
    pros,
    aiNeeded,
  };
}

function enumerateBestResult(metric) {
  const results = [];

  function walk(signalIndex, selectionMap) {
    if (signalIndex >= metric.signals.length) {
      const result = computeMetricResult(metric, selectionMap);
      if (result) {
        results.push(result);
      }
      return;
    }

    const signal = metric.signals[signalIndex];
    for (const choice of signal.choices) {
      walk(signalIndex + 1, { ...selectionMap, [signal.id]: choice.id });
    }
  }

  walk(0, {});
  return results.sort((left, right) => left.totalDays - right.totalDays || left.devDays - right.devDays)[0];
}

function getRouteComparison() {
  return state.currentCase.metricOptions
    .map((metric) => enumerateBestResult(metric))
    .filter(Boolean)
    .sort((left, right) => left.totalDays - right.totalDays || left.devDays - right.devDays);
}

function renderList(items, className = "") {
  return `<ul class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function pluralize(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }

  return many;
}

function formatTreeLabel(label) {
  return String(label).replace(/^Маршрут\s+/u, "Дерево метрик ");
}

function buildChoicePreview(choice) {
  return `
    <h4 class="choice-title">${escapeHtml(choice.title)}</h4>
    <p class="choice-system">${escapeHtml(choice.system)}</p>
    <div class="choice-timeline">
      <span class="timeline-pill timeline-pill-dev">${choice.devDays} дн. разработка</span>
      <span class="timeline-pill timeline-pill-observation">${choice.evidenceDays} дн. наблюдение</span>
    </div>
    <p class="choice-note">Период наблюдения: время, за которое накапливается репрезентативная статистика.</p>
    <div class="choice-meta">
      <span>${escapeHtml(choice.dataCategory)}</span>
      <span>качество: ${escapeHtml(choice.quality)}</span>
      <span>${escapeHtml(choice.masterSource)}</span>
    </div>
    <div class="choice-columns">
      <div>
        <h4>Стек</h4>
        ${renderList(choice.stack, "mini-list")}
      </div>
      <div>
        <h4>План проекта</h4>
        ${renderList(choice.backlog, "backlog-list")}
      </div>
    </div>
  `;
}

function renderCaseHeader() {
  const currentCase = state.currentCase;

  return `
    <section class="case-summary-grid" id="case-summary">
      <article class="panel">
        <h2 class="panel-title">${escapeHtml(currentCase.title)}</h2>
        <div class="kicker-row">
          <span class="kicker">${escapeHtml(currentCase.domain)}</span>
          <span class="kicker">${escapeHtml(currentCase.audience)}</span>
        </div>
        <p class="panel-subtitle">${escapeHtml(currentCase.businessQuestion)}</p>
        <h3>Критерии к пилотной метрике</h3>
        ${renderList(currentCase.successCriteria, "criteria-list")}
      </article>
      <article class="panel">
        <h2 class="panel-title">Финансовая цель</h2>
        <p class="panel-subtitle">${escapeHtml(currentCase.financialTarget)}</p>
      </article>
    </section>
  `;
}

function renderMetricPicker() {
  const section = document.createElement("section");
  section.className = "panel";
  section.id = "metric-picker";
  section.innerHTML = `
    <h2 class="panel-title">Шаг 1. Выберите пилотную метрику</h2>
    <p class="panel-subtitle">
      Сначала выбираем не красивую формулировку, а дерево метрик, по которому реально можно прийти к финансовому эффекту.
    </p>
    <div class="metric-grid" id="metric-grid"></div>
  `;

  const grid = section.querySelector("#metric-grid");

  state.currentCase.metricOptions.forEach((metric) => {
    const node = metricCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".metric-route").textContent = formatTreeLabel(metric.routeLabel);
    node.querySelector(".metric-title").textContent = metric.title;
    node.querySelector(".metric-rationale").textContent = metric.pilotRationale;
    if (metric.id === state.selectedMetricId) {
      node.classList.add("is-selected");
    }
    node.addEventListener("click", () => {
      state.selectedMetricId = metric.id;
      state.revealExpert = false;
      setDefaultSelections(metric);
      render();
    });
    grid.appendChild(node);
  });

  return section;
}

function renderMetricTree(metric) {
  const leadingItems = metric.tree.leading
    .map((item) => `
      <div class="tree-stage is-leading">
        <p class="tree-stage-label">Опережающий сигнал</p>
        <p class="tree-value">${escapeHtml(item)}</p>
      </div>
    `)
    .join("");

  const section = document.createElement("section");
  section.className = "panel tree-card";
  section.id = "metric-tree";
  section.innerHTML = `
    <h2 class="panel-title">Шаг 2. Дерево расчета для выбранной метрики</h2>
    <p class="panel-subtitle">
      Показываем, как выбранная пилотная метрика поднимается до операционного эффекта и дальше до финансовой модели.
    </p>
    <div class="tree-columns">
      ${leadingItems}
      <div class="tree-stage is-operational">
        <p class="tree-stage-label">Пилотная метрика</p>
        <p class="tree-value">${escapeHtml(metric.tree.operational)}</p>
      </div>
      <div class="tree-stage is-financial">
        <p class="tree-stage-label">Финансовый эффект</p>
        <p class="tree-value">${escapeHtml(metric.tree.financial)}</p>
      </div>
    </div>
  `;
  return section;
}

function renderSourcePickers(metric) {
  const section = document.createElement("section");
  section.className = "panel";
  section.id = "source-pickers";
  section.innerHTML = `
    <h2 class="panel-title">Шаг 3. Подберите источники данных</h2>
    <p class="panel-subtitle">
      Для каждого измеримого сигнала выбираем источник. Тут же становится видно, где нужен AI-блок, где проседает качество и сколько займет дорога до результата. Период наблюдения показывает, когда статистика станет репрезентативной.
    </p>
    <div class="signal-grid" id="signal-grid"></div>
  `;

  const grid = section.querySelector("#signal-grid");

  metric.signals.forEach((signal) => {
    const node = sourcePickerTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".signal-label").textContent = signal.label;
    node.querySelector(".signal-description").textContent = signal.description;
    node.querySelector(".signal-pill").textContent = signal.routeHint;
    const labelEl = node.querySelector(".source-label");
    labelEl.textContent = signal.question;
    const select = node.querySelector(".source-select");

    signal.choices.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = `${choice.title} · ${choice.devDays} дн. разработка · ${choice.evidenceDays} дн. наблюдение`;
      select.appendChild(option);
    });

    select.value = state.selections[signal.id] || signal.choices[0]?.id || "";
    const preview = node.querySelector(".choice-preview");
    const selectedChoice = getSelectedChoice(signal);
    if (selectedChoice) {
      preview.innerHTML = buildChoicePreview(selectedChoice);
    }

    select.addEventListener("change", (event) => {
      state.selections[signal.id] = event.target.value;
      state.revealExpert = false;
      render();
    });

    grid.appendChild(node);
  });

  return section;
}

function renderComparison(metric, selectedResult, bestOverall, bestForMetric) {
  const section = document.createElement("section");
  section.className = "panel";
  section.id = "route-comparison";

  const routeCards = getRouteComparison()
    .map((result) => {
      const isBest = result.metric.id === bestOverall.metric.id;
      const isSelected = result.metric.id === metric.id;
      const statusClass = isBest ? "" : result.totalDays - bestOverall.totalDays <= 12 ? "warn" : "danger";
      const statusLabel = isBest
        ? "лучшее дерево метрик"
        : result.totalDays - bestOverall.totalDays <= 12
          ? "рядом с лидером"
          : "проигрывает по времени";

      return `
        <article class="comparison-card ${isBest ? "is-best" : ""} ${isSelected ? "is-selected" : ""}">
          <div class="comparison-head">
            <span class="metric-route">${escapeHtml(formatTreeLabel(result.metric.routeLabel))}</span>
            <h3>${escapeHtml(result.metric.title)}</h3>
            <span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="chips">
            <span class="chip">${result.devDays} дн. разработка</span>
            <span class="chip">${result.evidenceDays} дн. наблюдение</span>
            <span class="total-badge">итого ${result.totalDays} дн.</span>
          </div>
          <h4>Лучший набор источников</h4>
          ${renderList(result.selectedChoices.map((choice) => choice.title), "mini-list")}
          <h4>Стек</h4>
          ${renderList(result.stack, "mini-list")}
        </article>
      `;
    })
    .join("");

  const selectedIsBest = selectedResult.totalDays === bestOverall.totalDays && metric.id === bestOverall.metric.id;
  const selectedComboIsBestForMetric = selectedResult.totalDays === bestForMetric.totalDays;
  const discardedRoutes = getRouteComparison()
    .filter((result) => result.metric.id !== bestOverall.metric.id)
    .map((result) => `${formatTreeLabel(result.metric.routeLabel)}: ${result.metric.title} (${result.totalDays} дн)`);

  section.innerHTML = `
    <h2 class="panel-title">Шаг 4. Сравнение деревьев метрик</h2>
    <p class="panel-subtitle">
      Ниже тренажер автоматически считает лучшее дерево метрик по каждому варианту метрики и сравнивает их по общей длине проекта.
    </p>
    <div class="comparison-grid">${routeCards}</div>
    <div class="actions-row" style="margin-top: 18px;">
      <button class="ghost-button" id="reveal-expert-button" type="button">
        ${state.revealExpert ? "Скрыть экспертный разбор" : "Показать экспертный разбор"}
      </button>
    </div>
    ${state.revealExpert ? `
      <div class="reveal-panel">
        <h3>Экспертный разбор</h3>
        <p class="muted">
          ${selectedIsBest
            ? "Вы выбрали дерево метрик, которое действительно минимизирует время до доверяемого результата."
            : `Лучшее дерево метрик в кейсе: ${escapeHtml(formatTreeLabel(bestOverall.metric.routeLabel))} — ${escapeHtml(bestOverall.metric.title)}.`}
        </p>
        ${!selectedComboIsBestForMetric ? `<p class="muted">Даже внутри выбранной метрики можно улучшить конфигурацию источников: у этой метрики есть вариант на ${bestForMetric.totalDays} дн вместо ${selectedResult.totalDays} дн.</p>` : ""}
        <p class="muted">${escapeHtml(state.currentCase.expertNote)}</p>
        <h4>Что отбрасываем</h4>
        ${renderList(discardedRoutes, "issue-list")}
      </div>
    ` : ""}
  `;

  section.querySelector("#reveal-expert-button").addEventListener("click", () => {
    state.revealExpert = !state.revealExpert;
    render();
  });

  return section;
}

function renderResult(metric, selectedResult, bestOverall, bestForMetric) {
  const selectedIsBest = selectedResult.totalDays === bestOverall.totalDays && metric.id === bestOverall.metric.id;
  const selectedComboIsBestForMetric = selectedResult.totalDays === bestForMetric.totalDays;
  let verdictTitle = "Есть более быстрое дерево метрик";
  let verdictText = `${formatTreeLabel(bestOverall.metric.routeLabel)} приводит к результату быстрее: ${bestOverall.totalDays} дн против ${selectedResult.totalDays} дн.`;

  if (selectedIsBest) {
    verdictTitle = "Дерево метрик выбрано удачно";
    verdictText = "Вы собрали конфигурацию, которая быстрее всего приводит к доверяемому результату.";
  } else if (metric.id === bestOverall.metric.id && !selectedComboIsBestForMetric) {
    verdictTitle = "Метрика выбрана верно, но источники можно улучшить";
    verdictText = `Для этой метрики есть более сильная конфигурация: ${bestForMetric.totalDays} дн против текущих ${selectedResult.totalDays} дн.`;
  }

  const section = document.createElement("section");
  section.className = "panel";
  section.id = "project-result";
  section.innerHTML = `
    <h2 class="panel-title">Шаг 5. Что уходит в проект</h2>
    <p class="panel-subtitle">
      В финале из абстрактной карты получается вполне проектный артефакт: дерево метрик, главные источники, AI-блоки и план проекта.
    </p>
    <div class="formula-grid">
      <article class="formula-card">
        <p class="formula-value">${selectedResult.devDays}</p>
        <p class="formula-label">дней на доработку данных и интеграции</p>
      </article>
      <article class="formula-card">
        <p class="formula-value">${selectedResult.evidenceDays}</p>
        <p class="formula-label">дней периода наблюдения до репрезентативной статистики</p>
      </article>
      <article class="formula-card">
        <p class="formula-value">${selectedResult.totalDays}</p>
        <p class="formula-label">итоговых дней до решения по пилоту</p>
      </article>
    </div>
    <div class="result-grid" style="margin-top: 16px;">
      <article class="result-card is-primary">
        <div class="result-head">
          <h3>${escapeHtml(verdictTitle)}</h3>
          <span class="status-badge ${selectedIsBest ? "" : "warn"}">${escapeHtml(formatTreeLabel(metric.routeLabel))}</span>
        </div>
        <p class="muted">${escapeHtml(verdictText)}</p>
        <h4>Итоговая пилотная метрика</h4>
        ${renderList([metric.title], "mini-list")}
        <h4>Главные источники</h4>
        ${renderList(selectedResult.masterSources, "mini-list")}
      </article>
      <article class="result-card">
        <div class="result-head">
          <h3>Требуемый стек</h3>
          <span class="status-badge ${selectedResult.aiNeeded ? "" : "warn"}">${selectedResult.aiNeeded ? "есть AI-блок" : "без AI"}</span>
        </div>
        ${renderList(selectedResult.stack, "mini-list")}
        <h4>Категории данных</h4>
        ${renderList(selectedResult.categories, "mini-list")}
      </article>
      <article class="result-card">
        <div class="result-head">
          <h3>План проекта</h3>
          <span class="status-badge">${selectedResult.backlog.length} ${pluralize(selectedResult.backlog.length, "задача", "задачи", "задач")}</span>
        </div>
        ${renderList(selectedResult.backlog, "backlog-list")}
      </article>
      <article class="result-card">
        <div class="result-head">
          <h3>Риски и пробелы</h3>
          <span class="status-badge danger">${selectedResult.issues.length} ${pluralize(selectedResult.issues.length, "риск", "риска", "рисков")}</span>
        </div>
        ${renderList(selectedResult.issues, "issue-list")}
        <h4>Что помогает дереву метрик</h4>
        ${renderList(selectedResult.pros, "mini-list")}
      </article>
    </div>
  `;
  return section;
}

function renderEmptyMetricState() {
  const section = document.createElement("section");
  section.className = "panel";
  section.id = "empty-state";
  section.innerHTML = `
    <div class="empty-state">
      Выберите пилотную метрику выше. После этого появятся дерево расчета, выбор источников и итоговая оценка дерева метрик.
    </div>
  `;
  return section;
}

function render() {
  if (!state.currentCase) {
    appEl.innerHTML = `<section class="panel panel-loading"><p>Кейс не найден.</p></section>`;
    return;
  }

  appEl.innerHTML = "";
  appEl.insertAdjacentHTML("beforeend", renderCaseHeader());
  appEl.appendChild(renderMetricPicker());

  const metric = getSelectedMetric();
  if (!metric) {
    appEl.appendChild(renderEmptyMetricState());
    return;
  }

  const selectedResult = computeMetricResult(metric, state.selections);
  const bestOverall = getRouteComparison()[0];
  const bestForMetric = enumerateBestResult(metric);

  appEl.appendChild(renderMetricTree(metric));
  appEl.appendChild(renderSourcePickers(metric));

  if (!selectedResult || !bestOverall) {
    appEl.appendChild(renderEmptyMetricState());
    return;
  }

  appEl.appendChild(renderComparison(metric, selectedResult, bestOverall, bestForMetric));
  appEl.appendChild(renderResult(metric, selectedResult, bestOverall, bestForMetric));
}

async function loadCase(caseId) {
  const registryItem = state.registry.find((item) => item.id === caseId) || state.registry[0];
  const caseData = await fetchJson(`./data/cases/${registryItem.file}`);
  state.currentCase = caseData;
  state.selectedMetricId = caseData.metricOptions[0]?.id || null;
  state.revealExpert = false;
  if (caseData.metricOptions[0]) {
    setDefaultSelections(caseData.metricOptions[0]);
  }
  caseSelectEl.value = registryItem.id;
  updateUrl(registryItem.id);
  render();
}

function initCaseSelect() {
  caseSelectEl.innerHTML = "";
  state.registry.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    caseSelectEl.appendChild(option);
  });

  caseSelectEl.addEventListener("change", async (event) => {
    await loadCase(event.target.value);
  });
}

async function init() {
  try {
    state.registry = await fetchJson(registryUrl);
    initCaseSelect();
    const initialCaseId = getCaseIdFromUrl() || state.registry[0]?.id;
    await loadCase(initialCaseId);
  } catch (error) {
    appEl.innerHTML = `
      <section class="panel">
        <h2 class="panel-title">Не удалось загрузить тренажер</h2>
        <p class="panel-subtitle">${escapeHtml(error.message)}</p>
      </section>
    `;
  }
}

init();
