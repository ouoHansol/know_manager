import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BellRing,
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "knou-essential-manager-v2";

type EventType = "assignment" | "attendance" | "registration" | "course" | "substitute" | "grade" | "exam" | "notice";
type Priority = "high" | "normal" | "low";
type EventStatus = "open" | "missed" | "submitted" | "graded" | "available" | "complete";
type CategoryView = "all" | "course" | "assignment" | "attendance" | "exam" | "grade";
type CompletionView = "open" | "done";

type NoticeSummaryItem = {
  label: string;
  text: string;
};

type KnouEvent = {
  id: string;
  type: EventType;
  title: string;
  date: string;
  time?: string;
  priority?: Priority;
  link?: string;
  note?: string;
  done: boolean;
  status?: EventStatus;
  summary?: NoticeSummaryItem[];
  diff?: number;
};

type Profile = {
  name?: string;
  department?: string;
  credits?: string;
  grade?: string;
};

type SyncedPayload = {
  events: KnouEvent[];
  profile?: Profile;
};

type SetEvents = React.Dispatch<React.SetStateAction<KnouEvent[]>>;

const typeLabels: Record<EventType, string> = {
  assignment: "과제물",
  attendance: "출석수업",
  registration: "수강신청",
  course: "수강정보",
  substitute: "출석대체",
  grade: "학점",
  exam: "시험",
  notice: "공지",
};

