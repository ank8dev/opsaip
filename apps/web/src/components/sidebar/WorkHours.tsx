import { clockFor, pad2 } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { Face } from '../common/Face';

const DAY = 1440; // minutes

/** Everyone's working window on one 24-hour scale, shown in your own time. */
export function WorkHours({ now }: { now: Date }) {
  const { ws } = useWorkspace();
  const myMin = now.getHours() * 60 + now.getMinutes();

  const rows = ws.team
    .map((p) => ({ p, clock: clockFor(p, now) }))
    .sort((a, b) => Number(b.clock.working) - Number(a.clock.working));

  return (
    <section className="op-group op-hours-sec" aria-label="Work hours">
      <div className="op-group-h">
        <span>Work hours</span>
        <span>your time</span>
      </div>
      <div className="op-hours">
        <div className="op-hours-rows">
          {rows.map(({ p, clock }) => {
            // their clock minus yours, in minutes, between -12h and +12h
            const diff = ((clock.min - myMin + DAY + DAY / 2) % DAY) - DAY / 2;
            const start = (((p.start * 60 - diff) % DAY) + DAY) % DAY;
            const len = (p.end - p.start) * 60;
            // a window that crosses your midnight is drawn as two pieces
            const segs = [
              [start, Math.min(len, DAY - start)],
              [0, Math.max(0, start + len - DAY)],
            ].filter(([, w]) => w > 0);
            return (
              <div
                key={p.id}
                className="op-hrow"
                data-on={clock.working}
                title={`${p.name} · ${pad2(p.start)}:00–${pad2(p.end)}:00 their time`}
              >
                <Face person={p} on={clock.working} small />
                <div className="op-track">
                  {segs.map(([s, w]) => (
                    <span key={s} className="op-seg" style={{ left: `${(s / DAY) * 100}%`, width: `${(w / DAY) * 100}%` }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="op-axis" aria-hidden="true">
          <span />
          <div className="op-axis-in">
            <span style={{ left: 0 }}>00</span>
            <span style={{ left: '25%' }}>06</span>
            <span style={{ left: '50%' }}>12</span>
            <span style={{ left: '75%' }}>18</span>
            <span style={{ left: '100%' }}>24</span>
          </div>
        </div>
        {/* the "now" line: 8px padding + 30px face column, then a share of the track */}
        <span
          className="op-hours-now"
          aria-hidden="true"
          style={{ left: `calc(38px + (100% - 46px) * ${myMin / DAY})` }}
        />
      </div>
    </section>
  );
}
