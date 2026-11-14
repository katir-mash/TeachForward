import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Eye, EyeOff, LayoutDashboard, Leaf, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import './admin.css';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = value => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
};

async function adminApi(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/admin/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || 'This action could not be completed. Please try again.');
      error.status = response.status;
      error.code = result.code;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The server took too long to respond. Please try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the server. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function AdminBrand({ onBack, inverted = false }) {
  return <button type="button" className={`admin-brand${inverted ? ' inverted' : ''}`} onClick={onBack} aria-label="Back to TeachForward"><span><BookOpen size={21} strokeWidth={1.7} /></span><strong>Teach<span>Forward</span><i>.</i></strong></button>;
}

function AccessBadge({ visitor }) {
  const label = visitor.source === 'admin' ? 'Manual Plus' : visitor.source === 'demo' ? 'Plus demo' : 'Free';
  return <span className={`admin-access-badge ${visitor.source === 'admin' ? 'manual' : visitor.source === 'demo' ? 'demo' : 'free'}`}>{visitor.plan === 'plus' ? <Sparkles size={11} /> : null}{label}</span>;
}

export default function Admin({ onBack }) {
  const back = onBack || (() => window.location.assign('/'));
  const [session, setSession] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [search, setSearch] = useState('');
  const [accessId, setAccessId] = useState('');
  const [accessIdError, setAccessIdError] = useState('');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  function requestFailed(err) {
    if (err.status === 401) {
      setSession(current => ({ ...current, authenticated: false }));
      setOverview(null);
      setModal(null);
      setError('Your administrator session has ended. Sign in again to continue.');
    } else {
      setError(err.message);
    }
  }

  async function refresh() {
    setRefreshing(true); setError('');
    try { setOverview(await adminApi('overview')); }
    catch (err) { requestFailed(err); }
    finally { setRefreshing(false); }
  }

  async function bootstrap() {
    setLoading(true); setError('');
    try {
      const result = await adminApi('session');
      setSession(result);
      if (result.authenticated) setOverview(await adminApi('overview'));
    } catch (err) { requestFailed(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { bootstrap(); }, []);

  async function login(event) {
    event.preventDefault();
    if (!password || signingIn) return;
    setSigningIn(true); setError(''); setNotice('');
    try {
      const result = await adminApi('login', { password });
      setPassword(''); setShowPassword(false); setSession(result);
      setOverview(await adminApi('overview'));
    } catch (err) {
      setPassword('');
      setSession(current => ({ ...current, authenticated: false }));
      setOverview(null);
      setError(err.message);
    } finally { setSigningIn(false); }
  }

  async function logout() {
    setSigningOut(true); setError('');
    try {
      await adminApi('logout', {});
      setSession(current => ({ ...current, authenticated: false }));
      setOverview(null); setNotice('You have signed out securely.');
    } catch (err) { requestFailed(err); }
    finally { setSigningOut(false); }
  }

  function openModal(value) { setModalError(''); setModal(value); }

  function openDirectGrant(event) {
    event.preventDefault(); setAccessIdError('');
    const id = accessId.trim();
    if (!/^TF-[a-f0-9]{12}$/i.test(id)) {
      setAccessIdError('Enter the complete Access ID, for example TF- followed by 12 letters or numbers.');
      return;
    }
    const existing = overview?.visitors.find(visitor => visitor.accessId.toLowerCase() === id.toLowerCase());
    openModal({ type: 'grant', accessId: existing?.accessId || id, days: '30' });
  }

  async function saveAction(event) {
    event?.preventDefault();
    if (saving || !modal) return;
    if (modal.type === 'grant' && (!/^\d+$/.test(String(modal.days)) || Number(modal.days) < 1 || Number(modal.days) > 365)) {
      setModalError('Choose a whole number of days between 1 and 365.');
      return;
    }
    setSaving(true); setModalError(''); setError('');
    let actionSaved = false;
    try {
      if (modal.type === 'grant') {
        await adminApi('grant', { accessId: modal.accessId, days: Number(modal.days) });
        setNotice(`Plus access updated for ${modal.accessId}. No payment was taken.`);
        setAccessId('');
      } else if (modal.type === 'revoke') {
        await adminApi('revoke', { accessId: modal.accessId });
        setNotice(`Plus access revoked for ${modal.accessId}.`);
      } else {
        await adminApi('settings', { demoUpgradeEnabled: modal.enabled });
        setNotice(modal.enabled ? 'Public Demo upgrade is enabled.' : 'Public Demo upgrade is disabled. Manual Plus grants remain active.');
      }
      actionSaved = true;
      setModal(null);
      setOverview(await adminApi('overview'));
    } catch (err) {
      if (err.status === 401) requestFailed(err);
      else if (actionSaved) setError('The change was saved, but the latest records could not be loaded. Use Refresh to update the list.');
      else setModalError(err.message);
    } finally { setSaving(false); }
  }

  const authenticated = Boolean(session?.authenticated);
  const visitors = overview?.visitors || [];
  const filteredVisitors = visitors.filter(visitor => visitor.accessId.toLowerCase().includes(search.trim().toLowerCase()));
  const demoEnabled = overview?.settings?.demoUpgradeEnabled ?? true;
  const stats = overview?.stats;

  if (loading) return <div className="admin-shell admin-initial"><AdminBrand onBack={back} /><div role="status"><LoaderCircle className="admin-spin" size={28} /><h1>Opening your workspace…</h1><p>Checking administrator access.</p></div></div>;

  if (!authenticated) return <div className="admin-shell admin-login-shell">
    <section className="admin-login-story"><AdminBrand inverted onBack={back} /><div className="admin-story-copy"><span className="admin-kicker">TEACHFORWARD ADMINISTRATION</span><h1>A little support.<br /><em>A meaningful<br />way forward.</em></h1><p>Manage who has access to Plus, so you can focus on helping people take their next step.</p><div className="admin-story-rule" /><span className="admin-story-mission"><Leaf size={23} /> We grow by helping others grow.</span></div><div className="admin-private-label"><LockKeyhole size={14} /> Private administrator workspace</div></section>
    <section className="admin-login-main"><button type="button" className="admin-back" onClick={back}><ArrowLeft size={16} /> Back to TeachForward</button><div className="admin-login-card"><span className="admin-icon-box"><ShieldCheck size={26} strokeWidth={1.6} /></span><span className="admin-kicker">ACCESS MANAGEMENT</span><h2>{session?.configured === false ? 'Set up your administrator.' : 'Welcome back.'}</h2><p>{session?.configured === false ? 'Create the local administrator credentials before managing Plus access.' : 'Sign in to grant, extend, or revoke Plus access.'}</p>
      {notice && <div className="admin-message success" role="status"><Check size={16} /><span>{notice}</span></div>}
      {error && <div className="admin-message error" role="alert">{error}</div>}
      {session?.configured === false ? <div className="admin-setup-instructions"><p>In the TeachForward project folder, run:</p><code>npm.cmd run setup:admin</code><p>Open <strong>server/admin-access.txt</strong> locally for your administrator password, then restart the server.</p><button type="button" className="admin-button secondary" onClick={bootstrap}><RefreshCw size={15} /> Check setup again</button></div> : session ? <form onSubmit={login} className="admin-login-form"><label htmlFor="admin-password">Administrator password</label><div className="admin-password-wrap"><input id="admin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} maxLength={256} onChange={event => setPassword(event.target.value)} required disabled={signingIn} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={signingIn}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><button type="submit" className="admin-button primary" disabled={signingIn || !password}>{signingIn ? <LoaderCircle className="admin-spin" size={16} /> : <LockKeyhole size={16} />}{signingIn ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button><p className="admin-login-help">Your password is checked by the server. Administrator access is separate from visitor Plus access.</p></form> : <button className="admin-button secondary" onClick={bootstrap}><RefreshCw size={15} /> Try connecting again</button>}
      <div className="admin-login-note"><ShieldCheck size={14} /><span>Manual access management. No card details or payments.</span></div></div><span className="admin-login-footer">Built for your next chapter.</span></section>
  </div>;

  return <div className="admin-shell admin-workspace">
    <aside className="admin-sidebar"><AdminBrand inverted onBack={back} /><div className="admin-sidebar-label">ADMIN WORKSPACE</div><nav aria-label="Administration"><a href="#admin-overview" className="admin-side-link"><LayoutDashboard size={17} /> Overview <ChevronRight size={13} /></a><a href="#admin-visitors" className="admin-side-link"><Users size={17} /> Visitors & access</a><a href="#admin-controls" className="admin-side-link"><Settings2 size={17} /> Access controls</a></nav><div className="admin-sidebar-footer"><span><ShieldCheck size={17} /> Server-protected access</span><p>Manual Plus grants.<br />No payment processing.</p><button type="button" onClick={back}><ArrowLeft size={14} /> Open visitor site</button></div></aside>
    <div className="admin-content"><header className="admin-topbar"><span><LockKeyhole size={13} /> PRIVATE WORKSPACE</span><div><span className="admin-session-time">Session ends {formatDate(session?.expiresAt)}</span><button type="button" className="admin-signout" onClick={logout} disabled={signingOut}>{signingOut ? <LoaderCircle size={14} className="admin-spin" /> : <LogOut size={14} />} Sign out</button></div></header>
      <main className="admin-main" id="admin-overview"><div className="admin-page-heading"><div><span className="admin-kicker">A CLEARER WAY TO MANAGE ACCESS</span><h1>Help the next chapter happen.</h1><p>Give visitors more room to grow with manual Plus access.</p></div><button type="button" className="admin-button secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'admin-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
        {error && <div className="admin-message error" role="alert">{error}</div>}
        {notice && <div className="admin-message success" role="status"><Check size={16} /><span>{notice}</span></div>}
        <div className="admin-stats"><article><span><Users size={18} /> Visitor browsers</span><strong>{stats ? stats.visitors : '—'}</strong><p>Browsers with an Access ID</p></article><article><span><Sparkles size={18} /> Manual Plus</span><strong>{stats ? stats.manualPlus : '—'}</strong><p>Active administrator grants</p></article><article><span><Leaf size={18} /> Plus demo</span><strong>{stats ? stats.demoPlus : '—'}</strong><p>Currently unlocked through demo</p></article></div>
        <section className="admin-card admin-quick-grant"><div><span className="admin-kicker">MAKE ROOM TO GROW</span><h2>Grant Plus by Access ID.</h2><p>Ask the visitor for the Access ID shown on their roadmap.</p></div><form onSubmit={openDirectGrant}><label htmlFor="admin-access-id">Visitor Access ID</label><div><input id="admin-access-id" placeholder="TF-XXXXXXXXXXXX" maxLength={15} autoComplete="off" spellCheck="false" value={accessId} onChange={event => { setAccessId(event.target.value); setAccessIdError(''); }} aria-invalid={!!accessIdError} aria-describedby={accessIdError ? 'admin-access-id-error' : undefined} disabled={!overview} /><button className="admin-button primary" type="submit" disabled={!overview || !accessId.trim()}><Plus size={16} /> Grant Plus</button></div>{accessIdError && <p className="admin-field-error" id="admin-access-id-error" role="alert">{accessIdError}</p>}</form></section>
        <section className="admin-card admin-visitors-section" id="admin-visitors"><div className="admin-section-heading"><div><h2>Visitors & access</h2><p>Manage browser-based access, without registration.</p></div><label className="admin-search"><Search size={16} /><span className="sr-only">Search Access IDs</span><input type="search" placeholder="Find an Access ID…" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search Access IDs" /></label></div>
          {!overview ? <div className="admin-empty" role="status"><LoaderCircle size={24} className={refreshing ? 'admin-spin' : ''} /><h3>{refreshing ? 'Loading visitor access…' : 'Visitor information is unavailable.'}</h3><p>{refreshing ? 'Checking the latest server records.' : 'Use Refresh to try loading the latest records.'}</p></div> : filteredVisitors.length === 0 ? <div className="admin-empty"><Users size={29} strokeWidth={1.4} /><h3>{search ? 'No matching Access ID.' : 'Your first visitor is still ahead.'}</h3><p>{search ? 'Check the complete ID or clear your search.' : 'Visitors appear after they open TeachForward. Their Access ID connects this panel to their current browser.'}</p>{search && <button type="button" className="admin-text-button" onClick={() => setSearch('')}>Clear search <ArrowRight size={13} /></button>}</div> : <div className="admin-table-scroll"><table className="admin-visitors-table"><thead><tr><th scope="col">Visitor</th><th scope="col">Access</th><th scope="col">Expires</th><th scope="col">Mentor today</th><th scope="col">Actions</th></tr></thead><tbody>{filteredVisitors.map(visitor => <tr key={visitor.accessId}><td><strong className="admin-access-id">{visitor.accessId}</strong><span>Seen {formatDate(visitor.lastSeenAt)}</span><small>First visit {formatDate(visitor.createdAt)}</small></td><td><AccessBadge visitor={visitor} /></td><td>{visitor.expiresAt ? formatDate(visitor.expiresAt) : 'No active term'}</td><td>{Number.isInteger(visitor.used) && Number.isInteger(visitor.limit) ? <span className="admin-usage"><strong>{visitor.used}</strong> / {visitor.limit}<small>successful answers</small></span> : <span className="admin-unavailable">No current session</span>}</td><td><div className="admin-row-actions"><button type="button" className="admin-row-grant" onClick={() => openModal({ type: 'grant', accessId: visitor.accessId, days: '30', expiresAt: visitor.source === 'admin' ? visitor.expiresAt : null })}><Plus size={13} />{visitor.source === 'admin' ? 'Extend' : 'Grant Plus'}</button><button type="button" className="admin-row-revoke" disabled={visitor.plan !== 'plus'} onClick={() => openModal({ type: 'revoke', accessId: visitor.accessId })}>Revoke</button></div></td></tr>)}</tbody></table></div>}
          <div className="admin-table-note"><ShieldCheck size={15} /><p>Only access records are shown. This panel does not expose visitor questionnaires, Mentor conversations, or API keys.</p></div>
        </section>
        <section className="admin-card admin-controls" id="admin-controls"><div className="admin-control-icon"><Settings2 size={24} strokeWidth={1.5} /></div><div className="admin-control-copy"><span className="admin-kicker">ACCESS CONTROLS</span><h2>Public Demo upgrade</h2><p>{demoEnabled ? 'Visitors can currently unlock Plus themselves with Demo upgrade. Disable it when you want Plus access to be controlled through administrator grants.' : 'Public Demo upgrade is disabled. Visitors need an active administrator grant for Plus access.'}</p><small>Changing this setting does not cancel manual grants. Demo access never records a payment.</small></div><div className="admin-toggle-wrap"><button type="button" className={`admin-toggle ${demoEnabled ? 'enabled' : ''}`} role="switch" aria-label="Allow public Demo upgrade" aria-checked={demoEnabled} disabled={!overview} onClick={() => openModal({ type: 'demo', enabled: !demoEnabled })}><span /></button><span>{demoEnabled ? 'Enabled' : 'Disabled'}</span></div></section>
        <div className="admin-browser-note"><LockKeyhole size={19} /><div><strong>Access follows the visitor’s browser.</strong><p>Without registration, a new browser or cleared cookies gets a new Access ID. Manual Plus is an access grant, not proof that money was received. No charge or subscription renewal is created here.</p></div></div>
        <footer className="admin-footer"><span>TeachForward administration</span><span>We grow by helping others grow.</span></footer>
      </main>
    </div>
    {modal && <AdminDialog busy={saving} close={() => setModal(null)}>
      <span className="admin-dialog-icon">{modal.type === 'grant' ? <Sparkles size={25} /> : modal.type === 'revoke' ? <LockKeyhole size={25} /> : <Settings2 size={25} />}</span>
      <span className="admin-kicker">{modal.type === 'demo' ? 'ACCESS CONTROLS' : 'MANUAL PLUS ACCESS'}</span>
      <h2 id="admin-dialog-title">{modal.type === 'grant' ? modal.expiresAt ? 'A little more time to grow.' : 'Open up their next chapter.' : modal.type === 'revoke' ? 'Revoke Plus access?' : modal.enabled ? 'Enable public Demo upgrade?' : 'Disable public Demo upgrade?'}</h2>
      <p id="admin-dialog-description">{modal.type === 'grant' ? <>Grant or extend Plus for <strong>{modal.accessId}</strong>. No payment will be taken.</> : modal.type === 'revoke' ? <>Remove manual and current demo access for <strong>{modal.accessId}</strong>. Their free roadmap and browser progress remain available.</> : modal.enabled ? 'Visitors will be able to unlock Plus themselves without payment. Use this for demonstrations and testing.' : 'Visitors using Plus demo will return to Free. Active administrator grants will keep their Plus access.'}</p>
      {modal.type === 'grant' ? <form className="admin-grant-form" onSubmit={saveAction}><label htmlFor="admin-grant-days"><CalendarDays size={15} /> Access duration</label><div className="admin-duration-presets">{[1, 7, 30, 90].map(days => <button type="button" key={days} className={String(days) === modal.days ? 'selected' : ''} aria-pressed={String(days) === modal.days} onClick={() => setModal({ ...modal, days: String(days) })} disabled={saving}>{days} {days === 1 ? 'day' : 'days'}</button>)}</div><div className="admin-days-input"><input id="admin-grant-days" type="number" inputMode="numeric" min={1} max={365} step={1} value={modal.days} onChange={event => setModal({ ...modal, days: event.target.value })} disabled={saving} required /><span>days · 1–365</span></div><p className="admin-grant-hint">{modal.expiresAt ? `Current expiry: ${formatDate(modal.expiresAt)}. New days extend the active term.` : 'A new term starts when you confirm this grant.'} Access can extend up to one year from today.</p>{modalError && <div className="admin-message error" role="alert">{modalError}</div>}<div className="admin-dialog-actions"><button type="button" className="admin-button secondary" disabled={saving} onClick={() => setModal(null)}>Cancel</button><button type="submit" className="admin-button primary" disabled={saving}>{saving ? <LoaderCircle size={15} className="admin-spin" /> : <Sparkles size={15} />}{saving ? 'Saving…' : modal.expiresAt ? 'Extend Plus access' : 'Confirm Plus grant'}</button></div></form> : <>{modal.type === 'revoke' && demoEnabled && <div className="admin-dialog-note">Public Demo upgrade is enabled. This visitor can unlock demo access again; disable public demo to manage Plus only through grants.</div>}{modalError && <div className="admin-message error" role="alert">{modalError}</div>}<div className="admin-dialog-actions"><button type="button" className="admin-button secondary" disabled={saving} onClick={() => setModal(null)}>Cancel</button><button type="button" className={`admin-button ${modal.type === 'revoke' ? 'danger' : 'primary'}`} onClick={saveAction} disabled={saving}>{saving ? <LoaderCircle size={15} className="admin-spin" /> : null}{saving ? 'Saving…' : modal.type === 'revoke' ? 'Revoke Plus access' : modal.enabled ? 'Enable demo' : 'Disable demo'}</button></div></>}
    </AdminDialog>}
  </div>;
}

function AdminDialog({ busy, close, children }) {
  const dialogRef = useRef(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(close);
  busyRef.current = busy;
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keydown(event) {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return <div className="admin-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}><section ref={dialogRef} className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" aria-describedby="admin-dialog-description" tabIndex={-1}><button type="button" className="admin-dialog-close" aria-label="Close access dialog" disabled={busy} onClick={close}><X size={20} /></button>{children}</section></div>;
}
