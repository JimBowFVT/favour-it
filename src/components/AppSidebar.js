import { useEffect, useRef, useState } from 'react';
import { formatMicroFav } from '../lib/favAmounts';
import './AppSidebar.css';

export const APP_NAV_ITEMS = ['Home', 'Explore', 'Orders', 'My Deals', 'Wallet', 'Community', 'Upgrade'];
const mobile = () => !window.matchMedia?.('(min-width: 1000px)').matches;
const ICONS = { Home: '⌂', Explore: '⌕', Orders: '▤', 'My Deals': '▦', Wallet: '◈', Community: '◎', Upgrade: '✦' };
export default function AppSidebar({ active, open, onToggle, onNavigate, fav }) {
  const [isMobile, setIsMobile] = useState(mobile);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1000px)');
    const changed = event => setIsMobile(!event.matches);
    media?.addEventListener?.('change', changed);
    return () => media?.removeEventListener?.('change', changed);
  }, []);
  const panel = useRef(null);
  const toggle = useRef(null);
  useEffect(() => {
    if (!open || !isMobile) return undefined;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('button')?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { onToggle(false); toggle.current?.focus(); }
      if (event.key !== 'Tab') return;
      const items = [toggle.current, ...Array.from(panel.current?.querySelectorAll('button:not(:disabled)') || [])].filter(Boolean);
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', handleKey); };
  }, [open, onToggle, isMobile]);
  const navigate = item => {
    onNavigate(item);
    if (mobile()) { onToggle(false); toggle.current?.focus(); }
  };
  return <>
    <button ref={toggle} className="app-menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="app-sidebar" onClick={() => onToggle(!open)}><span aria-hidden="true">☰</span><span>Menu</span></button>
    {open && <>
      <button className="app-sidebar-backdrop" type="button" aria-label="Close navigation overlay" tabIndex={-1} onClick={() => onToggle(false)} />
      <aside ref={panel} id="app-sidebar" className="app-sidebar" aria-label="Application navigation">
        <p className="app-sidebar-caption">YOUR WORKSPACE</p>
        <nav aria-label="Main navigation">{APP_NAV_ITEMS.map(item => {
          const selected = active === item || (item === 'My Deals' && ['Create Deal', 'Edit Deal'].includes(active));
          return <button key={item} type="button" className={selected ? 'selected' : ''} aria-current={selected ? 'page' : undefined} onClick={() => navigate(item)}><span aria-hidden="true">{ICONS[item]}</span><span>{item}</span></button>;
        })}</nav>
        <button type="button" className="app-sidebar-wallet" onClick={() => navigate('Wallet')}><small>AVAILABLE FAV</small><strong dir="ltr">{formatMicroFav(fav)}</strong><span>Open your wallet →</span></button>
        <small className="app-sidebar-note">Your marketplace balance is not a cash balance.</small>
      </aside>
    </>}
  </>;
}
