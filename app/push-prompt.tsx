'use client';

import { useEffect, useState } from 'react';
import { savePushSubscription } from './actions';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushPrompt() {
  const [state, setState] = useState<'unsupported' | 'prompt' | 'subscribed' | 'denied'>(
    'unsupported'
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'subscribed' : 'prompt');
    });
  }, []);

  const subscribe = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'prompt');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });
      await savePushSubscription(sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      });
      setState('subscribed');
    } catch {
      // Leave as prompt; user can retry
    }
  };

  if (state !== 'prompt') return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
      <span className="text-blue-900 dark:text-blue-200">
        Get alerts for urgent school items
      </span>
      <button
        onClick={subscribe}
        className="shrink-0 rounded-full bg-blue-600 px-3 py-1.5 font-medium text-white"
      >
        Enable
      </button>
    </div>
  );
}
