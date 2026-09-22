const BOOKS_TABLE = "reading_books";
const HISTORY_TABLE = "reading_history";
const SETTINGS_TABLE = "reading_settings";
const DEFAULT_THRESHOLD = 85;

const supabase = window.supabase.createClient(
  window.READING_SUPABASE.url,
  window.READING_SUPABASE.anonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    },
  },
);

const bootError = document.getElementById("boot-error");
const viewSetup = document.getElementById("view-setup");
const viewReading = document.getElementById("view-reading");
const viewHistory = document.getElementById("view-history");
const formSetup = document.getElementById("form-setup");
const formReading = document.getElementById("form-reading");
const formSettings = document.getElementById("form-settings");
const bookTitleInput = document.getElementById("book-title");
const lastPageInput = document.getElementById("last-page");
const pageReachedInput = document.getElementById("page-reached");
const setupError = document.getElementById("setup-error");
const readingError = document.getElementById("reading-error");
const settingsError = document.getElementById("settings-error");
const readingTitle = document.getElementById("reading-title");
const readingDate = document.getElementById("reading-date");
const readingFinish = document.getElementById("reading-finish");
const readingProgress = document.getElementById("reading-progress");
const readingPercent = document.getElementById("reading-percent");
const historyTitle = document.getElementById("history-title");
const historyList = document.getElementById("history-list");
const summaryPages = document.getElementById("summary-pages");
const summaryPercent = document.getElementById("summary-percent");
const settingsEl = document.getElementById("settings");
const reminderEl = document.getElementById("reminder");
const reminderThresholdInput = document.getElementById("reminder-threshold");

let book = null;
let history = [];
let reminderThreshold = DEFAULT_THRESHOLD;
let reminderDismissed = false;
let saving = false;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLongDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function parsePositiveInt(value) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function showError(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function currentPage() {
  if (!history.length) return 0;
  return Math.max(...history.map((entry) => entry.end_page));
}

function progressPercent() {
  if (!book) return 0;
  const pct = (currentPage() / book.last_readable_page) * 100;
  return Math.min(100, Math.floor(pct + 1e-9));
}

function atThreshold() {
  return Boolean(book) && progressPercent() >= reminderThreshold;
}

function showView(name) {
  viewSetup.hidden = name !== "setup";
  viewReading.hidden = name !== "reading";
  viewHistory.hidden = name !== "history";
}

function renderReading() {
  if (!book) return;
  readingTitle.textContent = book.title;
  readingDate.textContent = formatLongDate(new Date());
  pageReachedInput.value = "";
  showError(readingError, "");
  const showFinish = atThreshold();
  readingFinish.hidden = !showFinish;
  if (showFinish) {
    readingProgress.textContent = `${currentPage()} / ${book.last_readable_page}`;
    readingPercent.textContent = `${progressPercent()}%`;
  }
}

function renderHistory() {
  if (!book) return;
  historyTitle.textContent = book.title;
  historyList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No reading recorded yet.";
    historyList.append(empty);
  } else {
    const sorted = [...history].sort((a, b) => a.read_date.localeCompare(b.read_date));
    for (const entry of sorted) {
      const row = document.createElement("p");
      row.textContent = `${formatLongDate(parseDateKey(entry.read_date))} — ${entry.start_page}–${entry.end_page}`;
      historyList.append(row);
    }
  }
  summaryPages.textContent = `${currentPage()} / ${book.last_readable_page}`;
  summaryPercent.textContent = `${progressPercent()}%`;
}

function maybeShowReminder() {
  if (!atThreshold() || reminderDismissed) {
    reminderEl.hidden = true;
    return;
  }
  reminderEl.hidden = false;
}

async function loadSettings() {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("reminder_threshold")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  const value = Number(data?.reminder_threshold);
  reminderThreshold = Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_THRESHOLD;
}

async function loadActiveBook() {
  const { data, error } = await supabase
    .from(BOOKS_TABLE)
    .select("id, title, last_readable_page, status")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  book = data ?? null;
}

async function loadHistory() {
  if (!book) {
    history = [];
    return;
  }
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select("id, book_id, read_date, start_page, end_page")
    .eq("book_id", book.id)
    .order("read_date", { ascending: true });
  if (error) throw error;
  history = data || [];
}

async function boot() {
  try {
    await loadSettings();
    await loadActiveBook();
    await loadHistory();
    if (!book) {
      showView("setup");
      return;
    }
    renderReading();
    showView("reading");
  } catch (err) {
    console.error(err);
    showError(bootError, "Couldn’t load reading data.");
  }
}

