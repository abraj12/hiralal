import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { AdminApiClient } from '../lib/api';
import { AdminErrorBoundary } from '../components/AdminErrorBoundary';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let mounted = true;
    const pathname = router.pathname;
    const isLogin = pathname === '/login';

    const verifySession = async () => {
      try {
        const res = await AdminApiClient.getMe();
        if (!mounted) return;
        if (res?.success && res?.user) {
          AdminApiClient.setUser(res.user);
          const role = res.user.role;
          const billAdminAllowed = ['/', '/bills'];
          const opsAdminAllowed = ['/', '/bills', '/users', '/rewards', '/payouts', '/audit-logs', '/notifications', '/settings'];

          if (isLogin) {
            setAuthorized(true);
            router.replace('/');
            return;
          }

          const isAllowed =
            (role === 'BILL_ADMIN' && billAdminAllowed.includes(pathname)) ||
            (role === 'OPERATIONS_ADMIN' && opsAdminAllowed.includes(pathname));

          if (!isAllowed) {
            setAuthorized(false);
            if (role === 'BILL_ADMIN' || role === 'OPERATIONS_ADMIN') {
              router.replace('/');
            } else {
              AdminApiClient.clearToken();
              router.replace('/login');
            }
            return;
          } else {
            setAuthorized(true);
          }
        } else {
          AdminApiClient.clearToken();
          if (!isLogin) {
            setAuthorized(false);
            router.replace('/login');
          }
        }
      } catch {
        if (!mounted) return;
        AdminApiClient.clearToken();
        if (!isLogin) {
          setAuthorized(false);
          router.replace('/login');
        }
      }
    };

    if (!isLogin) {
      verifySession();
    } else {
      setAuthorized(true);
    }

    return () => {
      mounted = false;
    };
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
        <AdminErrorBoundary>
          <Component {...pageProps} />
        </AdminErrorBoundary>
      ) : (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </>
  );
}
