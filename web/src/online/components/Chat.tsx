import { useEffect, useRef, useState, type FormEvent } from 'react';
import { REACTIONS, VOICE_MAX_CHARS, VOICE_MAX_MS, type ChatMessage } from '../../../../shared/online.ts';
import { useOT } from '../i18n.ts';

export type ChatSend = (body: { kind: 'text' | 'reaction'; text: string } | { kind: 'voice'; audio: string; ms: number }) => Promise<void>;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const seconds = (ms: number) => `0:${String(Math.max(1, Math.round(ms / 1000))).padStart(2, '0')}`;

/** Messages, quick reactions and phrases, a text field and a voice recorder. */
export function ChatPanel({ messages, meId, onSend, compact }: { messages: ChatMessage[]; meId: number | null; onSend: ChatSend; compact?: boolean }) {
  const t = useOT();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send: ChatSend = async (body) => {
    try {
      await onSend(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = text.trim();
    if (!s) return;
    setText('');
    void send({ kind: 'text', text: s });
  };

  return (
    <section className={`o-chat${compact ? ' compact' : ''}`} aria-label={t.chat.title}>
      <ol className="o-chat-list" ref={list} aria-live="polite">
        {messages.length === 0 && <li className="o-muted o-small o-center">{t.chat.empty}</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.accountId === meId ? 'mine' : ''}>
            <span className="o-avatar" aria-hidden="true">{m.avatar}</span>
            <span className="o-chat-body">
              <span className="o-chat-meta">{m.accountId === meId ? t.common.you : m.username} · {time(m.at)}</span>
              {m.kind === 'reaction' ? <span className="o-chat-emoji">{m.text}</span>
                : m.kind === 'voice' ? <VoiceNote audio={m.audio} ms={m.ms ?? 0} />
                  : <span className="o-chat-text">{m.text}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="o-reactions" role="group" aria-label={t.chat.reactions}>
        {REACTIONS.map((r) => (
          <button key={r} type="button" onClick={() => send({ kind: 'reaction', text: r })}>{r}</button>
        ))}
      </div>
      <div className="o-phrases">
        {t.chat.phrases.map((p) => (
          <button key={p} type="button" onClick={() => send({ kind: 'text', text: p })}>{p}</button>
        ))}
      </div>
      <form className="o-chat-form" onSubmit={submit}>
        <input className="o-input" value={text} maxLength={200} placeholder={t.chat.placeholder} aria-label={t.chat.placeholder} onChange={(e) => setText(e.target.value)} />
        <VoiceRecorder onDone={(audio, ms) => send({ kind: 'voice', audio, ms })} onError={setError} />
        <button type="submit" className="o-btn small" disabled={!text.trim()}>{t.chat.send}</button>
      </form>
      {error && <p className="o-error" role="alert">{error}</p>}
    </section>
  );
}

/** A voice message: play/pause and its length. Old messages lose their audio on the server. */
export function VoiceNote({ audio, ms }: { audio?: string; ms: number }) {
  const t = useOT();
  const [playing, setPlaying] = useState(false);
  // A format this browser can't decode (e.g. WebM on an older iPhone) or a damaged recording.
  const [broken, setBroken] = useState(() => Boolean(audio) && !canPlay(audio!));
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => el.current?.pause(), []);
  if (!audio) return <span className="o-muted o-small">🎤 {seconds(ms)} · {t.chat.expired}</span>;
  if (broken) return <span className="o-muted o-small">🎤 {seconds(ms)} · {t.chat.unplayable}</span>;
  const toggle = () => {
    if (!el.current) {
      el.current = new Audio(audio);
      el.current.onended = () => setPlaying(false);
      el.current.onerror = () => {
        setPlaying(false);
        setBroken(true);
      };
    }
    if (playing) {
      el.current.pause();
      setPlaying(false);
    } else {
      el.current.currentTime = 0;
      void el.current.play().then(
        () => setPlaying(true),
        (err: unknown) => {
          setPlaying(false);
          // Blocked autoplay is retried by the next tap; anything else means the audio itself won't play.
          if (!(err instanceof DOMException && err.name === 'NotAllowedError')) setBroken(true);
        },
      );
    }
  };
  return (
    <button type="button" className="o-voice" aria-pressed={playing} onClick={toggle}>
      <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
      <span className="o-voice-wave" aria-hidden="true" />
      <span className="o-num">{seconds(ms)}</span>
      <span className="sr-only">{t.chat.voice}</span>
    </button>
  );
}

/** Whether this browser can decode the recording's format at all, from the data URL's media type. */
function canPlay(dataUrl: string): boolean {
  const type = dataUrl.slice(5, dataUrl.indexOf(';base64,'));
  return new Audio().canPlayType(type) !== '';
}

const MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

/** Tap to record (up to 15 s), tap again to send, ✕ to throw away. Low bitrate keeps a message small. */
function VoiceRecorder({ onDone, onError }: { onDone: (audio: string, ms: number) => void; onError: (e: string) => void }) {
  const t = useOT();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; cancel: boolean; timer: ReturnType<typeof setInterval> } | null>(null);

  useEffect(() => () => stop(true), []);
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  function stop(cancel: boolean) {
    const r = rec.current;
    if (!r) return;
    r.cancel = cancel;
    clearInterval(r.timer);
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    r.stream.getTracks().forEach((tr) => tr.stop());
    rec.current = null;
    setRecording(false);
  }

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24_000 });
      const chunks: Blob[] = [];
      const started = Date.now();
      const state = {
        recorder, stream, started, cancel: false,
        timer: setInterval(() => {
          const ms = Date.now() - started;
          setElapsed(ms);
          if (ms >= VOICE_MAX_MS) stop(false);
        }, 200),
      };
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        const ms = Math.min(Date.now() - started, VOICE_MAX_MS);
        if (state.cancel || ms < 400) return;
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result);
          if (url.length > VOICE_MAX_CHARS) onError(t.chat.tooLong);
          else onDone(url, ms);
        };
        reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      };
      recorder.start(250);
      rec.current = state;
      setElapsed(0);
      setRecording(true);
    } catch {
      onError(t.chat.noMic);
    }
  };

  if (recording) {
    return (
      <span className="o-recording">
        <button type="button" className="o-btn ghost small" aria-label={t.common.cancel} onClick={() => stop(true)}>✕</button>
        <button type="button" className="o-btn danger small" onClick={() => stop(false)}>
          <span className="o-rec-dot" aria-hidden="true" />{seconds(elapsed)} · {t.chat.send}
        </button>
      </span>
    );
  }
  return (
    <button type="button" className="o-btn ghost small o-mic" aria-label={t.chat.record} title={t.chat.record} onClick={start}>🎤</button>
  );
}
