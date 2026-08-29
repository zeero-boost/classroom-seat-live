(() => {
  "use strict";

  const MAX_STUDENTS = 150;
  const STORAGE_KEY = "classroom-seat-live-v1";
  const ROSTER_WIDTH_KEY = "classroom-seat-live-roster-width";
  const LIVE_SESSION_KEY = "classroom-seat-live-session-v1";
  const DEFAULT_ROSTER_WIDTH = 400;
  const LIVE_SAVE_DELAY = 70;
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCkUXVET-wH26hCffsn_wO3dFL9cnHVpnM",
    authDomain: "classroom-seat-live-realtime.firebaseapp.com",
    projectId: "classroom-seat-live-realtime",
    storageBucket: "classroom-seat-live-realtime.firebasestorage.app",
    messagingSenderId: "673249926315",
    appId: "1:673249926315:web:0fa00111cc2196da016bee",
  };
  const KOREAN_SEAT_KEYS = Object.freeze({
    "ㅁ": "A",
    "ㅠ": "B",
    "ㅊ": "C",
    "ㅇ": "D",
    "ㄷ": "E",
    "ㄹ": "F",
    "ㅎ": "G",
    "ㅗ": "H",
    "ㅑ": "I",
    "ㅓ": "J",
    "ㅏ": "K",
    "ㅣ": "L",
    "ㅡ": "M",
    "ㅜ": "N",
  });
  const roomIdFromUrl = new URLSearchParams(window.location.search).get("room") || "";
  const isViewerMode = /^[a-f0-9]{32}$/i.test(roomIdFromUrl);

  if (isViewerMode) document.body.classList.add("viewer-mode");

  const sections = [
    {
      label: "1분단",
      columns: ["A", "B", "C"],
      specials: { C10: "과대단", C2: "과대단" },
      isSeat: (column, row) => row <= 9 && !(column === "C" && row === 2),
    },
    {
      label: "2분단",
      columns: ["D", "E", "F", "G"],
      specials: { D1: "과대" },
      isSeat: (column, row) => (row >= 2 && row <= 9) || (row === 10 && column === "G") || (row === 1 && column !== "D"),
    },
    {
      label: "3분단",
      columns: ["H", "I", "J", "K"],
      specials: {},
      isSeat: (column, row) => row <= 9 || (row === 10 && (column === "H" || column === "K")),
    },
    {
      label: "4분단",
      columns: ["L", "M", "N"],
      specials: { L10: "과대단", L1: "과대단" },
      isSeat: (column, row) => (row >= 2 && row <= 9) || (row === 1 && column !== "L"),
    },
  ];

  const validSeats = new Set();
  for (const section of sections) {
    for (let row = 10; row >= 1; row -= 1) {
      for (const column of section.columns) {
        if (section.isSeat(column, row)) validSeats.add(`${column}${row}`);
      }
    }
  }

  const dom = {
    assignedCount: document.querySelector("#assignedCount"),
    remainingCount: document.querySelector("#remainingCount"),
    saveState: document.querySelector("#saveState"),
    shareButton: document.querySelector("#shareButton"),
    shareButtonText: document.querySelector("#shareButtonText"),
    importButton: document.querySelector("#importButton"),
    excelButton: document.querySelector("#excelButton"),
    pdfButton: document.querySelector("#pdfButton"),
    fullscreenButton: document.querySelector("#fullscreenButton"),
    resetButton: document.querySelector("#resetButton"),
    fileInput: document.querySelector("#fileInput"),
    searchInput: document.querySelector("#searchInput"),
    seatSections: document.querySelector("#seatSections"),
    rosterList: document.querySelector("#rosterList"),
    rosterScroll: document.querySelector("#rosterScroll"),
    emptySearch: document.querySelector("#emptySearch"),
    fileName: document.querySelector("#fileName"),
    rowCount: document.querySelector("#rowCount"),
    toastRegion: document.querySelector("#toastRegion"),
    resetDialog: document.querySelector("#resetDialog"),
    shareDialog: document.querySelector("#shareDialog"),
    shareLink: document.querySelector("#shareLink"),
    copyShareLink: document.querySelector("#copyShareLink"),
    stopShareButton: document.querySelector("#stopShareButton"),
    viewerNotice: document.querySelector("#viewerNotice"),
    viewerNoticeTitle: document.querySelector("#viewerNoticeTitle"),
    viewerNoticeText: document.querySelector("#viewerNoticeText"),
    dropOverlay: document.querySelector("#dropOverlay"),
    panelResizer: document.querySelector("#panelResizer"),
  };

  let rows = createBlankRows();
  let importedFileName = "";
  let saveTimer = null;
  let previousAssignments = new Map();
  let pdfJsPromise = null;
  let firebasePromise = null;
  let liveSessionId = "";
  let liveOwnerId = "";
  let liveSaveTimer = null;
  let viewerUnsubscribe = null;
  let dragDepth = 0;

  function createBlankRows() {
    return Array.from({ length: MAX_STUDENTS }, () => ({ name: "", seat: "" }));
  }

  function normalizeSeat(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/[ㅁㅠㅊㅇㄷㄹㅎㅗㅑㅓㅏㅣㅡㅜ]/g, (key) => KOREAN_SEAT_KEYS[key])
      .replace(/\s+/g, "");
  }

  function escapeText(value) {
    return String(value ?? "").trim();
  }

  function buildSeatMap() {
    const fragment = document.createDocumentFragment();

    sections.forEach((section) => {
      const sectionEl = document.createElement("section");
      sectionEl.className = "seat-section";
      sectionEl.style.setProperty("--columns", String(section.columns.length));
      sectionEl.setAttribute("aria-label", section.label);

      const grid = document.createElement("div");
      grid.className = "seat-grid";

      for (let row = 10; row >= 1; row -= 1) {
        const rowEl = document.createElement("div");
        rowEl.className = "seat-row";

        section.columns.forEach((column) => {
          const code = `${column}${row}`;

          if (section.specials[code]) {
            const special = document.createElement("div");
            special.className = "special-seat";
            special.textContent = section.specials[code];
            special.title = `${code} 위치 · ${section.specials[code]}`;
            rowEl.append(special);
            return;
          }

          if (!section.isSeat(column, row)) {
            const empty = document.createElement("div");
            empty.className = "seat-empty";
            empty.setAttribute("aria-hidden", "true");
            rowEl.append(empty);
            return;
          }

          const seat = document.createElement("div");
          seat.className = "seat";
          seat.dataset.seat = code;
          const seatCode = document.createElement("span");
          seatCode.className = "seat-code";
          seatCode.textContent = code;

          const seatName = document.createElement("input");
          seatName.className = "seat-name";
          seatName.type = "text";
          seatName.maxLength = 20;
          seatName.autocomplete = "off";
          seatName.spellcheck = false;
          seatName.placeholder = "이름";
          seatName.readOnly = isViewerMode;
          if (isViewerMode) seatName.tabIndex = -1;
          seatName.setAttribute("aria-label", `${code} 자리 이름`);
          seatName.addEventListener("blur", (event) => updateNameFromSeat(code, event.target.value));
          seatName.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              const { assignments } = calculateState();
              event.currentTarget.value = assignments.get(code)?.name ?? "";
              event.currentTarget.blur();
            }
          });

          seat.append(seatCode, seatName);
          rowEl.append(seat);
        });

        grid.append(rowEl);
      }

      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = section.label;

      sectionEl.append(grid, label);
      fragment.append(sectionEl);
    });

    dom.seatSections.append(fragment);
  }

  function buildRoster() {
    const fragment = document.createDocumentFragment();

    rows.forEach((row, index) => {
      const rowEl = document.createElement("div");
      rowEl.className = "roster-row";
      rowEl.dataset.index = String(index);

      const number = document.createElement("span");
      number.className = "row-number";
      number.textContent = String(index + 1);

      const nameInput = document.createElement("input");
      nameInput.className = "roster-input name-input";
      nameInput.type = "text";
      nameInput.autocomplete = "off";
      nameInput.placeholder = index === 0 ? "이름 입력" : "";
      nameInput.value = row.name;
      nameInput.setAttribute("aria-label", `${index + 1}번 이름`);
      nameInput.addEventListener("input", (event) => updateRow(index, "name", event.target.value));
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          rowEl.querySelector(".seat-input").focus();
          rowEl.querySelector(".seat-input").select();
        }
      });

      const seatInput = document.createElement("input");
      seatInput.className = "roster-input seat-input";
      seatInput.type = "text";
      seatInput.inputMode = "text";
      seatInput.autocomplete = "off";
      seatInput.maxLength = 3;
      seatInput.placeholder = index === 0 ? "A9" : "";
      seatInput.value = row.seat;
      seatInput.setAttribute("aria-label", `${index + 1}번 자리`);
      seatInput.addEventListener("input", (event) => {
        const nextValue = normalizeSeat(event.target.value);
        event.target.value = nextValue;
        updateRow(index, "seat", nextValue);
      });
      seatInput.addEventListener("blur", () => reportSeatIssue(index));
      seatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const nextRow = dom.rosterList.querySelector(`[data-index="${index + 1}"]`);
          if (nextRow) {
            const nextInput = nextRow.querySelector(".name-input");
            nextInput.focus();
            nextInput.select();
            nextRow.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
      });

      const status = document.createElement("span");
      status.className = "row-status";
      status.textContent = "대기";

      rowEl.append(number, nameInput, seatInput, status);
      fragment.append(rowEl);
    });

    dom.rosterList.replaceChildren(fragment);
  }

  function updateRow(index, field, value) {
    if (isViewerMode) return;
    rows[index][field] = field === "seat" ? normalizeSeat(value) : value;
    refreshAssignments();
    scheduleSave();
  }

  function updateNameFromSeat(seatCode, value) {
    if (isViewerMode) return;
    const name = escapeText(value);
    const currentIndex = rows.findIndex((row) => normalizeSeat(row.seat) === seatCode);

    if (!name) {
      if (currentIndex >= 0) rows[currentIndex].seat = "";
    } else if (currentIndex >= 0) {
      const sameNameIndex = rows.findIndex((row, index) => index !== currentIndex && escapeText(row.name) === name);
      if (sameNameIndex >= 0) {
        rows[currentIndex].seat = "";
        rows[sameNameIndex].seat = seatCode;
      } else {
        rows[currentIndex].name = name;
      }
    } else {
      const sameNameIndex = rows.findIndex((row) => escapeText(row.name) === name);
      if (sameNameIndex >= 0) {
        rows[sameNameIndex].seat = seatCode;
      } else {
        const blankIndex = rows.findIndex((row) => !escapeText(row.name) && !normalizeSeat(row.seat));
        if (blankIndex === -1) {
          addToast(`명단 ${MAX_STUDENTS}칸이 모두 사용 중입니다.`, "error");
          refreshAssignments();
          return;
        }
        rows[blankIndex] = { name, seat: seatCode };
      }
    }

    syncInputsFromState();
    scheduleSave();
  }

  function calculateState() {
    const seatRows = new Map();
    const rowStates = rows.map(() => ({ type: "empty", label: "대기" }));

    rows.forEach((row, index) => {
      const name = escapeText(row.name);
      const seat = normalizeSeat(row.seat);
      if (!name && !seat) return;
      if (!name && seat) {
        rowStates[index] = { type: "invalid", label: "이름 필요" };
        return;
      }
      if (name && !seat) {
        rowStates[index] = { type: "waiting", label: "대기" };
        return;
      }
      if (!validSeats.has(seat)) {
        rowStates[index] = { type: "invalid", label: "확인" };
        return;
      }
      if (!seatRows.has(seat)) seatRows.set(seat, []);
      seatRows.get(seat).push(index);
    });

    const assignments = new Map();
    seatRows.forEach((indices, seat) => {
      if (indices.length > 1) {
        indices.forEach((index) => {
          rowStates[index] = { type: "duplicate", label: "중복" };
        });
        assignments.set(seat, { name: "중복", duplicate: true, rowIndex: indices[0] });
        return;
      }

      const rowIndex = indices[0];
      rowStates[rowIndex] = { type: "assigned", label: "완료" };
      assignments.set(seat, { name: escapeText(rows[rowIndex].name), duplicate: false, rowIndex });
    });

    return { assignments, rowStates };
  }

  function refreshAssignments() {
    const { assignments, rowStates } = calculateState();

    document.querySelectorAll(".seat").forEach((seatEl) => {
      const code = seatEl.dataset.seat;
      const assignment = assignments.get(code);
      const nameEl = seatEl.querySelector(".seat-name");
      const previous = previousAssignments.get(code);

      seatEl.classList.toggle("assigned", Boolean(assignment));
      seatEl.classList.toggle("duplicate", Boolean(assignment?.duplicate));
      if (document.activeElement !== nameEl) nameEl.value = assignment?.name ?? "";
      nameEl.setAttribute("aria-label", assignment ? `${code} 자리 ${assignment.name}` : `${code} 자리 이름`);

      if (assignment && previous !== assignment.name) {
        seatEl.classList.remove("just-assigned");
        void seatEl.offsetWidth;
        seatEl.classList.add("just-assigned");
        window.setTimeout(() => seatEl.classList.remove("just-assigned"), 700);
      }
    });

    rowStates.forEach((state, index) => {
      const rowEl = dom.rosterList.querySelector(`[data-index="${index}"]`);
      if (!rowEl) return;
      rowEl.classList.toggle("assigned", state.type === "assigned");
      rowEl.classList.toggle("invalid", state.type === "invalid");
      rowEl.classList.toggle("duplicate", state.type === "duplicate");
      rowEl.querySelector(".row-status").textContent = state.label;
    });

    previousAssignments = new Map(Array.from(assignments, ([seat, item]) => [seat, item.name]));

    const namedCount = rows.filter((row) => escapeText(row.name)).length;
    const assignedCount = rowStates.filter((state) => state.type === "assigned").length;
    dom.assignedCount.textContent = String(assignedCount);
    dom.remainingCount.textContent = String(Math.max(0, namedCount - assignedCount));
    dom.rowCount.textContent = `${namedCount} / ${MAX_STUDENTS}`;

    applySearch();
  }

  function focusAssignedStudent(seatCode) {
    if (isViewerMode) return;
    const { assignments } = calculateState();
    const assignment = assignments.get(seatCode);
    if (!assignment || assignment.duplicate) {
      addToast(assignment?.duplicate ? `${seatCode} 자리가 중복 입력됐습니다.` : `${seatCode}는 아직 빈자리입니다.`, assignment?.duplicate ? "error" : "");
      return;
    }

    dom.searchInput.value = "";
    applySearch();
    const rowEl = dom.rosterList.querySelector(`[data-index="${assignment.rowIndex}"]`);
    rowEl.scrollIntoView({ block: "center", behavior: "smooth" });
    const input = rowEl.querySelector(".seat-input");
    input.focus();
    input.select();
  }

  function reportSeatIssue(index) {
    const { rowStates } = calculateState();
    const state = rowStates[index];
    const seat = normalizeSeat(rows[index].seat);
    if (state.type === "invalid" && seat && !validSeats.has(seat)) {
      addToast(`${seat}는 자리표에 없는 코드입니다.`, "error");
    } else if (state.type === "duplicate") {
      addToast(`${seat} 자리가 두 번 입력됐습니다.`, "error");
    }
  }

  function applySearch() {
    const query = escapeText(dom.searchInput.value).toLocaleLowerCase("ko-KR");
    let visibleCount = 0;

    dom.rosterList.querySelectorAll(".roster-row").forEach((rowEl) => {
      const index = Number(rowEl.dataset.index);
      const haystack = `${rows[index].name} ${rows[index].seat} ${index + 1}`.toLocaleLowerCase("ko-KR");
      const visible = !query || haystack.includes(query);
      rowEl.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    dom.emptySearch.hidden = visibleCount !== 0;
  }

  function scheduleSave() {
    if (isViewerMode) return;
    dom.saveState.textContent = "저장 중…";
    dom.saveState.classList.add("saving");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveLocal, 280);
    scheduleLiveSave();
  }

  function saveLocal() {
    if (isViewerMode) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, importedFileName, savedAt: Date.now() }));
      if (liveSessionId) {
        setLiveUi(true);
      } else {
        dom.saveState.textContent = "자동 저장됨";
        dom.saveState.classList.remove("saving");
      }
    } catch (error) {
      console.error(error);
      dom.saveState.textContent = "저장 실패";
      dom.saveState.classList.remove("saving");
    }
  }

  function loadLocal() {
    if (isViewerMode) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.rows)) return;
      rows = createBlankRows();
      saved.rows.slice(0, MAX_STUDENTS).forEach((row, index) => {
        rows[index] = {
          name: escapeText(row?.name),
          seat: normalizeSeat(row?.seat),
        };
      });
      importedFileName = escapeText(saved.importedFileName);
    } catch (error) {
      console.warn("저장된 데이터를 불러오지 못했습니다.", error);
    }
  }

  function syncInputsFromState() {
    rows.forEach((row, index) => {
      const rowEl = dom.rosterList.querySelector(`[data-index="${index}"]`);
      rowEl.querySelector(".name-input").value = row.name;
      rowEl.querySelector(".seat-input").value = row.seat;
    });
    dom.fileName.textContent = importedFileName || "파일을 불러오거나 직접 입력하세요.";
    refreshAssignments();
  }

  async function importFile(file) {
    if (!file || !/\.(?:pdf|xlsx|xls|csv)$/i.test(file.name)) {
      addToast("PDF, 엑셀 또는 CSV 명단만 불러올 수 있습니다.", "error");
      return;
    }

    dom.importButton.disabled = true;
    dom.importButton.classList.add("is-loading");
    dom.importButton.setAttribute("aria-busy", "true");
    try {
      const importedRows = /\.pdf$/i.test(file.name) ? await readPdfRoster(file) : await readSpreadsheetRoster(file);

      if (!importedRows.length) {
        addToast(/\.pdf$/i.test(file.name) ? "PDF에서 이름을 찾지 못했습니다. 스캔 이미지 PDF인지 확인해 주세요." : "파일에서 학생 이름을 찾지 못했습니다.", "error");
        return;
      }

      rows = createBlankRows();
      importedRows.slice(0, MAX_STUDENTS).forEach((row, index) => {
        rows[index] = row;
      });
      importedFileName = file.name;
      dom.searchInput.value = "";
      syncInputsFromState();
      saveLocal();
      dom.rosterScroll.scrollTop = 0;
      if (importedRows.length > MAX_STUDENTS) {
        addToast(`PDF에서 ${importedRows.length}명을 찾았습니다. 최대 ${MAX_STUDENTS}명까지만 불러왔고 ${importedRows.length - MAX_STUDENTS}명은 제외했습니다.`);
      } else {
        addToast(`${importedRows.length}명의 명단을 불러왔습니다.`);
      }
    } catch (error) {
      console.error(error);
      if (error?.name === "PasswordException") {
        addToast("암호가 설정된 PDF는 읽을 수 없습니다.", "error");
      } else {
        addToast("파일을 읽지 못했습니다. PDF, 엑셀 또는 CSV 파일인지 확인해 주세요.", "error");
      }
    } finally {
      dom.fileInput.value = "";
      dom.importButton.disabled = false;
      dom.importButton.classList.remove("is-loading");
      dom.importButton.removeAttribute("aria-busy");
    }
  }

  async function readSpreadsheetRoster(file) {
    if (!window.XLSX) throw new Error("엑셀 읽기 도구를 불러오지 못했습니다.");

    const data = await file.arrayBuffer();
    const isCsv = /\.csv$/i.test(file.name);
    let workbook;
    if (isCsv) {
      let text = new TextDecoder("utf-8").decode(data);
      if (text.includes("\uFFFD")) text = new TextDecoder("euc-kr").decode(data);
      workbook = window.XLSX.read(text.replace(/^\uFEFF/, ""), { type: "string" });
    } else {
      workbook = window.XLSX.read(data, { type: "array" });
    }
    const preferredSheet = workbook.SheetNames.find((name) => /호명|명단|순서|roster/i.test(name));
    const sheetName = preferredSheet || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    return extractRoster(matrix);
  }

  async function loadPdfJs() {
    if (!pdfJsPromise) {
      pdfJsPromise = Promise.resolve().then(() => {
        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) throw new Error("PDF 읽기 도구를 불러오지 못했습니다.");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.js?v=20260829-8", window.location.href).href;
        return pdfjsLib;
      });
    }
    return pdfJsPromise;
  }

  async function readPdfRoster(file) {
    const pdfjsLib = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const matrix = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      matrix.push(...pdfItemsToMatrix(textContent.items));
    }

    return extractPdfRoster(matrix);
  }

  function pdfItemsToMatrix(items) {
    const lines = [];
    items.forEach((item) => {
      const text = escapeText(item.str);
      if (!text) return;
      const x = Number(item.transform?.[4] ?? 0);
      const y = Number(item.transform?.[5] ?? 0);
      let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);
      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }
      line.items.push({ text, x, width: Number(item.width ?? 0), height: Math.abs(Number(item.height ?? item.transform?.[0] ?? 10)) });
    });

    return lines
      .sort((a, b) => b.y - a.y)
      .map((line) => {
        const cells = [];
        let buffer = "";
        let rightEdge = null;
        let previousHeight = 10;
        line.items.sort((a, b) => a.x - b.x).forEach((item) => {
          const gap = rightEdge === null ? 0 : item.x - rightEdge;
          const isColumnGap = rightEdge !== null && gap > Math.max(12, previousHeight * 0.9);
          if (isColumnGap && buffer) {
            cells.push(buffer.trim());
            buffer = item.text;
          } else {
            const needsSpace = buffer && gap > 2.5;
            buffer += `${needsSpace ? " " : ""}${item.text}`;
          }
          rightEdge = Math.max(item.x + item.width, item.x);
          previousHeight = item.height || previousHeight;
        });
        if (buffer) cells.push(buffer.trim());
        return cells;
      })
      .filter((row) => row.length);
  }

  function extractPdfRoster(matrix) {
    const result = [];
    const ignored = /^(?:호명순서|호명명단|명단|이름|성명|학생명|학생|학번|순번|번호|자리|좌석|상태|대기|배치|페이지|과대단|과대)$/i;
    const isRankedStudentTable = matrix.some((row) => {
      const line = row.map((cell) => escapeText(cell)).filter(Boolean).join(" ");
      return /순위/.test(line) && /학번/.test(line) && /(?:성명|이름)/.test(line);
    });

    matrix.forEach((row) => {
      const cells = row.map((cell) => escapeText(cell)).filter(Boolean);
      if (!cells.length) return;

      const rawLine = cells.join(" ");
      if (isRankedStudentTable && !/^\s*\d{1,3}\s+\d{6,12}(?:\s|$)/.test(rawLine)) return;
      const hasOrdinal = cells.some((cell) => /^\d{1,12}\s*[.)번:\-]?$/.test(cell)) || /^\s*\d{1,12}\s+/.test(rawLine);

      const joined = cells
        .join(" ")
        .replace(/(?<=[가-힣])\s+(?=[가-힣])/g, "")
        .replace(/(?:호명순서|호명명단|학생명단|이름|성명|학생명|학번|순번|번호|자리번호|자리|좌석|상태)/gi, " ")
        .replace(/^\s*\d{1,12}\s*[.)번:\-]?\s*/, " ")
        .trim();
      const seatMatch = joined.match(/(?:^|\s)([A-N](?:10|[1-9]))(?:\s|$)/i);
      const withoutSeat = joined.replace(/(?:^|\s)[A-N](?:10|[1-9])(?:\s|$)/gi, " ").trim();
      const koreanNames = withoutSeat.match(/[가-힣]{2,6}/g) || [];
      let name = koreanNames.find((candidate) => {
        if (ignored.test(candidate) || /(?:학과|학년|강의|수업|교수|담당)$/.test(candidate)) return false;
        const isStandaloneShortName = candidate.length <= 4 && withoutSeat.replace(/\s/g, "") === candidate;
        return hasOrdinal || Boolean(seatMatch) || isStandaloneShortName;
      });

      if (!name) {
        const latin = withoutSeat.match(/[A-Za-z][A-Za-z.'-]{1,}(?:\s+[A-Za-z][A-Za-z.'-]{1,}){0,3}/);
        const isStandaloneLatinName = latin && withoutSeat.trim() === latin[0] && latin[0].split(/\s+/).length <= 4;
        if (latin && !/^(?:pdf|name|student|seat|page)$/i.test(latin[0]) && (hasOrdinal || Boolean(seatMatch) || isStandaloneLatinName)) name = latin[0];
      }

      if (name && !ignored.test(name)) result.push({ name, seat: normalizeSeat(seatMatch?.[1] || "") });
    });

    if (result.length) return result;
    return extractRoster(matrix);
  }

  function extractRoster(matrix) {
    const cleanRows = matrix
      .map((row) => (Array.isArray(row) ? row.map((cell) => escapeText(cell)) : []))
      .filter((row) => row.some(Boolean));

    if (!cleanRows.length) return [];

    let headerIndex = -1;
    let nameColumn = -1;
    let seatColumn = -1;

    cleanRows.slice(0, 15).some((row, rowIndex) => {
      const detectedName = row.findIndex((cell) => /^(이름|성명|학생명|호명|name)$/i.test(cell.replace(/\s/g, "")));
      if (detectedName === -1) return false;
      headerIndex = rowIndex;
      nameColumn = detectedName;
      seatColumn = row.findIndex((cell) => /^(자리|좌석|자리번호|seat)$/i.test(cell.replace(/\s/g, "")));
      return true;
    });

    if (nameColumn === -1) {
      const columnCount = Math.max(...cleanRows.map((row) => row.length));
      const scores = Array.from({ length: columnCount }, (_, column) => {
        return cleanRows.slice(0, 60).reduce((score, row) => {
          const cell = escapeText(row[column]);
          if (!cell || /^\d+$/.test(cell) || /^[A-N](?:[1-9]|10)$/i.test(cell)) return score;
          if (/순번|번호|자리|좌석/.test(cell)) return score;
          return score + 1;
        }, 0);
      });
      nameColumn = scores.indexOf(Math.max(...scores));
      headerIndex = -1;
    }

    const sourceRows = cleanRows.slice(headerIndex + 1);
    const result = [];

    sourceRows.forEach((row) => {
      const name = escapeText(row[nameColumn]);
      if (!name || /^(이름|성명|학생명|호명)$/i.test(name.replace(/\s/g, ""))) return;
      if (/^\d+$/.test(name)) return;
      const seat = seatColumn >= 0 ? normalizeSeat(row[seatColumn]) : "";
      result.push({ name, seat });
    });

    return result;
  }

  function getDateStamp() {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date())
      .replace(/\.\s?/g, "-")
      .replace(/-$/, "");
  }

  function getExportSnapshot() {
    const calculated = calculateState();
    const assignedBySeat = new Map();
    const namedCount = rows.filter((row) => escapeText(row.name)).length;
    const assignedCount = calculated.rowStates.filter((state) => state.type === "assigned").length;

    calculated.assignments.forEach((assignment, seat) => {
      assignedBySeat.set(seat, assignment.duplicate ? { name: "중복", duplicate: true } : { name: assignment.name, duplicate: false });
    });

    return {
      assignedBySeat,
      populatedRows: rows
        .map((row, index) => ({
          number: index + 1,
          name: escapeText(row.name),
          seat: normalizeSeat(row.seat),
          status: calculated.rowStates[index].label,
        }))
        .filter((row) => row.name || row.seat),
      assignedCount,
      waitingCount: Math.max(0, namedCount - assignedCount),
      hasProblems: calculated.rowStates.some((state) => state.type === "invalid" || state.type === "duplicate"),
    };
  }

  async function buildReferenceStyleWorkbook(snapshot) {
    const response = await fetch("./seat-layout-template.xlsx", { cache: "no-store" });
    if (!response.ok) throw new Error(`자리표 서식 파일을 불러오지 못했습니다. (${response.status})`);

    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    worksheet.name = "확정 자리표";

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const seat = normalizeSeat(cell.value);
        if (!validSeats.has(seat)) return;
        const assignment = snapshot.assignedBySeat.get(seat);
        cell.value = assignment?.name || seat;
      });
    });

    const roster = workbook.addWorksheet("전체 명단", {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      pageMargins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    });
    roster.columns = [
      { header: "순번", key: "number", width: 8 },
      { header: "이름", key: "name", width: 20 },
      { header: "자리", key: "seat", width: 10 },
      { header: "상태", key: "status", width: 14 },
    ];
    snapshot.populatedRows.forEach((row) => roster.addRow(row));
    roster.autoFilter = { from: "A1", to: `D${Math.max(1, roster.rowCount)}` };
    roster.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111820" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    return workbook;
  }

  function downloadExcelBuffer(buffer, fileName) {
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportWorkbook() {
    if (!window.ExcelJS) {
      addToast("엑셀 저장 도구를 불러오지 못했습니다.", "error");
      return;
    }

    const snapshot = getExportSnapshot();
    dom.excelButton.disabled = true;
    dom.excelButton.setAttribute("aria-busy", "true");

    try {
      const workbook = await buildReferenceStyleWorkbook(snapshot);
      downloadExcelBuffer(await workbook.xlsx.writeBuffer(), `확정_자리표_${getDateStamp()}.xlsx`);
      addToast(snapshot.hasProblems ? "엑셀을 저장했습니다. 중복·오류 자리를 확인해 주세요." : "첨부 형식으로 엑셀을 저장했습니다.", snapshot.hasProblems ? "error" : "");
    } catch (error) {
      console.error(error);
      addToast("엑셀 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      dom.excelButton.disabled = false;
      dom.excelButton.removeAttribute("aria-busy");
    }
  }

  function roundedRect(ctx, x, y, width, height, radius, fill, stroke, lineWidth = 1) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function fitCanvasText(ctx, text, maxWidth, initialSize, minSize = 15) {
    let size = initialSize;
    do {
      ctx.font = `900 ${size}px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 1;
    } while (size > minSize);
    return minSize;
  }

  function drawFinalSeatChart(snapshot) {
    const canvas = document.createElement("canvas");
    canvas.width = 2100;
    canvas.height = 1450;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f6f7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#111820";
    ctx.fillRect(0, 0, canvas.width, 142);
    ctx.fillStyle = "#28d7a1";
    ctx.beginPath();
    ctx.arc(72, 70, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 48px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
    ctx.fillText("확정 자리표", 105, 86);
    ctx.fillStyle = "#aeb8c2";
    ctx.font = "700 20px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`배치 ${snapshot.assignedCount}명 · 대기 ${snapshot.waitingCount}명 · ${new Date().toLocaleString("ko-KR")}`, 2030, 82);
    ctx.textAlign = "left";

    const marginX = 72;
    const gridTop = 220;
    const gridHeight = 980;
    const labelHeight = 56;
    const rowHeight = (gridHeight - labelHeight) / 10;
    const sectionGap = 26;
    const usableWidth = canvas.width - marginX * 2 - sectionGap * 3;
    const unitWidth = usableWidth / 14;
    let sectionX = marginX;

    ctx.textAlign = "center";
    sections.forEach((section) => {
      const sectionWidth = unitWidth * section.columns.length;
      ctx.fillStyle = "#111820";
      ctx.fillRect(sectionX, gridTop - 6, sectionWidth, 6);

      for (let row = 10; row >= 1; row -= 1) {
        const rowIndex = 10 - row;
        section.columns.forEach((column, columnIndex) => {
          const code = `${column}${row}`;
          const x = sectionX + columnIndex * unitWidth;
          const y = gridTop + rowIndex * rowHeight;

          if (section.specials[code]) {
            ctx.fillStyle = "#ebe7dc";
            ctx.fillRect(x, y, unitWidth, rowHeight);
            ctx.strokeStyle = "#b8c0c7";
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, unitWidth, rowHeight);
            ctx.fillStyle = "#655c48";
            ctx.font = "850 19px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
            ctx.fillText(section.specials[code], x + unitWidth / 2, y + rowHeight / 2 + 7);
            return;
          }

          if (!section.isSeat(column, row)) return;
          const assignment = snapshot.assignedBySeat.get(code);
          ctx.fillStyle = assignment?.duplicate ? "#ffb8b1" : assignment ? "#0da9d6" : "#ffffff";
          ctx.fillRect(x, y, unitWidth, rowHeight);
          ctx.strokeStyle = assignment ? "#178eb0" : "#b8c0c7";
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, unitWidth, rowHeight);

          if (assignment) {
            ctx.textAlign = "right";
            ctx.fillStyle = assignment.duplicate ? "#7a2119" : "rgba(4,44,57,.62)";
            ctx.font = "800 15px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
            ctx.fillText(code, x + unitWidth - 9, y + 19);
            ctx.textAlign = "center";
            ctx.fillStyle = assignment.duplicate ? "#6f1e17" : "#042c39";
            fitCanvasText(ctx, assignment.name, unitWidth - 18, 27);
            ctx.fillText(assignment.name, x + unitWidth / 2, y + rowHeight / 2 + 10);
          } else {
            ctx.fillStyle = "#38434e";
            ctx.font = "850 20px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
            ctx.fillText(code, x + unitWidth / 2, y + rowHeight / 2 + 7);
          }
        });
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sectionX, gridTop + rowHeight * 10, sectionWidth, labelHeight);
      ctx.strokeStyle = "#b8c0c7";
      ctx.lineWidth = 2;
      ctx.strokeRect(sectionX, gridTop + rowHeight * 10, sectionWidth, labelHeight);
      ctx.fillStyle = "#4e5964";
      ctx.font = "850 22px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
      ctx.fillText(section.label, sectionX + sectionWidth / 2, gridTop + rowHeight * 10 + 36);
      sectionX += sectionWidth + sectionGap;
    });

    const frontY = 1270;
    const frontGap = 26;
    const frontWidth = (canvas.width - marginX * 2 - frontGap * 3) / 4;
    ["창가", "교탁 · PC · 교수님", "교단", "앞문"].forEach((label, index) => {
      const x = marginX + index * (frontWidth + frontGap);
      roundedRect(ctx, x, frontY, frontWidth, 82, 8, "#ffffff", "#b9c1c8", 2);
      ctx.fillStyle = "#515c66";
      ctx.font = "800 21px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + frontWidth / 2, frontY + 50);
    });

    ctx.fillStyle = "#6f7a86";
    ctx.font = "650 16px Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("자리배치 LIVE에서 생성", marginX, 1410);
    ctx.textAlign = "right";
    ctx.fillText(snapshot.hasProblems ? "주의: 중복 또는 잘못된 자리 입력이 포함되어 있습니다." : "최종 확인용", canvas.width - marginX, 1410);
    return canvas;
  }

  function exportPdf() {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) {
      addToast("PDF 저장 도구를 불러오지 못했습니다.", "error");
      return;
    }

    dom.pdfButton.disabled = true;
    dom.pdfButton.classList.add("is-loading");
    window.setTimeout(() => {
      try {
        const snapshot = getExportSnapshot();
        const canvas = drawFinalSeatChart(snapshot);
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
        pdf.setProperties({ title: "확정 자리표", subject: "자리배치 LIVE 최종 자리표", creator: "자리배치 LIVE" });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 8, 8, 281, 194, undefined, "FAST");
        pdf.save(`확정_자리표_${getDateStamp()}.pdf`);
        addToast(snapshot.hasProblems ? "PDF를 저장했습니다. 중복·오류 자리를 확인해 주세요." : "확정 자리표 PDF를 저장했습니다.", snapshot.hasProblems ? "error" : "");
      } catch (error) {
        console.error(error);
        addToast("PDF를 만드는 중 오류가 발생했습니다.", "error");
      } finally {
        dom.pdfButton.disabled = false;
        dom.pdfButton.classList.remove("is-loading");
      }
    }, 30);
  }

  function addToast(message, type = "") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    dom.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error(error);
      addToast("이 브라우저에서는 전체 화면을 사용할 수 없습니다.", "error");
    }
  }

  function resetAll() {
    if (isViewerMode) return;
    rows = createBlankRows();
    importedFileName = "";
    previousAssignments.clear();
    dom.searchInput.value = "";
    syncInputsFromState();
    localStorage.removeItem(STORAGE_KEY);
    dom.rosterScroll.scrollTop = 0;
    dom.saveState.textContent = "초기화됨";
    addToast("명단과 자리 입력을 모두 지웠습니다.");
  }

  function isFileDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function showDropOverlay() {
    dom.dropOverlay.hidden = false;
    dom.dropOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("file-dragging");
  }

  function hideDropOverlay() {
    dragDepth = 0;
    dom.dropOverlay.hidden = true;
    dom.dropOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("file-dragging");
  }

  function bindFileDrop() {
    document.addEventListener("dragenter", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth += 1;
      showDropOverlay();
    });
    document.addEventListener("dragover", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", (event) => {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideDropOverlay();
    });
    document.addEventListener("drop", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      hideDropOverlay();
      if (!files.length) return;
      if (files.length > 1) addToast("여러 파일 중 첫 번째 명단만 불러옵니다.");
      importFile(files[0]);
    });
    window.addEventListener("blur", hideDropOverlay);
  }

  function getRosterWidthLimits() {
    const min = 320;
    const max = Math.max(min, Math.min(600, Math.round(window.innerWidth * 0.48)));
    return { min, max };
  }

  function applyRosterWidth(width, save = false) {
    if (window.innerWidth <= 900) return;
    const { min, max } = getRosterWidthLimits();
    const nextWidth = Math.min(max, Math.max(min, Math.round(Number(width) || DEFAULT_ROSTER_WIDTH)));
    document.documentElement.style.setProperty("--roster-width", `${nextWidth}px`);
    dom.panelResizer.setAttribute("aria-valuemin", String(min));
    dom.panelResizer.setAttribute("aria-valuemax", String(max));
    dom.panelResizer.setAttribute("aria-valuenow", String(nextWidth));
    if (save) localStorage.setItem(ROSTER_WIDTH_KEY, String(nextWidth));
  }

  function loadRosterWidth() {
    const savedWidth = Number(localStorage.getItem(ROSTER_WIDTH_KEY));
    applyRosterWidth(Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : DEFAULT_ROSTER_WIDTH);
  }

  function bindPanelResizer() {
    let dragging = false;

    const finishResize = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("panel-resizing");
      applyRosterWidth(Number(dom.panelResizer.getAttribute("aria-valuenow")), true);
    };

    dom.panelResizer.addEventListener("pointerdown", (event) => {
      if (window.innerWidth <= 900) return;
      event.preventDefault();
      dom.panelResizer.focus();
      dragging = true;
      document.body.classList.add("panel-resizing");
      dom.panelResizer.setPointerCapture?.(event.pointerId);
    });

    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      applyRosterWidth(window.innerWidth - event.clientX);
    });
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);

    dom.panelResizer.addEventListener("dblclick", () => {
      applyRosterWidth(DEFAULT_ROSTER_WIDTH, true);
      addToast("호명 순서 칸 너비를 기본값으로 되돌렸습니다.");
    });

    dom.panelResizer.addEventListener("keydown", (event) => {
      const current = Number(dom.panelResizer.getAttribute("aria-valuenow")) || DEFAULT_ROSTER_WIDTH;
      const { min, max } = getRosterWidthLimits();
      let nextWidth = current;
      if (event.key === "ArrowLeft") nextWidth += 20;
      else if (event.key === "ArrowRight") nextWidth -= 20;
      else if (event.key === "Home") nextWidth = min;
      else if (event.key === "End") nextWidth = max;
      else return;
      event.preventDefault();
      applyRosterWidth(nextWidth, true);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) loadRosterWidth();
    });
  }

  function bindEvents() {
    if (isViewerMode) {
      dom.fullscreenButton.addEventListener("click", toggleFullscreen);
      document.addEventListener("fullscreenchange", () => {
        dom.fullscreenButton.title = document.fullscreenElement ? "전체 화면 종료" : "전체 화면";
        dom.fullscreenButton.setAttribute("aria-label", dom.fullscreenButton.title);
      });
      return;
    }
    dom.importButton.addEventListener("click", () => dom.fileInput.click());
    dom.fileInput.addEventListener("change", () => {
      const [file] = dom.fileInput.files;
      if (file) importFile(file);
    });
    dom.excelButton.addEventListener("click", exportWorkbook);
    dom.pdfButton.addEventListener("click", exportPdf);
    dom.fullscreenButton.addEventListener("click", toggleFullscreen);
    dom.resetButton.addEventListener("click", () => dom.resetDialog.showModal());
    dom.resetDialog.addEventListener("close", () => {
      if (dom.resetDialog.returnValue === "confirm") resetAll();
    });
    dom.searchInput.addEventListener("input", applySearch);
    document.addEventListener("fullscreenchange", () => {
      dom.fullscreenButton.title = document.fullscreenElement ? "전체 화면 종료" : "전체 화면";
      dom.fullscreenButton.setAttribute("aria-label", dom.fullscreenButton.title);
    });
    bindFileDrop();
    bindPanelResizer();
  }

  function getRemoteState() {
    return {
      rows: rows.map((row) => ({
        name: escapeText(row.name),
        seat: normalizeSeat(row.seat),
      })),
    };
  }

  function applyRemoteState(state) {
    if (!state || !Array.isArray(state.rows)) return false;
    rows = createBlankRows();
    state.rows.slice(0, MAX_STUDENTS).forEach((row, index) => {
      rows[index] = {
        name: escapeText(row?.name),
        seat: normalizeSeat(row?.seat),
      };
    });
    importedFileName = "";
    syncInputsFromState();
    return true;
  }

  async function loadFirebase() {
    if (!firebasePromise) {
      firebasePromise = Promise.all([
        import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js"),
      ]).then(([appModule, authModule, firestoreModule]) => {
        const app = appModule.initializeApp(FIREBASE_CONFIG);
        return {
          auth: authModule.getAuth(app),
          db: firestoreModule.getFirestore(app),
          authModule,
          firestoreModule,
        };
      });
    }
    return firebasePromise;
  }

  async function ensureTeacherAuth(firebase) {
    if (firebase.auth.currentUser) return firebase.auth.currentUser;
    const credential = await firebase.authModule.signInAnonymously(firebase.auth);
    return credential.user;
  }

  function buildShareUrl(sessionId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("room", sessionId);
    return url.href;
  }

  function setLiveUi(active) {
    dom.shareButton.classList.toggle("is-live", active);
    dom.shareButtonText.textContent = active ? "LIVE 공유 중" : "실시간 공유";
    dom.saveState.textContent = active ? "LIVE 연결됨" : "자동 저장됨";
    dom.saveState.classList.remove("saving");
    dom.saveState.classList.toggle("live", active);
  }

  async function writeLiveState() {
    if (!liveSessionId || !liveOwnerId || isViewerMode) return;
    try {
      const firebase = await loadFirebase();
      const reference = firebase.firestoreModule.doc(firebase.db, "seatSessions", liveSessionId);
      await firebase.firestoreModule.setDoc(reference, {
        ownerId: liveOwnerId,
        state: getRemoteState(),
        updatedAt: firebase.firestoreModule.serverTimestamp(),
        version: Date.now(),
      });
      setLiveUi(true);
    } catch (error) {
      console.error("실시간 자리표 저장 실패", error);
      dom.saveState.textContent = "LIVE 저장 실패";
      dom.saveState.classList.remove("saving", "live");
      addToast("실시간 공유 연결이 끊겼습니다. 인터넷 연결을 확인해 주세요.", "error");
    }
  }

  function scheduleLiveSave() {
    if (!liveSessionId || isViewerMode) return;
    dom.saveState.textContent = "LIVE 반영 중…";
    dom.saveState.classList.add("saving");
    dom.saveState.classList.remove("live");
    window.clearTimeout(liveSaveTimer);
    liveSaveTimer = window.setTimeout(writeLiveState, LIVE_SAVE_DELAY);
  }

  async function startLiveShare() {
    dom.shareButton.disabled = true;
    dom.shareButton.classList.add("is-loading");
    try {
      const firebase = await loadFirebase();
      const user = await ensureTeacherAuth(firebase);
      liveOwnerId = user.uid;
      liveSessionId = liveSessionId || crypto.randomUUID().replaceAll("-", "");
      await writeLiveState();
      localStorage.setItem(LIVE_SESSION_KEY, liveSessionId);
      dom.shareLink.value = buildShareUrl(liveSessionId);
      dom.shareDialog.showModal();
      addToast("학생용 실시간 링크를 만들었습니다.");
    } catch (error) {
      console.error("실시간 공유 시작 실패", error);
      liveSessionId = "";
      liveOwnerId = "";
      localStorage.removeItem(LIVE_SESSION_KEY);
      setLiveUi(false);
      addToast("실시간 공유를 시작하지 못했습니다. 인터넷 연결을 확인해 주세요.", "error");
    } finally {
      dom.shareButton.disabled = false;
      dom.shareButton.classList.remove("is-loading");
    }
  }

  async function resumeLiveShare() {
    const savedSessionId = localStorage.getItem(LIVE_SESSION_KEY) || "";
    if (!/^[a-f0-9]{32}$/i.test(savedSessionId)) return;
    try {
      const firebase = await loadFirebase();
      const user = await ensureTeacherAuth(firebase);
      const reference = firebase.firestoreModule.doc(firebase.db, "seatSessions", savedSessionId);
      const snapshot = await firebase.firestoreModule.getDoc(reference);
      if (!snapshot.exists() || snapshot.data().ownerId !== user.uid) throw new Error("공유 소유권을 확인할 수 없습니다.");
      liveSessionId = savedSessionId;
      liveOwnerId = user.uid;
      dom.shareLink.value = buildShareUrl(liveSessionId);
      setLiveUi(true);
      scheduleLiveSave();
    } catch (error) {
      console.warn("이전 실시간 공유를 이어갈 수 없습니다.", error);
      localStorage.removeItem(LIVE_SESSION_KEY);
      liveSessionId = "";
      liveOwnerId = "";
      setLiveUi(false);
    }
  }

  async function stopLiveShare() {
    if (!liveSessionId) return;
    dom.stopShareButton.disabled = true;
    try {
      const firebase = await loadFirebase();
      const reference = firebase.firestoreModule.doc(firebase.db, "seatSessions", liveSessionId);
      await firebase.firestoreModule.deleteDoc(reference);
      liveSessionId = "";
      liveOwnerId = "";
      localStorage.removeItem(LIVE_SESSION_KEY);
      setLiveUi(false);
      dom.shareDialog.close();
      addToast("실시간 공유를 종료했습니다.");
    } catch (error) {
      console.error("실시간 공유 종료 실패", error);
      addToast("공유를 종료하지 못했습니다. 다시 시도해 주세요.", "error");
    } finally {
      dom.stopShareButton.disabled = false;
    }
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(dom.shareLink.value);
      addToast("학생용 링크를 복사했습니다.");
    } catch (error) {
      dom.shareLink.focus();
      dom.shareLink.select();
      document.execCommand("copy");
      addToast("학생용 링크를 복사했습니다.");
    }
  }

  function bindLiveShareEvents() {
    dom.shareButton.addEventListener("click", () => {
      if (liveSessionId) {
        dom.shareLink.value = buildShareUrl(liveSessionId);
        dom.shareDialog.showModal();
      } else {
        startLiveShare();
      }
    });
    dom.copyShareLink.addEventListener("click", copyShareLink);
    dom.stopShareButton.addEventListener("click", stopLiveShare);
  }

  function setViewerStatus(title, text, type = "") {
    dom.viewerNotice.hidden = false;
    dom.viewerNotice.className = `viewer-notice ${type}`.trim();
    dom.viewerNoticeTitle.textContent = title;
    dom.viewerNoticeText.textContent = text;
    dom.saveState.textContent = title;
    dom.saveState.classList.toggle("live", type !== "error");
  }

  async function initializeViewer() {
    document.querySelector("#seatPanelTitle").textContent = "학생용 실시간 자리표";
    setViewerStatus("연결 중…", "선생님의 자리표를 불러오고 있습니다.");
    try {
      const firebase = await loadFirebase();
      const reference = firebase.firestoreModule.doc(firebase.db, "seatSessions", roomIdFromUrl);
      viewerUnsubscribe = firebase.firestoreModule.onSnapshot(reference, (snapshot) => {
        if (!snapshot.exists()) {
          setViewerStatus("공유 종료됨", "선생님이 공유를 끝냈거나 링크가 올바르지 않습니다.", "error");
          return;
        }
        if (!applyRemoteState(snapshot.data().state)) {
          setViewerStatus("표시 오류", "자리표 데이터를 읽지 못했습니다.", "error");
          return;
        }
        setViewerStatus("실시간 연결됨", "선생님이 자리를 바꾸면 이 화면도 자동으로 갱신됩니다.", "connected");
      }, (error) => {
        console.error("학생용 실시간 연결 실패", error);
        setViewerStatus("연결 실패", "인터넷 연결을 확인한 뒤 새로고침해 주세요.", "error");
      });
    } catch (error) {
      console.error("학생용 화면 초기화 실패", error);
      setViewerStatus("연결 실패", "인터넷 연결을 확인한 뒤 새로고침해 주세요.", "error");
    }
  }

  loadLocal();
  loadRosterWidth();
  buildSeatMap();
  buildRoster();
  bindEvents();
  syncInputsFromState();
  if (isViewerMode) {
    initializeViewer();
  } else {
    bindLiveShareEvents();
    resumeLiveShare();
  }
})();
