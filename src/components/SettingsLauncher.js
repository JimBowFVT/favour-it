import { useEffect, useState } from 'react';
import AccountSettings from './AccountSettings';

export default function SettingsLauncher({ session, profile, onProfileChanged }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const openSettings = () => setOpen(true);
    window.addEventListener('favourit:open-settings', openSettings);
    return () => window.removeEventListener('favourit:open-settings', openSettings);
  }, []);
  return <>
    <button className="settings-launcher" onClick={() => setOpen(true)} aria-label="Account settings" title="Account settings">⚙</button>
    {open && <AccountSettings session={session} profile={profile} onProfileChanged={onProfileChanged} onClose={() => setOpen(false)} />}
  </>;
}
