import { motion } from 'motion/react';
import { README_URL } from '../../data/source';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { Wordmark } from '../common/Logo';
import { Opsy } from '../opsy/Opsy';
import { TokenForm } from '../settings/TokenForm';
import './Connect.css';

/**
 * What a user sees until the app is connected to a server: where it will
 * connect, a field for the access token, and a link to the README that says
 * how to run a server. There is no sample data here.
 *
 * Motion: the existing `rise` entrance from styles/motion.ts, with the tokens
 * from useUi().motion, so reduced motion is already respected.
 *
 * `serverUrl` is this page's own origin: the app only talks to the server that
 * serves it, so there is nothing to type.
 */
export function ConnectScreen({ serverUrl = globalThis.location?.origin ?? '' }: { serverUrl?: string }) {
  const t = useUi().motion;
  return (
    <main className="op-connect" aria-labelledby="op-connect-title">
      <motion.div className="op-connect-card" {...rise(t, 0)}>
        <Wordmark className="op-connect-logo" />
        <Opsy state="hello" size={72} />
        <h1 className="op-connect-title" id="op-connect-title">Connect to your Opsaip server</h1>
        <p className="op-connect-sub">
          Opsaip shows your own team’s tasks, so it needs your server. Paste the access token you set when you started it.
        </p>
        <dl className="op-connect-facts">
          <dt>Server</dt>
          <dd>{serverUrl}</dd>
        </dl>
        <TokenForm />
        <p className="op-connect-help">
          No server yet? <a href={README_URL} target="_blank" rel="noopener noreferrer">How to run one (README)</a>
        </p>
      </motion.div>
    </main>
  );
}