function App() {
  const [events, setEvents] = useStoredEvents();
  const [categoryView, setCategoryView] = useState<CategoryView>("all");
  const [profile, setProfile] = useState<Profile>({});
  const [completionView, setCompletionView] = useState<CompletionView>("open");
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [editing, setEditing] = useState<KnouEvent | null>(null);
  const [selectedNotice, setSelectedNotice] = useState<KnouEvent | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);

  useEffect(() => {
    loadSyncedPayload().then((payload) => {
      if (!payload) return;
      setProfile(payload.profile || {});
      setEvents((current) => {
        const manualEvents = current.filter((event) => !String(event.id).startsWith("knou-"));
        return [...manualEvents, ...(payload.events || [])];
      });
    });
  }, [setEvents]);

  const scheduleEvents = useMemo(() => events.filter((event) => event.type !== "notice"), [events]);
  const notices = useMemo(() => events.filter((event) => event.type === "notice").sort(sortByNewest), [events]);
  const openEvents = scheduleEvents.filter((event) => !event.done);
  const overdue = openEvents.filter((event) => getDayDiff(event.date) < 0);
  const missedEvents = scheduleEvents.filter(isMissedEvent).sort(sortByDate);
  const doneEvents = scheduleEvents.filter((event) => event.done && event.status !== "missed");
  const gradeEvents = scheduleEvents.filter((event) => event.type === "grade").sort(sortByDate);
  const soon = openEvents.filter((event) => {
    const diff = getDayDiff(event.date);
    return diff >= 0 && diff <= 7;
  });

  const visibleEvents = useMemo(() => {
    return scheduleEvents
      .filter(matchesCategoryView(categoryView))
      .filter((event) => (completionView === "open" ? !event.done : event.done))
      .sort(sortByDate);
  }, [categoryView, completionView, scheduleEvents]);

  const alerts = useMemo(() => {
    return scheduleEvents
      .filter((event) => !event.done)
      .map((event) => ({ ...event, diff: getDayDiff(event.date) }))
      .filter((event) => event.diff <= 7 || event.priority === "high")
      .sort(sortByUrgency)
      .slice(0, 8);
  }, [scheduleEvents]);

  function addEvent(formData: FormData) {
    const type = formData.get("type");
    const title = formData.get("title");
    const date = formData.get("date");
    const time = formData.get("time");
    const priority = formData.get("priority");
    const link = formData.get("link");
    const note = formData.get("note");

    setEvents((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: isEventType(type) ? type : "assignment",
        title: stringifyFormValue(title).trim(),
        date: stringifyFormValue(date),
        time: stringifyFormValue(time),
        priority: isPriority(priority) ? priority : "normal",
        link: stringifyFormValue(link).trim(),
        note: stringifyFormValue(note).trim(),
        done: false,
      },
    ]);
    setAddOpen(false);
  }

  function toggleDone(id: string) {
    setEvents((current) => current.map((event) => (event.id === id ? { ...event, done: !event.done } : event)));
  }

  function saveEdit(formData: FormData) {
    if (!editing) return;
    const title = formData.get("title");
    const date = formData.get("date");
    const note = formData.get("note");
    setEvents((current) =>
      current.map((event) =>
        event.id === editing.id
          ? {
              ...event,
              title: stringifyFormValue(title).trim(),
              date: stringifyFormValue(date),
              note: stringifyFormValue(note).trim(),
            }
          : event
      )
    );
    setEditing(null);
  }

  function deleteEvent(id: string) {
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
          <Metric className="danger" label="놓친 정보" value={missedEvents.length} />
          <Metric className="warning" label="7일 이내" value={soon.length} />
          <Metric label="미완료" value={openEvents.length} />
          <Metric className="calm" label="학점 항목" value={gradeEvents.length} />
        </section>

        <section className="main-grid">
          <aside className="left-sidebar">
            <ProfilePanel profile={profile} gradeEvents={gradeEvents} onOpenGrades={() => setGradeOpen(true)} />
            <NoticePanel notices={notices} onSelect={setSelectedNotice} />
          </aside>
          <div className="work-area">
            <Panel
              eyebrow="schedule"
              title="필수 일정"
              action={
                <div className="toolbar">
                  <div className="segmented category-tabs" role="tablist" aria-label="일정 유형">
                    {([
                      ["all", "전체"],
                      ["course", "수강"],
                      ["assignment", "과제물"],
                      ["attendance", "출석"],
                      ["exam", "시험"],
                      ["grade", "학점"],
                    ] satisfies Array<[CategoryView, string]>).map(([value, label]) => (
                      <button key={value} className={`filter ${categoryView === value ? "active" : ""}`} onClick={() => setCategoryView(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="segmented compact" role="tablist" aria-label="일정 보기">
                    {([
                      ["open", "미완료"],
                      ["done", "완료"],
                    ] satisfies Array<[CompletionView, string]>).map(([value, label]) => (
                      <button key={value} className={`filter ${completionView === value ? "active" : ""}`} onClick={() => setCompletionView(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <button className="ghost-button" onClick={clearDone}>
                    <Trash2 /> 완료 정리
                  </button>
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
      <GradeDialog open={gradeOpen} profile={profile} gradeEvents={gradeEvents} onClose={() => setGradeOpen(false)} />
    </>
  );
}

function matchesCategoryView(categoryView: CategoryView) {
  return (event: KnouEvent) => {
    if (categoryView === "all") return true;
    if (categoryView === "course") return event.type === "course" || event.type === "registration";
    if (categoryView === "assignment") return event.type === "assignment";
    if (categoryView === "attendance") return event.type === "attendance" || event.type === "substitute";
    if (categoryView === "exam") return event.type === "exam";
    if (categoryView === "grade") return event.type === "grade";
    return true;
  };
}

function useStoredEvents(): [KnouEvent[], SetEvents] {
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

  const setEvents = useCallback<SetEvents>((updater) => {
    setEventsState((current: KnouEvent[]) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: next }));
      return next;
    });
  }, []);

  return [events, setEvents];
}

function Metric({ className = "", label, value }: { className?: string; label: string; value: string | number }) {
  return (
    <article className={`metric ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
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

function EventList({
  events,
  emptyText,
  onToggle,
  onEdit,
}: {
  events: KnouEvent[];
  emptyText: string;
  onToggle: (id: string) => void;
  onEdit: (event: KnouEvent) => void;
}) {
  if (!events.length) return <div className="empty">{emptyText}</div>;

  return (
    <div className="event-list">
      {events.map((event) => (
        <EventCard key={event.id} event={event} onToggle={onToggle} onEdit={onEdit} />
      ))}
    </div>
  );
}

function NoticePanel({ notices, onSelect }: { notices: KnouEvent[]; onSelect: (notice: KnouEvent) => void }) {
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

function ProfilePanel({
  profile,
  gradeEvents,
  onOpenGrades,
}: {
  profile: Profile;
  gradeEvents: KnouEvent[];
  onOpenGrades: () => void;
}) {
  return (
    <section className="panel profile-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">my status</p>
          <h2>내 상태</h2>
        </div>
      </div>
      <div className="identity-card">
        <UserRound />
        <div>
          <strong>{profile.name || "이름 수집 전"}</strong>
          <span>{profile.department || "학과 수집 전"}</span>
        </div>
      </div>
      <button className="grade-card" onClick={onOpenGrades}>
        <GraduationCap />
        <div>
          <span>총학점 / 성적</span>
          <strong>{profile.credits || profile.grade || (gradeEvents.length ? `${gradeEvents.length}개 항목` : "수집 전")}</strong>
        </div>
      </button>
    </section>
  );
}

function EventCard({
  event,
  onToggle,
  onEdit,
}: {
  event: KnouEvent;
  onToggle: (id: string) => void;
  onEdit: (event: KnouEvent) => void;
}) {
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

function AddDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (formData: FormData) => void }) {
  return (
    <Modal open={open} onClose={onClose}>
      <EventForm title="항목 추가" onClose={onClose} onSubmit={onSubmit} />
    </Modal>
  );
}

function EditDialog({
  event,
  onClose,
  onSubmit,
  onDelete,
}: {
  event: KnouEvent | null;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  onDelete: (id: string) => void;
}) {
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
            <textarea name="note" rows={3} defaultValue={event.note || ""} />
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

function EventForm({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
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
          <option value="substitute">출석대체</option>
          <option value="registration">수강신청</option>
          <option value="course">수강정보</option>
          <option value="exam">시험</option>
          <option value="grade">학점</option>
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
        <textarea name="note" rows={3} placeholder="제출 방식, 강의실, 준비물 등" />
      </label>
      <button className="primary-button" type="submit">
        <Plus /> 추가
      </button>
    </form>
  );
}

function SyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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

function NoticeDialog({ notice, onClose }: { notice: KnouEvent | null; onClose: () => void }) {
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
          <div className="notice-summary subtle">
            <FileText />
            <div>
              <strong>{notice.title}</strong>
              <span>{formatDate(notice)}</span>
            </div>
          </div>
          <div className="notice-summary-list">
            {getNoticeSummaryItems(notice).map((item, index) => (
              <div key={`${item.label}-${index}`} className="notice-summary-point">
                <span>{item.label}</span>
                <strong>{item.text}</strong>
              </div>
            ))}
          </div>
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

function GradeDialog({
  open,
  profile,
  gradeEvents,
  onClose,
}: {
  open: boolean;
  profile: Profile;
  gradeEvents: KnouEvent[];
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="dialog-card">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">grade</p>
            <h2>학점 / 성적</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </div>
        <div className="notice-summary">
          <BookOpen />
          <div>
            <strong>{profile.credits || profile.grade || "학점/성적 상세 수집 전"}</strong>
            <span>{profile.name || ""} {profile.department || ""}</span>
          </div>
        </div>
        {!gradeEvents.length ? (
          <p className="hint">성적/학점 상세 화면 URL을 KNOU_EXTRA_URLS에 추가하면 동기화 후 여기에 표시됩니다.</p>
        ) : (
          <div className="event-list">
            {gradeEvents.map((event) => (
              <div key={event.id} className="notice-summary-point">
                <span>{formatDate(event)}</span>
                <strong>{event.title}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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

async function loadSyncedPayload(): Promise<SyncedPayload | null> {
  try {
    const response = await fetch("./data/knou-events.json", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload.events) ? payload : null;
  } catch {
    return null;
  }
}

function exportData(events: KnouEvent[]) {
  const blob = new Blob([JSON.stringify({ events }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `knou-manager-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getDayDiff(date: string) {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function sortByDate(a: KnouEvent, b: KnouEvent) {
  return `${a.date} ${a.time || "23:59"}`.localeCompare(`${b.date} ${b.time || "23:59"}`);
}

function sortByNewest(a: KnouEvent, b: KnouEvent) {
  return `${b.date} ${b.time || "23:59"}`.localeCompare(`${a.date} ${a.time || "23:59"}`);
}

function sortByUrgency(a: KnouEvent, b: KnouEvent) {
  const aDiff = a.diff ?? getDayDiff(a.date);
  const bDiff = b.diff ?? getDayDiff(b.date);
  if (aDiff !== bDiff) return aDiff - bDiff;
  const score = { high: 0, normal: 1, low: 2 };
  return (score[a.priority ?? "normal"] ?? 1) - (score[b.priority ?? "normal"] ?? 1);
}

function statusClass(event: KnouEvent) {
  if (isMissedEvent(event)) return "overdue";
  if (event.done || event.status === "complete") return "done";
  const diff = event.diff ?? getDayDiff(event.date);
  if (diff < 0) return "overdue";
  if (diff <= 7) return "soon";
  return "";
}

function statusText(event: KnouEvent) {
  if (isMissedEvent(event)) return "놓침";
  if (event.status === "submitted") return "제출완료";
  if (event.status === "graded") return "평가완료";
  if (event.status === "available") return "신청가능";
  if (event.status === "complete" || event.done) return "완료";
  const diff = event.diff ?? getDayDiff(event.date);
  if (diff < 0) return `${Math.abs(diff)}일 지연`;
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff <= 7) return `${diff}일 남음`;
  return "예정";
}

function isMissedEvent(event: KnouEvent) {
  return event.status === "missed" || (!event.done && getDayDiff(event.date) < 0);
}

function formatDate(event: KnouEvent) {
  const date = new Date(`${event.date}T00:00:00`);
  const label = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
  return event.time ? `${label} ${event.time}` : label;
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function getNoticeSummaryItems(notice: KnouEvent): NoticeSummaryItem[] {
  if (Array.isArray(notice.summary) && notice.summary.length) return notice.summary;
  const raw = (notice.note || notice.title)
    .replace(/^.*공지:\s*/, "")
    .replace(/\s*첨부파일\s*\d+\s*개\s*있음\s*$/, "")
    .trim();
  return [{ label: "요약", text: raw || notice.title }];
}

function stringifyFormValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function isEventType(value: FormDataEntryValue | null): value is EventType {
  return typeof value === "string" && value in typeLabels;
}

function isPriority(value: FormDataEntryValue | null): value is Priority {
  return value === "high" || value === "normal" || value === "low";
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(<App />);
