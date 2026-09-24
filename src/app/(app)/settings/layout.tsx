import { SettingsTabs } from './tabs';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-3 text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsTabs />
      {children}
    </>
  );
}
