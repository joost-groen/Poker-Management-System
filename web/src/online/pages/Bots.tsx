import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rng } from '../../../../shared/poker/cards.ts';
import { BOT_LEVELS, BOT_STYLE, decide, type BotLevel } from '../../../../shared/poker/bots.ts';
import { advise, review, type Leak } from '../../../../shared/poker/coach.ts';
import { describe, evaluate } from '../../../../shared/poker/evaluate.ts';
import { act, remainingBoard, startHand, type Action, type HandState } from '../../../../shared/poker/holdem.ts';
import { viewFor } from '../../../../shared/poker/view.ts';
import { Info } from '../../components/Info.tsx';
import { useAccount } from '../api.ts';
import { readBotStats, recordBotHand } from '../botStats.ts';
import { recordOf } from '../../../../shared/poker/history.ts';
import { useTurnAlert, useWakeLock } from '../alerts.ts';
import { handsWithLeak, readBotHands, saveBotHand } from '../botHistory.ts';
import { ActionBar, PreActions, usePreAction } from '../components/ActionBar.tsx';
import { HistoryList } from '../components/HandReplay.tsx';
import { CoachPanel, FeedbackLine, HandReview, LeakList, RevealList, type ReviewedFeedback } from '../components/CoachPanel.tsx';
import { OHeader, Sheet, SoundToggle } from '../components/Nav.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { dealDelay, outcomeOf, TableFelt } from '../components/TableFelt.tsx';
import { chips, signedBb } from '../format.ts';
import { handName, useOT } from '../i18n.ts';
import { usePrefs, setPref } from '../prefs.ts';
import { soundsFor } from '../sound.ts';
import { useStagedHand } from '../stage.ts';

export type BotMode = 'practice' | 'learn';

const SB = 10;
const BB = 20;
const STACKS = [50, 100, 200];
const OPPONENTS = [1, 2, 3, 4, 5];
/** Practice deals the next hand this long after the winner is shown. */
const NEXT_HAND_MS = 7000;
/** A bot's thinking time per move (ms), before a random part of up to 80% on top. */
const THINK: Record<Action['type'], number> = { fold: 650, check: 600, call: 950, raise: 1300 };
const YOU = 'you';

// The browser deals with crypto randomness too; modulo bias is negligible for n ≤ 52.
const cryptoRng: Rng = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

interface Setup {
  level: BotLevel;
  opponents: number;
  stackBb: number;
}

interface Player {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  stack: number;
  bought: number;
}

/** A running bot game, kept on the device so a reload or a closed app picks up where it stopped. */
interface Saved {
  setup: Setup;
  players: Player[];
  hand: HandState | null;
  button: number | null;
  handNo: number;
  summary: { hands: number; won: number; biggest: number };
  sessionLeaks: Partial<Record<Leak, number>>;
}

const saveKey = (mode: BotMode) => `poker-online-botgame-${mode}`;

