"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;

    void navigator.serviceWorker
      .register("/sw.js")
      .then((registered) => {
        registration = registered;
      })
      .catch(() => {
        // The app remains fully usable online if registration is unavailable.
      });

    /**
     * Installed to the home screen, this app can stay open for days. A worker
     * only looks for a new version when the page is loaded, so without this it
     * would go on serving whatever it cached the day it was installed. Coming
     * back to the app is the moment somebody is about to use it, and the
     * cheapest one to check.
     */
    const lookForUpdate = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void registration?.update().catch(() => {
        // Offline, or the check was refused: the app keeps working as it is.
      });
    };

    document.addEventListener("visibilitychange", lookForUpdate);

    return () => {
      document.removeEventListener("visibilitychange", lookForUpdate);
    };
  }, []);

  return null;
}
