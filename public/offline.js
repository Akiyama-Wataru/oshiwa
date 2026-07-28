const heading = document.getElementById("offline-heading");
const detail = document.getElementById("offline-detail");

/**
 * This page stands in for any navigation that failed, which happens both when
 * the device has no connection and when the app itself could not be reached.
 * Telling somebody they are offline while their connection is fine sends them
 * to check their wifi when nothing is wrong with it, so the two are named
 * apart.
 */
const MESSAGES = {
  offline: {
    heading: "いまはオフラインです",
    detail: "接続が戻ったら、もう一度ためしてください。",
  },
  unreachable: {
    heading: "推し輪に接続できませんでした",
    detail: "通信はつながっています。時間をおいて、もう一度ためしてください。",
  },
};

function render() {
  const message =
    navigator.onLine === false ? MESSAGES.offline : MESSAGES.unreachable;

  if (heading) {
    heading.textContent = message.heading;
  }

  if (detail) {
    detail.textContent = message.detail;
  }

  document.title = `${message.heading} | 推し輪`;
}

render();

// The page stays open while somebody walks back into signal, and a message
// that no longer matches what they can see is worse than no message.
window.addEventListener("online", render);
window.addEventListener("offline", render);

document.getElementById("retry")?.addEventListener("click", () => {
  window.location.reload();
});
