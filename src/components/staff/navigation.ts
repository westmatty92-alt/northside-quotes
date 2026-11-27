// Full-page navigation, in one place so tests can stand in for it (jsdom cannot navigate). Used where a hard load is
// the point: after sign-out or an ended session the page must start again with no cached private data in memory.
export function navigateTo(url: string): void {
  window.location.assign(url);
}
