(() => {
  "use strict";

  const MAX_STUDENTS = 125;
  const STORAGE_KEY = "classroom-seat-live-v1";

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
    importButton: document.querySelector("#importButton"),
    exportButton: document.querySelector("#exportButton"),
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
  };

  let rows = createBlankRows();
  let importedFileName = "";
  let saveTimer = null;
  let previousAssignments = new Map();

  function createBlankRows() {
    return Array.from({ length: MAX_STUDENTS }, () => ({ name: "", seat: "" }));
  }

  function normalizeSeat(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
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

          const seat = document.createElement("button");
          seat.type = "button";
          seat.className = "seat";
          seat.dataset.seat = code;
          seat.setAttribute("aria-label", `${code} 빈자리`);
          seat.innerHTML = `<span class="seat-code">${code}</span><span class="seat-name"></span>`;
          seat.addEventListener("click", () => focusAssignedStudent(code));
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
    rows[index][field] = field === "seat" ? normalizeSeat(value) : value;
    refreshAssignments();
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
      nameEl.textContent = assignment?.name ?? "";
      seatEl.setAttribute("aria-label", assignment ? `${code} ${assignment.name}` : `${code} 빈자리`);

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
    dom.saveState.textContent = "저장 중…";
    dom.saveState.classList.add("saving");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveLocal, 280);
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, importedFileName, savedAt: Date.now() }));
      dom.saveState.textContent = "자동 저장됨";
      dom.saveState.classList.remove("saving");
    } catch (error) {
      console.error(error);
      dom.saveState.textContent = "저장 실패";
      dom.saveState.classList.remove("saving");
    }
  }

  function loadLocal() {
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
    if (!window.XLSX) {
      addToast("엑셀 읽기 도구를 불러오지 못했습니다.", "error");
      return;
    }

    try {
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
      const importedRows = extractRoster(matrix);

      if (!importedRows.length) {
        addToast("파일에서 학생 이름을 찾지 못했습니다.", "error");
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
      addToast(`${Math.min(importedRows.length, MAX_STUDENTS)}명의 명단을 불러왔습니다.`);
    } catch (error) {
      console.error(error);
      addToast("파일을 읽지 못했습니다. 엑셀 또는 CSV 파일인지 확인해 주세요.", "error");
    } finally {
      dom.fileInput.value = "";
    }
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

  function exportWorkbook() {
    if (!window.XLSX) {
      addToast("엑셀 저장 도구를 불러오지 못했습니다.", "error");
      return;
    }

    const output = [["순번", "이름", "자리", "상태"]];
    const { rowStates } = calculateState();
    rows.forEach((row, index) => {
      if (!escapeText(row.name) && !normalizeSeat(row.seat)) return;
      output.push([index + 1, escapeText(row.name), normalizeSeat(row.seat), rowStates[index].label]);
    });

    const worksheet = window.XLSX.utils.aoa_to_sheet(output);
    worksheet["!cols"] = [{ wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 10 }];
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "자리배치 결과");
    const stamp = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date())
      .replace(/\.\s?/g, "-")
      .replace(/-$/, "");
    window.XLSX.writeFile(workbook, `자리배치_결과_${stamp}.xlsx`);
    addToast("자리배치 결과를 저장했습니다.");
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

  function bindEvents() {
    dom.importButton.addEventListener("click", () => dom.fileInput.click());
    dom.fileInput.addEventListener("change", () => {
      const [file] = dom.fileInput.files;
      if (file) importFile(file);
    });
    dom.exportButton.addEventListener("click", exportWorkbook);
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
  }

  loadLocal();
  buildSeatMap();
  buildRoster();
  bindEvents();
  syncInputsFromState();
})();
