(() => {
  "use strict";

  const PAGE_WIDTH = 841.8898;
  const PAGE_HEIGHT = 595.2756;
  const SCALE = 3;
  const FONT = 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const COLORS = Object.freeze({
    ink: "#182b37",
    muted: "#697984",
    line: "#aab6bd",
    roleFill: "#f1ede4",
    roleInk: "#6b5941",
    representativeFill: "#e9f4fa",
    representativeInk: "#246785",
    blankFill: "#f2f4f5",
    duplicateFill: "#fff0ee",
    duplicateInk: "#ad3027",
    duplicateLine: "#cc655d",
  });

  function draw(snapshot, { sections, validSeats, roles, representativeSeats }) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(PAGE_WIDTH * SCALE);
    canvas.height = Math.round(PAGE_HEIGHT * SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("자리표 이미지를 만들 수 없습니다.");
    context.scale(canvas.width / PAGE_WIDTH, canvas.height / PAGE_HEIGHT);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.textBaseline = "alphabetic";

    const left = 38;
    const right = PAGE_WIDTH - left;
    const sectionGap = 17;
    const cellWidth = (right - left - 3 * sectionGap) / 14;
    const cellHeight = 38;
    const gridTop = 507;
    const gridBottom = gridTop - 10 * cellHeight;
    const assignedCount = Number(snapshot.assignedCount) || 0;
    const waitingCount = Number(snapshot.waitingCount) || 0;

    function font(size, weight = 500) {
      context.font = `${weight} ${size}px ${FONT}`;
    }

    // Coordinates use the same bottom-left origin as the printable PDF layout.
    function text(value, x, y, size, color = COLORS.ink, align = "left", weight = 500) {
      font(size, weight);
      context.fillStyle = color;
      context.textAlign = align;
      context.fillText(String(value), x, PAGE_HEIGHT - y);
    }

    function rectangle(x, y, width, height, fill, stroke = null, lineWidth = 0.5) {
      context.fillStyle = fill;
      context.fillRect(x, PAGE_HEIGHT - y - height, width, height);
      if (stroke) {
        context.strokeStyle = stroke;
        context.lineWidth = lineWidth;
        context.strokeRect(x, PAGE_HEIGHT - y - height, width, height);
      }
    }

    function line(x1, y1, x2, y2, color, width) {
      context.beginPath();
      context.moveTo(x1, PAGE_HEIGHT - y1);
      context.lineTo(x2, PAGE_HEIGHT - y2);
      context.strokeStyle = color;
      context.lineWidth = width;
      context.stroke();
    }

    function wrapName(value, width) {
      const lines = [];
      let current = "";
      for (const character of Array.from(value)) {
        if (current && context.measureText(current + character).width > width) {
          lines.push(current);
          current = character;
        } else {
          current += character;
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    function drawName(value, x, y, color, isBlocked) {
      const name = String(value || "").replace(/\s+/g, " ").trim();
      if (!name) return;
      const width = cellWidth - 8;
      const weight = isBlocked ? 500 : 700;
      const maxSize = isBlocked ? 10.8 : 12.8;
      let size = maxSize;
      font(size, weight);
      while (size > 9.8 && context.measureText(name).width > width) {
        size = Math.max(9.8, size - 0.2);
        font(size, weight);
      }
      if (context.measureText(name).width <= width) {
        text(name, x + cellWidth / 2, y + 9, size, color, "center", weight);
        return;
      }

      // Unusually long names wrap into the area below the seat code and role.
      // This keeps up to 20 Korean characters inside the same physical seat.
      let lines;
      let lineHeight;
      size = 10.8;
      do {
        font(size, weight);
        lines = wrapName(name, width);
        lineHeight = size * 1.16;
        if (lines.length <= 3 && lines.length * lineHeight <= 22) break;
        size -= 0.2;
      } while (size > 1);
      const blockHeight = lines.length * lineHeight;
      const firstBaseline = y + 3 + (22 - blockHeight) / 2 + blockHeight - size;
      lines.forEach((part, index) => {
        text(part, x + cellWidth / 2, firstBaseline - index * lineHeight, size, color, "center", weight);
      });
    }

    text("확정 자리배치표", left, PAGE_HEIGHT - 41, 21, COLORS.ink, "left", 700);
    text(`총 ${assignedCount + waitingCount}명`, right, PAGE_HEIGHT - 40, 10, COLORS.ink, "right");
    let subtitle = "자리 코드와 이름을 확인해 주세요.";
    if (snapshot.hasProblems) {
      subtitle = `확인 필요: 중복 또는 잘못된 자리 입력이 있습니다.${waitingCount ? ` 미배치 ${waitingCount}명.` : ""}`;
    } else if (waitingCount) {
      subtitle = `${assignedCount}명 배치 · ${waitingCount}명 대기`;
    }
    text(subtitle, left, PAGE_HEIGHT - 59, 8.2, snapshot.hasProblems ? COLORS.duplicateInk : COLORS.muted, "left", 400);

    const legendY = PAGE_HEIGHT - 58;
    [
      { x: right - 149, fill: COLORS.roleFill, label: "과대·과대단", color: COLORS.roleInk },
      { x: right - 62, fill: COLORS.representativeFill, label: "대표학생", color: COLORS.representativeInk },
    ].forEach(({ x, fill, label, color }) => {
      rectangle(x, legendY - 1, 8, 8, fill, COLORS.line, 0.45);
      text(label, x + 13, legendY, 8, color, "left", 400);
    });
    text("뒤쪽", PAGE_WIDTH / 2, gridTop + 13, 7.8, COLORS.muted, "center");

    let sectionX = left;
    sections.forEach((section) => {
      const sectionWidth = section.columns.length * cellWidth;
      line(sectionX, gridTop - cellHeight, sectionX + sectionWidth, gridTop - cellHeight, COLORS.ink, 1.6);
      for (let row = 10; row >= 1; row -= 1) {
        const y = gridTop - (11 - row) * cellHeight;
        section.columns.forEach((column, index) => {
          const code = `${column}${row}`;
          const isBlocked = code === "B1";
          if (!isBlocked && !validSeats.has(code)) return;
          const seatX = sectionX + index * cellWidth;
          const assignment = snapshot.assignedBySeat.get(code);
          const duplicate = !isBlocked && Boolean(assignment?.duplicate);
          const fixedRole = roles[code] || "";
          const isRepresentative = representativeSeats.has(code);
          const role = fixedRole || (isRepresentative ? "대표학생" : "");
          const fill = isBlocked ? COLORS.blankFill
            : duplicate ? COLORS.duplicateFill
              : fixedRole ? COLORS.roleFill
                : isRepresentative ? COLORS.representativeFill : "#ffffff";
          rectangle(seatX, y, cellWidth, cellHeight, fill, duplicate ? COLORS.duplicateLine : COLORS.line);
          text(code, seatX + cellWidth - 4.5, y + cellHeight - 9.3, 7.1, COLORS.muted, "right");
          if (role) {
            text(role, seatX + 4.5, y + cellHeight - 9.3, 6.9, fixedRole ? COLORS.roleInk : COLORS.representativeInk);
          }
          const name = isBlocked ? "빈자리" : duplicate ? "중복" : assignment?.name || "";
          drawName(name, seatX, y, isBlocked ? COLORS.muted : duplicate ? COLORS.duplicateInk : COLORS.ink, isBlocked);
        });
      }
      text(section.label, sectionX + sectionWidth / 2, gridBottom - 20, 10, COLORS.ink, "center", 700);
      sectionX += sectionWidth + sectionGap;
    });

    for (let row = 10; row >= 1; row -= 1) {
      const y = gridTop - (10.5 - row) * cellHeight - 2.6;
      text(row, left - 14, y, 7.8, COLORS.muted, "center");
      text(row, right + 14, y, 7.8, COLORS.muted, "center");
    }

    const podiumWidth = 152;
    rectangle((PAGE_WIDTH - podiumWidth) / 2, 52, podiumWidth, 27, COLORS.ink);
    text("교탁", PAGE_WIDTH / 2, 61, 10.5, "#ffffff", "center", 700);
    text("창가", left, 62, 8, COLORS.muted);
    text("앞문", right, 62, 8, COLORS.muted, "right");
    text("앞쪽", PAGE_WIDTH / 2, 34, 7.8, COLORS.muted, "center", 400);
    return canvas;
  }

  window.SeatChartExport = Object.freeze({ draw });
})();
