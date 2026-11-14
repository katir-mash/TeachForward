import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, Clock3, Compass, Download, ExternalLink, GraduationCap, Leaf, ListChecks, LoaderCircle, LockKeyhole, MapPin, Menu, MessageCircle, Plus, Send, ShieldCheck, Sparkles, Target, X } from 'lucide-react';
import { buildRoadmap, PROFILE_OPTIONS, SAMPLE_PROFILE, validateProfile } from '../shared/roadmap.js';
import { browserStorage, loadProgress, saveProgress } from './storage.js';

const blankProfile = { education: '', certification: '', subject: '', time: '' };
const optionLabel = (key, value) => PROFILE_OPTIONS[key].find(item => item.value === value)?.label || value;

async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (['PLUS_REQUIRED', 'DAILY_LIMIT', 'AI_NOT_CONFIGURED'].includes(result.code)) window.dispatchEvent(new Event('teachforward-session-refresh'));
      const error = new Error(result.error || 'The server could not complete this request. Please try again.');
      error.code = result.code; error.usage = result.usage;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Your roadmap and saved progress are still available.');
    if (error instanceof TypeError) throw new Error('Cannot reach the server. Your roadmap works offline; reconnect to use Mentor and Demo upgrade.');
    throw error;
  } finally { clearTimeout(timer); }
}

function Brand({ onClick }) {
  return <button className="brand" onClick={onClick} aria-label="TeachForward home"><span className="brand-icon"><BookOpen size={22} strokeWidth={1.7} /></span><span>Teach<span className="brand-light">Forward</span><span className="brand-dot">.</span></span></button>;
}

function SourceLink({ source, compact = false }) {
  if (!source) return null;
  return <a href={source.url} target="_blank" rel="noreferrer" className={compact ? 'source-link compact' : 'source-link'}><span>{source.title}{!compact && <small>Texas Education Agency · Checked {source.verifiedAt}</small>}</span><ExternalLink size={14} /></a>;
}

