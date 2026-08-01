import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SetupLayout({ children }) {
  if (process.env.SETUP_ENABLED !== 'true') redirect('/');
  return children;
}
