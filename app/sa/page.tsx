// app/sa/page.tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Course = {
  code: string;
  title: string;
  time_slot: string | null;
  room: string | null;
  password: string;
};

// Supabase の user_metadata 用
type SupabaseUserMetadata = {
  name?: string;
  full_name?: string;
};

export default function SaCourseListPage() {
  const router = useRouter();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [error, setError] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [timeSlot, setTimeSlot] = useState('');
  const [room, setRoom] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // ★ 授業削除用の状態
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ★ SA 自身の情報 & 個人設定 UI 用
  const [saUserId, setSaUserId] = useState<string | null>(null);
  const [saName, setSaName] = useState<string>('SA');
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  };

  const openSettingsPanel = () => {
    setDisplayNameInput(saName);
    setShowSettingsPanel(true);
  };

  const closeSettingsPanel = () => {
    // 保存中・ログアウト中は閉じない
    if (savingProfile || loggingOut) return;
    setShowSettingsPanel(false);
  };

  const handleSaveDisplayName = async () => {
    if (!saUserId) {
      showToast('ユーザー情報の取得に失敗しました');
      return;
    }

    const name = displayNameInput.trim();
    if (!name) {
      showToast('表示名を入力してください');
      return;
    }

    setSavingProfile(true);
    const { error } = await supabase
      .from('sa_profiles')
      .upsert(
        {
          user_id: saUserId,
          display_name: name,
        },
        { onConflict: 'user_id' }
      );

    setSavingProfile(false);

    if (error) {
      console.error('sa_profiles upsert error', error);
      showToast('名前の保存に失敗しました');
      return;
    }

    setSaName(name);
    showToast('名前を更新しました');
    setShowSettingsPanel(false);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    setLoggingOut(false);

    if (error) {
      console.error('logout error', error);
      showToast('ログアウトに失敗しました');
      return;
    }

    router.push('/sa/login');
  };

  // ログイン＆授業一覧取得 ＋ ログイン中ユーザー名取得
  useEffect(() => {
    const run = async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        router.push('/sa/login');
        return;
      }

      // SA 基本情報
      setSaUserId(auth.user.id);
      const meta = (auth.user.user_metadata ?? {}) as SupabaseUserMetadata;
      const baseName =
        meta.name || meta.full_name || auth.user.email || 'SA';
      setSaName(baseName);

      // 授業一覧
      const { data, error: dbError } = await supabase
        .from('courses')
        .select('*')
        .order('created_at', { ascending: true });

      if (dbError) {
        console.error(dbError);
        setError('授業一覧の取得に失敗しました。');
      } else if (data) {
        setCourses(data as Course[]);
      }

      setLoadingCourses(false);
    };

    void run();
  }, [router]);

  // sa_profiles から display_name を上書き読み込み
  useEffect(() => {
    if (!saUserId) return;

    const run = async () => {
      const { data, error } = await supabase
        .from('sa_profiles')
        .select('display_name')
        .eq('user_id', saUserId)
        .maybeSingle();

      if (!error && data?.display_name) {
        setSaName(data.display_name);
      }
    };

    void run();
  }, [saUserId]);

  const handleOpenCourse = (courseCode: string) => {
    router.push(`/sa/dashboard?course=${encodeURIComponent(courseCode)}`);
  };

  const resetForm = () => {
    setCode('');
    setTitle('');
    setTimeSlot('');
    setRoom('');
    setPassword('');
  };

  const handleCreateCourse = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code || !title || !password) {
      setError('授業コード・タイトル・パスワードは必須です。');
      return;
    }

    setSaving(true);

    const { data, error: insertError } = await supabase
      .from('courses')
      .insert({
        code,
        title,
        time_slot: timeSlot || null,
        room: room || null,
        password,
      })
      .select()
      .single();

    setSaving(false);

    if (insertError || !data) {
      console.error(insertError);
      setError(
        '授業枠の作成に失敗しました。同じコードがすでに存在していないか確認してください。'
      );
      return;
    }

    setCourses((prev) => [...prev, data as Course]);
    resetForm();
    setShowAddForm(false);
  };

  // 授業削除ボタン押下 → 確認モーダルを開く
  const handleClickDeleteCourse = (courseCode: string) => {
    setError('');
    setDeletingCode(courseCode);
  };

  // 授業削除を確定
  const handleConfirmDeleteCourse = async () => {
    if (!deletingCode) return;
    setDeleting(true);
    setError('');

    const targetCode = deletingCode;

    try {
      // thread_locks / thread_reads は FK が無いので手動で削除
      await supabase.from('thread_locks').delete().eq('course_code', targetCode);
      await supabase.from('thread_reads').delete().eq('course_code', targetCode);

      // courses を削除（messages / calls は ON DELETE CASCADE の想定）
      const { error: deleteError } = await supabase
        .from('courses')
        .delete()
        .eq('code', targetCode);

      if (deleteError) {
        console.error(deleteError);
        setError('授業枠の削除に失敗しました。');
        setDeleting(false);
        return;
      }

      // ローカル状態からも削除
      setCourses((prev) => prev.filter((c) => c.code !== targetCode));
      setDeletingCode(null);
    } catch (e) {
      console.error(e);
      setError('授業枠の削除中にエラーが発生しました。');
    } finally {
      setDeleting(false);
    }
  };

  // 削除モーダルを閉じる
  const handleCancelDeleteCourse = () => {
    if (deleting) return;
    setDeletingCode(null);
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
          width: 'min(960px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* 上部ヘッダー：タイトル + ログイン中表示 + 個人設定 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>
              SAダッシュボード – 授業一覧
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: '#6b7280',
              }}
            >
              対応する授業を選択すると、スレッド一覧・チャット・呼び出し一覧が表示されます。
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {/* 「〇〇でログイン中」部分（/sa/dashboard と同じ見た目） */}
            <div
              style={{
                fontSize: 12,
                color: '#6b7280',
                whiteSpace: 'nowrap',
              }}
            >
              {saName} でログイン中
            </div>

            {/* 個人設定ボタン（スライドパネルを開く） */}
            <button
              type="button"
              onClick={openSettingsPanel}
              style={{
                borderRadius: 999,
                border: '1px solid #d1d5db',
                padding: '6px 10px',
                fontSize: 13,
                cursor: 'pointer',
                background: '#f9fafb',
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              <span>👤</span>
              <span
                style={{
                  fontSize: 11,
                  color: '#4b5563',
                }}
              >
                個人設定
              </span>
            </button>

            {/* 授業枠を作成ボタン（元のボタン） */}
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              style={{
                borderRadius: 999,
                border: 'none',
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: '#111827',
                color: '#fff',
                whiteSpace: 'nowrap',
              }}
            >
              授業枠を作成
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              fontSize: 12,
              color: '#b91c1c',
            }}
          >
            {error}
          </div>
        )}

        {/* 授業追加フォーム */}
        {showAddForm && (
          <div
            style={{
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
              新しい授業枠を作成
            </h2>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              学生にはセッションIDとセッションパスワードを配布します。
            </p>

            <form onSubmit={handleCreateCourse}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <div>
                  <label
                    htmlFor="code"
                    style={{
                      fontSize: 12,
                      display: 'block',
                      marginBottom: 4,
                      color: '#374151',
                    }}
                  >
                    セッションID（授業コード）
                  </label>
                  <input
                    id="code"
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="例：MUSIC-2-TUE"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="title"
                    style={{
                      fontSize: 12,
                      display: 'block',
                      marginBottom: 4,
                      color: '#374151',
                    }}
                  >
                    授業名
                  </label>
                  <input
                    id="title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例：音楽・音響処理"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="timeSlot"
                    style={{
                      fontSize: 12,
                      display: 'block',
                      marginBottom: 4,
                      color: '#374151',
                    }}
                  >
                    時限・曜日（任意）
                  </label>
                  <input
                    id="timeSlot"
                    type="text"
                    value={timeSlot}
                    onChange={(e) => setTimeSlot(e.target.value)}
                    placeholder="例：火曜2限"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="room"
                    style={{
                      fontSize: 12,
                      display: 'block',
                      marginBottom: 4,
                      color: '#374151',
                    }}
                  >
                    教室（任意）
                  </label>
                  <input
                    id="room"
                    type="text"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="例：C-302"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
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
                    id="password"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="例：8FQ92B"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    resetForm();
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
                  disabled={saving}
                  style={{
                    borderRadius: 999,
                    border: 'none',
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: '#111827',
                    color: '#fff',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? '作成中…' : '作成'}
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
              ※ 学生にはセッションIDとパスワードを配布してください。
            </div>
          </div>
        )}

        {/* 授業一覧カード */}
        <div
          style={{
            marginTop: 4,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 12,
          }}
        >
          {loadingCourses ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              授業を読み込み中です…
            </div>
          ) : courses.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              まだ授業枠がありません。「授業枠を作成」から新しい授業を追加してください。
            </div>
          ) : (
            courses.map((course) => (
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
                  {course.time_slot ?? '時間未設定'}
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
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleOpenCourse(course.code)}
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
                    この授業を開く
                  </button>

                  {/* 削除ボタン */}
                  <button
                    type="button"
                    onClick={() => handleClickDeleteCourse(course.code)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: '1px solid #fecaca',
                      fontSize: 11,
                      cursor: 'pointer',
                      background: '#fef2f2',
                      color: '#b91c1c',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 授業削除 確認モーダル */}
      {deletingCode && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancelDeleteCourse();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 30,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              padding: '20px 20px 16px',
              width: 380,
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 8,
                color: '#111827',
              }}
            >
              授業枠を削除しますか？
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#4b5563',
                marginBottom: 10,
                lineHeight: 1.5,
              }}
            >
              セッション{' '}
              <span style={{ fontWeight: 600 }}>{deletingCode}</span>{' '}
              を削除すると、
              <br />
              この授業に紐づくチャットメッセージ・呼び出し履歴・
              既読情報もすべて削除されます。
              <br />
              元に戻すことはできません。本当に削除してもよろしいですか？
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 10,
              }}
            >
              <button
                type="button"
                onClick={handleCancelDeleteCourse}
                disabled={deleting}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: 12,
                  cursor: deleting ? 'default' : 'pointer',
                  background: '#e5e7eb',
                  color: '#374151',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCourse}
                disabled={deleting}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: deleting ? 'default' : 'pointer',
                  background: '#b91c1c',
                  color: '#fff',
                }}
              >
                {deleting ? '削除中…' : '完全に削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 個人設定パネル（/sa/dashboard と同じ UI） */}
      {showSettingsPanel && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeSettingsPanel();
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.2)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 35,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 280,
              maxWidth: '80vw',
              height: '100%',
              background: '#ffffff',
              boxShadow: '-4px 0 16px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px 16px 12px',
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              個人設定
            </div>

            <label
              style={{
                fontSize: 12,
                fontWeight: 500,
                marginBottom: 4,
                display: 'block',
              }}
            >
              表示名（SA / 教員名）
            </label>
            <input
              type="text"
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="例: 本郷先生 / 佐藤SA など"
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                padding: '6px 8px',
                fontSize: 13,
                marginBottom: 10,
              }}
            />

            <button
              type="button"
              onClick={handleSaveDisplayName}
              disabled={savingProfile}
              style={{
                width: '100%',
                borderRadius: 999,
                border: 'none',
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: savingProfile ? 'default' : 'pointer',
                background: savingProfile ? '#9ca3af' : '#111827',
                color: '#ffffff',
                marginBottom: 16,
              }}
            >
              {savingProfile ? '保存中…' : '保存する'}
            </button>

            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                margin: '8px 0 8px',
              }}
            />

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              style={{
                width: '100%',
                borderRadius: 999,
                border: 'none',
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: loggingOut ? 'default' : 'pointer',
                background: 'transparent',
                color: '#ef4444',
                textAlign: 'left',
              }}
            >
              {loggingOut ? 'ログアウト中…' : 'ログアウトする'}
            </button>

            <button
              type="button"
              onClick={closeSettingsPanel}
              style={{
                marginTop: 'auto',
                alignSelf: 'flex-end',
                borderRadius: 999,
                border: 'none',
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: '#e5e7eb',
                color: '#374151',
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* トースト（/sa/dashboard と同じ感じ） */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#ffffff',
            padding: '6px 12px',
            borderRadius: 999,
            fontSize: 12,
            zIndex: 40,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