function App() {
  const [initial] = useState(() => loadProgress(browserStorage));
  const [profile, setProfile] = useState(initial.profile);
  const [completed, setCompleted] = useState(initial.completed);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [page, setPage] = useState(() => window.location.hash === '#roadmap' && initial.profile ? 'dashboard' : window.location.hash === '#start' ? 'form' : 'home');
  const [tab, setTab] = useState('roadmap');
  const [session, setSession] = useState(null);
  const [serverError, setServerError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const mainRef = useRef(null);
  const roadmap = profile ? buildRoadmap(profile) : null;
  const isPlus = session?.plan === 'plus';
  const manualAccess = isPlus && session?.entitlement?.source === 'admin';

  useEffect(() => {
    const refreshSession = () => api('session').then(result => { setSession(result); setServerError(''); }).catch(error => setServerError(error.message));
    refreshSession();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshSession(); };
    const onHash = () => {
      const hash = window.location.hash;
      if (!['#start', '#roadmap', '#home', ''].includes(hash)) return;
      setPage(hash === '#start' ? 'form' : hash === '#roadmap' && loadProgress(browserStorage).profile ? 'dashboard' : 'home');
      setMobileMenu(false);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('teachforward-session-refresh', refreshSession);
    window.addEventListener('focus', refreshSession);
    document.addEventListener('visibilitychange', onVisible);
    const refreshTimer = setInterval(onVisible, 30000);
    return () => { clearInterval(refreshTimer); window.removeEventListener('hashchange', onHash); window.removeEventListener('teachforward-session-refresh', refreshSession); window.removeEventListener('focus', refreshSession); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (profile && !saveProgress(browserStorage, profile, completed)) setStorageWarning('Your browser could not save progress. Keep this tab open or enable local storage.');
  }, [profile, completed]);

  function navigate(next, nextTab = 'roadmap') {
    setPage(next); setTab(nextTab); setMobileMenu(false);
    const hash = next === 'form' ? '#start' : next === 'dashboard' ? '#roadmap' : '#home';
    window.history.pushState(null, '', hash);
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => mainRef.current?.focus());
  }

  function createRoadmap(answers) {
    if (!validateProfile(answers).valid) return;
    const unchanged = JSON.stringify(answers) === JSON.stringify(profile);
    setProfile({ ...answers });
    if (!unchanged) setCompleted([]);
    if (!saveProgress(browserStorage, answers, unchanged ? completed : [])) setStorageWarning('Progress cannot be saved in this browser. Your roadmap is available in this tab.');
    setNotice('Your roadmap is ready. Start with the highlighted next step.');
    navigate('dashboard');
  }

  function toggleTask(id) {
    setCompleted(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setNotice('Progress updated. Completion is self-reported, not a certification decision.');
  }

  async function upgrade() {
    setUpgrading(true); setUpgradeError('');
    try {
      const result = await api('demo-upgrade', {});
      setSession(result); setUpgradeOpen(false);
      setNotice('Plus demo is active. No payment was taken.');
      if (profile) navigate('dashboard', 'skills');
    } catch (error) { setUpgradeError(error.message); }
    finally { setUpgrading(false); }
  }

  async function resetDemo() {
    setUpgradeError(''); setUpgrading(true);
    try {
      setSession(await api('demo-reset', {}));
      setNotice('You are back on the free plan. Your roadmap progress is saved.');
    } catch (error) { setUpgradeError(error.message); }
    finally { setUpgrading(false); }
  }

  const start = () => navigate('form');
  const showUpgrade = () => { setUpgradeError(''); setUpgradeOpen(true); };

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Brand onClick={() => navigate('home')} />
      <nav className={mobileMenu ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
        {page === 'dashboard' ? <>
          <button className={tab === 'roadmap' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('dashboard', 'roadmap')}>My roadmap</button>
          <button className={tab === 'skills' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('dashboard', 'skills')}>Skills studio</button>
          <button className={tab === 'sources' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('dashboard', 'sources')}>Official sources</button>
        </> : <>
          <a className="nav-link" href="#how-it-works" onClick={event => { if (page !== 'home') { event.preventDefault(); navigate('home'); setTimeout(() => document.getElementById('how-it-works')?.scrollIntoView(), 50); } }}>How it works</a>
          <button className="nav-link" onClick={() => { if (page !== 'home') navigate('home'); setTimeout(() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' }), 50); }}>Plans</button>
          {profile && <button className="nav-link" onClick={() => navigate('dashboard')}>My roadmap</button>}
        </>}
      </nav>
      <div className="header-actions"><span className="texas-tag"><MapPin size={13} /> Texas edition</span>{page === 'dashboard' ? <button className="button button-small button-outline" onClick={showUpgrade}><Sparkles size={14} /> {isPlus ? manualAccess ? 'Plus access' : 'Plus demo' : 'Explore Plus'}</button> : <button className="button button-small" onClick={start}>Get Started <ArrowUpRight size={15} /></button>}<button className="mobile-toggle icon-button" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle navigation" aria-expanded={mobileMenu}>{mobileMenu ? <X /> : <Menu />}</button></div>
    </div></header>

    {storageWarning && <div className="global-warning" role="status">{storageWarning}</div>}
    <main id="main" ref={mainRef} tabIndex={-1}>
      {page === 'home' && <Landing start={start} sample={() => createRoadmap(SAMPLE_PROFILE)} showUpgrade={showUpgrade} isPlus={isPlus} demoAvailable={session?.demoAvailable !== false} />}
      {page === 'form' && <ProfileForm profile={profile} onSubmit={createRoadmap} onBack={() => navigate(profile ? 'dashboard' : 'home')} />}
      {page === 'dashboard' && roadmap && <div className="workspace container">
        <div className="breadcrumb"><span>YOUR NEXT CHAPTER</span><span><MapPin size={13} /> Texas <span className="crumb-divider">/</span> Skills track</span></div>
        <div className="dashboard-heading"><div><h1>{tab === 'skills' ? 'Build your teaching toolkit.' : tab === 'sources' ? 'Clarity starts with the source.' : 'A new direction. A clear next step.'}</h1><p>{tab === 'skills' ? 'Make room for practice, one manageable session at a time.' : tab === 'sources' ? 'Official guidance behind your roadmap, with verification dates.' : 'Your experience matters. Let’s turn it into a path forward.'}</p></div><button className="text-button" onClick={start}>Edit my profile <ArrowUpRight size={15} /></button></div>
        <div className="profile-strip"><span><GraduationCap size={16} />{optionLabel('education', profile.education)}</span><span><Target size={15} />{optionLabel('subject', profile.subject)}</span><span><Clock3 size={15} />{optionLabel('time', profile.time)}</span><span className="plan-tag">{isPlus ? manualAccess ? 'PLUS ACCESS' : 'PLUS · DEMO' : 'FREE PLAN'}</span></div>
        {session?.accessId && <div className="access-id-bar"><AccessIdentity session={session} /><span>{manualAccess ? `Plus access until ${new Date(session.entitlement.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : 'Share your Access ID with your administrator for manual Plus access.'}</span></div>}
        <div className="dashboard-layout"><section className="dashboard-main" aria-label={tab === 'sources' ? 'Verified sources' : 'Your personalized plan'}>
          {tab === 'roadmap' && <Roadmap roadmap={roadmap} completed={completed} toggle={toggleTask} />}
          {tab === 'skills' && <SkillsStudio profile={profile} roadmap={roadmap} completed={completed} isPlus={isPlus} manualAccess={manualAccess} showUpgrade={showUpgrade} />}
          {tab === 'sources' && <Sources sources={roadmap.sources} uncertainties={roadmap.uncertainties} />}
          <div className="navigator-note"><ShieldCheck size={19} /><p>TeachForward is your navigator, not a certifying authority. Your preparation program and TEA determine eligibility. No certification or employment is guaranteed.</p></div>
        </section><aside className="dashboard-aside"><Mentor key={JSON.stringify(profile)} profile={profile} roadmap={roadmap} completed={completed} session={session} setSession={setSession} serverError={serverError} />
          <div className="pace-card"><span className="eyebrow">AT YOUR PACE</span><h3>A little progress is still progress.</h3><p>{roadmap.paceLabel}</p><span className="subtle">Suggested practice rhythm, not a certification timeline.</span><Leaf className="pace-leaf" size={60} strokeWidth={1} /></div>
          {!isPlus && <button className="aside-plus" onClick={showUpgrade}><span><Sparkles size={17} /> Make a little more room to grow<small>Unlock your weekly plan with Plus</small></span><ArrowRight size={18} /></button>}
        </aside></div>
      </div>}
    </main>
    <footer className="site-footer container"><Brand onClick={() => navigate('home')} /><p>We grow by helping others grow.</p><a className="footer-admin-link" href="/admin">Admin</a><span>Built for your next chapter.</span></footer>
    <div className="sr-only" aria-live="polite">{notice}</div>
    {upgradeOpen && <UpgradeModal close={() => setUpgradeOpen(false)} upgrade={upgrade} resetDemo={resetDemo} isPlus={isPlus} session={session} busy={upgrading} error={upgradeError} />}
  </>;
}

function AccessIdentity({ session }) {
  const [copyStatus, setCopyStatus] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(session.accessId); setCopyStatus('Copied'); }
    catch { setCopyStatus('Select the ID to copy it manually.'); }
  }
  return <div className="access-identity"><span>Access ID</span><code>{session.accessId}</code><button className="text-button" onClick={copy} aria-label="Copy Access ID">Copy</button><small role="status">{copyStatus}</small></div>;
}

function Landing({ start, sample, showUpgrade, isPlus, demoAvailable }) {
  return <>
    <section className="hero container">
      <div className="hero-copy"><div className="hero-eyebrow"><span className="status-dot" /> A NEW CHAPTER, ROOTED IN PURPOSE</div><h1>Your experience.<br />Their future.<br /><em>A path into teaching.</em></h1><p className="hero-description">You’ve built a life full of skills. Bring them to the classroom with a personal path into teaching in Texas.</p><div className="hero-actions"><button className="button button-large" onClick={start}>Find my path <ArrowUpRight size={19} /></button><button className="text-button" onClick={sample}>Explore a sample <ArrowRight size={16} /></button></div><div className="hero-footnote"><Check size={14} /> Free to start <span>·</span> No account needed <span>·</span> Your pace</div></div>
      <div className="hero-visual" aria-label="Illustrative example of a personalized teaching roadmap"><div className="visual-grid" /><div className="orb orb-one" /><div className="orb orb-two" /><div className="visual-caption"><Compass size={16} /> FROM WHERE YOU ARE<br /><span>TO WHAT’S NEXT.</span></div><div className="path-drawing"><span className="path-stop one" /><span className="path-stop two" /><span className="path-stop three" /></div><div className="journey-card"><div className="journey-card-top"><span className="mini-icon"><BookOpen size={19} /></span><span>YOUR PATH INTO TEACHING<small>Texas · Skills track</small></span><span className="sample-tag">EXAMPLE</span></div><h3>A meaningful next chapter.</h3><div className="journey-row"><span className="journey-number filled"><Check size={14} /></span><div><strong>Start with your experience</strong><span>Your education. Your goals. Your pace.</span></div></div><div className="journey-row"><span className="journey-number current">2</span><div><strong>Find your Texas pathway</strong><span>Grounded in official TEA sources.</span></div><ArrowUpRight size={16} /></div><div className="journey-row"><span className="journey-number">3</span><div><strong>Build your teaching skills</strong><span>One clear next step at a time.</span></div></div><div className="journey-card-bottom"><span className="status-dot" /> A direction you can build on.<Leaf size={19} /></div></div><div className="purpose-tag"><span className="purpose-icon"><Leaf size={21} /></span><span>You don’t have to start over.<br /><strong>You get to build forward.</strong></span></div><span className="visual-index">01 — THE POSSIBILITIES AHEAD</span></div>
    </section>
    <div className="trust-band"><div className="container trust-inner"><span><ShieldCheck size={19} /> Clarity you can build on.</span><p>Official Texas Education Agency sources. A roadmap shaped around you.</p><a href="https://tea.texas.gov/educators/certification/initial-certification/becoming-classroom-teacher-texas" target="_blank" rel="noreferrer">Explore TEA guidance <ArrowUpRight size={15} /></a></div></div>
    <section className="how-section container" id="how-it-works"><div className="section-heading"><div><span className="eyebrow">LESS GUESSWORK. MORE FORWARD.</span><h2>A big change.<br />Broken into small steps.</h2></div><p>From “could I do this?” to “here’s my next step.”<br />A practical place to begin your teaching journey.</p></div><div className="how-grid">{[{ n: '01', icon: Compass, title: 'Start where you are.', copy: 'Tell us about your education, certification, interests, and time. Four answers. A path that fits.' }, { n: '02', icon: ListChecks, title: 'Make your next move.', copy: 'Get a Texas roadmap with official sources. Check off tasks and pick up where you left off.' }, { n: '03', icon: MessageCircle, title: 'Grow with guidance.', copy: 'Ask AI Mentor about your route and progress when AI is connected. Add a weekly practice plan with Plus.' }].map(({ n, icon: Icon, title, copy }) => <article className="how-card" key={n}><div className="how-top"><Icon size={24} strokeWidth={1.5} /><span>{n}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="plans-section container" id="plans"><div className="section-heading"><div><span className="eyebrow">A LITTLE SUPPORT FOR YOUR NEXT STEP</span><h2>Start free. Grow from there.</h2></div><p>No account. No commitment.<br />{demoAvailable ? 'Plus is a pricing hypothesis you can try in demo.' : 'Plus access is managed by your administrator.'}</p></div><div className="plans-grid"><article className="plan-card"><span className="eyebrow">THE FIRST STEP</span><h3>Free</h3><div className="price">$0<span>always free for this MVP</span></div><ul><li><Check /> Personalized Texas roadmap</li><li><Check /> Official sources & saved progress</li><li><Check /> 3 AI Mentor questions / day, when connected</li></ul><button className="button button-outline" onClick={start}>Create my free roadmap <ArrowRight size={17} /></button></article><article className="plan-card plus-plan"><span className="plan-badge">MORE ROOM TO GROW</span><span className="eyebrow">YOUR NEXT CHAPTER</span><h3>Plus <Sparkles size={22} /></h3><div className="price">$9.99<span>/ month · proposed price</span></div><ul><li><Check /> Everything in Free</li><li><Check /> Personal weekly plan & skill exercises</li><li><Check /> Downloadable progress summary</li><li><Check /> 20 AI Mentor questions / day, when connected</li></ul><button className="button" onClick={showUpgrade}>{isPlus ? 'Manage Plus access' : demoAvailable ? 'Demo upgrade' : 'Explore Plus'} <ArrowUpRight size={17} /></button><small>No checkout. No card. No charge.</small></article></div></section>
    <section className="mission-section container"><span className="mission-mark"><Leaf size={30} strokeWidth={1.3} /></span><p>We grow by helping<br /><em>others grow.</em></p><span>YOUR NEXT CHAPTER COULD HELP<br />SOMEONE ELSE BEGIN THEIRS.</span></section>
  </>;
}

function ProfileForm({ profile, onSubmit, onBack }) {
  const [answers, setAnswers] = useState(profile ? { ...profile } : blankProfile);
  const [errors, setErrors] = useState({});
  const fields = [{ key: 'education', label: 'What is your highest level of education?', hint: 'This helps identify the starting point for your certification route.' }, { key: 'certification', label: 'Do you already hold a teaching certificate?', hint: 'We’ll flag any certificate details that TEA still needs to confirm.' }, { key: 'subject', label: 'What would you like to teach?', hint: 'A preference is enough. Your program will confirm certificate area and grade band.' }, { key: 'time', label: 'How much time can you set aside each week?', hint: 'For planning your practice, not estimating how long certification will take.' }];
  function submit(event) {
    event.preventDefault();
    const result = validateProfile(answers); setErrors(result.errors);
    if (result.valid) onSubmit(answers);
    else requestAnimationFrame(() => document.getElementById(Object.keys(result.errors)[0])?.focus());
  }
  return <section className="form-shell container"><button className="text-button back-button" onClick={onBack}><ChevronLeft size={16} /> Back</button><div className="form-layout"><div className="form-intro"><span className="eyebrow">LET’S START WITH YOU</span><h1>A path that fits<br /><em>your starting point.</em></h1><p>You bring the experience. We’ll help you see what comes next.</p><div className="form-promise"><div><ShieldCheck size={19} /><span>Grounded in official Texas guidance</span></div><div><Clock3 size={19} /><span>Four questions. No account needed.</span></div><div><Leaf size={19} /><span>Start small. Keep moving forward.</span></div></div><div className="privacy-note"><strong>Your progress stays in this browser.</strong><p>No sign-up or cloud profile. Your answers and checked tasks are sent to the server only for requested Plus tools or AI guidance; AI requests share that context with OpenAI.</p></div></div><form className="profile-form panel" onSubmit={submit} noValidate><div className="form-title"><span>YOUR STARTING POINT</span><span>TEXAS · SKILLS</span></div>{fields.map(({ key, label, hint }, index) => <div className="form-field" key={key}><label htmlFor={key}><span className="field-number">0{index + 1}</span>{label}</label><div className="select-wrap"><select id={key} name={key} value={answers[key]} onChange={event => { setAnswers({ ...answers, [key]: event.target.value }); setErrors({ ...errors, [key]: undefined }); }} aria-invalid={!!errors[key]} aria-describedby={`${key}-hint${errors[key] ? ` ${key}-error` : ''}`}><option value="">Select an option</option>{PROFILE_OPTIONS[key].map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={15} /></div><p id={`${key}-hint`} className="field-hint">{hint}</p>{errors[key] && <p className="field-error" id={`${key}-error`} role="alert">{errors[key]}</p>}</div>)}{profile && <p className="field-hint">Changing your answers starts a new roadmap and resets task completion.</p>}<button className="button full-width" type="submit">Build my roadmap <ArrowRight size={17} /></button><button className="sample-button" type="button" onClick={() => { setAnswers({ ...SAMPLE_PROFILE }); setErrors({}); }}>Fill with an example profile</button><p className="form-disclaimer">Guidance for exploring Texas public-school teaching. TEA and your preparation program make certification decisions.</p></form></div></section>;
}

function Roadmap({ roadmap, completed, toggle }) {
  const [filter, setFilter] = useState('all');
  const next = roadmap.tasks.find(task => !completed.includes(task.id));
  const count = roadmap.tasks.filter(task => completed.includes(task.id)).length;
  const percent = Math.round(count / roadmap.tasks.length * 100);
  const filtered = roadmap.tasks.filter(task => filter === 'all' || (filter === 'done' ? completed.includes(task.id) : !completed.includes(task.id)));
  const nextSource = next?.sourceIds?.map(id => roadmap.sources.find(source => source.id === id)).find(Boolean);
  function openNextPractice() {
    setFilter('all');
    requestAnimationFrame(() => {
      const card = document.getElementById(`task-${next.id}`);
      const details = card?.querySelector('details');
      if (details) details.open = true;
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector('summary')?.focus({ preventScroll: true });
    });
  }
  return <>
    <div className="progress-panel panel"><div><span className="eyebrow">YOUR PERSONAL ROADMAP</span><h2>{roadmap.title}</h2><p>{roadmap.summary}</p></div><div className="progress-summary"><span><strong>{count}</strong> of {roadmap.tasks.length} steps complete</span><span>{percent}%</span></div><div className="progress-track" role="progressbar" aria-label="Roadmap progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div><small>Completion is self-reported. Checking a task does not establish certification eligibility.</small></div>
    <div className="next-step-panel"><div className="next-step-icon">{next ? <ArrowUpRight size={23} /> : <CheckCheck size={23} />}</div><div><span className="eyebrow">{next ? 'YOUR NEXT STEP' : 'YOUR CHECKLIST IS COMPLETE'}</span><h3>{next ? next.title : 'Look how far you’ve come.'}</h3><p>{next ? next.description : 'Revisit any task as needed. Confirm your status and any remaining requirements with TEA or your preparation program.'}</p>{next && (next.actionUrl || nextSource ? <a className="next-action" href={next.actionUrl || nextSource.url} target="_blank" rel="noreferrer">{next.actionLabel || 'Review this step'} <ArrowUpRight size={15} /></a> : <button className="next-action practice-action" onClick={openNextPractice}>{next.actionLabel || 'Practice this skill'} <ArrowUpRight size={15} /></button>)}</div></div>
    <div className="task-list-heading" id="task-list"><div><h2>Your path, step by step</h2><span>{roadmap.routeLabel}</span></div><label className="filter-label"><span className="sr-only">Filter tasks</span><select aria-label="Filter tasks" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All steps</option><option value="remaining">To do</option><option value="done">Completed</option></select></label></div>
    <div className="task-list">{filtered.length ? filtered.map(task => <Task key={task.id} task={task} done={completed.includes(task.id)} next={next?.id === task.id} toggle={toggle} sources={roadmap.sources} />) : <div className="empty-state panel"><ListChecks size={28} /><h3>{filter === 'done' ? 'Your first step is waiting.' : 'All caught up.'}</h3><p>{filter === 'done' ? 'Completed tasks will appear here as you make progress.' : 'You’ve checked every task. You can revisit them under All steps.'}</p></div>}</div>
    {!!roadmap.uncertainties?.length && <div className="clarify-panel"><h3><Compass size={18} /> A few things to confirm</h3><ul>{roadmap.uncertainties.map(item => <li key={item}>{item}</li>)}</ul></div>}
  </>;
}

function Task({ task, done, next, toggle, sources }) {
  return <article id={`task-${task.id}`} className={`task-card ${done ? 'done' : ''} ${next ? 'next' : ''}`}><div className="task-top"><label className="task-check"><input type="checkbox" checked={done} onChange={() => toggle(task.id)} aria-label={`Mark ${task.title} ${done ? 'incomplete' : 'complete'}`} /><span>{done && <Check size={14} strokeWidth={3} />}</span></label><div className="task-body"><div className="task-meta"><span className={task.category === 'Skills' ? 'category skill' : 'category'}>{task.category === 'Skills' ? 'SKILLS PRACTICE' : 'PATHWAY STEP'}</span>{next && <span className="next-label">UP NEXT</span>}{done && <span className="done-label">COMPLETED</span>}</div><h3>{task.title}</h3><p>{task.description}</p><details><summary>Step details & sources <ChevronDown size={14} /></summary><div className="task-detail"><p>{task.detail}</p>{task.category === 'Skills' && <small>TeachForward practice suggestion. This is not a TEA certification requirement.</small>}{task.sourceIds.map(id => <SourceLink key={id} compact source={sources.find(source => source.id === id)} />)}{task.actionUrl && <a className="text-button" href={task.actionUrl} target="_blank" rel="noreferrer">{task.actionLabel || 'Open resource'} <ArrowUpRight size={14} /></a>}</div></details></div></div></article>;
}

function Mentor({ profile, roadmap, completed, session, setSession, serverError }) {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [conversationId] = useState(() => crypto.randomUUID());
  const configured = session?.aiConfigured;
  async function ask(event) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    if (message.trim().length > 1200) { setError('Keep your question to 1,200 characters.'); return; }
    const question = message.trim();
    setBusy(true); setError(''); setSent(question);
    try {
      const result = await api('mentor', { message: question, profile, completedTaskIds: completed, conversationId });
      if (!result.answer?.trim()) throw new Error('Mentor returned an empty response. Please try again.');
      setMessages(current => [...current.slice(-3), { question, answer: result.answer, sources: result.sources || [] }]);
      setMessage('');
      if (result.usage) setSession(current => ({ ...current, usage: result.usage }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); setSent(''); }
  }
  return <section className="mentor-card panel" aria-label="AI Mentor"><div className="mentor-heading"><span className="mentor-icon"><Sparkles size={20} /></span><div><h2>Your AI Mentor</h2><span>A little clarity for the way ahead.</span></div><span className="ai-label">AI</span></div><div className="mentor-context"><span className="status-dot" /> KNOWS YOUR STARTING POINT<p>Your {optionLabel('subject', profile.subject).toLowerCase()} interest, your route, and {completed.length} checked {completed.length === 1 ? 'step' : 'steps'}.</p></div>{!configured && <div className="ai-unavailable" role="status"><strong>{session ? 'AI is not connected yet.' : serverError ? 'Mentor cannot connect.' : 'Checking AI availability…'}</strong><p>{session ? 'The owner needs to configure the server’s OpenAI key. Your roadmap and progress work without AI.' : serverError || 'Your roadmap is ready while we check the server.'}</p></div>}
    {messages.length === 0 && <div className="mentor-empty"><MessageCircle size={24} strokeWidth={1.4} /><p>A question is a good place to start.</p><span>Ask about your route, a task, or how to practice. Each question includes your current profile and progress.</span></div>}
    <div className="mentor-messages" aria-live="polite">{messages.map((item, index) => <div className="mentor-exchange" key={index}><div className="user-message">{item.question}</div><div className="ai-message">{item.answer}</div>{item.sources.map(source => <SourceLink compact key={source.id || source.url} source={source} />)}</div>)}{busy && <div className="mentor-loading"><p className="user-message">{sent}</p><span><LoaderCircle size={15} className="spin" /> Reviewing your route and progress…</span></div>}</div>
    <div className="suggested-questions"><button type="button" disabled={busy} onClick={() => setMessage('What should I do next, based on my completed steps?')}>What should I do next? <Plus size={12} /></button><button type="button" disabled={busy} onClick={() => setMessage(`How can I practice skills for ${optionLabel('subject', profile.subject)} with my available weekly time?`)}>How can I practice? <Plus size={12} /></button></div>
    <form className="mentor-form" onSubmit={ask}><label className="sr-only" htmlFor="mentor-question">Ask your mentor</label><textarea id="mentor-question" value={message} maxLength={1200} rows={3} placeholder="What’s on your mind?" onChange={event => { setMessage(event.target.value); setError(''); }} disabled={busy} /><div className="mentor-input-footer"><span>{message.length}/1,200</span><button className="button button-small" type="submit" disabled={busy || !message.trim()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Send size={14} />} Ask mentor</button></div></form>{error && <p className="error-message" role="alert">{error}</p>}<div className="mentor-footer"><LockKeyhole size={12} /><span>{session?.usage ? `${session.usage.remaining} of ${session.usage.limit} daily questions left` : 'Usage limits apply'} · {session?.plan === 'plus' ? (session.entitlement?.source === 'admin' ? 'Plus' : 'Plus demo') : 'Free'}</span></div><p className="ai-disclaimer">AI can make mistakes. Verify guidance with TEA. Up to 3 recent exchanges are included for follow-up questions. Chat resets when you leave this roadmap or refresh. Don’t include sensitive personal information.</p>
  </section>;
}

function SkillsStudio({ profile, roadmap, completed, isPlus, manualAccess, showUpgrade }) {
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [responses, setResponses] = useState({});
  async function load() {
    setBusy(true); setError('');
    try { setContent(await api('plus', { profile })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { setContent(null); if (isPlus) load(); }, [isPlus, JSON.stringify(profile)]);
  function download() {
    const report = { product: 'TeachForward', createdAt: new Date().toISOString(), profile, roadmap: roadmap.title, completedTaskIds: completed, tasks: roadmap.tasks.map(({ id, title }) => ({ id, title, completed: completed.includes(id) })), weeklyPlan: content.weeklyPlan, sources: roadmap.sources, disclaimer: 'Self-reported progress. Not evidence of certification or eligibility.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'teachforward-progress.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!isPlus) return <div className="skills-locked panel"><span className="large-icon"><LockKeyhole size={29} strokeWidth={1.4} /></span><span className="eyebrow">A LITTLE MORE STRUCTURE. A LITTLE MORE MOMENTUM.</span><h2>Turn your goals<br />into a weekly rhythm.</h2><p>Your free roadmap already gives you the path. Plus adds a personal weekly plan, subject practice exercises, and a downloadable progress summary.</p><div className="locked-preview"><span><Clock3 size={19} /> A plan for your available time</span><span><Target size={19} /> Exercises for your teaching interest</span><span><Download size={19} /> A summary you can keep</span></div><button className="button" onClick={showUpgrade}>Explore Plus · $9.99/month <ArrowRight size={16} /></button><small>Proposed price. Use Demo upgrade to try it. No payment.</small></div>;
  return <><div className="studio-heading panel"><span className="eyebrow">{manualAccess ? 'PLUS · SKILLS STUDIO' : 'PLUS DEMO · SKILLS STUDIO'}</span><h2>Practice with purpose.</h2><p>Built around your subject and available time. These are TeachForward suggestions, not TEA requirements or a certification schedule.</p>{content && <button className="text-button" onClick={download}><Download size={16} /> Download progress summary</button>}</div>{busy && <div className="loading-panel panel" role="status"><LoaderCircle className="spin" /> Preparing your weekly plan…</div>}{error && <div className="panel"><p className="error-message" role="alert">{error}</p><button className="button button-outline" onClick={load}>Try again</button></div>}{content && <><div className="task-list-heading"><h2>Your weekly practice plan</h2><span className="subtle">Repeat and adapt at your pace</span></div><div className="weekly-plan">{content.weeklyPlan.map((item, index) => <article className="weekly-item panel" key={index}><span className="week-number">0{index + 1}</span><div><h3>{item.title}</h3><p>{item.description}</p></div></article>)}</div><div className="task-list-heading"><h2>Your skill exercises</h2><span className="subtle">Practice, then reflect</span></div>{content.skillExercises.map(exercise => <article className="exercise-card panel" key={exercise.id}><span className="category skill">TEACHFORWARD PRACTICE</span><h3>{exercise.title}</h3><p>{exercise.prompt}</p><label htmlFor={exercise.id}>Your practice notes <span>(this visit only)</span></label><textarea id={exercise.id} rows={4} maxLength={4000} value={responses[exercise.id] || ''} onChange={event => setResponses({ ...responses, [exercise.id]: event.target.value })} placeholder="Capture an idea, a short lesson, or a reflection…" /></article>)}</>}</>;
}

function Sources({ sources, uncertainties }) {
  return <div className="sources-panel panel"><span className="eyebrow">OFFICIAL GUIDANCE, CLEARLY LABELED</span><h2>Know what your next step rests on.</h2><p>These TEA pages informed your route. Checked dates describe our review, not a promise that guidance will stay the same. Follow the original page and confirm details before applying or paying fees.</p>{sources.map(source => <article className="source-entry" key={source.id}><SourceLink source={source} /><p>{source.summary}</p></article>)}<div className="source-note"><h3>What this roadmap does not determine</h3><p>Final eligibility, exact exams, fees, program admission, and completion dates. Your certificate area, grade band, credential status, and program may change what is required.</p>{uncertainties?.length > 0 && <ul>{uncertainties.map(item => <li key={item}>{item}</li>)}</ul>}</div></div>;
}

function UpgradeModal({ close, upgrade, resetDemo, isPlus, session, busy, error }) {
  const modalRef = useRef(null);
  const manualAccess = isPlus && session?.entitlement?.source === 'admin';
  const demoAvailable = session?.demoAvailable !== false;
  useEffect(() => {
    const previous = document.activeElement;
    modalRef.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape' && !busy) close();
      if (event.key === 'Tab') {
        const elements = modalRef.current?.querySelectorAll('button:not(:disabled), a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modalRef.current)) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [busy]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" ref={modalRef} tabIndex={-1}>
      <button className="icon-button modal-close" onClick={close} disabled={busy} aria-label="Close Plus dialog"><X size={20} /></button>
      <span className="large-icon"><Sparkles size={27} /></span><span className="eyebrow">MORE ROOM TO GROW</span>
      <h2 id="upgrade-title">Your next chapter,<br />with a little more support.</h2>
      <p>Plus adds a weekly plan, practical skill exercises, a progress download, and more AI questions when AI is connected.</p>
      <div className="modal-price">$9.99 <span>/ month</span><small>Proposed price · no payment processed here</small></div>
      <div className="demo-notice"><ShieldCheck size={18} /><span>
        <strong>{manualAccess ? 'Your administrator granted Plus access.' : demoAvailable ? 'This is a demo upgrade.' : 'Plus access is managed by your administrator.'}</strong>
        {manualAccess ? `Your access is valid until ${new Date(session.entitlement.expiresAt).toLocaleDateString('en-US')}. This browser holds your access; no automatic renewal or payment takes place here.` : demoAvailable ? 'No card details. No real charge. No subscription starts. Demo access is tied to this browser cookie and resets when the server restarts or the cookie expires.' : 'Copy your Access ID below and share it with the TeachForward administrator to request access. No card or payment is collected on this page.'}
      </span></div>
      {session?.accessId && <AccessIdentity session={session} />}
      {error && <p className="error-message" role="alert">{error}</p>}
      {manualAccess ? <><p className="plus-active"><CheckCheck size={18} /> Your Plus access is active.</p><button className="button full-width" onClick={close}>Continue with Plus <ArrowRight size={16} /></button></> : isPlus ? <><p className="plus-active"><CheckCheck size={18} /> Your Plus demo is active.</p><button className="button button-outline full-width" onClick={resetDemo} disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : null} Return to Free for testing</button></> : demoAvailable ? <button className="button full-width" onClick={upgrade} disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />} {busy ? 'Activating demo…' : 'Demo upgrade'} <ArrowRight size={16} /></button> : <button className="button button-outline full-width" onClick={close}>Continue with Free</button>}
      <p className="modal-bottom">Your free roadmap and saved progress stay available. Plus access is tied to this browser, not an account.</p>
    </section>
  </div>;
}

export default App;
