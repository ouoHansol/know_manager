import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BellRing,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash,
  Trash2,
  X,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "knou-essential-manager-v2";

const typeLabels = {
  assignment: "과제물",
  attendance: "출석수업",
  registration: "수강신청",
  course: "수강정보",
  notice: "공지",
};

const filters = [
  ["all", "전체"],
  ["registration", "수강신청"],
  ["assignment", "과제"],
  ["attendance", "출석"],
  ["course", "수강"],
];

function App() {
  const [events, setEvents] = useStoredEvents();
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedNotice, setSelectedNotice] = useState(null);

  useEffect(() => {
    loadSyncedEvents().then((synced) => {
      if (!synced) return;
      setEvents((current) => {
        const manualEvents = current.filter((event) => !String(event.id).startsWith("knou-"));
        return [...manualEvents, ...synced];
      });
    });
  }, [setEvents]);

  const scheduleEvents = useMemo(() => events.filter((event) => event.type !== "notice"), [events]);
  const notices = useMemo(() => events.filter((event) => event.type === "notice").sort(sortByNewest), [events]);
  const openEvents = scheduleEvents.filter((event) => !event.done);
  const overdue = openEvents.filter((event) => getDayDiff(event.date) < 0);
  const soon = openEvents.filter((event) => {
    const diff = getDayDiff(event.date);
    return diff >= 0 && diff <= 7;
  });

  const visibleEvents = useMemo(() => {
    return scheduleEvents.filter(matchesCurrentView(activeFilter, searchTerm)).sort(sortByDate);
  }, [activeFilter, scheduleEvents, searchTerm]);

  const alerts = useMemo(() => {
    return scheduleEvents
      .filter((event) => !event.done)
      .map((event) => ({ ...event, diff: getDayDiff(event.date) }))
      .filter((event) => event.diff <= 7 || event.priority === "high")
      .sort(sortByUrgency)
      .slice(0, 8);
  }, [scheduleEvents]);

  function addEvent(formData) {
    setEvents((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: formData.get("type"),
        title: formData.get("title").trim(),
        date: formData.get("date"),
        time: formData.get("time"),
        priority: formData.get("priority"),
        link: formData.get("link").trim(),
        note: formData.get("note").trim(),
        done: false,
      },
    ]);
    setAddOpen(false);
  }

  function toggleDone(id) {
    setEvents((current) => current.map((event) => (event.id === id ? { ...event, done: !event.done } : event)));
  }

  function saveEdit(formData) {
    setEvents((current) =>
      current.map((event) =>
        event.id === editing.id
          ? {
              ...event,
              title: formData.get("title").trim(),
              date: formData.get("date"),
              note: formData.get("note").trim(),
            }
          : event
      )
    );
    setEditing(null);
  }

  function deleteEvent(id) {
    setEvents((current) => current.filter((event) => event.id !== id));
    setEditing(null);
  }

  function clearDone() {
    setEvents((current) => current.filter((event) => !event.done));
  }

  async function requestNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const urgent = scheduleEvents
      .filter((event) => !event.done)
      .map((event) => ({ ...event, diff: getDayDiff(event.date) }))
      .filter((event) => event.diff <= 1)
      .sort(sortByUrgency);

    if (urgent[0]) {
      new Notification("방통대 확인 필요", {
        body: `${urgent[0].title} - ${statusText(urgent[0])}`,
      });
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">KNOU essentials</p>
          <h1>방통대 필수 매니저</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => setAddOpen(true)}>
            <Plus /> 항목 추가
          </button>
          <button className="secondary-button" onClick={() => setSyncOpen(true)}>
            <RefreshCw /> 동기화 안내
          </button>
          <button className="icon-button" title="브라우저 알림 허용" aria-label="브라우저 알림 허용" onClick={requestNotifications}>
            <BellRing />
          </button>
          <button className="secondary-button" onClick={() => exportData(events)}>
            <Download /> 내보내기
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="summary-band" aria-label="요약">
          <Metric className="danger" label="지연" value={overdue.length} />
          <Metric className="warning" label="7일 이내" value={soon.length} />
          <Metric label="미완료" value={openEvents.length} />
          <Metric className="calm" label="오늘" value={formatToday()} />
        </section>

        <section className="main-grid">
          <aside className="left-sidebar">
            <NoticePanel notices={notices} onSelect={setSelectedNotice} />
          </aside>
          <div className="work-area">
            <Panel
              eyebrow="priority"
              title="지금 봐야 할 것"
              action={
                <button className="ghost-button" onClick={clearDone}>
                  <Trash2 /> 완료 정리
                </button>
              }
            >
              <EventList events={alerts} emptyText="미완료 경고가 없습니다." onToggle={toggleDone} onEdit={setEditing} />
            </Panel>

            <Panel
              eyebrow="schedule"
              title="필수 일정"
              action={
                <div className="toolbar">
                  <div className="segmented" role="tablist" aria-label="일정 필터">
                    {filters.map(([value, label]) => (
                      <button key={value} className={`filter ${activeFilter === value ? "active" : ""}`} onClick={() => setActiveFilter(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="search-box">
                    <input type="search" placeholder="과목, 메모 검색" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
                  </label>
                </div>
              }
            >
              <EventList
                events={visibleEvents}
                emptyText="표시할 일정이 없습니다. 자동 동기화를 실행하거나 항목을 추가하세요."
                onToggle={toggleDone}
                onEdit={setEditing}
              />
            </Panel>
          </div>
        </section>
      </main>

      <AddDialog open={addOpen} onClose={() => setAddOpen(false)} onSubmit={addEvent} />
      <SyncDialog open={syncOpen} onClose={() => setSyncOpen(false)} />
      <EditDialog event={editing} onClose={() => setEditing(null)} onSubmit={saveEdit} onDelete={deleteEvent} />
      <NoticeDialog notice={selectedNotice} onClose={() => setSelectedNotice(null)} />
    </>
  );
}

function useStoredEvents() {
  const [events, setEventsState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      return [];
    }
  });

  const setEvents = useCallback((updater) => {
    setEventsState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: next }));
      return next;
    });
  }, []);

  return [events, setEvents];
}

