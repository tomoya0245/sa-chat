// app/student/[courseCode]/page.tsx
/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */
'use client';

import { useEffect, useMemo, useState, FormEvent, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Message = {
  id: string | number;
  created_at: string | null;
  course_code: string;
  client_token: string;
  role: 'student' | 'sa';
  body: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
};

type MyCourse = {
  code: string;
  title: string;
  time_slot: string | null;
  room: string | null;
};

type ThreadReadRow = {
  course_code: string;
  client_token: string;
  reader_role: string;
  last_read_at: string | null;
};

const STORAGE_KEY = 'sa-chat-student-courses';

const formatTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

export default function StudentCoursePage() {
  const params = useParams<{ courseCode: string }>();
  const courseCode = params.courseCode;
  const router = useRouter();

  // チャットエリアのスクロール用
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ★ Supabase Auth の student_user_id と、それから作る clientToken
  const [studentUserId, setStudentUserId] = useState<string | null>(null);
  const [clientToken, setClientToken] = useState<string | null>(null);
  const [, setAuthChecking] = useState(true);

  // /student 画面で保存している授業一覧（ローカル用）
  const [myCourses, setMyCourses] = useState<MyCourse[]>([]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);

  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  // 呼び出しモーダル関連
  const [showCallModal, setShowCallModal] = useState(false);
  const [seatNote, setSeatNote] = useState('');
  const [callSending, setCallSending] = useState(false);
  const [toast, setToast] = useState('');

  // SA がこの thread をどこまで読んだか
  const [saReadAt, setSaReadAt] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  };

  const addMessageIfNotExists = (newMsg: Message) => {
    setMessages((prev) => {
      const newId = String(newMsg.id);
      if (prev.some((m) => String(m.id) === newId)) return prev;
      return [...prev, newMsg];
    });
  };

  // ★ 1) Supabase Auth で学生がログインしているかチェック
  useEffect(() => {
    if (!courseCode) return;

    const run = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        // 未ログインなら学生ログイン画面へ
        router.push('/student/login');
        return;
      }

      const uid = data.user.id;
      setStudentUserId(uid);

      // ★ 同じ Google アカウント & 同じ授業なら、どの端末でも同じ clientToken になる
      const token = `${uid}:${courseCode}`;
      setClientToken(token);

      setAuthChecking(false);
    };

    void run();
  }, [courseCode, router]);

  // myCourses を localStorage から読み込み（クライアント限定）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as MyCourse[];
      setMyCourses(parsed);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // メッセージ初期ロード（授業ごと）
  useEffect(() => {
    if (!courseCode) return;

    const run = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('course_code', courseCode)
        .order('created_at', { ascending: true });

      if (error) {
        console.error(error);
        showToast('メッセージの取得に失敗しました');
      } else if (data) {
        setMessages(data as Message[]);
      }
      setLoading(false);
    };

    void run();
  }, [courseCode]);

  // Realtime: メッセージ購読（この授業のメッセージ）
  useEffect(() => {
    if (!courseCode) return;

    const channel = supabase
      .channel(`messages:student:${courseCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `course_code=eq.${courseCode}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          addMessageIfNotExists(newMsg);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [courseCode]);

  // 学生がメッセージ一覧を見たタイミングで「既読（student側）」を更新
  useEffect(() => {
    if (!courseCode || !clientToken) return;
    if (messages.length === 0) return;

    const latest = messages[messages.length - 1];
    if (!latest?.created_at) return;

    const lastReadAt = latest.created_at;

    supabase
      .from('thread_reads')
      .upsert(
        {
          course_code: courseCode,
          client_token: clientToken,
          reader_role: 'student',
          last_read_at: lastReadAt,
        },
        {
          onConflict: 'course_code,client_token,reader_role',
        }
      )
      .then(({ error }) => {
        if (error) {
          console.error('student read upsert error', error);
        }
      });
  }, [courseCode, clientToken, messages]);

  // SA 側の既読情報（sa がこの clientToken の thread をどこまで読んだか）を取得＋Realtime購読
  useEffect(() => {
    if (!courseCode || !clientToken) return;

    const fetchSaRead = async () => {
      const { data, error } = await supabase
        .from('thread_reads')
        .select('course_code, client_token, reader_role, last_read_at')
        .eq('course_code', courseCode)
        .eq('client_token', clientToken)
        .eq('reader_role', 'sa')
        .maybeSingle();

      if (!error && data) {
        setSaReadAt((data as ThreadReadRow).last_read_at);
      }
    };

    void fetchSaRead();

    const channel = supabase
      .channel(`thread_reads:student:${courseCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'thread_reads',
          filter: `course_code=eq.${courseCode}`,
        },
        (payload) => {
          const row = payload.new as ThreadReadRow;
          if (row.client_token === clientToken && row.reader_role === 'sa') {
            setSaReadAt(row.last_read_at);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'thread_reads',
          filter: `course_code=eq.${courseCode}`,
        },
        (payload) => {
          const row = payload.new as ThreadReadRow;
          if (row.client_token === clientToken && row.reader_role === 'sa') {
            setSaReadAt(row.last_read_at);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [courseCode, clientToken]);

  // 自分のメッセージにフラグを持たせた配列
  const messagesByOwn = useMemo(
    () =>
      messages.map((m) => ({
        ...m,
        isMe:
          !!clientToken &&
          m.client_token === clientToken &&
          m.role === 'student',
        isSa: m.role === 'sa',
      })),
    [messages, clientToken]
  );

  // 自動スクロール（初期表示 & 新規メッセージ時）
  useEffect(() => {
    if (loading) return;
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: 'auto' });
  }, [loading, messages.length, courseCode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    const hasFile = !!attachmentFile;

    if (!text && !hasFile) return;
    if (!courseCode || !clientToken || !studentUserId) {
      showToast('ログイン情報の取得に失敗しました。もう一度開き直してください。');
      return;
    }

    setInput('');

    let attachmentUrl: string | null = null;
    let attachmentType: string | null = null;
    let attachmentName: string | null = null;

    if (attachmentFile) {
      const file = attachmentFile;
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${courseCode}/${clientToken}/${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(path, file);

      if (uploadError || !uploadData) {
        console.error(uploadError);
        showToast(
          `ファイルのアップロードに失敗しました: ${
            uploadError?.message ?? ''
          }`
        );
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('attachments')
        .getPublicUrl(uploadData.path);

      attachmentUrl = publicUrlData.publicUrl;
      attachmentType = file.type || null;
      attachmentName = file.name;
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        course_code: courseCode,
        client_token: clientToken,
        role: 'student',
        body: text || (hasFile ? '' : ''),
        attachment_url: attachmentUrl,
        attachment_type: attachmentType,
        attachment_name: attachmentName,
        // ★ Supabase Auth の user.id を一緒に保存
        student_user_id: studentUserId,
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      showToast(`送信に失敗しました: ${error.message}`);
      return;
    }

    if (data) {
      addMessageIfNotExists(data as Message);
    }

    setAttachmentFile(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  };

  const handleCallSa = () => {
    setSeatNote('');
    setShowCallModal(true);
  };

  const confirmCall = async () => {
    if (!courseCode || !clientToken) return;
    setCallSending(true);

    const { error } = await supabase.from('calls').insert({
      course_code: courseCode,
      client_token: clientToken,
      seat_text: seatNote || null,
    });

    setCallSending(false);
    setShowCallModal(false);

    if (error) {
      console.error(error);
      showToast(`呼び出しに失敗しました: ${error.message}`);
    } else {
      showToast('SAに通知しました');
    }
  };

  const handleChangeCourse = (code: string) => {
    if (!code || code === courseCode) return;
    router.push(`/student/${code}`);
  };

  return (
    <div
      style={{
        margin: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#e5e7eb',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* ヘッダー */}
      <header
        style={{
          padding: '10px 16px',
          background: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            授業チャット
          </h1>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 11,
              color: '#9ca3af',
            }}
          >
            このチャットは完全匿名です。SAと先生のみが内容を確認します。
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.push('/student')}
          style={{
            borderRadius: 999,
            border: '1px solid #d1d5db',
            background: '#f9fafb',
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          授業一覧に戻る
        </button>
      </header>

      {/* メインレイアウト：左に授業バナー / 右にチャット */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          gap: 12,
          padding: 12,
          maxWidth: 1100,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
          minHeight: 0,
        }}
      >
        {/* 左：授業選択バナー */}
        <aside
          style={{
            background: '#fefce8',
            borderRadius: 16,
            boxShadow: '0 10px 25px rgba(0,0,0,0.06)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <h2
            style={{
              margin: '0 0 8px',
              fontSize: 13,
              fontWeight: 600,
              color: '#854d0e',
            }}
          >
            授業一覧
          </h2>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              color: '#a16207',
            }}
          >
            参加中の授業からチャットする授業を選択してください。
          </p>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              borderTop: '1px solid #facc15',
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            {myCourses.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                登録済みの授業がありません。
                <br />
                （ホーム画面から追加してください）
              </div>
            ) : (
              myCourses.map((c) => {
                const selected = c.code === courseCode;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleChangeCourse(c.code)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderRadius: 12,
                      padding: '6px 8px',
                      marginBottom: 6,
                      cursor: 'pointer',
                      background: selected ? '#f97316' : '#fff7ed',
                      color: selected ? '#ffffff' : '#7c2d12',
                      boxShadow: selected
                        ? '0 4px 10px rgba(249,115,22,0.35)'
                        : 'none',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        marginBottom: 2,
                      }}
                    >
                      {c.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        opacity: 0.8,
                      }}
                    >
                      {c.time_slot ?? '-'} / {c.room ?? '-'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 右：チャットシェル */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: '#f9fafb',
            borderRadius: 16,
            boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {/* 上：授業情報 */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              現在の授業: {courseCode}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#9ca3af',
              }}
            >
              質問は完全匿名で送信されます。SAと先生のみが内容を確認します。
            </div>
          </div>

          {/* メッセージエリア（ここだけスクロール） */}
          <div
            ref={messageListRef}
            style={{
              flex: 1,
              padding: 16,
              overflowY: 'auto',
              minHeight: 0,
            }}
          >
            {loading ? (
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                読み込み中…
              </div>
            ) : messagesByOwn.length === 0 ? (
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                まだメッセージはありません。質問があれば下の欄から送信してください。
              </div>
            ) : (
              <>
                {messagesByOwn.map((m) => {
                  const timeLabel = formatTime(m.created_at);

                  const showRead =
                    m.isMe &&
                    !!saReadAt &&
                    !!m.created_at &&
                    m.created_at <= saReadAt;

                  return (
                    <div
                      key={String(m.id)}
                      style={{
                        display: 'flex',
                        justifyContent: m.isMe ? 'flex-end' : 'flex-start',
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          alignSelf: m.isMe ? 'flex-end' : 'flex-start',
                        }}
                      >
                        {!m.isMe && (
                          <div
                            style={{
                              fontSize: 10,
                              color: '#6b7280',
                              marginBottom: 2,
                            }}
                          >
                            {m.isSa ? 'SA' : '学生'}
                          </div>
                        )}

                        {/* 吹き出し */}
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: 14,
                            fontSize: 13,
                            lineHeight: 1.4,
                            background: m.isMe ? '#3b82f6' : '#ffffff',
                            color: m.isMe ? '#ffffff' : '#111827',
                            border: m.isMe ? 'none' : '1px solid #e5e7eb',
                            display: 'block',
                            textAlign: 'left',
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                          }}
                        >
                          {m.body && <div>{m.body}</div>}

                          {m.attachment_url && (
                            <div style={{ marginTop: m.body ? 8 : 0 }}>
                              {m.attachment_type?.startsWith('image/') ? (
                                <img
                                  src={m.attachment_url}
                                  alt={m.attachment_name ?? '添付画像'}
                                  style={{
                                    maxWidth: '100%',
                                    borderRadius: 8,
                                    display: 'block',
                                  }}
                                />
                              ) : (
                                <a
                                  href={m.attachment_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: 12,
                                    textDecoration: 'underline',
                                  }}
                                >
                                  {m.attachment_name ?? '添付ファイルを開く'}
                                </a>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 吹き出しの下に 時間＋既読 */}
                        {(timeLabel || showRead) && (
                          <div
                            style={{
                              marginTop: 2,
                              display: 'flex',
                              justifyContent: m.isMe
                                ? 'flex-end'
                                : 'flex-start',
                              gap: 6,
                              fontSize: 10,
                              alignItems: 'center',
                            }}
                          >
                            {timeLabel && (
                              <span
                                style={{
                                  color: '#9ca3af',
                                }}
                              >
                                {timeLabel}
                              </span>
                            )}
                            {showRead && (
                              <span
                                style={{
                                  color: '#3b82f6',
                                  fontWeight: 600,
                                }}
                              >
                                既読
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* 一番下のダミー要素（ここまでスクロール） */}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* 下：SAを呼ぶ + 入力フォーム */}
          <div
            style={{
              borderTop: '1px solid #e5e7eb',
              background: '#ffffff',
              padding: '8px 10px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* SAを呼ぶボタン */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={handleCallSa}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 10px rgba(239,68,68,0.35)',
                }}
              >
                SAを呼ぶ
              </button>
            </div>

            {/* 入力フォーム */}
            <form
              onSubmit={handleSubmit}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="ここに質問を入力（匿名）"
                  style={{
                    flex: 1,
                    resize: 'none',
                    borderRadius: 12,
                    border: '1px solid #d1d5db',
                    padding: '8px 10px',
                    fontSize: 13,
                    height: 44,
                    outline: 'none',
                  }}
                />
                <input
                  ref={attachmentInputRef}
                  type="file"
                  onChange={(e) =>
                    setAttachmentFile(e.target.files?.[0] ?? null)
                  }
                  style={{
                    fontSize: 11,
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  minWidth: 80,
                  borderRadius: 999,
                  border: 'none',
                  background: '#111827',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '8px 16px',
                }}
              >
                送信
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 呼び出しモーダル */}
      {showCallModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.20)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => setShowCallModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              padding: '20px 20px 16px',
              width: 360,
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}
            >
              呼びますか？
            </div>
            <div
              style={{ fontSize: 13, color: '#4b5563', marginBottom: 12 }}
            >
              SAに通知します。可能であれば座席のおおよその位置を入力してください。
            </div>
            <label
              htmlFor="seat-note"
              style={{
                fontSize: 12,
                color: '#374151',
                display: 'block',
                marginBottom: 4,
              }}
            >
              座席の位置（任意）
            </label>
            <input
              id="seat-note"
              type="text"
              value={seatNote}
              onChange={(e) => setSeatNote(e.target.value)}
              placeholder="例：窓側 / 後ろの列の右あたり"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid ',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div
              style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}
            >
              ※ 自由記述です。ヒント程度で大丈夫です。
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 14,
              }}
            >
              <button
                type="button"
                onClick={() => setShowCallModal(false)}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  fontSize: 13,
                  padding: '6px 14px',
                  cursor: 'pointer',
                  background: '#e5e7eb',
                  color: '#374151',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmCall}
                disabled={callSending}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  fontSize: 13,
                  padding: '6px 14px',
                  cursor: 'pointer',
                  background: '#ef4444',
                  color: '#fff',
                  fontWeight: 600,
                  opacity: callSending ? 0.7 : 1,
                }}
              >
                {callSending ? '送信中…' : '呼ぶ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 999,
            fontSize: 12,
            zIndex: 20,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
