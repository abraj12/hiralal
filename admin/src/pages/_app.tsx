import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { AdminApiClient } from '../lib/api';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const pathname = router.pathname;
    const isLogin = pathname === '/login';
    const user = AdminApiClient.getUser();

    if (!user && !isLogin) {
      setAuthorized(false);
      router.replace('/login');
    } else if (user && isLogin) {
      setAuthorized(true);
      router.replace('/');
    } else if (user) {
      const role = user.role;
      const billAdminAllowed = ['/', '/bills'];
      const opsAdminAllowed = ['/', '/users', '/rewards', '/payouts', '/audit-logs', '/notifications', '/settings'];

      const isAllowed =
        (role === 'BILL_ADMIN' && billAdminAllowed.includes(pathname)) ||
        (role === 'OPERATIONS_ADMIN' && opsAdminAllowed.includes(pathname));

      if (!isAllowed && pathname !== '/') {
        setAuthorized(false);
        router.replace('/');
      } else {
        setAuthorized(true);
      }
    } else {
      setAuthorized(true);
    }
  }, [router.pathname]);

  return (
    <>
      <Head>
        <title>Hiralal & Sons Rewards Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <link rel="icon" href="/assets/brand_logo.png" />
      </Head>
      {authorized || router.pathname === '/login' ? (
        <Component {...pageProps} />
      ) : (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </>
  );
}
