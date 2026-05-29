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
  StickyNote,
  Trash,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "knou-essential-manager-v2";
const MEMO_STORAGE_KEY = "knou-essential-memos-v1";
const PROFILE_STORAGE_KEY = "knou-essential-profile-v1";
const CREDENTIAL_STORAGE_KEY = "knou-essential-credentials-v1";
const SYNC_SCOPES = [
  ["profile", "내 상태"],
  ["courses", "수강"],
  ["assignments", "과제물"],
  ["attendance", "출석"],
  ["exam", "시험"],
  ["notices", "공지"],
] as const;

type EventType = "assignment" | "attendance" | "registration" | "course" | "substitute" | "grade" | "exam" | "notice";
type Priority = "high" | "normal" | "low";
type EventStatus = "open" | "missed" | "submitted" | "graded" | "available" | "complete";
type CategoryView = "all" | "course" | "assignment" | "attendance" | "exam";
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
  courseListUrl?: string;
  creditUrl?: string;
};

type MemoItem = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
};

type SyncedPayload = {
  events: KnouEvent[];
  profile?: Profile;
  errors?: string[];
  syncedAt?: string;
};

type SyncCredentials = {
  id: string;
  password: string;
};

type SyncScope = (typeof SYNC_SCOPES)[number][0];

type SyncStepResult = {
  label: string;
  count: number;
  ok: boolean;
  error?: string;
};

type SetEvents = React.Dispatch<React.SetStateAction<KnouEvent[]>>;

const typeLabels: Record<EventType, string> = {
  assignment: "과제물",
  attendance: "출석수업",
  registration: "수강신청",
  course: "형성평가",
  substitute: "출석대체",
  grade: "학점",
  exam: "시험",
  notice: "공지",
};

