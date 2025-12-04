// app/student/page.tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Course = {
  code: string;
  title: string;
  time_slot: string | null;
  room: string | null;
};

const STORAGE_KEY = 'sa-chat-student-courses';

export default function StudentCourseSelectPage() {
  const router = useRouter();
  const [myCourses, setMyCourses] = useState<Course[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessionPw, setSessionPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 初回ロード時に localStorage から授業一覧を復元
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Course[];
      // Hydration崩さないために、初期レンダー後にここで状態を復元する
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMyCourses(parsed);
    } catch {
      // 壊れてたら消しておく
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const saveCourses = (courses: Course[]) => {
    setMyCourses(courses);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
    }
  };

  const handleAddCourseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!sessionId || !sessionPw) {
      setError('セッションIDとパスワードを入力してください。');
      return;
    }

    setLoading(true);
    const { data, error: dbError } = await supabase
      .from('courses')
      .select('code, title, time_slot, room')
      .eq('code', sessionId)
      .eq('password', sessionPw)
      .single();

    setLoading(false);

    if (dbError || !data) {
      setError('セッションIDまたはパスワードが正しくありません。');
      return;
    }

    const newCourse: Course = {
      code: data.code,
      title: data.title,
      time_slot: data.time_slot ?? null,
      room: data.room ?? null,
    };

    // すでに登録済みなら上書き
    const existsIndex = myCourses.findIndex((c) => c.code === newCourse.code);
    let nextCourses: Course[];
    if (existsIndex >= 0) {
      nextCourses = [...myCourses];
      nextCourses[existsIndex] = newCourse;
    } else {
      nextCourses = [...myCourses, newCourse];
    }

    saveCourses(nextCourses);

    // フォームをクリア＆閉じる
    setSessionId('');
    setSessionPw('');
    setShowAddForm(false);

    // すぐチャット画面に遷移
    router.push(`/student/${encodeURIComponent(newCourse.code)}`);
  };

  const handleEnterCourse = (courseCode: string) => {
    router.push(`/student/${encodeURIComponent(courseCode)}`);
  };

  const handleRemoveCourse = (courseCode: string) => {
    const filtered = myCourses.filter((c) => c.code !== courseCode);
    saveCourses(filtered);
  };

  return (
    <div
      style={{
        margin: 0,
        minHeight: '100vh',
        background: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: '24px 12px',
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: '24px 24px 20px',
          borderRadius: 16,
          boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
          width: 'min(900px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>SAチャット – 授業選択</h1>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: '#6b7280',
            }}
          >
            一度参加した授業は、次回からここから選ぶだけで参加できます。
          </p>
        </div>

        {/* 登録済み授業一覧 */}
        <div
          style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          {myCourses.map((course) => (
            <div
              key={course.code}
              style={{
                borderRadius: 12,
                border: '1px solid #e5e7eb',
                background: '#f9fafb',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                {course.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                {course.time_slot ? course.time_slot : '時間未設定'}
                {course.room ? ` · 教室${course.room}` : ''}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#9ca3af',
                }}
              >
                コード: {course.code}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 4,
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => handleEnterCourse(course.code)}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    border: 'none',
                    padding: '6px 0',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: '#111827',
                    color: '#fff',
                  }}
                >
                  この授業に参加
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveCourse(course.code)}
                  style={{
                    borderRadius: 999,
                    border: 'none',
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    background: '#e5e7eb',
                    color: '#6b7280',
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          ))}

          {/* 授業追加カード */}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            style={{
              borderRadius: 12,
              border: '1px dashed #d1d5db',
              background: '#f9fafb',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '999px',
                border: '1px solid #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                color: '#6b7280',
              }}
              aria-hidden="true"
            >
              
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#374151',
              }}
            >
              授業を追加
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#9ca3af',
              }}
            >
              初めて参加する授業のID・パスワードを登録します。
            </div>
          </button>
        </div>

        {/* 授業追加フォーム（ログイン画面相当） */}
        {showAddForm && (
          <div
            style={{
              marginTop: 8,
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              background: '#f9fafb',
              padding: '12px 14px 10px',
            }}
          >
            <h2
              style={{
                margin: '0 0 8px',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              授業を追加
            </h2>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              先生が提示したセッションIDとパスワードを入力してください。
            </p>

            <form onSubmit={handleAddCourseSubmit}>
              <div style={{ marginBottom: 8 }}>
                <label
                  htmlFor="sessionId"
                  style={{
                    fontSize: 12,
                    display: 'block',
                    marginBottom: 4,
                    color: '#374151',
                  }}
                >
                  セッションID
                </label>
                <input
                  id="sessionId"
                  type="text"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="例：MUSIC-2-TUE"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: 8 }}>
                <label
                  htmlFor="sessionPw"
                  style={{
                    fontSize: 12,
                    display: 'block',
                    marginBottom: 4,
                    color: '#374151',
                  }}
                >
                  セッションパスワード
                </label>
                <input
                  id="sessionPw"
                  type="password"
                  value={sessionPw}
                  onChange={(e) => setSessionPw(e.target.value)}
                  placeholder="例：8FQ92B"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>

              {error && (
                <div
                  style={{
                    marginBottom: 6,
                    fontSize: 12,
                    color: '#b91c1c',
                  }}
                >
                  {error}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setSessionId('');
                    setSessionPw('');
                    setError('');
                  }}
                  style={{
                    borderRadius: 999,
                    border: 'none',
                    padding: '6px 14px',
                    fontSize: 12,
                    cursor: 'pointer',
                    background: '#e5e7eb',
                    color: '#374151',
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    borderRadius: 999,
                    border: 'none',
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: '#111827',
                    color: '#fff',
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? '確認中…' : '登録して参加'}
                </button>
              </div>
            </form>

            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: '#9ca3af',
              }}
            >
              ※ 一度追加した授業は、次回からカードをクリックするだけで参加できます。
            </div>
          </div>
        )}

        {/* 授業が1つもない場合の案内 */}
        {myCourses.length === 0 && !showAddForm && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: '#9ca3af',
            }}
          >
            まだ授業が登録されていません。「授業を追加」から最初の授業を登録してください。
          </div>
        )}
      </div>
    </div>
  );
}
