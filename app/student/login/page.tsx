// app/student/login/page.tsx
'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function StudentLoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo:
          typeof window !== 'undefined'
            ? `${window.location.origin}/student`
            : undefined,
      },
    });

    setLoading(false);

    if (error) {
      setError('Googleログインに失敗しました。もう一度お試しください。');
    }
    // 成功時は Google → Supabase → redirectTo で /student に戻ってくる
  };

  return (
    <div
      style={{
        margin: 0,
        height: '100vh',
        background: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: '32px 32px 24px',
          borderRadius: 16,
          boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
          width: 380,
        }}
      >
        <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>SAチャット – 学生ログイン</h1>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: 13,
            color: '#df4006ff',
          }}
        >
          学生用のログイン画面です。
          <br></br>
          ログインすると授業チャットを利用できます。
        </p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            marginTop: 8,
            width: '100%',
            padding: '10px 0',
            borderRadius: 999,
            border: '1px solid #d1d5db',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            background: '#ffffff',
            color: '#374151',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '1px solid #d1d5db',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
            }}
          >
            G
          </span>
          <span>{loading ? 'リダイレクト中…' : 'Googleでログイン'}</span>
        </button>

        {error && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: '#b91c1c',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
