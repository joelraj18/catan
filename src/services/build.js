// Which build of the game this page is. The deploy stamps the commit; a
// local build says 'dev'. Rooms compare it, so a laptop still showing an
// older cached page is told to refresh rather than quietly missing features.
export const BUILD = (process.env.REACT_APP_BUILD || 'dev').slice(0, 12);

export const cleanBuild = (value) => (typeof value === 'string' ? value.replace(/[^\w.-]/g, '').slice(0, 12) : '');

// Seats whose page is a different build from the host's.
export const outdatedSeats = (lobby) =>
  (lobby?.seats || []).filter((seat) => seat.build && lobby.build && seat.build !== lobby.build);

// Reload past any cached copy of the page.
export const reloadFresh = () => {
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now().toString(36));
  window.location.replace(url.toString());
};
