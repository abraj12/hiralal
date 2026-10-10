import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Hiralal & Sons Rewards Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <link rel="icon" href="/assets/app_icon_red.png" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
