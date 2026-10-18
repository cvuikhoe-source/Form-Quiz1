import { useState, useMemo, useEffect } from 'react';
import type { Lesson, User, LessonCategory, LessonCategoryIcon } from '@/types';
import { loadClasses, addClass, removeClass, loadAllVocabItems, getEffectiveLessonSchedule, getLessonTimeStatus } from '@/storage';
import { toast } from './Toast';
import {
  BookOpen, Languages, Headphones, PenTool, FileText, ClipboardList,
  CheckCircle2, ChevronRight, ChevronLeft, Inbox, Plus,
  FileSpreadsheet, XCircle, PlusCircle, Check, X, Users, Pencil, Trash2, GraduationCap, Search,
  Calendar, Clock, CalendarClock, Zap, Layers, ChevronDown,
} from 'lucide-react';

// ─── Schedule helpers (lesson learning-time) ───────────────────

const LESSON_STATUS_META: Record<ReturnType<typeof getLessonTimeStatus>, { label: string; cls: string }> = {
  no_limit: { label: 'Không giới hạn', cls: 'bg-slate-100 text-slate-500' },
  upcoming: { label: 'Sắp mở', cls: 'bg-amber-100 text-amber-700' },
  active: { label: 'Đang học', cls: 'bg-emerald-100 text-emerald-700' },
  ending_soon: { label: 'Sắp hết hạn', cls: 'bg-orange-100 text-orange-700' },
  expired: { label: 'Đã hết hạn', cls: 'bg-red-100 text-red-700' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function splitDateTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function composeDateTimeISO(date: string, time: string): string | null {
  if (!date) return null;
  const t = time || '23:59';
  const d = new Date(`${date}T${t}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hasSchedule(s: { startAt: string | null; deadline: string | null }): boolean {
  return Boolean(s.startAt || s.deadline);
}

/** Lesson override entry shape for editing UI */
interface LessonScheduleEntry {
  startAt: string;
  deadline: string;
  startTime: string;
  deadlineTime: string;
}

function emptyScheduleEntry(): LessonScheduleEntry {
  return { startAt: '', deadline: '', startTime: '', deadlineTime: '' };
}

function entryFromISO(startAt: string | null, deadline: string | null): LessonScheduleEntry {
  const s = splitDateTime(startAt);
  const d = splitDateTime(deadline);
  return { startAt: s.date, startTime: s.time, deadline: d.date, deadlineTime: d.time };
}

function entryHasValue(e: LessonScheduleEntry): boolean {
  return Boolean(e.startAt || e.deadline);
}

function entryToOverride(e: LessonScheduleEntry): { startAt: string | null; deadline: string | null } | null {
  if (!entryHasValue(e)) return null;
  return { startAt: composeDateTimeISO(e.startAt, e.startTime), deadline: composeDateTimeISO(e.deadline, e.deadlineTime) };
}

/** Compose a category/lesson schedule map from editing entries, dropping empties. */
function buildScheduleMap(
  entries: Record<string, LessonScheduleEntry>
): Record<string, { startAt: string | null; deadline: string | null }> {
  const out: Record<string, { startAt: string | null; deadline: string | null }> = {};
  for (const [cls, e] of Object.entries(entries)) {
    const ov = entryToOverride(e);
    if (ov) out[cls] = ov;
  }
  return out;
}

// ─── Shared schedule field pair ─────────────────────────────

function ScheduleFields({ entry, onChange }: {
  entry: LessonScheduleEntry;
  onChange: (patch: Partial<LessonScheduleEntry>) => void;
}) {
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400";
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-[10px] font-medium text-slate-500">Mở bài (ngày)</label>
        <input type="date" value={entry.startAt} onChange={(e) => onChange({ startAt: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium text-slate-500">Giờ mở</label>
        <input type="time" value={entry.startTime} onChange={(e) => onChange({ startTime: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium text-slate-500">Hạn kết thúc (ngày)</label>
        <input type="date" value={entry.deadline} onChange={(e) => onChange({ deadline: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-medium text-slate-500">Giờ hạn</label>
        <input type="time" value={entry.deadlineTime} onChange={(e) => onChange({ deadlineTime: e.target.value })} className={inputCls} />
      </div>
    </div>
  );
}

const ICON_MAP: Record<LessonCategoryIcon, typeof BookOpen> = {
  BookOpen,
  Languages,
  Headphones,
  PenTool,
  FileText,
  ClipboardList,
};

const ICON_CHOICES: { value: LessonCategoryIcon; label: string }[] = [
  { value: 'BookOpen', label: 'Ngữ pháp' },
  { value: 'Languages', label: 'Từ vựng' },
  { value: 'Headphones', label: 'Nghe' },
  { value: 'PenTool', label: 'Viết' },
  { value: 'FileText', label: 'Đọc' },
  { value: 'ClipboardList', label: 'Bài tập' },
];

interface LessonListViewProps {
  lessons: Lesson[];
  categories: LessonCategory[];
  completedIds: Set<string>;
  currentUser: User;
  canManage: boolean;
  onOpen: (lesson: Lesson) => void;
  onImport: () => void;
  onVocabImport?: (categoryId: string) => void;
  onOpenListening?: () => void;
  onOpenReading?: () => void;
  onUpdateLesson?: (id: string, updates: Partial<Lesson>) => void;
  onCreateCategory?: (data: Omit<LessonCategory, 'id' | 'createdAt'>) => void;
  onUpdateCategory?: (id: string, updates: Partial<LessonCategory>) => void;
  onDeleteCategory?: (id: string) => void;
}

function categoryVisibleForUser(cat: LessonCategory, user: User): boolean {
  if (user.role !== 'student') return true;
  const tc = cat.targetClasses;
  if (!tc || tc.length === 0 || tc.includes('Tất cả')) return true;
  return tc.some((cls) => user.assignedClasses.includes(cls));
}

function isReadingCategory(cat: LessonCategory): boolean {
  const t = cat.title.trim().toLowerCase();
  return cat.id === 'cat-reading' || t === 'bài học đọc' || t === 'bài học đọc hiểu';
}

function lessonVisibleForStudent(lesson: Lesson, user: User): boolean {
  if (user.role !== 'student') return true;
  const tc = lesson.targetClasses;
  if (!tc || tc.length === 0 || tc.includes('Tất cả')) return true;
  return tc.some((cls) => user.assignedClasses.includes(cls));
}

/** Classes a lesson's per-class schedule editor should show: lesson classes → category classes → all. */
function lessonScopeClasses(lesson: Lesson, category: LessonCategory | null, allClasses: string[]): string[] {
  const tc = lesson.targetClasses ?? [];
  if (tc.length > 0 && !tc.includes('Tất cả')) return tc;
  const cc = category?.targetClasses ?? [];
  if (cc.length > 0 && !cc.includes('Tất cả')) return cc;
  return allClasses;
}

export function LessonListView({
  lessons, categories, completedIds, currentUser, canManage, onOpen, onImport, onVocabImport, onOpenListening, onOpenReading,
  onUpdateLesson, onCreateCategory, onUpdateCategory, onDeleteCategory,
}: LessonListViewProps) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'done' | 'todo'>('all');
  const [classes, setClasses] = useState<string[]>([]);
  const [showClassInput, setShowClassInput] = useState(false);
  const [newClass, setNewClass] = useState('');
  const [editingLessonClasses, setEditingLessonClasses] = useState<Lesson | null>(null);
  const [editingCategory, setEditingCategory] = useState<LessonCategory | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ title: '', icon: 'BookOpen' as LessonCategoryIcon, teacherName: '' });
  const [catDefaultStart, setCatDefaultStart] = useState('');
  const [catDefaultStartTime, setCatDefaultStartTime] = useState('');
  const [catDefaultDeadline, setCatDefaultDeadline] = useState('');
  const [catDefaultDeadlineTime, setCatDefaultDeadlineTime] = useState('');
  const [vocabCounts, setVocabCounts] = useState<Record<string, number>>({});

  // Category edit modal schedule state
  const [editDefaultStart, setEditDefaultStart] = useState('');
  const [editDefaultStartTime, setEditDefaultStartTime] = useState('');
  const [editDefaultDeadline, setEditDefaultDeadline] = useState('');
  const [editDefaultDeadlineTime, setEditDefaultDeadlineTime] = useState('');
  const [editCatClassSchedules, setEditCatClassSchedules] = useState<Record<string, LessonScheduleEntry>>({});
  const [editShowClassSchedules, setEditShowClassSchedules] = useState(false);
  const [editCatOpenRows, setEditCatOpenRows] = useState<Set<string>>(new Set());

  // Bulk schedule editor state (Tier 2)
  const [showBulkSchedule, setShowBulkSchedule] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkEntries, setBulkEntries] = useState<Record<string, LessonScheduleEntry>>({});
  const [bulkClassEntries, setBulkClassEntries] = useState<Record<string, Record<string, LessonScheduleEntry>>>({});
  const [bulkClassOpen, setBulkClassOpen] = useState<Record<string, boolean>>({});
  const [bulkClassRowOpen, setBulkClassRowOpen] = useState<Set<string>>(new Set());
  const [bulkClassTouched, setBulkClassTouched] = useState<Set<string>>(new Set());
  const [autoStart, setAutoStart] = useState('');
  const [autoDaysPerLesson, setAutoDaysPerLesson] = useState('3');
  const [autoGapDays, setAutoGapDays] = useState('1');
  const [autoUseTime, setAutoUseTime] = useState('23:59');

  useEffect(() => {
    if (canManage) loadClasses().then(setClasses);
  }, [canManage]);

  useEffect(() => {
    loadAllVocabItems().then((items) => {
      const counts: Record<string, number> = {};
      items.forEach((v) => { counts[v.lessonId] = (counts[v.lessonId] ?? 0) + 1; });
      setVocabCounts(counts);
    });
  }, []);

  const visibleCategories = useMemo(
    () => categories.filter((c) => categoryVisibleForUser(c, currentUser)).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, currentUser]
  );

  const activeCategory = activeCategoryId ? categories.find((c) => c.id === activeCategoryId) ?? null : null;

  // Lessons in the active category, filtered by class visibility
  const categoryLessons = useMemo(() => {
    if (!activeCategory) return [];
    return lessons
      .filter((l) => l.categoryId === activeCategory.id)
      .filter((l) => lessonVisibleForStudent(l, currentUser))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [lessons, activeCategory, currentUser]);

  const filtered = useMemo(() => {
    return categoryLessons.filter((l) => {
      const matchSearch =
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        l.meaning.toLowerCase().includes(search.toLowerCase());
      const done = completedIds.has(l.id);
      if (filter === 'done' && !done) return false;
      if (filter === 'todo' && done) return false;
      return matchSearch;
    });
  }, [categoryLessons, search, filter, completedIds]);

  const doneCount = categoryLessons.filter((l) => completedIds.has(l.id)).length;
  const progressPct = categoryLessons.length > 0 ? Math.round((doneCount / categoryLessons.length) * 100) : 0;

  // Category-level stats
  const categoryStats = useMemo(() => {
    return visibleCategories.map((cat) => {
      const catLessons = lessons.filter((l) => l.categoryId === cat.id && lessonVisibleForStudent(l, currentUser));
      const catDone = catLessons.filter((l) => completedIds.has(l.id)).length;
      return { cat, total: catLessons.length, done: catDone };
    });
  }, [visibleCategories, lessons, completedIds, currentUser]);

  const handleAddClass = async () => {
    const trimmed = newClass.trim();
    if (!trimmed) return;
    const updated = await addClass(trimmed);
    setClasses(updated);
    setNewClass('');
    setShowClassInput(false);
  };

  const handleRemoveClass = async (cls: string) => {
    const updated = await removeClass(cls);
    setClasses(updated);
  };

  const toggleLessonClass = (lesson: Lesson, cls: string) => {
    if (!onUpdateLesson) return;
    const current = lesson.targetClasses ?? [];
    let next: string[];
    if (cls === 'Tất cả') {
      next = current.includes('Tất cả') ? [] : ['Tất cả'];
    } else {
      const withoutAll = current.filter((c) => c !== 'Tất cả');
      next = withoutAll.includes(cls) ? withoutAll.filter((c) => c !== cls) : [...withoutAll, cls];
    }
    onUpdateLesson(lesson.id, { targetClasses: next });
    setEditingLessonClasses((prev) => (prev ? { ...prev, targetClasses: next } : prev));
  };

  const toggleCategoryClass = (cat: LessonCategory, cls: string) => {
    if (!onUpdateCategory) return;
    const current = cat.targetClasses ?? [];
    let next: string[];
    if (cls === 'Tất cả') {
      next = current.includes('Tất cả') ? [] : ['Tất cả'];
    } else {
      const withoutAll = current.filter((c) => c !== 'Tất cả');
      next = withoutAll.includes(cls) ? withoutAll.filter((c) => c !== cls) : [...withoutAll, cls];
    }
    onUpdateCategory(cat.id, { targetClasses: next });
    setEditingCategory((prev) => (prev ? { ...prev, targetClasses: next } : prev));
    // A removed class keeps no per-class schedule entries (stale-data cleanup)
    if (!next.includes(cls)) {
      setEditCatClassSchedules((prev) => {
        if (!(cls in prev)) return prev;
        const cp = { ...prev };
        delete cp[cls];
        onUpdateCategory(cat.id, { classSchedules: buildScheduleMap(cp) });
        return cp;
      });
    }
  };

  const handleSaveCategory = () => {
    if (!categoryForm.title.trim() || !onCreateCategory) return;
    onCreateCategory({
      title: categoryForm.title.trim(),
      icon: categoryForm.icon,
      teacherName: categoryForm.teacherName.trim(),
      targetClasses: [],
      sortOrder: categories.length + 1,
      defaultStartAt: composeDateTimeISO(catDefaultStart, catDefaultStartTime),
      defaultDeadline: composeDateTimeISO(catDefaultDeadline, catDefaultDeadlineTime),
      classSchedules: {},
    });
    setCategoryForm({ title: '', icon: 'BookOpen', teacherName: '' });
    setCatDefaultStart(''); setCatDefaultStartTime('');
    setCatDefaultDeadline(''); setCatDefaultDeadlineTime('');
    setShowCategoryForm(false);
  };

  const handleOpenEditCategory = (cat: LessonCategory) => {
    setEditingCategory(cat);
    const ds = splitDateTime(cat.defaultStartAt);
    const dd = splitDateTime(cat.defaultDeadline);
    setEditDefaultStart(ds.date);
    setEditDefaultStartTime(ds.time);
    setEditDefaultDeadline(dd.date);
    setEditDefaultDeadlineTime(dd.time);
    const entries: Record<string, LessonScheduleEntry> = {};
    Object.entries(cat.classSchedules ?? {}).forEach(([cls, ov]) => {
      entries[cls] = entryFromISO(ov.startAt, ov.deadline);
    });
    setEditCatClassSchedules(entries);
    setEditShowClassSchedules(Object.keys(entries).length > 0);
    setEditCatOpenRows(new Set());
  };

  const saveCategorySchedule = (cat: LessonCategory) => {
    if (!onUpdateCategory) return;
    const nextStart = composeDateTimeISO(editDefaultStart, editDefaultStartTime) ?? (editDefaultStart || editDefaultStartTime ? cat.defaultStartAt : null);
    const nextDeadline = composeDateTimeISO(editDefaultDeadline, editDefaultDeadlineTime) ?? (editDefaultDeadline || editDefaultDeadlineTime ? cat.defaultDeadline : null);
    if (nextStart && nextDeadline && new Date(nextStart).getTime() >= new Date(nextDeadline).getTime()) {
      toast('Thời gian mở phải trước thời gian kết thúc', 'error');
      return;
    }
    // Per-class overrides must satisfy start < deadline for each filled pair
    for (const e of Object.values(editCatClassSchedules)) {
      const s = composeDateTimeISO(e.startAt, e.startTime);
      const d = composeDateTimeISO(e.deadline, e.deadlineTime);
      if (s && d && new Date(s).getTime() >= new Date(d).getTime()) {
        toast('Lịch theo lớp: thời gian mở phải trước thời gian kết thúc', 'error');
        return;
      }
    }
    onUpdateCategory(cat.id, {
      defaultStartAt: nextStart,
      defaultDeadline: nextDeadline,
      classSchedules: buildScheduleMap(editCatClassSchedules),
    });
    setEditingCategory(null);
    toast('Đã lưu thời gian học của danh mục', 'success');
  };

  const setEditCatEntry = (cls: string, patch: Partial<LessonScheduleEntry>) => {
    setEditCatClassSchedules((prev) => ({
      ...prev,
      [cls]: { ...(prev[cls] ?? emptyScheduleEntry()), ...patch },
    }));
  };

  const removeEditCatEntry = (cls: string) => {
    setEditCatOpenRows((prev) => {
      const next = new Set(prev);
      next.delete(cls);
      return next;
    });
    setEditCatClassSchedules((prev) => {
      const next = { ...prev };
      delete next[cls];
      return next;
    });
  };

  // ─── Bulk schedule editor handlers ──────────────────────────
  const openBulkSchedule = () => {
    const entries: Record<string, LessonScheduleEntry> = {};
    const classEntries: Record<string, Record<string, LessonScheduleEntry>> = {};
    categoryLessons.forEach((l) => {
      entries[l.id] = entryFromISO(l.startAt, l.deadline);
      const ce: Record<string, LessonScheduleEntry> = {};
      Object.entries(l.classSchedules ?? {}).forEach(([cls, ov]) => {
        ce[cls] = entryFromISO(ov.startAt, ov.deadline);
      });
      classEntries[l.id] = ce;
    });
    setBulkEntries(entries);
    setBulkClassEntries(classEntries);
    setBulkClassOpen({});
    setBulkClassRowOpen(new Set());
    setBulkClassTouched(new Set());
    setBulkSelected(new Set());
    setShowBulkSchedule(true);
  };

  const toggleBulkSelect = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setBulkEntry = (id: string, patch: Partial<LessonScheduleEntry>) => {
    setBulkEntries((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyScheduleEntry()), ...patch } }));
  };

  const touchBulkClass = (id: string) => setBulkClassTouched((prev) => new Set(prev).add(id));

  const setBulkClassEntry = (id: string, cls: string, patch: Partial<LessonScheduleEntry>) => {
    touchBulkClass(id);
    setBulkClassEntries((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [cls]: { ...(prev[id]?.[cls] ?? emptyScheduleEntry()), ...patch } },
    }));
  };

  const removeBulkClassEntry = (id: string, cls: string) => {
    setBulkClassRowOpen((prev) => {
      const next = new Set(prev);
      next.delete(`${id}::${cls}`);
      return next;
    });
    touchBulkClass(id);
    setBulkClassEntries((prev) => {
      const next = { ...(prev[id] ?? {}) };
      delete next[cls];
      return { ...prev, [id]: next };
    });
  };

  const applyBulk = () => {
    if (!onUpdateLesson) return;
    let count = 0;
    for (const id of bulkSelected) {
      const e = bulkEntries[id];
      if (e) {
        const s = composeDateTimeISO(e.startAt, e.startTime);
        const d = composeDateTimeISO(e.deadline, e.deadlineTime);
        if (s && d && new Date(s).getTime() >= new Date(d).getTime()) {
          toast(`Bài "${categoryLessons.find((l) => l.id === id)?.title ?? id}": thời gian mở phải trước kết thúc`, 'error');
          return;
        }
      }
      if (bulkClassTouched.has(id)) {
        for (const [cls, ce] of Object.entries(bulkClassEntries[id] ?? {})) {
          const s = composeDateTimeISO(ce.startAt, ce.startTime);
          const d = composeDateTimeISO(ce.deadline, ce.deadlineTime);
          if (s && d && new Date(s).getTime() >= new Date(d).getTime()) {
            toast(`Bài "${categoryLessons.find((l) => l.id === id)?.title ?? id}" - lớp ${cls}: thời gian mở phải trước kết thúc`, 'error');
            return;
          }
        }
      }
    }
    for (const id of bulkSelected) {
      const e = bulkEntries[id];
      if (!e) continue;
      const updates: Partial<Lesson> = {
        startAt: composeDateTimeISO(e.startAt, e.startTime),
        deadline: composeDateTimeISO(e.deadline, e.deadlineTime),
      };
      // Only lessons whose per-class section was touched get their classSchedules rewritten;
      // untouched lessons keep their existing per-class schedules.
      if (bulkClassTouched.has(id)) updates.classSchedules = buildScheduleMap(bulkClassEntries[id] ?? {});
      onUpdateLesson(id, updates);
      count++;
    }
    if (count > 0) toast(`Đã cập nhật lịch cho ${count} bài học`, 'success');
    setShowBulkSchedule(false);
  };

  const applyAutoSchedule = () => {
    if (!onUpdateLesson) return;
    const days = parseInt(autoDaysPerLesson, 10);
    const gap = parseInt(autoGapDays, 10);
    if (!autoStart || Number.isNaN(days) || days < 1) {
      toast('Chọn ngày bắt đầu và số ngày mỗi bài (≥1)', 'error');
      return;
    }
    const targets = categoryLessons.filter((l) => bulkSelected.has(l.id));
    if (targets.length === 0) {
      toast('Chọn ít nhất một bài học', 'error');
      return;
    }
    const base = new Date(`${autoStart}T00:00:00`);
    if (Number.isNaN(base.getTime())) { toast('Ngày bắt đầu không hợp lệ', 'error'); return; }
    const gapN = Number.isNaN(gap) || gap < 0 ? 0 : gap;
    let cursor = new Date(base);
    for (const lesson of targets) {
      const s = new Date(cursor);
      const dl = new Date(cursor.getTime() + days * 86400000);
      if (autoUseTime) {
        const [hh, mm] = autoUseTime.split(':').map((v) => parseInt(v, 10));
        dl.setHours(hh || 0, mm || 0, 0, 0);
      } else {
        dl.setHours(23, 59, 0, 0);
      }
      onUpdateLesson(lesson.id, {
        startAt: s.toISOString(),
        deadline: dl.toISOString(),
      });
      cursor = new Date(cursor.getTime() + (days + gapN) * 86400000);
    }
    toast(`Đã tạo lịch tự động cho ${targets.length} bài học`, 'success');
    setShowBulkSchedule(false);
  };

  const clearBulkSelection = () => setBulkSelected(new Set());
  const selectAllBulk = () => setBulkSelected(new Set(categoryLessons.map((l) => l.id)));

  const handleDeleteCategory = (cat: LessonCategory) => {
    if (!onDeleteCategory) return;
    if (!confirm(`Xóa danh mục "${cat.title}"? Các bài học trong danh mục sẽ không bị xóa nhưng sẽ mất danh mục.`)) return;
    onDeleteCategory(cat.id);
    setEditingCategory(null);
  };

  // ─── Tier 2: Lesson list inside a category ───────────────────
  if (activeCategory) {
    const Icon = ICON_MAP[activeCategory.icon] ?? BookOpen;
    return (
      <div className="px-4 pb-28 pt-4 md:px-0 md:pb-8">
        {/* Back button + header */}
        <button
          onClick={() => { setActiveCategoryId(null); setSearch(''); setFilter('all'); }}
          className="mb-3 flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <ChevronLeft size={18} /> Danh mục bài học
        </button>

        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md">
            <Icon size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-800">{activeCategory.title}</h2>
            {activeCategory.teacherName && (
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <GraduationCap size={12} /> {activeCategory.teacherName}
              </p>
            )}
            <p className="text-xs text-slate-400">{doneCount}/{categoryLessons.length} bài đã học</p>
          </div>
          {canManage && categoryLessons.length > 0 && onUpdateLesson && (
            <button onClick={openBulkSchedule}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-md hover:bg-blue-700">
              <Layers size={15} /> Thiết lập lịch học
            </button>
          )}
          {canManage && (
            <button onClick={() => activeCategory.id === 'cat-vocab' && onVocabImport ? onVocabImport(activeCategory.id) : onImport()}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-md hover:bg-emerald-700">
              <FileSpreadsheet size={15} /> Nhập
            </button>
          )}
        </div>

        {/* Progress bar */}
        {categoryLessons.length > 0 && (
          <div className="mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 p-4 text-white shadow-md">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Tiến độ học tập</span>
              <span className="font-bold">{progressPct}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-blue-100">Đã hoàn thành {doneCount} / {categoryLessons.length} bài</p>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-3">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm bài học..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </div>

        {/* Filter chips */}
        <div className="mb-4 flex gap-2">
          {([
            { v: 'all', l: 'Tất cả' },
            { v: 'todo', l: 'Chưa học' },
            { v: 'done', l: 'Đã học' },
          ] as { v: 'all' | 'done' | 'todo'; l: string }[]).map((opt) => (
            <button key={opt.v} onClick={() => setFilter(opt.v)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${filter === opt.v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
              {opt.l}
            </button>
          ))}
        </div>

        {/* Lesson list */}
        {filtered.length > 0 ? (
          <div className="space-y-2.5 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3">
            {filtered.map((lesson, idx) => {
              const done = completedIds.has(lesson.id);
              const schedule = getEffectiveLessonSchedule(lesson, activeCategory, currentUser);
              const status = getLessonTimeStatus(schedule);
              const hasOwn = Boolean(lesson.startAt || lesson.deadline);
              return (
                <div key={lesson.id} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${done ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'}`}>
                      {done ? <CheckCircle2 size={18} /> : <span>{lesson.sortOrder || idx + 1}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <button onClick={() => onOpen(lesson)} className="text-left w-full">
                        <p className="text-sm font-bold text-slate-800 leading-tight">{lesson.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{lesson.meaning}</p>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400">
                          {activeCategory.id === 'cat-vocab' ? (
                            <span className="flex items-center gap-1"><BookOpen size={10} /> {vocabCounts[lesson.id] ?? 0} từ vựng</span>
                          ) : (
                            <>
                              <span className="flex items-center gap-1"><BookOpen size={10} /> {lesson.examples.length} ví dụ</span>
                              <span>{lesson.exercises.length} bài tập</span>
                            </>
                          )}
                          {(lesson.targetClasses?.length ?? 0) > 0 && !lesson.targetClasses.includes('Tất cả') && (
                            <span className="rounded bg-sky-100 px-1 py-0.5 font-medium text-sky-600">{lesson.targetClasses.join(', ')}</span>
                          )}
                        </div>
                        {hasSchedule(schedule) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${LESSON_STATUS_META[status].cls}`}>
                              <Clock size={9} /> {LESSON_STATUS_META[status].label}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {schedule.startAt ? `Từ ${fmtDate(schedule.startAt)}` : 'Không giới hạn'}
                              {schedule.startAt && schedule.deadline ? ' → ' : ''}
                              {schedule.deadline ? `đến ${fmtDate(schedule.deadline)}` : ''}
                            </span>
                            {!hasOwn && <span className="text-[10px] text-slate-300">(mặc định danh mục)</span>}
                          </div>
                        )}
                      </button>
                      {canManage && onUpdateLesson && (
                        <button onClick={() => setEditingLessonClasses(lesson)}
                          className="mt-2 text-[10px] font-medium text-blue-500 hover:text-blue-700">
                          Phân lớp áp dụng {(lesson.targetClasses?.length ?? 0) > 0 ? `(${lesson.targetClasses.join(', ')})` : '(Tất cả)'}
                        </button>
                      )}
                    </div>
                    <button onClick={() => onOpen(lesson)} className="shrink-0 self-center">
                      <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-400 transition-colors" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Inbox size={48} className="mb-3 text-slate-300" />
            {categoryLessons.length === 0 ? (
              <>
                <p className="text-sm font-medium text-slate-500">Chưa có bài học nào trong danh mục này</p>
                {canManage && (
                  <button onClick={() => activeCategory.id === 'cat-vocab' && onVocabImport ? onVocabImport(activeCategory.id) : onImport()} className="mt-3 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                    <Plus size={16} /> Nhập từ Excel
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm font-medium text-slate-500">Không tìm thấy bài học</p>
            )}
          </div>
        )}

        {/* Bulk schedule editor modal */}
        {showBulkSchedule && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in md:items-center" onClick={() => setShowBulkSchedule(false)}>
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 animate-slide-up safe-bottom md:rounded-2xl md:animate-fade-in" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">Thiết lập lịch học</h3>
                <button onClick={() => setShowBulkSchedule(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
              </div>
              <p className="mb-3 text-xs text-slate-400">Chọn bài học rồi đặt thời gian mở / hạn kết thúc. Bỏ trống = không giới hạn.</p>

              {/* Bulk selection controls */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button onClick={selectAllBulk} className="rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-200">Chọn tất cả</button>
                <button onClick={clearBulkSelection} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">Bỏ chọn</button>
                <span className="text-xs text-slate-400">Đã chọn: {bulkSelected.size}/{categoryLessons.length}</span>
              </div>

              {/* Auto-schedule generator */}
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-amber-700"><Zap size={13} /> Tạo lịch tự động cho các bài đã chọn</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-slate-500">Ngày bắt đầu</label>
                    <input type="date" value={autoStart} onChange={(e) => setAutoStart(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-slate-500">Giờ hạn mỗi ngày</label>
                    <input type="time" value={autoUseTime} onChange={(e) => setAutoUseTime(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-slate-500">Số ngày mỗi bài</label>
                    <input type="number" min={1} value={autoDaysPerLesson} onChange={(e) => setAutoDaysPerLesson(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-slate-500">Nghỉ giữa các bài (ngày)</label>
                    <input type="number" min={0} value={autoGapDays} onChange={(e) => setAutoGapDays(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
                  </div>
                </div>
                <button onClick={applyAutoSchedule}
                  className="mt-2 w-full rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white hover:bg-amber-600">
                  Tạo lịch tự động
                </button>
                <p className="mt-1 text-[10px] text-amber-600">Bài 1 mở từ ngày bắt đầu, hạn sau {autoDaysPerLesson || '?'} ngày; bài sau bắt đầu ngay khi bài trước hết hạn {parseInt(autoGapDays, 10) > 0 ? `cộng thêm ${autoGapDays} ngày nghỉ` : ''}.</p>
              </div>

              {/* Per-lesson entries */}
              <div className="space-y-2">
                {categoryLessons.map((lesson) => {
                  const selected = bulkSelected.has(lesson.id);
                  const lessonClasses = lessonScopeClasses(lesson, activeCategory, classes);
                  return (
                    <div key={lesson.id} className={`rounded-xl border p-3 transition-colors ${selected ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={selected} onChange={() => toggleBulkSelect(lesson.id)} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{lesson.sortOrder || '?'} . {lesson.title}</span>
                      </label>
                      {selected && (
                        <div className="mt-2 pl-6">
                          <p className="mb-1.5 text-[10px] font-medium text-slate-400">Thời gian chung (dùng khi lớp chưa có lịch riêng)</p>
                          <ScheduleFields entry={bulkEntries[lesson.id] ?? emptyScheduleEntry()} onChange={(patch) => setBulkEntry(lesson.id, patch)} />
                          <button
                            onClick={() => setBulkClassOpen((p) => ({ ...p, [lesson.id]: !p[lesson.id] }))}
                            className="mt-2 flex w-full items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 border border-slate-200 hover:bg-slate-50"
                          >
                            <span className="flex items-center gap-1"><Users size={11} /> Lịch riêng theo lớp ({Object.keys(bulkClassEntries[lesson.id] ?? {}).filter((c) => entryHasValue(bulkClassEntries[lesson.id][c])).length}/{lessonClasses.length})</span>
                            {bulkClassOpen[lesson.id] ? <ChevronDown size={12} className="rotate-180" /> : <ChevronDown size={12} />}
                          </button>
                          {bulkClassOpen[lesson.id] && (
                            <div className="mt-2 space-y-1.5">
                              {lessonClasses.length === 0 && <p className="text-[10px] text-slate-400">Chưa có lớp nào.</p>}
                              {lessonClasses.map((cls) => {
                                const entry = bulkClassEntries[lesson.id]?.[cls] ?? emptyScheduleEntry();
                                const rowKey = `${lesson.id}::${cls}`;
                                const open = bulkClassRowOpen.has(rowKey) || entryHasValue(entry);
                                return (
                                  <div key={cls} className={`rounded-lg border p-2 ${open ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
                                    <div className="mb-1 flex items-center justify-between">
                                      <span className="text-[11px] font-semibold text-slate-700">{cls}</span>
                                      {open && (
                                        <button onClick={() => removeBulkClassEntry(lesson.id, cls)} className="text-[10px] font-medium text-red-500 hover:text-red-600">Bỏ</button>
                                      )}
                                    </div>
                                    {!open ? (
                                      <button
                                        onClick={() => setBulkClassRowOpen((prev) => new Set(prev).add(rowKey))}
                                        className="text-[10px] font-medium text-blue-500 hover:text-blue-700"
                                      >
                                        + Thêm lịch riêng
                                      </button>
                                    ) : (
                                      <ScheduleFields entry={entry} onChange={(patch) => setBulkClassEntry(lesson.id, cls, patch)} />
                                    )}
                                  </div>
                                );
                              })}
                              <p className="text-[10px] text-slate-400">Mỗi lớp độc lập. Lớp chưa đặt lịch dùng thời gian chung / mặc định danh mục.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex gap-2">
                <button onClick={() => setShowBulkSchedule(false)} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">Đóng</button>
                <button onClick={applyBulk} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Áp dụng cho bài đã chọn</button>
              </div>
            </div>
          </div>
        )}

        {/* Lesson class assignment modal */}
        {editingLessonClasses && (
          <ClassPickerModal
            title="Lớp áp dụng bài học"
            subtitle={editingLessonClasses.title}
            targetClasses={editingLessonClasses.targetClasses ?? []}
            classes={classes}
            onToggle={(cls) => toggleLessonClass(editingLessonClasses, cls)}
            onClose={() => setEditingLessonClasses(null)}
            showClassInput={showClassInput}
            setShowClassInput={setShowClassInput}
            newClass={newClass}
            setNewClass={setNewClass}
            onAddClass={handleAddClass}
            onRemoveClass={handleRemoveClass}
          />
        )}
      </div>
    );
  }

  // ─── Tier 1: Category grid ───────────────────────────────────
  return (
    <div className="px-4 pb-28 pt-4 md:px-0 md:pb-8">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Bài học</h2>
          <p className="text-sm text-slate-500">{visibleCategories.length} danh mục bài học</p>
        </div>
        {canManage && onImport && (
          <button onClick={onImport}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-md hover:bg-emerald-700">
            <FileSpreadsheet size={15} /> Nhập Excel
          </button>
        )}
      </div>

      {/* Category cards */}
      {visibleCategories.length > 0 ? (
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3">
          {categoryStats.map(({ cat, total, done }) => {
            const Icon = ICON_MAP[cat.icon] ?? BookOpen;
            const catProgress = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div
                key={cat.id}
                onClick={() => cat.id === 'cat-listening' && onOpenListening ? onOpenListening() : isReadingCategory(cat) && onOpenReading ? onOpenReading() : setActiveCategoryId(cat.id)}
                className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md transition-transform group-hover:scale-105">
                    <Icon size={24} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800">{cat.title}</p>
                    {cat.teacherName && (
                      <p className="mt-0.5 text-xs text-slate-500 flex items-center gap-1">
                        <GraduationCap size={11} /> {cat.teacherName}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{total} bài học</span>
                      <span className="text-slate-300">|</span>
                      <span className="text-emerald-600 font-medium">{done} đã học</span>
                    </div>
                    {/* Class info */}
                    <div className="mt-1.5 flex items-center gap-1 text-[10px]">
                      <Users size={10} className="text-slate-400" />
                      <span className="text-slate-400">Phân lớp:</span>
                      {(cat.targetClasses?.length ?? 0) === 0 || cat.targetClasses.includes('Tất cả') ? (
                        <span className="rounded bg-indigo-100 px-1 py-0.5 font-medium text-indigo-600">Tất cả</span>
                      ) : (
                        <span className="rounded bg-sky-100 px-1 py-0.5 font-medium text-sky-600">{cat.targetClasses.join(', ')}</span>
                      )}
                    </div>
                    {/* Schedule info */}
                    {(() => {
                      const perClass = Object.keys(cat.classSchedules ?? {}).length;
                      return (
                        <div className="mt-1 flex items-center gap-1 text-[10px]">
                          <Calendar size={10} className="text-slate-400" />
                          {perClass > 0 ? (
                            <span className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-700">Lịch học: theo từng lớp</span>
                          ) : hasSchedule({ startAt: cat.defaultStartAt, deadline: cat.defaultDeadline }) ? (
                            <span className="text-slate-400">
                              Thời gian: {cat.defaultStartAt ? fmtDate(cat.defaultStartAt) : '—'} → {cat.defaultDeadline ? fmtDate(cat.defaultDeadline) : '—'}
                            </span>
                          ) : (
                            <span className="text-slate-300">Không giới hạn thời gian</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <ChevronRight size={20} className="shrink-0 self-center text-slate-300 group-hover:text-blue-400 transition-colors" />
                </div>
                {/* Mini progress bar */}
                {total > 0 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-500" style={{ width: `${catProgress}%` }} />
                  </div>
                )}
                {/* Manage button */}
                {canManage && (onUpdateCategory || onDeleteCategory) && (
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenEditCategory(cat); }}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-blue-500 hover:bg-blue-50"
                    >
                      <Pencil size={11} /> Sửa
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox size={48} className="mb-3 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">Chưa có danh mục bài học nào</p>
        </div>
      )}

      {/* Add category button (manage) */}
      {canManage && onCreateCategory && (
        <button
          onClick={() => setShowCategoryForm(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white py-4 text-sm font-medium text-slate-500 transition-all hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-600"
        >
          <Plus size={18} /> Thêm danh mục bài học
        </button>
      )}

      {/* Category form modal */}
      {showCategoryForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in md:items-center" onClick={() => setShowCategoryForm(false)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 animate-slide-up safe-bottom md:rounded-2xl md:animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Thêm danh mục bài học</h3>
              <button onClick={() => setShowCategoryForm(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Tên danh mục</label>
                <input
                  type="text" value={categoryForm.title}
                  onChange={(e) => setCategoryForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="VD: Bài học Kanji"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Biểu tượng</label>
                <div className="flex flex-wrap gap-2">
                  {ICON_CHOICES.map((opt) => {
                    const Icon = ICON_MAP[opt.value];
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setCategoryForm((p) => ({ ...p, icon: opt.value }))}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${categoryForm.icon === opt.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        <Icon size={14} /> {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Giáo viên phụ trách</label>
                <input
                  type="text" value={categoryForm.teacherName}
                  onChange={(e) => setCategoryForm((p) => ({ ...p, teacherName: e.target.value }))}
                  placeholder="VD: Thầy Nguyễn Văn Khoa"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-700"><CalendarClock size={13} /> Thời gian học mặc định (tùy chọn)</p>
                <ScheduleFields
                  entry={{ startAt: catDefaultStart, startTime: catDefaultStartTime, deadline: catDefaultDeadline, deadlineTime: catDefaultDeadlineTime }}
                  onChange={(patch) => {
                    if ('startAt' in patch) setCatDefaultStart(patch.startAt ?? '');
                    if ('startTime' in patch) setCatDefaultStartTime(patch.startTime ?? '');
                    if ('deadline' in patch) setCatDefaultDeadline(patch.deadline ?? '');
                    if ('deadlineTime' in patch) setCatDefaultDeadlineTime(patch.deadlineTime ?? '');
                  }}
                />
                <p className="mt-1.5 text-[10px] text-slate-400">Bỏ trống = bài học không giới hạn thời gian. Có thể đặt riêng theo lớp sau khi tạo.</p>
              </div>
              <button
                onClick={handleSaveCategory}
                disabled={!categoryForm.title.trim()}
                className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Tạo danh mục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category edit modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in md:items-center" onClick={() => setEditingCategory(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 animate-slide-up safe-bottom md:rounded-2xl md:animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Chỉnh sửa danh mục</h3>
              <button onClick={() => setEditingCategory(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
            </div>

            {/* Edit title & teacher */}
            {onUpdateCategory && (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Tên danh mục</label>
                  <input
                    type="text" value={editingCategory.title}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateCategory(editingCategory.id, { title: val });
                      setEditingCategory((p) => p ? { ...p, title: val } : p);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Giáo viên phụ trách</label>
                  <input
                    type="text" value={editingCategory.teacherName}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateCategory(editingCategory.id, { teacherName: val });
                      setEditingCategory((p) => p ? { ...p, teacherName: val } : p);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Biểu tượng</label>
                  <div className="flex flex-wrap gap-2">
                    {ICON_CHOICES.map((opt) => {
                      const Icon = ICON_MAP[opt.value];
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            onUpdateCategory(editingCategory.id, { icon: opt.value });
                            setEditingCategory((p) => p ? { ...p, icon: opt.value } : p);
                          }}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${editingCategory.icon === opt.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          <Icon size={14} /> {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Learning-time schedule */}
            {onUpdateCategory && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-700"><CalendarClock size={13} /> Thời gian học mặc định</p>
                <ScheduleFields
                  entry={{ startAt: editDefaultStart, startTime: editDefaultStartTime, deadline: editDefaultDeadline, deadlineTime: editDefaultDeadlineTime }}
                  onChange={(patch) => {
                    if ('startAt' in patch) setEditDefaultStart(patch.startAt ?? '');
                    if ('startTime' in patch) setEditDefaultStartTime(patch.startTime ?? '');
                    if ('deadline' in patch) setEditDefaultDeadline(patch.deadline ?? '');
                    if ('deadlineTime' in patch) setEditDefaultDeadlineTime(patch.deadlineTime ?? '');
                  }}
                />
                <button
                  onClick={() => setEditShowClassSchedules((v) => !v)}
                  className="mt-3 flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-100"
                >
                  <span className="flex items-center gap-1"><Users size={13} /> Thiết lập riêng theo lớp ({Object.keys(editCatClassSchedules).length})</span>
                  {editShowClassSchedules ? <ChevronDown size={14} className="rotate-180" /> : <ChevronDown size={14} />}
                </button>
                {editShowClassSchedules && (
                  <div className="mt-2 space-y-2">
                    {(() => {
                      const cat = editingCategory;
                      const tc = cat.targetClasses ?? [];
                      const scoped = tc.length > 0 && !tc.includes('Tất cả') ? tc : classes;
                      const assignedCount = scoped.filter((c) => editCatClassSchedules[c]).length;
                      return (
                        <>
                          {scoped.length === 0 && <p className="text-[10px] text-slate-400">Chưa có lớp nào. Thêm lớp ở phần phân lớp bên dưới.</p>}
                          {scoped.length > 0 && (
                            <p className="text-[10px] text-slate-400">Lịch riêng cho {assignedCount}/{scoped.length} lớp: {scoped.join(', ')}</p>
                          )}
                          {scoped.map((cls) => {
                            const entry = editCatClassSchedules[cls] ?? emptyScheduleEntry();
                            const open = editCatOpenRows.has(cls) || entryHasValue(entry);
                            return (
                              <div key={cls} className={`rounded-lg border p-2.5 ${open ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
                                <div className="mb-1.5 flex items-center justify-between">
                                  <span className="text-xs font-semibold text-slate-700">{cls}</span>
                                  {open && (
                                    <button onClick={() => removeEditCatEntry(cls)} className="text-[10px] font-medium text-red-500 hover:text-red-600">Bỏ lịch riêng</button>
                                  )}
                                </div>
                                {!open ? (
                                  <button
                                    onClick={() => setEditCatOpenRows((prev) => new Set(prev).add(cls))}
                                    className="text-[10px] font-medium text-blue-500 hover:text-blue-700"
                                  >
                                    + Thêm lịch riêng cho lớp này
                                  </button>
                                ) : (
                                  <ScheduleFields entry={entry} onChange={(patch) => setEditCatEntry(cls, patch)} />
                                )}
                              </div>
                            );
                          })}
                          <p className="text-[10px] text-slate-400">Mỗi lớp có lịch độc lập — sửa lớp này không ảnh hưởng lớp khác. Lớp chưa đặt lịch dùng thời gian mặc định.</p>
                        </>
                      );
                    })()}
                  </div>
                )}
                <button onClick={() => saveCategorySchedule(editingCategory)}
                  className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                  Lưu thời gian học
                </button>
              </div>
            )}

            {/* Class assignment */}
            <ClassPickerModal
              title="Lớp áp dụng danh mục"
              subtitle={editingCategory.title}
              targetClasses={editingCategory.targetClasses ?? []}
              classes={classes}
              onToggle={(cls) => toggleCategoryClass(editingCategory, cls)}
              onClose={() => setEditingCategory(null)}
              showClassInput={showClassInput}
              setShowClassInput={setShowClassInput}
              newClass={newClass}
              setNewClass={setNewClass}
              onAddClass={handleAddClass}
              onRemoveClass={handleRemoveClass}
              embedded
              extraActions={
                onDeleteCategory && (
                  <button
                    onClick={() => handleDeleteCategory(editingCategory)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                  >
                    <Trash2 size={16} /> Xóa danh mục
                  </button>
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reusable class picker ─────────────────────────────────────

interface ClassPickerModalProps {
  title: string;
  subtitle: string;
  targetClasses: string[];
  classes: string[];
  onToggle: (cls: string) => void;
  onClose: () => void;
  showClassInput: boolean;
  setShowClassInput: (v: boolean) => void;
  newClass: string;
  setNewClass: (v: string) => void;
  onAddClass: () => void;
  onRemoveClass: (cls: string) => void;
  embedded?: boolean;
  extraActions?: React.ReactNode;
}

function ClassPickerModal({
  title, subtitle, targetClasses, classes, onToggle, onClose,
  showClassInput, setShowClassInput, newClass, setNewClass, onAddClass, onRemoveClass,
  embedded, extraActions,
}: ClassPickerModalProps) {
  const content = (
    <>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>
      )}
      {embedded && <h3 className="mb-3 text-sm font-bold text-slate-700">{title}</h3>}
      <p className="mb-2 text-xs text-slate-500 font-medium truncate">{subtitle}</p>
      <p className="mb-3 text-xs text-slate-400">Chọn lớp được phép xem. Bỏ trống = tất cả các lớp.</p>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => onToggle('Tất cả')}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${targetClasses.includes('Tất cả') ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          Tất cả các lớp
        </button>
        {classes.map((cls) => (
          <div key={cls} className="relative group">
            <button onClick={() => onToggle(cls)}
              className={`rounded-lg px-3 py-2 pr-7 text-xs font-medium transition-all ${targetClasses.includes(cls) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {cls}
            </button>
            <button onClick={() => onRemoveClass(cls)} className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500" title="Xóa lớp">
              <XCircle size={12} />
            </button>
          </div>
        ))}
      </div>

      {showClassInput ? (
        <div className="mt-2 flex gap-1.5">
          <input type="text" value={newClass} onChange={(e) => setNewClass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAddClass()}
            placeholder="Nhập tên lớp mới..." className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" autoFocus />
          <button onClick={onAddClass} className="rounded-xl bg-blue-600 px-3 text-white hover:bg-blue-700"><Check size={18} /></button>
          <button onClick={() => { setShowClassInput(false); setNewClass(''); }} className="rounded-xl bg-slate-100 px-3 text-slate-500 hover:bg-slate-200"><X size={18} /></button>
        </div>
      ) : (
        <button onClick={() => setShowClassInput(true)} className="mt-2 flex items-center gap-1 rounded-lg border border-dashed border-blue-300 bg-blue-50/50 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50">
          <PlusCircle size={14} /> Thêm lớp mới
        </button>
      )}

      {extraActions}

      {!embedded && (
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Xong</button>
        </div>
      )}
    </>
  );

  if (embedded) return <div>{content}</div>;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in md:items-center" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 animate-slide-up safe-bottom md:rounded-2xl md:animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