function Metric({ className = "", label, value }) {
  return (
    <article className={`metric ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ eyebrow, title, action, children }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EventList({ events, emptyText, onToggle, onEdit }) {
  if (!events.length) return <div className="empty">{emptyText}</div>;

  return (
    <div className="event-list">
      {events.map((event) => (
        <EventCard key={event.id} event={event} onToggle={onToggle} onEdit={onEdit} />
      ))}
    </div>
  );
}

function NoticePanel({ notices, onSelect }) {
  return (
    <section className="panel notice-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">notice</p>
          <h2>읽을 공지</h2>
        </div>
      </div>
      {!notices.length ? (
        <div className="empty notice-empty">표시할 공지가 없습니다.</div>
      ) : (
        <div className="notice-list">
          {notices.slice(0, 10).map((notice) => (
            <button key={notice.id} className="notice-item" onClick={() => onSelect(notice)}>
              <span>{formatShortDate(notice.date)}</span>
              <strong>{notice.title}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function EventCard({ event, onToggle, onEdit }) {
  const status = event.done ? "" : statusClass(event);

  return (
    <article className={`event-item ${event.done ? "done" : status}`}>
      <input className="check" type="checkbox" checked={event.done} onChange={() => onToggle(event.id)} aria-label="완료 처리" />
      <div className="event-main">
        <div className="event-title">
          <span className={`tag ${event.type}`}>{typeLabels[event.type] || "기타"}</span>
          {event.link ? (
            <a className="title-link" href={event.link} target="_blank" rel="noreferrer">
              {event.title}
            </a>
          ) : (
            <span className="title-link">{event.title}</span>
          )}
          {event.done ? <span className="status">완료</span> : <span className={`status ${status}`}>{statusText(event)}</span>}
          <button className="row-action" onClick={() => onEdit(event)} title="수정" aria-label="수정">
            <Pencil />
          </button>
        </div>
        {event.note ? <p className="event-note">{event.note}</p> : null}
      </div>
      <div className="date-chip">{formatDate(event)}</div>
    </article>
  );
}

function AddDialog({ open, onClose, onSubmit }) {
  return (
    <Modal open={open} onClose={onClose}>
      <EventForm title="항목 추가" onClose={onClose} onSubmit={onSubmit} />
    </Modal>
  );
}

function EditDialog({ event, onClose, onSubmit, onDelete }) {
  return (
    <Modal open={Boolean(event)} onClose={onClose}>
      {event ? (
        <form
          className="dialog-card"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            onSubmit(new FormData(submitEvent.currentTarget));
          }}
        >
          <div className="panel-heading">
            <h2>항목 수정</h2>
            <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
              <X />
            </button>
          </div>
          <label>
            과목/제목
            <input name="title" type="text" defaultValue={event.title} required />
          </label>
          <label>
            일자
            <input name="date" type="date" defaultValue={event.date} required />
          </label>
          <label>
            메모
            <textarea name="note" rows="3" defaultValue={event.note || ""} />
          </label>
          <menu>
            <button className="danger-button" type="button" onClick={() => onDelete(event.id)}>
              <Trash /> 삭제
            </button>
            <button className="primary-button" type="submit">
              <Save /> 저장
            </button>
          </menu>
        </form>
      ) : null}
    </Modal>
  );
}

function EventForm({ title, onClose, onSubmit }) {
  return (
    <form
      className="dialog-card"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <div className="panel-heading">
        <h2>{title}</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
          <X />
        </button>
      </div>
      <label>
        구분
        <select name="type" required>
          <option value="assignment">과제물</option>
          <option value="attendance">출석수업</option>
          <option value="registration">수강신청</option>
          <option value="course">수강정보</option>
          <option value="notice">공지</option>
        </select>
      </label>
      <label>
        과목/제목
        <input name="title" type="text" placeholder="예: 자료구조 과제 1" required />
      </label>
      <label>
        일자
        <input name="date" type="date" required />
      </label>
      <label>
        마감 시간
        <input name="time" type="time" />
      </label>
      <label>
        중요도
        <select name="priority" defaultValue="normal">
          <option value="high">높음</option>
          <option value="normal">보통</option>
          <option value="low">낮음</option>
        </select>
      </label>
      <label>
        확인 링크
        <input name="link" type="url" placeholder="https://..." />
      </label>
      <label>
        메모
        <textarea name="note" rows="3" placeholder="제출 방식, 강의실, 준비물 등" />
      </label>
      <button className="primary-button" type="submit">
        <Plus /> 추가
      </button>
    </form>
  );
}

function SyncDialog({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="dialog-card">
        <div className="panel-heading">
          <h2>자동 동기화</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </div>
        <p className="hint">계정정보는 로컬 .env에 있고 앱 화면에는 표시하지 않습니다. 최신 정보 갱신은 터미널에서 npm run sync를 실행하면 됩니다.</p>
        <div className="links-panel">
          <a href="https://www.knou.ac.kr" target="_blank" rel="noreferrer">
            <ExternalLink /> 방통대 대표 홈페이지
          </a>
          <a href="https://ucampus.knou.ac.kr" target="_blank" rel="noreferrer">
            <ExternalLink /> U-KNOU 캠퍼스
          </a>
        </div>
      </div>
    </Modal>
  );
}

function NoticeDialog({ notice, onClose }) {
  return (
    <Modal open={Boolean(notice)} onClose={onClose}>
      {notice ? (
        <div className="dialog-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">notice</p>
              <h2>공지 요약</h2>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="닫기">
              <X />
            </button>
          </div>
          <div className="notice-summary">
            <FileText />
            <div>
              <strong>{notice.title}</strong>
              <span>{formatDate(notice)}</span>
            </div>
          </div>
          <p className="notice-summary-body">{summarizeNotice(notice)}</p>
          {notice.link ? (
            <a className="primary-link-button" href={notice.link} target="_blank" rel="noreferrer">
              <ExternalLink /> 원문 공지 열기
            </a>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function Modal({ open, onClose, children }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

async function loadSyncedEvents() {
  try {
    const response = await fetch("./data/knou-events.json", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload.events) ? payload.events : null;
  } catch {
    return null;
  }
}

function matchesCurrentView(activeFilter, searchTerm) {
  return (event) => {
    const matchesFilter = activeFilter === "all" || event.type === activeFilter;
    const haystack = `${event.title} ${event.note || ""} ${typeLabels[event.type] || ""}`.toLowerCase();
    return matchesFilter && (!searchTerm || haystack.includes(searchTerm.toLowerCase()));
  };
}

function exportData(events) {
  const blob = new Blob([JSON.stringify({ events }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `knou-manager-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getDayDiff(date) {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target - base) / 86400000);
}

function sortByDate(a, b) {
  return `${a.date} ${a.time || "23:59"}`.localeCompare(`${b.date} ${b.time || "23:59"}`);
}

function sortByNewest(a, b) {
  return `${b.date} ${b.time || "23:59"}`.localeCompare(`${a.date} ${a.time || "23:59"}`);
}

function sortByUrgency(a, b) {
  if (a.diff !== b.diff) return a.diff - b.diff;
  const score = { high: 0, normal: 1, low: 2 };
  return (score[a.priority] ?? 1) - (score[b.priority] ?? 1);
}

function statusClass(event) {
  const diff = "diff" in event ? event.diff : getDayDiff(event.date);
  if (diff < 0) return "overdue";
  if (diff <= 7) return "soon";
  return "";
}

function statusText(event) {
  const diff = "diff" in event ? event.diff : getDayDiff(event.date);
  if (diff < 0) return `${Math.abs(diff)}일 지연`;
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff <= 7) return `${diff}일 남음`;
  return "예정";
}

function formatDate(event) {
  const date = new Date(`${event.date}T00:00:00`);
  const label = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
  return event.time ? `${label} ${event.time}` : label;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function summarizeNotice(notice) {
  const raw = notice.note || notice.title;
  return raw
    .replace(/^.*공지:\s*/, "")
    .replace(/\s*첨부파일\s*\d+\s*개\s*있음\s*$/, "")
    .trim();
}

function formatToday() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
}

createRoot(document.getElementById("root")).render(<App />);