function loadGame(mode: BotMode): Saved | null {
  try {
    const raw = localStorage.getItem(saveKey(mode));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function saveGame(mode: BotMode, game: Saved | null) {
  try {
    if (game) localStorage.setItem(saveKey(mode), JSON.stringify(game));
    else localStorage.removeItem(saveKey(mode));
  } catch {
    /* resuming is a convenience */
  }
}

export function Bots({ mode }: { mode: BotMode }) {
  // Only the game that was running when the page opened is resumed; once it ends, new settings start fresh.
  const [saved, setSaved] = useState(() => loadGame(mode));
  const [setup, setSetup] = useState<Setup | null>(saved?.setup ?? null);
  const [round, setRound] = useState(0);
  const leave = () => {
    saveGame(mode, null);
    setSaved(null);
  };
  if (!setup) return <BotSetup mode={mode} onStart={setSetup} />;
  return (
    <BotGame
      key={round}
      mode={mode}
      setup={setup}
      saved={saved}
      onAgain={() => {
        leave();
        setRound((r) => r + 1);
      }}
      onExit={() => {
        leave();
        setSetup(null);
      }}
    />
  );
}

function BotSetup({ mode, onStart }: { mode: BotMode; onStart: (s: Setup) => void }) {
  const t = useOT();
  const prefs = usePrefs();
  const [level, setLevel] = useState<BotLevel>('beginner');
  const [opponents, setOpponents] = useState(3);
  const [stackBb, setStackBb] = useState(100);
  const stats = useMemo(readBotStats, []);

  return (
    <main className="o-page bare narrow">
      <OHeader title={mode === 'learn' ? t.bots.learnTitle : t.bots.practiceTitle} back="/online">
        <Info label={t.bots.about}>{t.bots.localNote}</Info>
      </OHeader>

      <section className="o-section">
        <h2 className="o-label">
          {t.bots.level}
          <Info label={t.bots.aboutLevels}>
            {BOT_LEVELS.map((l) => <span key={l} style={{ display: 'block', marginBottom: 6 }}><b>{t.bots.levels[l]}</b>: {t.bots.levelInfo[l]}</span>)}
          </Info>
        </h2>
        <div className="o-levels">
          {BOT_LEVELS.map((l) => {
            const r = stats.levels[l];
            return (
              <button key={l} type="button" className="o-level" aria-pressed={level === l} onClick={() => setLevel(l)}>
                <span className="o-emoji" aria-hidden="true">{BOT_STYLE[l].avatars[0]}</span>
                <span>
                  <strong>{t.bots.levels[l]}</strong>
                  {r && <small>{t.bots.record(r.hands, signedBb(r.netBb))}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="o-section">
        <h2 className="o-label">{t.bots.opponents}</h2>
        <div className="o-seg">
          {OPPONENTS.map((n) => (
            <button key={n} type="button" aria-pressed={opponents === n} onClick={() => setOpponents(n)}>{n + 1}</button>
          ))}
        </div>
      </section>

      <section className="o-section">
        <h2 className="o-label">{t.bots.stack}</h2>
        <div className="o-seg">
          {STACKS.map((n) => (
            <button key={n} type="button" aria-pressed={stackBb === n} onClick={() => setStackBb(n)}>{t.bots.bb(n)}</button>
          ))}
        </div>
      </section>

      {mode === 'practice' && (
        <label className="o-switch">
          <input type="checkbox" checked={prefs.handName} onChange={(e) => setPref('handName', e.target.checked)} />
          <strong>{t.bots.showHand}</strong>
        </label>
      )}

      {mode === 'learn' && (
        <nav className="o-modes" aria-label={t.learn.more}>
          <a className="o-mode mint" href="#/online/chart">
            <span className="o-emoji" aria-hidden="true">🗺️</span>
            <strong>{t.learn.chart}</strong>
          </a>
          <a className="o-mode peach" href="#/online/drill">
            <span className="o-emoji" aria-hidden="true">🎯</span>
            <strong>{t.learn.drill}</strong>
          </a>
        </nav>
      )}

      <button type="button" className="o-btn block" onClick={() => onStart({ level, opponents, stackBb })}>{t.bots.start}</button>
    </main>
  );
}

function BotGame({ mode, setup, saved, onAgain, onExit }: { mode: BotMode; setup: Setup; saved: Saved | null; onAgain: () => void; onExit: () => void }) {
  const t = useOT();
  const account = useAccount();
  const prefs = usePrefs();
  const start = setup.stackBb * BB;
  const playersRef = useRef<Player[]>(saved?.players ?? []);
  const [players, setPlayersState] = useState<Player[]>(() => {
    if (saved) return saved.players;
    const style = BOT_STYLE[setup.level];
    const list: Player[] = [{ id: YOU, name: account?.username ?? t.common.you, avatar: account?.avatar ?? '😎', seat: 0, stack: start, bought: start }];
    for (let i = 0; i < setup.opponents; i++) {
      list.push({ id: `bot${i}`, name: style.names[i], avatar: style.avatars[i], seat: i + 1, stack: start, bought: start });
    }
    playersRef.current = list;
    return list;
  });
  const setPlayers = (list: Player[]) => {
    playersRef.current = list;
    setPlayersState(list);
  };
  const [hand, setHand] = useState<HandState | null>(saved?.hand ?? null);
  const button = useRef<number | null>(saved?.button ?? null);
  const handNo = useRef(saved?.handNo ?? 0);
  const reviewRef = useRef<ReviewedFeedback[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedFeedback[]>([]);
  const [lastFeedback, setLastFeedback] = useState<ReviewedFeedback | null>(null);
  const [summary, setSummary] = useState(saved?.summary ?? { hands: 0, won: 0, biggest: 0 });
  const [sessionLeaks, setSessionLeaks] = useState<Partial<Record<Leak, number>>>(saved?.sessionLeaks ?? {});
  const [ended, setEnded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** Learn: the opponents' cards turned up after the hand. */
  const [revealed, setRevealed] = useState(false);
  const [restShown, setRestShown] = useState(false);

  const me = players[0];

  const deal = useCallback(() => {
    // Busted bots buy in again so the table keeps going; the player decides for themselves.
    const list = playersRef.current.map((p) => (p.id !== YOU && p.stack === 0 ? { ...p, stack: start, bought: p.bought + start } : p));
    setPlayers(list);
    if (list[0].stack === 0) return;
    handNo.current++;
    const h = startHand({
      players: list.map((p) => ({ id: p.id, name: p.name, seat: p.seat, stack: p.stack })),
      previousButton: button.current,
      sb: SB,
      bb: BB,
      rng: cryptoRng,
      handNo: handNo.current,
    });
    button.current = h.players[h.button].seat;
    reviewRef.current = [];
    setReviewed([]);
    setLastFeedback(null);
    setRevealed(false);
    setRestShown(false);
    setHand(h);
  }, [start]);

  const apply = useCallback((next: HandState) => {
    setHand(next);
    const r = next.result;
    if (!r) return;
    const stacks = new Map(next.players.map((p) => [p.id, p.stack]));
    setPlayers(playersRef.current.map((p) => (stacks.has(p.id) ? { ...p, stack: stacks.get(p.id)! } : p)));
    const net = r.net[YOU] ?? 0;
    setSummary((s) => ({ hands: s.hands + 1, won: s.won + (net > 0 ? 1 : 0), biggest: Math.max(s.biggest, net > 0 ? r.won[YOU] : 0) }));
    const leaks = reviewRef.current.flatMap((f) => (f.leak ? [f.leak] : []));
    setSessionLeaks((s) => {
      const out = { ...s };
      for (const l of leaks) out[l] = (out[l] ?? 0) + 1;
      return out;
    });
    setReviewed(reviewRef.current);
    recordBotHand(setup.level, net / BB, leaks);
    saveBotHand({ level: setup.level, mode, record: recordOf(next), feedback: reviewRef.current });
  }, [setup.level, mode]);

  // A restored game carries on with its hand; a new one deals straight away.
  const handRef = useRef(hand);
  handRef.current = hand;
  useEffect(() => {
    if (!handRef.current) deal();
  }, [deal]);

  useEffect(() => {
    saveGame(mode, { setup, players, hand, button: button.current, handNo: handNo.current, summary, sessionLeaks });
  }, [mode, setup, players, hand, summary, sessionLeaks]);

  // The screen replays every step; bots and the next deal wait until it has caught up.
  const target = useMemo(() => (hand ? viewFor(hand, YOU) : null), [hand]);
  const { shown: view, settled } = useStagedHand(target, (prev, next) => soundsFor(prev, next, YOU));

  // Bots think for a moment, longer for a raise than for a fold, and a little longer on a fresh street.
  useEffect(() => {
    if (!hand || hand.result || ended || !settled) return;
    const p = hand.players[hand.toAct!];
    if (p.id === YOU) return;
    const action = decide(viewFor(hand, p.id), setup.level).action;
    const fresh = hand.actions.at(-1)?.street !== hand.street;
    const think = THINK[action.type] * (1 + Math.random() * 0.8) + (fresh ? 400 : 0);
    const timer = setTimeout(() => apply(act(hand, hand.toAct!, action)), think);
    return () => clearTimeout(timer);
  }, [hand, settled, ended, apply, setup.level]);

  // Practice deals on by itself; Learn waits so the review can be read.
  useEffect(() => {
    if (mode !== 'practice' || !hand?.result || !settled || ended || playersRef.current[0].stack === 0) return;
    const timer = setTimeout(deal, NEXT_HAND_MS);
    return () => clearTimeout(timer);
  }, [mode, hand, settled, ended, deal]);

  const yourTurn = Boolean(settled && view?.legal);
  useTurnAlert(yourTurn, t.table.yourTurn);
  useWakeLock(!ended);
  const pre = usePreAction(view, settled, (a) => onAct(a));
  const advice = useMemo(() => (mode === 'learn' && settled && view?.legal ? advise(view) : null), [mode, settled, view]);

  const onAct = (a: Action) => {
    if (!hand || !view || !settled) return;
    if (advice) {
      const f: ReviewedFeedback = { ...review(advice, a, view.legal!.check), label: advice.start.label, position: advice.position };
      reviewRef.current = [...reviewRef.current, f];
      setLastFeedback(f);
    }
    apply(act(hand, YOU, a));
  };

  const busted = me.stack === 0 && (!hand || (hand.result && view?.result));
  // Learn: once the hand is over and on screen, every opponent's cards can be turned up.
  const showAll = mode === 'learn' && revealed && Boolean(hand?.result && view?.result && settled);
  const feltView = showAll && view && hand ? { ...view, players: view.players.map((p, i) => ({ ...p, cards: p.cards ?? hand.players[i].cards })) } : view;
  // After a hand that ended early: the board it would have dealt.
  const canRest = Boolean(hand?.result && view?.result && settled && hand.board.length < 5 && !restShown && !ended);
  // Learn: Enter deals the next hand once the review is up.
  const canDeal = Boolean(view?.result && settled && mode === 'learn' && !busted && !ended);
  useEffect(() => {
    if (!canDeal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') deal();
      if (e.key === 'v' || e.key === 'V') setRevealed((r) => !r);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDeal, deal]);

  const rebuy = () => {
    setPlayers(playersRef.current.map((p) => (p.id === YOU ? { ...p, stack: p.stack + start, bought: p.bought + start } : p)));
    deal();
  };

  const seats = players.map((p) => ({ name: p.name, avatar: p.avatar, stack: p.stack }));
  const myCards = view && view.you !== null ? view.players[view.you].cards : null;
  const myScore = myCards && view && view.board.length ? describe(evaluate([...myCards, ...view.board])) : null;
  const iFolded = view && view.you !== null ? view.players[view.you].folded : false;
  const myOutcome = view && view.you !== null ? outcomeOf(view, view.you) : null;
  const net = me.stack - me.bought;
  const actor = view && view.toAct !== null && !view.result ? view.players[view.toAct] : null;
  const waitingFor = actor && actor.id !== YOU ? actor.name : null;

  return (
    <main className="o-page bare">
      <OHeader title={`${mode === 'learn' ? t.bots.learnTitle : t.bots.practiceTitle} · ${t.bots.levels[setup.level]}`} back="/online">
        <SoundToggle />
        <button type="button" className="icon-btn" aria-label={t.history.title} title={t.history.title} onClick={() => setShowHistory(true)}><HistoryIcon /></button>
        <button type="button" className="o-btn ghost small" onClick={() => setEnded(true)}>{t.bots.endSession}</button>
      </OHeader>

      <div className={`o-game${mode === 'practice' ? ' solo' : ''}`}>
        <TableFelt maxSeats={players.length} seats={seats} hand={feltView} youSeat={0} format={chips} revealFolded={showAll}
          rest={restShown && hand?.result ? remainingBoard(hand) : null} onShowRest={canRest ? () => setRestShown(true) : undefined} />

        <div className="o-hand">
          {myCards && (
            <span className="o-cards">
              {[...myCards].sort((a, b) => b - a).map((c, i) => (
                <PlayingCard key={`${view!.handNo}-${i}`} card={c} size="lg" dim={iFolded} win={myOutcome === 'win'} lose={myOutcome === 'lose'} delay={dealDelay(view!, view!.you!, i)} />
              ))}
            </span>
          )}
          {(mode === 'learn' || prefs.handName) && myScore && !iFolded && <span className="o-hand-name">{handName(t, myScore)}</span>}
        </div>

        {mode === 'learn' && (
          <aside className="o-side">
            {lastFeedback && !yourTurn && !view?.result && <FeedbackLine feedback={lastFeedback} />}
            {advice && view && <CoachPanel advice={advice} format={chips} betting={view.currentBet === 0} />}
            {view?.result && <HandReview items={reviewed} />}
            {showAll && hand?.result && (
              <RevealList
                board={hand.board}
                showdown={hand.result.showdown}
                format={chips}
                hands={hand.players.filter((p) => p.id !== YOU).map((p) => ({
                  id: p.id, name: p.name, avatar: players.find((x) => x.id === p.id)?.avatar ?? '🤖', cards: p.cards,
                  folded: hand.actions.find((a) => a.playerId === p.id && a.type === 'fold')?.street ?? null,
                  net: hand.result!.net[p.id],
                }))}
              />
            )}
          </aside>
        )}

        <div className="o-actions">
          {busted ? (
            <>
              <p className="o-wait" style={{ minHeight: 0 }}>{t.bots.busted}</p>
              <button type="button" className="o-btn block" onClick={rebuy}>{t.bots.rebuy(chips(start))}</button>
            </>
          ) : yourTurn && view ? (
            <ActionBar view={view} format={chips} onAct={onAct} />
          ) : view?.result && settled && mode === 'learn' ? (
            <div className="o-action-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <button type="button" className="o-act" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
                {revealed ? t.reveal.hide : t.reveal.show}<kbd>V</kbd>
              </button>
              <button type="button" className="o-act main" onClick={deal}>{t.bots.nextHand}<kbd>↵</kbd></button>
            </div>
          ) : (
            <>
              <p className="o-wait" style={pre.available ? { minHeight: 0 } : undefined}>{view?.result ? t.table.waiting : waitingFor ? t.table.thinking(waitingFor) : '…'}</p>
              <PreActions state={pre} format={chips} />
            </>
          )}
        </div>
      </div>

      {showHistory && (
        <Sheet title={t.history.title} onClose={() => setShowHistory(false)}>
          <BotHistory />
        </Sheet>
      )}

      {ended && (
        <div className="o-sheet" role="dialog" aria-modal="true" aria-label={t.bots.summary}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 500 }}>{t.bots.summary}</h2>
            <div className="o-hero">
              <span className="o-label">{t.bots.result}</span>
              <span className={`o-hero-value ${net > 0 ? 'o-pos' : net < 0 ? 'o-neg' : ''}`}>{net > 0 ? '+' : ''}{chips(net)}</span>
              <span className="o-muted">{signedBb(net / BB)} BB</span>
            </div>
            <div className="o-stats">
              <div className="o-stat"><span>{t.bots.handsPlayed}</span><span>{summary.hands}</span></div>
              <div className="o-stat"><span>{t.bots.handsWon}</span><span>{summary.won}</span></div>
              <div className="o-stat"><span>{t.bots.biggestPot}</span><span>{chips(summary.biggest)}</span></div>
            </div>
            {mode === 'learn' && (
              <section className="o-section">
                <h3 className="o-label">{t.profile.leaks}</h3>
                <LeakList leaks={sessionLeaks} />
              </section>
            )}
            <button type="button" className="o-btn block" onClick={onAgain}>{t.bots.again}</button>
            <button type="button" className="o-btn ghost block" onClick={onExit}>{t.bots.change}</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** Your latest bot hands on this device, newest first. */
export function BotHistory({ leak }: { leak?: Leak }) {
  const t = useOT();
  const hands = useMemo(() => (leak ? handsWithLeak(leak) : readBotHands()), [leak]);
  return (
    <HistoryList
      viewerId={YOU}
      empty={t.history.emptyBots}
      items={hands.map((h) => ({
        key: h.id, record: h.record, title: `${t.bots.levels[h.level]}`, at: h.at, maxSeats: h.record.players.length, format: chips,
        avatars: Object.fromEntries(h.record.players.map((p) => [p.id, p.id === YOU ? '😎' : botAvatar(h.level, p.id)])),
      }))}
    />
  );
}

const botAvatar = (level: BotLevel, id: string) => BOT_STYLE[level].avatars[Number(id.replace('bot', ''))] ?? '🤖';

const HistoryIcon = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4l3 2" />
  </svg>
);