formSetup.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  const title = bookTitleInput.value.trim();
  const lastPage = parsePositiveInt(lastPageInput.value);
  if (!title) {
    showError(setupError, "Enter a book title.");
    return;
  }
  if (lastPage == null) {
    showError(setupError, "Last readable page must be a whole number greater than 0.");
    return;
  }
  saving = true;
  showError(setupError, "");
  const { data, error } = await supabase
    .from(BOOKS_TABLE)
    .insert({
      title,
      last_readable_page: lastPage,
      status: "active",
    })
    .select("id, title, last_readable_page, status")
    .single();
  saving = false;
  if (error) {
    console.error(error);
    showError(setupError, "Couldn’t save this book.");
    return;
  }
  book = data;
  history = [];
  reminderDismissed = false;
  formSetup.reset();
  renderReading();
  showView("reading");
});

formReading.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !book) return;
  const submitted = parsePositiveInt(pageReachedInput.value);
  if (submitted == null) {
    showError(readingError, "Enter a whole number greater than 0.");
    return;
  }
  if (submitted > book.last_readable_page) {
    showError(readingError, `The last readable page is ${book.last_readable_page}.`);
    return;
  }
  const reached = currentPage();
  if (submitted < reached) {
    showError(readingError, `You’re already on page ${reached}.`);
    return;
  }

  const date = todayKey();
  const existing = history.find((entry) => entry.read_date === date);
  const previous = [...history]
    .filter((entry) => entry.read_date < date)
    .sort((a, b) => a.read_date.localeCompare(b.read_date))
    .at(-1);
  const startPage = existing
    ? existing.start_page
    : previous
      ? previous.end_page + 1
      : 1;

  if (submitted < startPage) {
    showError(readingError, `You’re already on page ${reached || startPage - 1}.`);
    return;
  }

  saving = true;
  showError(readingError, "");
  let error;
  if (existing) {
    const result = await supabase
      .from(HISTORY_TABLE)
      .update({ end_page: submitted, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("id, book_id, read_date, start_page, end_page")
      .single();
    error = result.error;
    if (!error) {
      existing.end_page = result.data.end_page;
    }
  } else {
    const result = await supabase
      .from(HISTORY_TABLE)
      .insert({
        book_id: book.id,
        read_date: date,
        start_page: startPage,
        end_page: submitted,
      })
      .select("id, book_id, read_date, start_page, end_page")
      .single();
    error = result.error;
    if (!error) history.push(result.data);
  }
  saving = false;
  if (error) {
    console.error(error);
    showError(readingError, "Couldn’t save that page.");
    return;
  }

  reminderDismissed = false;
  renderHistory();
  showView("history");
  maybeShowReminder();
});

document.getElementById("btn-history").addEventListener("click", () => {
  renderHistory();
  showView("history");
});

document.getElementById("btn-reading").addEventListener("click", () => {
  reminderEl.hidden = true;
  renderReading();
  showView("reading");
});

document.getElementById("btn-settings").addEventListener("click", () => {
  reminderEl.hidden = true;
  reminderThresholdInput.value = String(reminderThreshold);
  showError(settingsError, "");
  settingsEl.hidden = false;
});

document.getElementById("btn-settings-close").addEventListener("click", () => {
  settingsEl.hidden = true;
});

formSettings.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  const threshold = parsePositiveInt(reminderThresholdInput.value);
  if (threshold == null || threshold > 100) {
    showError(settingsError, "Enter a number from 1 to 100.");
    return;
  }
  saving = true;
  showError(settingsError, "");
  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert({
      id: 1,
      reminder_threshold: threshold,
      updated_at: new Date().toISOString(),
    });
  saving = false;
  if (error) {
    console.error(error);
    showError(settingsError, "Couldn’t save this setting.");
    return;
  }
  reminderThreshold = threshold;
  reminderDismissed = false;
  settingsEl.hidden = true;
  renderHistory();
  maybeShowReminder();
});

document.getElementById("btn-reminder-ok").addEventListener("click", () => {
  reminderDismissed = true;
  reminderEl.hidden = true;
});

document.getElementById("btn-finished").addEventListener("click", async () => {
  if (saving || !book) return;
  saving = true;
  const { error } = await supabase
    .from(BOOKS_TABLE)
    .update({
      status: "finished",
      finished_at: new Date().toISOString(),
    })
    .eq("id", book.id);
  saving = false;
  if (error) {
    console.error(error);
    showError(readingError, "Couldn’t mark this book finished.");
    return;
  }
  book = null;
  history = [];
  reminderDismissed = false;
  reminderEl.hidden = true;
  settingsEl.hidden = true;
  showError(setupError, "");
  formSetup.reset();
  showView("setup");
});

boot();
