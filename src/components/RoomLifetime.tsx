import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { timeLabel } from '../lib/playback';

export function RoomLifetime({ expiresAt, now, onExpire }: { expiresAt: string; now: () => number; onExpire: () => void }) {
  const latest = useRef({ now, onExpire }); latest.current = { now, onExpire };
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((Date.parse(expiresAt) - now()) / 1000)));
  useEffect(() => {
    let expired = false;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - latest.current.now()) / 1000));
      setSeconds(remaining);
      if ((!Number.isFinite(remaining) || remaining <= 0) && !expired) { expired = true; latest.current.onExpire(); }
    };
    update(); const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update); window.addEventListener('focus', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); };
  }, [expiresAt]);
  return <div className={`room-lifetime ${seconds <= 300 ? 'ending' : ''}`}><Clock3 size={14}/><span>Room expires in <strong>{timeLabel(seconds)}</strong></span><span>Temporary room · 4-hour limit</span></div>;
}
