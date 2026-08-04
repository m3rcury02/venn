"use client";

import { useEffect, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushToggle() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(async () => {
      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!isMounted) return;
      if (!supported) {
        setIsSupported(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (isMounted) {
        setIsSupported(true);
        setIsSubscribed(Boolean(sub));
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  if (isSupported === false) {
    return (
      <p className="t-body text-xs text-fg-faint">
        Web Push requires installing Venn to your home screen on iOS or using a browser with Push API support.
      </p>
    );
  }

  if (isSupported === null) {
    return null;
  }

  const handleToggle = () => {
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setError("Push notification key is not configured.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (isSubscribed) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await fetch("/api/push/subscribe", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            });
            await sub.unsubscribe();
          }
          setIsSubscribed(false);
        } else {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            setError("Notification permission was denied.");
            return;
          }

          const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey.buffer as ArrayBuffer,
          });

          const res = await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          });

          if (res.ok) {
            setIsSubscribed(true);
          } else {
            setError("Failed to save push subscription.");
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update push subscription.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 items-start">
      <button
        type="button"
        disabled={isPending}
        onClick={handleToggle}
        className={buttonClass(isSubscribed ? "ghost" : "marquee", "h-8 py-0 px-4 text-xs")}
      >
        {isPending
          ? "Updating..."
          : isSubscribed
            ? "Disable Push Notifications"
            : "Enable Push Notifications"}
      </button>
      {error ? <p className="t-body text-xs text-beam-a">{error}</p> : null}
    </div>
  );
}
