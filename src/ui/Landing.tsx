// Landing hero: "describe a robot, talk to it" with one-click voice-robot templates and the prompt box.
import type { ReferenceImage } from '../design/pipeline';
import { AiModeSelect, Composer } from './Chat';

export interface Template { id: string; emoji: string; title: string; tagline: string; hues: [string, string]; prompt: string; parts: string[] }

export const TEMPLATES: Template[] = [
  {
    id: 'desk-buddy', emoji: '🤖', title: 'Desk buddy', tagline: 'Chats, nods and keeps you company while you work.', hues: ['#4f8cff', '#2ec4f1'],
    parts: ['mic', 'speaker', 'display'],
    prompt: 'A friendly talking desk buddy robot: a rounded head with a small display face and two LED eyes on a short neck servo so it nods and turns toward you while it talks, a mic and a speaker in the body, sky blue and white.',
  },
  {
    id: 'talking-cat', emoji: '🐱', title: 'Talking cat', tagline: 'Purrs back, tilts its head, swishes its tail.', hues: ['#f59e0b', '#f97316'],
    parts: ['mic', 'speaker', 'display'],
    prompt: 'A talking cat robot that sits on a shelf: an egg-shaped body, a head with pointed ears that tilts on a servo, a tail that swishes, display eyes, a mic and a speaker in the chest, orange and cream.',
  },
  {
    id: 'plant-companion', emoji: '🪴', title: 'Plant companion', tagline: 'Leans in to remind you to water the plant.', hues: ['#22c55e', '#14b8a6'],
    parts: ['mic', 'speaker'],
    prompt: 'A plant companion robot that sits next to a flower pot: a leaf-shaped head on a stem that bends toward you when it talks, two LED eyes, a mic and a speaker in a round base, it reminds you to water the plant, leaf green and white.',
  },
  {
    id: 'study-coach', emoji: '📚', title: 'Study coach', tagline: 'Runs focus sessions and cheers you on.', hues: ['#6366f1', '#a855f7'],
    parts: ['mic', 'speaker', 'display'],
    prompt: 'A study coach robot for a desk: a small display face on a head that tilts, one arm that points or waves to cheer, a mic and a speaker, runs focus timers and quizzes you, navy blue and yellow.',
  },
  {
    id: 'story-owl', emoji: '🦉', title: 'Story-telling owl', tagline: 'Flaps its wings while it tells bedtime stories.', hues: ['#a16207', '#d97706'],
    parts: ['mic', 'speaker'],
    prompt: 'A story-telling owl robot for a bedside table: a round body, big LED eyes, two wings that flap gently on servos while it tells stories, a head that turns, a mic and a speaker, warm brown and cream.',
  },
  {
    id: 'door-greeter', emoji: '👋', title: 'Door greeter', tagline: 'Turns to face visitors and waves hello.', hues: ['#0d9488', '#06b6d4'],
    parts: ['mic', 'speaker', 'display'],
    prompt: 'A greeter robot for a front door: a tall capsule body, a head that turns to face visitors, an arm that waves hello, a display face, a mic and a speaker to welcome people, white and teal.',
  },
];

export function Landing(props: {
  onSend: (p: string, image?: ReferenceImage) => void;
  thinking: boolean;
  ai: { ai: boolean; provider?: string } | null;
  aiMode: 'auto' | 'offline';
  setAiMode: (m: 'auto' | 'offline') => void;
  userName?: string | null;
}) {
  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing-glow" aria-hidden />
      <div className="landing-inner">
        <div className="hero">
          <span className="hero-kicker">PICOCEO Builder · AI robot studio</span>
          <h1 id="landing-title">Describe a robot.<br /><span className="grad">Then talk to it.</span></h1>
          <p className="hero-sub">
            Say what you want in one sentence. The AI designs the body, picks the mic, speaker and servos,
            makes printable parts and gives it a voice through your own AI brain.
          </p>
          <div className="hero-steps" aria-hidden>
            <span><b>1</b> Describe</span><i>→</i><span><b>2</b> Watch it build</span><i>→</i><span><b>3</b> Print &amp; flash</span><i>→</i><span><b>4</b> Talk</span>
          </div>
          <div className="hero-box">
            <Composer
              variant="hero"
              autoFocus
              onSend={props.onSend}
              thinking={props.thinking}
              submitLabel="Design it ✦"
              placeholder="e.g. a talking penguin that tells me the weather and flaps its wings"
              extra={<AiModeSelect ai={props.ai} aiMode={props.aiMode} setAiMode={props.setAiMode} />}
            />
          </div>
        </div>
        <div className="tpl-head">
          <h2>Start from a voice robot</h2>
          <span>One click: every template talks, listens and moves.</span>
        </div>
        <ul className="tpl-grid">
          {TEMPLATES.map(t => (
            <li key={t.id}>
              <button className="tpl-card" style={{ ['--h1' as string]: t.hues[0], ['--h2' as string]: t.hues[1] }}
                onClick={() => props.onSend(t.prompt)} disabled={props.thinking} aria-label={`Start the ${t.title} template: ${t.tagline}`}>
                <span className="tpl-art" aria-hidden><span className="tpl-emoji">{t.emoji}</span><span className="tpl-wave"><i /><i /><i /></span></span>
                <span className="tpl-body">
                  <b>{t.title}</b>
                  <span>{t.tagline}</span>
                  <span className="tpl-parts">{t.parts.map(p => <em key={p}>{p}</em>)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
