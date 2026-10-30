import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { AdminApiClient } from '../lib/api';
import { AdminErrorBoundary } from '../components/AdminErrorBoundary';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  // FINDING-17: Track authorized path to eliminate transient flash of unauthorized content on route change
  const [authorizedPath, setAuthorizedPath] = useState<string | null>(null);

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
          const billAdminAllowed = ['/', '/bills', '/change-password'];
          const opsAdminAllowed = ['/', '/bills', '/users', '/rewards', '/payouts', '/audit-logs', '/notifications', '/settings', '/change-password'];

          // HIR-M-12: forced rotation of initial administrator passwords
          if (res.user.mustChangePassword && pathname !== '/change-password') {
            setAuthorizedPath(null);
            router.replace('/change-password');
            return;
          }

          if (isLogin) {
            setAuthorizedPath('/login');
            router.replace('/');
            return;
          }

          const isAllowed =
            (role === 'BILL_ADMIN' && billAdminAllowed.includes(pathname)) ||
            (role === 'OPERATIONS_ADMIN' && opsAdminAllowed.includes(pathname));

          if (!isAllowed) {
            setAuthorizedPath(null);
            if (role === 'BILL_ADMIN' || role === 'OPERATIONS_ADMIN') {
              router.replace('/');
            } else {
              AdminApiClient.clearToken();
              router.replace('/login');
            }
            return;
          } else {
            setAuthorizedPath(pathname);
          }
        } else {
          AdminApiClient.clearToken();
          if (!isLogin) {
            setAuthorizedPath(null);
            router.replace('/login');
          }
        }
      } catch {
        if (!mounted) return;
        AdminApiClient.clearToken();
        if (!isLogin) {
          setAuthorizedPath(null);
          router.replace('/login');
        }
      }
    };

    if (!isLogin) {
      verifySession();
    } else {
      setAuthorizedPath('/login');
    }

    return () => {
      mounted = false;
    };
  }, [router.pathname]);

  const isAuthorized = router.pathname === '/login' || authorizedPath === router.pathname;

  return (
    <>
      <Head>
        <title>Hiralal & Sons Rewards Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <link rel="icon" href="/assets/brand_logo.png" />
      </Head>
      {isAuthorized ? (
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