function App() {
  const [events, setEvents] = useStoredEvents();
  const [memos, setMemos] = useStoredMemos();
  const [categoryView, setCategoryView] = useState<CategoryView>("all");
  const [profile, setProfile] = useState<Profile>(() => loadStoredProfile());
  const [completionView, setCompletionView] = useState<CompletionView>("open");
  const [addOpen, setAddOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [editingMemo, setEditingMemo] = useState<MemoItem | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [editing, setEditing] = useState<KnouEvent | null>(null);
  const [selectedNotice, setSelectedNotice] = useState<KnouEvent | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);

  useEffect(() => {
    loadSyncedPayload().then((payload) => {
      if (!payload) return;
      applySyncedPayload(payload);
    });
  }, [setEvents]);

  function applySyncedPayload(payload: SyncedPayload) {
    const nextProfile = payload.profile || {};
    setProfile((current) => {
      const merged = { ...current, ...nextProfile };
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    });
    if ((payload.events || []).length) {
      setEvents((current) => {
        return mergeSyncedEvents(current, payload.events || []);
      });
    }
  }

  const scheduleEvents = useMemo(() => events.filter((event) => event.type !== "notice" && event.type !== "grade"), [events]);
  const notices = useMemo(() => events.filter((event) => event.type === "notice").sort(sortByNewest), [events]);
  const openEvents = scheduleEvents.filter((event) => !event.done);
  const gradeEvents = events.filter((event) => event.type === "grade").sort(sortByDate);
  const topExamEvents = useMemo(() => scheduleEvents.filter((event) => event.type === "exam" && !event.done).sort(sortByUrgency).slice(0, 3), [scheduleEvents]);

  const visibleEvents = useMemo(() => {
    return scheduleEvents
      .filter(matchesCategoryView(categoryView))
      .filter((event) => (completionView === "open" ? !event.done : event.done))
      .sort(sortByDate);
  }, [categoryView, completionView, scheduleEvents]);

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

  function addMemo(formData: FormData) {
    const title = stringifyFormValue(formData.get("title")).trim();
    const body = stringifyFormValue(formData.get("body")).trim();
    if (!title && !body) return;
    setMemos((current) => [
      {
        id: crypto.randomUUID(),
        title: title || "메모",
        body,
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setMemoOpen(false);
  }

  function saveMemo(formData: FormData) {
    if (!editingMemo) return;
    const title = stringifyFormValue(formData.get("title")).trim();
    const body = stringifyFormValue(formData.get("body")).trim();
    setMemos((current) =>
      current.map((memo) =>
        memo.id === editingMemo.id
          ? {
              ...memo,
              title: title || "메모",
              body,
              updatedAt: new Date().toISOString(),
            }
          : memo
      )
    );
    setEditingMemo(null);
  }

  function deleteMemo(id: string) {
    setMemos((current) => current.filter((memo) => memo.id !== id));
    setEditingMemo(null);
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
        <section className="priority-board" aria-label="주요 정보">
          <ExamFocus events={topExamEvents} />
          <MemoPanel memos={memos} onAdd={() => setMemoOpen(true)} onEdit={setEditingMemo} onDelete={deleteMemo} />
        </section>

        <section className="main-grid">
          <aside className="left-sidebar">
            <ProfilePanel profile={profile} gradeEvents={gradeEvents} onOpenGrades={() => setGradeOpen(true)} onSynced={applySyncedPayload} />
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
      <MemoDialog open={memoOpen} onClose={() => setMemoOpen(false)} onSubmit={addMemo} />
      <MemoDialog memo={editingMemo} open={Boolean(editingMemo)} onClose={() => setEditingMemo(null)} onSubmit={saveMemo} onDelete={deleteMemo} />
      <SyncDialog open={syncOpen} onClose={() => setSyncOpen(false)} onSynced={applySyncedPayload} />
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

function useStoredMemos(): [MemoItem[], React.Dispatch<React.SetStateAction<MemoItem[]>>] {
  const [memos, setMemosState] = useState(() => {
    const saved = localStorage.getItem(MEMO_STORAGE_KEY);
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed.memos) ? parsed.memos : [];
    } catch {
      return [];
    }
  });

  const setMemos = useCallback<React.Dispatch<React.SetStateAction<MemoItem[]>>>((updater) => {
    setMemosState((current: MemoItem[]) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify({ memos: next }));
      return next;
    });
  }, []);

  return [memos, setMemos];
}

function loadStoredProfile(): Profile {
  const saved = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (!saved) return {};
  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function loadStoredCredentials(): SyncCredentials {
  const saved = localStorage.getItem(CREDENTIAL_STORAGE_KEY);
  if (!saved) return { id: "", password: "" };
  try {
    const parsed = JSON.parse(saved);
    return {
      id: typeof parsed.id === "string" ? parsed.id : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
    };
  } catch {
    return { id: "", password: "" };
  }
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
  const [page, setPage] = useState(0);
  const latestNotices = notices.slice(0, 10);
  const pageCount = Math.ceil(latestNotices.length / 5);
  const visibleNotices = latestNotices.slice(page * 5, page * 5 + 5);

  useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(Math.max(pageCount - 1, 0));
  }, [page, pageCount]);

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
        <>
          <div className="notice-list">
            {visibleNotices.map((notice) => (
              <button key={notice.id} className="notice-item" onClick={() => onSelect(notice)}>
                <span>{formatShortDate(notice.date)}</span>
                <strong>{notice.title}</strong>
              </button>
            ))}
          </div>
          {pageCount > 1 ? (
            <div className="notice-pagination" aria-label="공지 페이지">
              {Array.from({ length: pageCount }, (_, index) => (
                <button key={index} className={page === index ? "active" : ""} onClick={() => setPage(index)}>
                  {index + 1}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ProfilePanel({
  profile,
  gradeEvents,
  onOpenGrades,
  onSynced,
}: {
  profile: Profile;
  gradeEvents: KnouEvent[];
  onOpenGrades: () => void;
  onSynced: (payload: SyncedPayload) => void;
}) {
  const hasProfile = Boolean(profile.name || profile.department || profile.credits);

  return (
    <section className="panel profile-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">my status</p>
          <h2>내 상태</h2>
        </div>
      </div>
      {!hasProfile ? (
        <div className="profile-login">
          <p className="hint">로그인하면 이름, 학과, 수강목록, 학점 정보를 이 영역에 표시합니다.</p>
          <SyncForm onSynced={onSynced} />
        </div>
      ) : (
        <>
          <div className="identity-card">
            <UserRound />
            <div>
              <strong>{profile.name || "이름 수집 전"}</strong>
              <span>{profile.department || "학과 수집 전"}</span>
            </div>
          </div>
          <a className="course-list-card" href={profile.courseListUrl || "https://m.knou.ac.kr/dashboard/course-list"} target="_blank" rel="noreferrer">
            <BookOpen />
            <div>
              <span>수강목록</span>
              <strong>현재 수강과목 보기</strong>
            </div>
            <ExternalLink />
          </a>
          <a className="credit-card" href={profile.creditUrl || "https://m.knou.ac.kr/agm"} target="_blank" rel="noreferrer">
            <GraduationCap />
            <div>
              <span>나의 총 학점</span>
              <strong>{formatCredits(profile.credits)}</strong>
            </div>
            <ExternalLink />
          </a>
          <button className="grade-card" onClick={onOpenGrades}>
            <BookOpen />
            <div>
              <span>현재 수강과목 성적</span>
              <strong>{countScoredGrades(gradeEvents)}개 채점됨</strong>
            </div>
          </button>
        </>
      )}
    </section>
  );
}

function ExamFocus({ events }: { events: KnouEvent[] }) {
  return (
    <section className="panel focus-panel exam-focus">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">exam</p>
          <h2>시험 일정</h2>
        </div>
      </div>
      {!events.length ? (
        <p className="empty compact-empty">시험 일정이 없습니다. 동기화를 실행하세요.</p>
      ) : (
        <div className="focus-list">
          {events.map((event) => (
            <a key={event.id} className="exam-focus-item" href={event.link || "#"} target="_blank" rel="noreferrer">
              <strong>{event.title}</strong>
              <ExamDetails event={event} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function MemoPanel({
  memos,
  onAdd,
  onEdit,
  onDelete,
}: {
  memos: MemoItem[];
  onAdd: () => void;
  onEdit: (memo: MemoItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="panel focus-panel memo-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">memo</p>
          <h2>내 메모</h2>
        </div>
        <button className="secondary-button" onClick={onAdd}>
          <Plus /> 메모
        </button>
      </div>
      {!memos.length ? (
        <p className="empty compact-empty">아직 메모가 없습니다.</p>
      ) : (
        <div className="memo-list">
          {memos.slice(0, 4).map((memo) => (
            <article key={memo.id} className="memo-item">
              <StickyNote />
              <div>
                <strong>{memo.title}</strong>
                {memo.body ? <p>{memo.body}</p> : null}
              </div>
              <button className="row-action" onClick={() => onEdit(memo)} title="수정" aria-label="메모 수정">
                <Pencil />
              </button>
              <button className="row-action" onClick={() => onDelete(memo.id)} title="삭제" aria-label="메모 삭제">
                <Trash />
              </button>
            </article>
          ))}
        </div>
      )}
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
    <article className={`event-item ${event.type} ${event.done ? "done" : status}`}>
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
        {event.note && event.type !== "exam" ? <p className="event-note">{event.note}</p> : null}
        {event.type === "exam" ? <ExamDetails event={event} compact /> : null}
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

function MemoDialog({
  open,
  memo,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  memo?: MemoItem | null;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <form
        className="dialog-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <div className="panel-heading">
          <h2>{memo ? "메모 수정" : "메모 추가"}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </div>
        <label>
          제목
          <input name="title" type="text" defaultValue={memo?.title || ""} placeholder="예: 시험 준비물" />
        </label>
        <label>
          내용
          <textarea name="body" rows={5} defaultValue={memo?.body || ""} placeholder="잊으면 안 되는 내용" />
        </label>
        <menu>
          {memo && onDelete ? (
            <button className="danger-button" type="button" onClick={() => onDelete(memo.id)}>
              <Trash /> 삭제
            </button>
          ) : null}
          <button className="primary-button" type="submit">
            <Save /> 저장
          </button>
        </menu>
      </form>
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

function SyncDialog({ open, onClose, onSynced }: { open: boolean; onClose: () => void; onSynced: (payload: SyncedPayload) => void }) {
  function handleSynced(payload: SyncedPayload) {
    onSynced(payload);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="dialog-card">
        <div className="panel-heading">
          <h2>내 계정으로 동기화</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </div>
        <p className="hint">
          아이디와 비밀번호는 이 브라우저에만 저장됩니다. 동기화 요청 때만 Vercel API로 전달되고 저장소나 서버 환경변수에는 저장하지 않습니다.
        </p>
        <SyncForm onSynced={handleSynced} />
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

function SyncForm({ onSynced }: { onSynced: (payload: SyncedPayload) => void }) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [remember, setRemember] = useState(true);
  const [credentials, setCredentials] = useState<SyncCredentials>(() => loadStoredCredentials());

  async function syncNow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setMessage("동기화 중입니다. 방통대 로그인과 페이지 조회가 끝날 때까지 잠시 기다려 주세요.");

    try {
      const formData = new FormData(event.currentTarget);
      const nextCredentials = {
        id: stringifyFormValue(formData.get("id")).trim(),
        password: stringifyFormValue(formData.get("password")),
      };

      const mergedPayload: SyncedPayload = { events: [], profile: {}, errors: [] };
      const stepResults: SyncStepResult[] = [];

      for (const [scope, label] of SYNC_SCOPES) {
        setMessage(`${label} 동기화 중입니다. 단계별로 나눠 가져오는 중입니다.`);
        try {
          const payload = await requestSyncScope(nextCredentials, scope);
          mergedPayload.events = [...(mergedPayload.events || []), ...(payload.events || [])];
          mergedPayload.profile = { ...(mergedPayload.profile || {}), ...(payload.profile || {}) };
          mergedPayload.errors = [...(mergedPayload.errors || []), ...(payload.errors || [])];
          stepResults.push({ label, count: countSyncedItems(payload), ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "실패";
          mergedPayload.errors = [...(mergedPayload.errors || []), `${label}: ${message}`];
          stepResults.push({ label, count: 0, ok: false, error: message });
        }
      }

      const syncedCount = countSyncedItems(mergedPayload);
      if (syncedCount === 0) {
        const details = mergedPayload.errors?.filter(Boolean).join(" | ");
        throw new Error(details || "로그인은 시도했지만 표시할 정보를 가져오지 못했습니다. Vercel 함수 로그를 확인하세요.");
      }

      if (remember) {
        localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(nextCredentials));
      } else {
        localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
      }

      setCredentials(nextCredentials);
      onSynced(mergedPayload);
      const errorText = mergedPayload.errors?.length ? ` / 일부 오류: ${mergedPayload.errors.join(" | ")}` : "";
      const missingText = getMissingSyncCategoryText(mergedPayload);
      const stepText = stepResults.map((result) => `${result.label} ${result.ok ? result.count : "실패"}`).join(", ");
      setMessage(`동기화 완료: 일정 ${mergedPayload.events?.length || 0}개, 내 상태 ${countProfileFields(mergedPayload.profile)}개 (${stepText})${missingText}${errorText}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <form className="event-form" onSubmit={syncNow}>
        <label>
          방통대 아이디
          <input name="id" autoComplete="username" value={credentials.id} onChange={(event) => setCredentials({ ...credentials, id: event.target.value })} />
        </label>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={credentials.password}
            onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          이 브라우저에 계정정보 저장
        </label>
        <button className="primary-button" type="submit" disabled={running}>
          <RefreshCw /> {running ? "동기화 중" : "지금 동기화"}
        </button>
      </form>
      {message ? <p className="sync-message">{message}</p> : null}
    </>
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
            <h2>현재 수강과목 성적</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </div>
        <div className="notice-summary">
          <BookOpen />
          <div>
            <strong>{formatCredits(profile.credits)}</strong>
            <span>{profile.name || ""} {profile.department || ""}</span>
          </div>
        </div>
        {countScoredGrades(gradeEvents) === 0 ? (
          <p className="hint">아직 채점된 점수가 없습니다.</p>
        ) : (
          <div className="event-list">
            {gradeEvents.filter(hasGradeScore).map((event) => {
              const score = getGradeScore(event);
              return (
                <div key={event.id} className="notice-summary-point">
                  <span>{event.title}</span>
                  <strong>{score || "점수 확인 필요"}</strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ExamDetails({ event, compact = false }: { event: KnouEvent; compact?: boolean }) {
  const details = parseExamDetails(event);
  if (!details && !event.note) return null;
  return (
    <div className={`exam-details ${compact ? "compact" : ""}`}>
      <div className="exam-detail-grid">
        <span>
          <strong>일자</strong>
          {details?.date || event.date || "일자 선택 필요!"}
        </span>
        <span>
          <strong>시간</strong>
          {details?.time || event.time || "확인 필요"}
        </span>
        <span>
          <strong>장소</strong>
          {details?.place || "확인 필요"}
        </span>
      </div>
      {details?.subjects.length ? (
        <div className="subject-badges">
          {details.subjects.map((subject) => (
            <span key={subject}>{subject}</span>
          ))}
        </div>
      ) : null}
    </div>
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

async function readSyncResponse(response: Response): Promise<SyncedPayload & { error?: string }> {
  const text = await response.text();
  if (!text) return { events: [] };

  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === "object" ? payload : { events: [], error: "동기화 응답 형식이 올바르지 않습니다." };
  } catch {
    return {
      events: [],
      error: `서버 응답이 JSON이 아닙니다: ${text.slice(0, 180)}`,
    };
  }
}

async function requestSyncScope(credentials: SyncCredentials, scope: SyncScope): Promise<SyncedPayload> {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...credentials, scope }),
  });
  const payload = await readSyncResponse(response);
  if (!response.ok) throw new Error(payload.error || `${scope} 동기화에 실패했습니다.`);
  return payload;
}

function mergeSyncedEvents(current: KnouEvent[], incoming: KnouEvent[]): KnouEvent[] {
  const merged = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    merged.set(event.id, event);
  }
  return pruneRedundantExamPlaceholders([...merged.values()]);
}

function pruneRedundantExamPlaceholders(events: KnouEvent[]): KnouEvent[] {
  const hasDetailedExam = events.some((event) => {
    if (event.type !== "exam") return false;
    const details = parseExamDetails(event);
    return Boolean(details?.subjects.length || (details?.place && details.place !== "확인 필요"));
  });
  if (!hasDetailedExam) return events;
  return events.filter((event) => {
    if (event.type !== "exam") return true;
    const text = `${event.title} ${event.note || ""}`;
    return !/(일자\s*선택\s*필요|일자\s*확인\s*필요|일자 미정)/.test(text);
  });
}

function countSyncedItems(payload: SyncedPayload): number {
  return (payload.events || []).length + countProfileFields(payload.profile);
}

function countProfileFields(profile?: Profile): number {
  if (!profile) return 0;
  return [profile.name, profile.department, profile.credits, profile.grade].filter(Boolean).length;
}

function getMissingSyncCategoryText(payload: SyncedPayload): string {
  const events = payload.events || [];
  const missing = [
    countProfileFields(payload.profile) ? "" : "내 상태",
    events.some((event) => event.type === "course" || event.type === "registration") ? "" : "수강",
    events.some((event) => event.type === "assignment" || event.type === "substitute") ? "" : "과제물",
    events.some((event) => event.type === "attendance" || event.type === "substitute") ? "" : "출석",
    events.some((event) => event.type === "exam") ? "" : "시험",
    events.some((event) => event.type === "notice") ? "" : "공지",
  ].filter(Boolean);
  return missing.length ? ` / 부족한 항목: ${missing.join(", ")}` : "";
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
  if (!date) return Number.POSITIVE_INFINITY;
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function sortByDate(a: KnouEvent, b: KnouEvent) {
  if (!a.date && !b.date) return (a.title || "").localeCompare(b.title || "");
  if (!a.date) return 1;
  if (!b.date) return -1;
  return `${a.date} ${a.time || "23:59"}`.localeCompare(`${b.date} ${b.time || "23:59"}`);
}

function sortByNewest(a: KnouEvent, b: KnouEvent) {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
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
  if (!event.date) return "";
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
  if (!event.date) return "일자 미정";
  const diff = event.diff ?? getDayDiff(event.date);
  if (diff < 0) return `${Math.abs(diff)}일 지연`;
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff <= 7) return `${diff}일 남음`;
  return "예정";
}

function isMissedEvent(event: KnouEvent) {
  if (!event.date) return false;
  return event.status === "missed" || (!event.done && getDayDiff(event.date) < 0);
}

function formatDate(event: KnouEvent) {
  if (!event.date) return "일자 미정";
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

function parseExamDetails(event: KnouEvent) {
  const note = event.note || "";
  const date = note.match(/시험일자\s*(20\d{2}-\d{2}-\d{2})/)?.[1] || event.date;
  const parts = note
    .replace(/^\*/, "")
    .split("/")
    .map((part) => part.trim());
  const place = parts.find((part) => /지역대학|학습관|시험장|온라인|ZOOM/.test(part) && !part.includes("응시과목")) || "";
  const time = parts.find((part) => /\b[0-2]?\d:[0-5]\d\s*~\s*[0-2]?\d:[0-5]\d\b/.test(part)) || event.time || "";
  const subjectText = note.match(/응시과목:\s*(.+)$/)?.[1] || "";
  const subjects = subjectText
    .split(",")
    .map((subject) => subject.trim())
    .filter(Boolean);
  if (!date && !place && !time && !subjects.length) return null;
  return { date, place, time, subjects };
}

function stringifyFormValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function formatCredits(value?: string) {
  const match = value?.match(/\d+(?:\.\d+)?/);
  return match ? `${match[0]}학점` : "수집 전";
}

function countScoredGrades(events: KnouEvent[]) {
  return events.filter(hasGradeScore).length;
}

function hasGradeScore(event: KnouEvent) {
  return Boolean(getGradeScore(event));
}

function getGradeScore(event: KnouEvent) {
  const text = `${event.title} ${event.note || ""}`;
  const score = text.match(/(?:점수|취득점수|평점|등급)\s*[:：]?\s*([A-F][+0-]?|\d{1,3}(?:\.\d+)?점?)/i)?.[1];
  if (!score) return "";
  return score.endsWith("점") || /^[A-F]/i.test(score) ? score : `${score}점`;
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
