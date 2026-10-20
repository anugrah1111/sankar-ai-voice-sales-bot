import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { AudioLines, BarChart3, ChevronLeft, Clock3, Menu, Plus, Settings2, X } from 'lucide-react';

const navigation = [
  { to: '/', label: 'Dashboard', icon: BarChart3, end: true },
  { to: '/new-call', label: 'New call', icon: Plus },
  { to: '/history', label: 'Call history', icon: Clock3 },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><AudioLines size={21} strokeWidth={2.5} /></div>
          <div><div className="brand-name">voxline</div><div className="brand-caption">SALES WORKSPACE</div></div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-pill"><span className="workspace-dot" /> Sankar Group <ChevronLeft size={14} className="workspace-chevron" /></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>{label === 'Call history' && <span className="nav-live-dot" title="History is available" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-tip"><div className="side-tip-icon"><AudioLines size={17} /></div><div><strong>Better calls start with listening.</strong><p>Capture the customer’s needs before you recommend a solution.</p></div></div>
          <div className="profile-row"><div className="avatar avatar-blue">SG</div><div className="profile-copy"><strong>Sankar Group</strong><span>Sales workspace</span></div><button className="icon-button profile-menu" aria-label="Workspace menu"><Settings2 size={16} /></button></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="mobile-header">
          <button className="icon-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="mobile-brand"><span className="brand-mark small"><AudioLines size={17} /></span> voxline</div>
          <NavLink to="/new-call" className="mobile-new-call" aria-label="Start a call"><Plus size={19} /></NavLink>
        </header>
        <main className="main-content"><Outlet /></main>
      </div>
    </div>
  );
}
