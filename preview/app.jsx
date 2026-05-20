// Preview app — single page with version switcher.
// Reads ?v=v1|v2|v3|v4 from URL and localStorage for active version,
// then mounts the matching variation. Floating switcher pill at bottom.

const VERSIONS = [
  { id: 'v1', label: 'V1', name: '터미널 프로', sub: '다크 · 고밀도', Comp: () => <V1Terminal/> },
  { id: 'v2', label: 'V2', name: '에디토리얼', sub: '세리프 · 네이비', Comp: () => <V2Editorial/> },
  { id: 'v3', label: 'V3', name: 'FT 살몬', sub: '저널리즘 톤', Comp: () => <V3FT/> },
  { id: 'v4', label: 'V4', name: '미니멀', sub: 'Linear · Stripe', Comp: () => <V4Minimal/> },
];

const LS_KEY = 'deallist-preview-v';

function getInitialVersion() {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('v');
  if (fromUrl && VERSIONS.find(v => v.id === fromUrl)) return fromUrl;
  const fromLS = localStorage.getItem(LS_KEY);
  if (fromLS && VERSIONS.find(v => v.id === fromLS)) return fromLS;
  return 'v2'; // default — editorial
}

function PreviewApp() {
  const [active, setActive] = React.useState(getInitialVersion);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    // Sync URL + localStorage
    const url = new URL(window.location.href);
    url.searchParams.set('v', active);
    window.history.replaceState({}, '', url.toString());
    localStorage.setItem(LS_KEY, active);
    // Update document title
    const v = VERSIONS.find(x => x.id === active);
    document.title = `DealList Preview · ${v.label} ${v.name}`;
  }, [active]);

  // Keyboard shortcut: 1/2/3/4 to switch
  React.useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key) - 1;
        if (VERSIONS[idx]) setActive(VERSIONS[idx].id);
      }
      if (e.key === 'h' || e.key === 'H') setCollapsed(c => !c);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const ActiveComp = VERSIONS.find(v => v.id === active).Comp;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        <ActiveComp/>
      </div>
      <Switcher active={active} setActive={setActive} collapsed={collapsed} setCollapsed={setCollapsed} />
    </>
  );
}

function Switcher({ active, setActive, collapsed, setCollapsed }) {
  const s = useSummary();
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="시안 스위처 펼치기 (H)"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          width: 44, height: 44, borderRadius: '50%',
          background: '#0a0a0a', color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Pretendard, sans-serif', fontSize: 13, fontWeight: 700,
        }}
      >
        {active.toUpperCase()}
      </button>
    );
  }
  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(20px)',
      borderRadius: 14, padding: 6,
      boxShadow: '0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', gap: 4,
      fontFamily: 'Pretendard, -apple-system, sans-serif',
    }}>
      <div style={{ padding: '0 12px 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: s._source === 'live' ? '#39d98a' : '#ffb547', boxShadow: s._source === 'live' ? '0 0 8px #39d98a' : '0 0 8px #ffb547' }}/>
        <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3 }}>DealList Preview</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5 }}>{s._source === 'live' ? 'live data' : 'mock data'}</div>
      </div>
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.1)' }}/>
      {VERSIONS.map(v => {
        const isActive = v.id === active;
        return (
          <button
            key={v.id}
            onClick={() => setActive(v.id)}
            style={{
              padding: '8px 14px',
              background: isActive ? '#fff' : 'transparent',
              color: isActive ? '#0a0a0a' : 'rgba(255,255,255,0.75)',
              border: 'none', borderRadius: 9, cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left',
              transition: 'background 0.15s, color 0.15s',
              display: 'flex', flexDirection: 'column', gap: 1, minWidth: 92,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, opacity: isActive ? 0.6 : 0.5 }}>{v.label}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{v.name}</span>
            </div>
            <div style={{ fontSize: 10, opacity: 0.55 }}>{v.sub}</div>
          </button>
        );
      })}
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.1)', marginLeft: 4 }}/>
      <button
        onClick={() => setCollapsed(true)}
        title="접기 (H)"
        style={{
          width: 30, height: 30, borderRadius: 8, background: 'transparent',
          color: 'rgba(255,255,255,0.5)', border: 'none', cursor: 'pointer',
          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
      >
        ⌄
      </button>
    </div>
  );
}

// Boot — load summary then render
(async function boot() {
  await loadSummary();
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<PreviewApp/>);
})();
