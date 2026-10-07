import { useEffect, useState } from 'react';
import { BUILD, outdatedSeats, reloadFresh } from '../services/build';

// A slim banner when the people at a table are not all on the same build of
// the game: usually one laptop still showing an older cached page, which is
// why a feature can show on one screen and not another.
export default function VersionNotice({ session }) {
  const [lobby, setLobby] = useState(() => session?.lobby || null);
  useEffect(() => session?.on('lobby', (next) => setLobby({ ...next })), [session]);

  if (!lobby?.seats?.length) return null;
  // A host on a build from before versions were stamped sends none.
  const hostIsOld = !lobby.build && !session?.isHost;
  const mineIsOld = Boolean(lobby.build) && lobby.build !== BUILD;
  const old = outdatedSeats(lobby);
  if (!hostIsOld && !mineIsOld && !old.length) return null;

  return (
    <div className="version-notice" role="status">
      <span>
        {hostIsOld
          ? 'The host\u2019s page is an older version of the game. Ask them to refresh, then rejoin.'
          : mineIsOld
          ? 'This page is an older version than the host’s. Refresh to get the latest game.'
          : `${old.map((seat) => seat.name).join(' and ')} ${old.length > 1 ? 'are' : 'is'} on an older version of the game and should refresh.`}
      </span>
      {mineIsOld && (
        <button type="button" className="property-action-btn" onClick={reloadFresh}>
          Refresh
        </button>
      )}
    </div>
  );
}
