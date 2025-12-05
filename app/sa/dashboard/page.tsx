/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */
'use client';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react'; 
import { FormEvent, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Course = {
  code: string;
  title: string;
  time_slot: string | null;
  room: string | null;
};

type Message = {
  id: string | number;
  created_at: string | null;
  course_code: string;
  client_token: string;
  student_user_id: string | null;
  role: 'student' | 'sa';
  body: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
};

type Call = {
  id: string | number;
  created_at: string | null;
  course_code: string;
  client_token: string;
  student_user_id: string | null;
  seat_text: string | null;
  handled_at: string | null;
};

type CallGroup = {
  clientToken: string;
  latestCreatedAt: string | null;
  seatNotes: string[];
  count: number;
};

type StudentReadRow = {
  course_code: string;
  client_token: string;
  last_read_at: string | null;
};

type ThreadReadRealtimeRow = {
  course_code: string;
  client_token: string;
  reader_role: string;
  last_read_at: string | null;
};


type ThreadLock = {
  course_code: string;
  client_token: string;
  sa_user_id: string;
  sa_name: string | null;
  locked_at: string | null;
};

function SaDashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialCourseCode = searchParams.get('course');
  const [currentCourseCode, setCurrentCourseCode] = useState<string | null>(
    initialCourseCode
  );

  const [course, setCourse] = useState<Course | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const [threads, setThreads] = useState<string[]>([]);
  const [selectedThreadToken, setSelectedThreadToken] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [replyText, setReplyText] = useState('');
  const [replyAttachmentFile, setReplyAttachmentFile] = useState<File | null>(
    null
  );
  const replyFileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  // メッセージが変わるたびに一番下までスクロール
  useEffect(() => {
    if (!messageListRef.current) return;
    const el = messageListRef.current;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  // 学生側の既読時刻（このスレッドで学生が最後に見た時刻）
  const [selectedStudentReadAt, setSelectedStudentReadAt] = useState<
    string | null
  >(null);

  // SA自身の情報
  const [saUserId, setSaUserId] = useState<string | null>(null);
  const [saName, setSaName] = useState<string>('SA');

  // スレッドロック情報（client_token -> lock row）
  const [threadLocks, setThreadLocks] = useState<
    Record<string, ThreadLock | null>
  >({});
  const [takingLock, setTakingLock] = useState(false);

  // 「呼び出し対応済み」確認モーダル
  const [confirmClientToken, setConfirmClientToken] = useState<string | null>(
    null
  );
  const [confirming, setConfirming] = useState(false);

  // 匿名番号: client_token -> 匿名番号 (1,2,3,...)
  const [aliasMap, setAliasMap] = useState<Record<string, number>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ログインチェック & courseクエリが無ければ /sa へ
  useEffect(() => {
    const run = async () => {
      const { data: auth, error } = await supabase.auth.getUser();
      if (error || !auth.user) {
        router.push('/sa/login');
        return;
      }

      // 自分のid / 名前を保存
      setSaUserId(auth.user.id);
      const fullName =
        (auth.user.user_metadata &&
          (auth.user.user_metadata.full_name as string | undefined)) ||
        auth.user.email ||
        'SA';
      setSaName(fullName);

      if (!initialCourseCode) {
        router.push('/sa');
        return;
      }

      setCurrentCourseCode(initialCourseCode);
    };

    void run();
  }, [router, initialCourseCode]);

  // 授業情報・メッセージ・呼び出しの初期取得
  useEffect(() => {
    if (!currentCourseCode) return;

    const run = async () => {
      setLoading(true);

      // 授業情報
      const { data: courseData, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('code', currentCourseCode)
        .maybeSingle();

      if (!courseError && courseData) {
        setCourse(courseData as Course);
      }

      // メッセージ全件
      const { data: msgData, error: msgError } = await supabase
        .from('messages')
        .select('*')
        .eq('course_code', currentCourseCode)
        .order('created_at', { ascending: true });

      if (msgError) {
        console.error(msgError);
        showToast('メッセージの取得に失敗しました');
      } else if (msgData) {
        const ms = msgData as Message[];
        setMessages(ms);
        const threadTokens = Array.from(
          new Set(ms.map((m) => m.client_token))
        );
        setThreads(threadTokens);
        if (!selectedThreadToken && threadTokens.length > 0) {
          setSelectedThreadToken(threadTokens[0]);
        }
      }

      // 呼び出し（未対応のみ）
      const { data: callData, error: callError } = await supabase
        .from('calls')
        .select('*')
        .eq('course_code', currentCourseCode)
        .is('handled_at', null)
        .order('created_at', { ascending: true });

      if (callError) {
        console.error(callError);
        showToast('呼び出し一覧の取得に失敗しました');
      } else if (callData) {
        setCalls(callData as Call[]);
      }

      setLoading(false);
    };

    void run();
  }, [currentCourseCode, selectedThreadToken]);

  // Realtime: メッセージ
  useEffect(() => {
    if (!currentCourseCode) return;

    const channel = supabase
      .channel(`sa-messages:${currentCourseCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `course_code=eq.${currentCourseCode}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            const newId = String(newMsg.id);
            if (prev.some((m) => String(m.id) === newId)) return prev;
            return [...prev, newMsg];
          });

          setThreads((prev) => {
            if (prev.includes(newMsg.client_token)) return prev;
            return [...prev, newMsg.client_token];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentCourseCode]);

  // Realtime: 呼び出し（INSERT & UPDATE）
  useEffect(() => {
    if (!currentCourseCode) return;

    const channel = supabase
      .channel(`sa-calls:${currentCourseCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `course_code=eq.${currentCourseCode}`,
        },
        (payload) => {
          const newCall = payload.new as Call;
          if (newCall.handled_at === null) {
            setCalls((prev) => {
              const newId = String(newCall.id);
              if (prev.some((c) => String(c.id) === newId)) return prev;
              return [...prev, newCall];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `course_code=eq.${currentCourseCode}`,
        },
        (payload) => {
          const updated = payload.new as Call;
          setCalls((prev) =>
            prev
              .map((c) => (String(c.id) === String(updated.id) ? updated : c))
              .filter((c) => c.handled_at === null)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentCourseCode]);

  // thread_locks を取得 & Realtime購読
  useEffect(() => {
    if (!currentCourseCode) return;

    const fetchLocks = async () => {
      const { data, error } = await supabase
        .from('thread_locks')
        .select('course_code, client_token, sa_user_id, sa_name, locked_at')
        .eq('course_code', currentCourseCode);

      if (error) {
        console.error('thread_locks fetch error', error);
        return;
      }

      const map: Record<string, ThreadLock | null> = {};
      for (const row of data as ThreadLock[]) {
        map[row.client_token] = row;
      }
      setThreadLocks(map);
    };

    void fetchLocks();

    const channel = supabase
      .channel(`thread_locks:${currentCourseCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'thread_locks',
          filter: `course_code=eq.${currentCourseCode}`,
        },
        (payload) => {
          const row = payload.new as ThreadLock;
          setThreadLocks((prev) => ({
            ...prev,
            [row.client_token]: row,
          }));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'thread_locks',
          filter: `course_code=eq.${currentCourseCode}`,
        },
        (payload) => {
          const row = payload.new as ThreadLock;
          setThreadLocks((prev) => ({
            ...prev,
            [row.client_token]: row,
          }));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'thread_locks',
          filter: `course_code=eq.${currentCourseCode}`,
        },
        (payload) => {
          const row = payload.old as ThreadLock;
          setThreadLocks((prev) => ({
            ...prev,
            [row.client_token]: null,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentCourseCode]);

  // 学生側の既読時刻を「最初に一度だけ」読み込む
useEffect(() => {
  if (!currentCourseCode || !selectedThreadToken) {
    setSelectedStudentReadAt(null);
    return;
  }

  const run = async () => {
    const { data, error } = await supabase
      .from('thread_reads')
      .select('last_read_at')
      .eq('course_code', currentCourseCode)
      .eq('client_token', selectedThreadToken)
      .eq('reader_role', 'student')
      .maybeSingle<StudentReadRow>();

    if (error || !data) {
      setSelectedStudentReadAt(null);
      return;
    }
    setSelectedStudentReadAt(data.last_read_at);
  };

  void run();
}, [currentCourseCode, selectedThreadToken]);


// 学生側の既読（thread_reads）の変更を Realtime で受け取る
useEffect(() => {
  if (!currentCourseCode) return;

  const channel = supabase
    .channel(`sa-thread-reads:${currentCourseCode}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'thread_reads',
        filter: `course_code=eq.${currentCourseCode}`,
      },
      (payload) => {
        const row = payload.new as ThreadReadRealtimeRow;
        // 今見ているスレッド & 学生側の既読だけ反映
        if (
          row.reader_role === 'student' &&
          row.client_token === selectedThreadToken
        ) {
          setSelectedStudentReadAt(row.last_read_at);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'thread_reads',
        filter: `course_code=eq.${currentCourseCode}`,
      },
      (payload) => {
        const row = payload.new as ThreadReadRealtimeRow;
        if (
          row.reader_role === 'student' &&
          row.client_token === selectedThreadToken
        ) {
          setSelectedStudentReadAt(row.last_read_at);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [currentCourseCode, selectedThreadToken]);




  // SA がこのスレッドを開いた → 生徒側の既読に反映
  useEffect(() => {
    if (!currentCourseCode || !selectedThreadToken) return;

    const run = async () => {
      const now = new Date().toISOString();

      try {
        await supabase.from('thread_reads').upsert(
          {
            course_code: currentCourseCode,
            client_token: selectedThreadToken,
            reader_role: 'sa',
            last_read_at: now,
          },
          {
            onConflict: 'course_code,client_token,reader_role',
          }
        );
      } catch (e) {
        console.error(e);
      }
    };

    void run();
  }, [currentCourseCode, selectedThreadToken]);

  // 選択中スレッドのメッセージだけ
  const selectedMessages = useMemo(() => {
    if (!selectedThreadToken) return [];
    return messages.filter((m) => m.client_token === selectedThreadToken);
  }, [messages, selectedThreadToken]);

  // スレッド切替 or メッセージ変化でスクロール
  useEffect(() => {
    if (!messageListRef.current) return;
    const el = messageListRef.current;
    el.scrollTop = el.scrollHeight;
  }, [selectedThreadToken, selectedMessages.length]);

  // 選択中スレッドのロック情報
  const selectedLock = selectedThreadToken
    ? threadLocks[selectedThreadToken] ?? null
    : null;

  const isLockedByMe =
    !!selectedLock &&
    saUserId != null &&
    selectedLock.sa_user_id === saUserId;

  // このスレッドの回答担当になる（ロックを取る）
  const handleTakeLock = async () => {
    if (!currentCourseCode || !selectedThreadToken || !saUserId) {
      showToast('スレッドが選択されていません');
      return;
    }

    if (takingLock) return;
    setTakingLock(true);

    const existing = threadLocks[selectedThreadToken];

    // すでに自分が担当なら何もしない
    if (existing && existing.sa_user_id === saUserId) {
      setTakingLock(false);
      return;
    }

    // 他のSAが担当している場合は弾く
    if (existing && existing.sa_user_id !== saUserId) {
      showToast(`${existing.sa_name ?? '他のSA'} がこのスレッドを対応中です`);
      setTakingLock(false);
      return;
    }

    // ロックを取得（または自分に更新）
    const { data, error } = await supabase
      .from('thread_locks')
      .upsert(
        {
          course_code: currentCourseCode,
          client_token: selectedThreadToken,
          sa_user_id: saUserId,
          sa_name: saName,
        },
        {
          onConflict: 'course_code,client_token',
        }
      )
      .select('course_code, client_token, sa_user_id, sa_name, locked_at')
      .single<ThreadLock>();

    setTakingLock(false);

    if (error) {
      console.error('take lock error', error);
      showToast('別のSAが先に担当になりました');
      return;
    }

    if (data) {
      setThreadLocks((prev) => ({
        ...prev,
        [data.client_token]: data,
      }));
      setSelectedThreadToken(data.client_token);
    }
  };

  // このスレッドの担当を解除する
  const handleReleaseLock = async () => {
    if (!currentCourseCode || !selectedThreadToken || !saUserId) {
      showToast('スレッドが選択されていません');
      return;
    }

    const existing = threadLocks[selectedThreadToken];
    if (!existing) {
      // もうロックがない
      return;
    }
    if (existing.sa_user_id !== saUserId) {
      showToast('あなたはこのスレッドの担当ではありません');
      return;
    }

    const { error } = await supabase
      .from('thread_locks')
      .delete()
      .eq('course_code', currentCourseCode)
      .eq('client_token', selectedThreadToken)
      .eq('sa_user_id', saUserId);

    if (error) {
      console.error('release lock error', error);
      showToast('担当解除に失敗しました');
      return;
    }

    setThreadLocks((prev) => ({
      ...prev,
      [selectedThreadToken]: null,
    }));
    showToast('担当を解除しました');
  };

  // 呼び出しを client_token ごとにまとめる
  const callGroups: CallGroup[] = useMemo(() => {
    const map = new Map<string, CallGroup>();

    for (const c of calls) {
      const key = c.client_token;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          clientToken: key,
          latestCreatedAt: c.created_at,
          seatNotes: c.seat_text ? [c.seat_text] : [],
          count: 1,
        });
      } else {
        existing.count += 1;
        if (
          c.created_at &&
          (!existing.latestCreatedAt ||
            c.created_at > existing.latestCreatedAt)
        ) {
          existing.latestCreatedAt = c.created_at;
        }
        if (c.seat_text && !existing.seatNotes.includes(c.seat_text)) {
          existing.seatNotes.push(c.seat_text);
        }
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      (b.latestCreatedAt ?? '').localeCompare(a.latestCreatedAt ?? '')
    );
  }, [calls]);

  // ◆ 匿名番号（匿名1, 匿名2, ...）を course ごと & client_token ごとに振る
  useEffect(() => {
    if (!currentCourseCode) return;

    // この授業で「番号を振りたい client_token」を集める
    const targetTokens = new Set<string>();

    for (const t of threads) {
      targetTokens.add(t);
    }
    for (const c of calls) {
      targetTokens.add(c.client_token);
    }

    if (targetTokens.size === 0) return;

    const run = async () => {
      // すでに付いている alias を読み込み
      const { data, error } = await supabase
        .from('student_aliases')
        .select('client_token, alias_number')
        .eq('course_code', currentCourseCode);

      if (error) {
        console.error('student_aliases fetch error', error);
        return;
      }

      const map: Record<string, number> = {};
      let max = 0;

      for (const row of (data ?? []) as {
        client_token: string;
        alias_number: number;
      }[]) {
        map[row.client_token] = row.alias_number;
        if (row.alias_number > max) max = row.alias_number;
      }

      // alias がまだ無い client_token にだけ新しい番号を振る
      const inserts: {
        course_code: string;
        client_token: string;
        alias_number: number;
      }[] = [];

      targetTokens.forEach((token) => {
        if (!map[token]) {
          max += 1;
          map[token] = max;
          inserts.push({
            course_code: currentCourseCode,
            client_token: token,
            alias_number: max,
          });
        }
      });

      // 新しい alias をまとめて挿入
      if (inserts.length > 0) {
        const { error: insertError } = await supabase
          .from('student_aliases')
          .insert(inserts);

        if (insertError) {
          console.error('student_aliases insert error', insertError);
        }
      }

      setAliasMap(map);
    };

    void run();
  }, [currentCourseCode, threads, calls]);

  const handleSendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentCourseCode || !selectedThreadToken) {
      showToast('返信するスレッドを選択してください');
      return;
    }

    // ロック確認：自分が担当でない場合は送信不可
    if (selectedLock && !isLockedByMe) {
      showToast(
        `${selectedLock.sa_name ?? '他のSA'} がこのスレッドを対応中です`
      );
      return;
    }

    const text = replyText.trim();
    const hasFile = !!replyAttachmentFile;

    // テキストもファイルも無ければ何もしない
    if (!text && !hasFile) return;

    setReplyText('');

    let attachmentUrl: string | null = null;
    let attachmentType: string | null = null;
    let attachmentName: string | null = null;

    // 添付ファイルがあれば先にアップロード
    if (replyAttachmentFile) {
      const file = replyAttachmentFile;
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${currentCourseCode}/${selectedThreadToken}/${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(path, file);

      if (uploadError || !uploadData) {
        console.error(uploadError);
        showToast('ファイルのアップロードに失敗しました');
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('attachments')
        .getPublicUrl(uploadData.path);

      attachmentUrl = publicUrlData.publicUrl;
      attachmentType = file.type || null;
      attachmentName = file.name;
    }

    // どの学生か紐づける（従来どおり）
    let studentUserId: string | null = null;

    const { data: baseMessage, error: findError } = await supabase
      .from('messages')
      .select('student_user_id')
      .eq('course_code', currentCourseCode)
      .eq('client_token', selectedThreadToken)
      .eq('role', 'student')
      .not('student_user_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!findError && baseMessage && baseMessage.student_user_id) {
      studentUserId = baseMessage.student_user_id as string;
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        course_code: currentCourseCode,
        client_token: selectedThreadToken,
        student_user_id: studentUserId,
        role: 'sa',
        body: text || (hasFile ? '' : ''),
        attachment_url: attachmentUrl,
        attachment_type: attachmentType,
        attachment_name: attachmentName,
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      showToast('送信に失敗しました');
      return;
    }

    if (data) {
      setMessages((prev) => [...prev, data as Message]);
    }

    // フォームのファイルをクリア
    setReplyAttachmentFile(null);
    if (replyFileInputRef.current) {
      replyFileInputRef.current.value = '';
    }
  };

  // 呼び出し「対応済み」クリック → 確認モーダル
  const handleClickMarkDone = (clientToken: string) => {
    setConfirmClientToken(clientToken);
  };

  // モーダルで「対応済みにする」を確定
  const handleConfirmMarkDone = async () => {
    if (!currentCourseCode || !confirmClientToken) return;

    setConfirming(true);
    const { error } = await supabase
      .from('calls')
      .update({ handled_at: new Date().toISOString() })
      .eq('course_code', currentCourseCode)
      .eq('client_token', confirmClientToken)
      .is('handled_at', null);

    setConfirming(false);

    if (error) {
      console.error(error);
      showToast('更新に失敗しました');
      return;
    }

    setCalls((prev) =>
      prev.filter(
        (c) =>
          !(
            c.course_code === currentCourseCode &&
            c.client_token === confirmClientToken &&
            c.handled_at === null
          )
      )
    );
    setConfirmClientToken(null);
    showToast('呼び出しを対応済みにしました');
  };

  const handleCancelConfirm = () => {
    if (confirming) return;
    setConfirmClientToken(null);
  };

  const handleBackToCourses = () => {
    router.push('/sa');
  };

  const headerTitle =
    course?.title && course?.time_slot
      ? `${course.title} / ${course.time_slot}`
      : course?.title ?? '授業チャット';

  const headerMeta = course?.room ? `教室 ${course.room}` : '教室情報なし';

  return (
    <div
      style={{
        margin: 0,
        height: '100vh',
        background: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
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
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {headerTitle}
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#6b7280',
            }}
          >
            {headerMeta}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: '#9ca3af',
            }}
          >
            左：スレッド一覧 / 中：チャット / 右：呼び出し一覧
          </div>
        </div>

        <button
          type="button"
          onClick={handleBackToCourses}
          style={{
            borderRadius: 999,
            border: 'none',
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
            background: '#e5e7eb',
            color: '#374151',
            whiteSpace: 'nowrap',
          }}
        >
          授業一覧に戻る
        </button>
      </header>

      {/* 本体 */}
      <div
        style={{
          flex: 1,
          maxWidth: 1200,
          margin: '10px auto',
          width: '100%',
          padding: '0 8px',
          boxSizing: 'border-box',
          minHeight: 0,
        }}
      >
        <div
          style={{
            height: '100%',
            background: '#f3f4f6',
            borderRadius: 16,
            boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
            display: 'grid',
            gridTemplateColumns: '260px minmax(0, 1fr) 260px',
            gap: 0,
            overflow: 'hidden',
          }}
        >
          {/* スレッド一覧 */}
          <div
            style={{
              borderRight: '1px solid #e5e7eb',
              background: '#f9fafb',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #e5e7eb',
                fontSize: 13,
                fontWeight: 600,
                background: '#f3f4f6',
              }}
            >
              スレッド一覧
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 8,
              }}
            >
              {threads.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: '#6b7280',
                  }}
                >
                  まだメッセージがありません。
                </div>
              ) : (
                threads.map((token) => {
                  const lastMessage = messages
                    .filter((m) => m.client_token === token)
                    .slice(-1)[0];

                  const isSelected = selectedThreadToken === token;

                  const lock = threadLocks[token] ?? null;
                  const lockLabel =
                    lock && lock.sa_name
                      ? `${lock.sa_name} が回答中`
                      : lock
                      ? '他のSAが回答中'
                      : '';

                  const aliasNumber = aliasMap[token];
                  const displayName = aliasNumber
                    ? `匿名${aliasNumber}`
                    : '匿名さん';

                  return (
                    <button
                      key={token}
                      type="button"
                      onClick={() => setSelectedThreadToken(token)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        borderRadius: 10,
                        border: 'none',
                        padding: '8px 8px',
                        marginBottom: 6,
                        cursor: 'pointer',
                        background: isSelected ? '#111827' : '#ffffff',
                        color: isSelected ? '#f9fafb' : '#111827',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          marginBottom: 2,
                        }}
                      >
                        {displayName}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: isSelected ? '#e5e7eb' : '#6b7280',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {lastMessage
                          ? lastMessage.body ||
                            (lastMessage.attachment_name ?? '（ファイル添付）')
                          : 'まだメッセージはありません'}
                      </div>
                      {lockLabel && (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 10,
                            color: isSelected ? '#93c5fd' : '#3b82f6',
                          }}
                        >
                          {lockLabel}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* チャットエリア */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#f9fafb',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid',
                fontSize: 13,
                fontWeight: 600,
                background: '#ffffff',
              }}
            >
              チャット
            </div>

            {/* ロック表示＆担当ボタン */}
            {selectedThreadToken && (
              <div
                style={{
                  padding: '4px 10px',
                  borderBottom: '1px solid #e5e7eb',
                  fontSize: 11,
                  background: '#f9fafb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: '#6b7280',
                }}
              >
                <span>
                  {!selectedLock
                    ? 'まだ担当者はいません'
                    : isLockedByMe
                    ? 'あなたがこのスレッドを対応中です'
                    : `${selectedLock.sa_name ?? '他のSA'} が回答中です`}
                </span>

                <div style={{ display: 'flex', gap: 6 }}>
                  {/* 担当するボタン（担当者がいないときだけ） */}
                  {!selectedLock && (
                    <button
                      type="button"
                      onClick={handleTakeLock}
                      style={{
                        borderRadius: 999,
                        border: 'none',
                        padding: '4px 10px',
                        fontSize: 11,
                        cursor: 'pointer',
                        background: '#111827',
                        color: '#f9fafb',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      このスレッドを担当する
                    </button>
                  )}

                  {/* 担当解除ボタン（自分が担当のときだけ） */}
                  {isLockedByMe && (
                    <button
                      type="button"
                      onClick={handleReleaseLock}
                      style={{
                        borderRadius: 999,
                        border: 'none',
                        padding: '4px 10px',
                        fontSize: 11,
                        cursor: 'pointer',
                        background: '#e5e7eb',
                        color: '#374151',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      担当を解除する
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* メッセージリスト */}
            <div
              ref={messageListRef}
              style={{
                flex: 1,
                padding: 12,
                overflowY: 'auto',
                minHeight: 0,
              }}
            >
              {loading && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#6b7280',
                    marginBottom: 8,
                  }}
                >
                  読み込み中…
                </div>
              )}
              {!selectedThreadToken ? (
                <div
                  style={{
                    fontSize: 13,
                    color: '#6b7280',
                  }}
                >
                  左のスレッド一覧から学生を選択してください。
                </div>
              ) : selectedMessages.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: '#6b7280',
                  }}
                >
                  このスレッドにはまだメッセージがありません。
                </div>
              ) : (
                selectedMessages.map((m) => {
                  const mine = m.role === 'sa';
                  const timeLabel = formatTime(m.created_at);
                  const showRead =
                    mine &&
                    !!selectedStudentReadAt &&
                    !!m.created_at &&
                    m.created_at <= selectedStudentReadAt;

                  return (
                    <div
                      key={String(m.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: mine ? 'flex-end' : 'flex-start',
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: 360,
                          alignSelf: mine ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            color: '#6b7280',
                            marginBottom: 2,
                          }}
                        >
                          {mine ? 'SA / 教員' : '学生（匿名）'}
                        </div>
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: 14,
                            fontSize: 13,
                            lineHeight: 1.4,
                            background: mine ? '#111827' : '#ffffff',
                            color: mine ? '#f9fafb' : '#111827',
                            border: mine ? 'none' : '1px solid #e5e7eb',
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                            textAlign: 'left',
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
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 10,
                          color: '#9ca3af',
                          textAlign: mine ? 'right' : 'left',
                          maxWidth: 360,
                        }}
                      >
                        {timeLabel}
                        {showRead && (
                          <span
                            style={{
                              marginLeft: 6,
                              color: '#3b82f6',
                            }}
                          >
                            既読
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 返信フォーム */}
            <form
              onSubmit={handleSendReply}
              style={{
                borderTop: '1px solid #e5e7eb',
                padding: '8px 10px',
                background: '#ffffff',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
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
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={
                    !selectedThreadToken
                      ? 'スレッドを選択してください'
                      : selectedLock && !isLockedByMe
                      ? `${selectedLock.sa_name ?? '他のSA'} が回答中のため、編集できません`
                      : 'ここに返信内容を入力'
                  }
                  disabled={
                    !selectedThreadToken ||
                    (selectedLock != null && !isLockedByMe)
                  }
                  style={{
                    flex: 1,
                    resize: 'none',
                    borderRadius: 12,
                    border: '1px solid #d1d5db',
                    padding: '8px 10px',
                    fontSize: 13,
                    height: 48,
                    outline: 'none',
                    background:
                      !selectedThreadToken ||
                      (selectedLock != null && !isLockedByMe)
                        ? '#f3f4f6'
                        : '#ffffff',
                  }}
                />
                <input
                  ref={replyFileInputRef}
                  type="file"
                  onChange={(e) =>
                    setReplyAttachmentFile(e.target.files?.[0] ?? null)
                  }
                  disabled={
                    !selectedThreadToken ||
                    (selectedLock != null && !isLockedByMe)
                  }
                  style={{
                    fontSize: 11,
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={
                  !selectedThreadToken ||
                  (replyText.trim() === '' && !replyAttachmentFile) ||
                  (selectedLock != null && !isLockedByMe)
                }
                style={{
                  minWidth: 80,
                  borderRadius: 999,
                  border: 'none',
                  background:
                    !selectedThreadToken ||
                    (replyText.trim() === '' && !replyAttachmentFile) ||
                    (selectedLock != null && !isLockedByMe)
                      ? '#9ca3af'
                      : '#111827',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    !selectedThreadToken ||
                    (replyText.trim() === '' && !replyAttachmentFile) ||
                    (selectedLock != null && !isLockedByMe)
                      ? 'default'
                      : 'pointer',
                  padding: '0 16px',
                }}
              >
                送信
              </button>
            </form>
          </div>

          {/* 呼び出し一覧 */}
          <div
            style={{
              borderLeft: '1px solid #e5e7eb',
              background: '#fef2f2',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #fecaca',
                fontSize: 13,
                fontWeight: 600,
                background: '#fee2e2',
                color: '#7f1d1d',
              }}
            >
              呼び出し一覧
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 8,
              }}
            >
              {callGroups.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: '#b91c1c',
                  }}
                >
                  現在、未対応の呼び出しはありません。
                </div>
              ) : (
                callGroups.map((g) => {
                  const aliasNumber = aliasMap[g.clientToken];
                  const displayName = aliasNumber
                    ? `匿名${aliasNumber}`
                    : '匿名さん';

                  return (
                    <div
                      key={g.clientToken}
                      style={{
                        borderRadius: 10,
                        border: '1px solid #fecaca',
                        background: '#fff',
                        padding: '8px 10px',
                        marginBottom: 8,
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#7f1d1d',
                          marginBottom: 2,
                        }}
                      >
                        {displayName}（呼び出し {g.count} 件）
                      </div>
                      {g.seatNotes.length > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#9f1239',
                            marginBottom: 4,
                          }}
                        >
                          座席メモ: {g.seatNotes.join(' / ')}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleClickMarkDone(g.clientToken)}
                        style={{
                          marginTop: 4,
                          borderRadius: 999,
                          border: 'none',
                          padding: '4px 10px',
                          fontSize: 11,
                          cursor: 'pointer',
                          background: '#b91c1c',
                          color: '#fff',
                          fontWeight: 600,
                        }}
                      >
                        対応済みにする
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 呼び出し対応確認モーダル */}
      {confirmClientToken && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancelConfirm();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.2)',
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
              width: 360,
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              呼び出しを対応済みにしますか？
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#4b5563',
                marginBottom: 10,
              }}
            >
              この学生からの未対応の呼び出しをすべて「対応済み」にします。
              <br />
              よろしければ「対応済みにする」を押してください。
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
                onClick={handleCancelConfirm}
                disabled={confirming}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: 12,
                  cursor: confirming ? 'default' : 'pointer',
                  background: '#e5e7eb',
                  color: '#374151',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmMarkDone}
                disabled={confirming}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: confirming ? 'default' : 'pointer',
                  background: '#b91c1c',
                  color: '#fff',
                }}
              >
                {confirming ? '更新中…' : '対応済みにする'}
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
export default function SaDashboardPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            margin: 0,
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              fontSize: 13,
              color: '#6b7280',
            }}
          >
            ダッシュボードを読み込み中…
          </div>
        </div>
      }
    >
      <SaDashboardInner />
    </Suspense>
  );
}
