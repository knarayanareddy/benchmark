import { useEffect, useState } from 'react';
import { getConfig } from './lib/config.js';
import './profile.css';

/**
 * Shown on every screen while the deployment is in demo mode. Renders nothing otherwise, so the
 * real pilot never sees it. Demo staff credentials are printed on the server console, never shown here.
 * @param {{ staff?: boolean }} props
 */
export function DemoBanner({ staff = false }) {
  const [config, setConfig] = useState(/** @type {{ demo: boolean } | null} */ (null));
  useEffect(() => {
    let live = true;
    getConfig().then((c) => { if (live) setConfig(c); });
    return () => { live = false; };
  }, []);
  if (!config?.demo) return null;
  return (
    <div className="demo-banner" role="status">
      <p>Demo data: these questions and the panel are made up to show how it works. Nothing here is a result.</p>
      {staff && <p>Demo deployment. Staff credentials are shown in the server console.</p>}
    </div>
  );
}
