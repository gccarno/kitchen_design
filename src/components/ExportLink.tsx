'use client';

import React, { useState } from 'react';
import { isNative } from '@/lib/client/native';
import { saveAndShare } from '@/lib/client/download';

interface ExportLinkProps {
  online: boolean;
  href: string;
  children: React.ReactNode;
  'aria-label'?: string;
}

/**
 * A server-generated download: a link online, a disabled label offline (it can't be fetched
 * without a network). In the Android app a download link does nothing, so the file is fetched,
 * saved and handed to the share sheet; if that fails, the reason shows next to the link.
 */
export default function ExportLink({ online, href, children, ...rest }: ExportLinkProps) {
  const [error, setError] = useState<string | null>(null);
  if (!online) {
    return (
      <span className="text-gray-400" title="Offline" aria-disabled="true" {...rest}>
        {children}
      </span>
    );
  }
  const name = rest['aria-label'] ?? (typeof children === 'string' ? children : 'file');
  return (
    <>
      <a
        className="text-blue-700 underline"
        href={href}
        download
        onClick={async (e) => {
          if (!isNative()) return;
          e.preventDefault();
          setError(null);
          try {
            await saveAndShare(href, href.split('?')[0].split('/').slice(-2).join('-'));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'download failed');
          }
        }}
        {...rest}
      >
        {children}
      </a>
      {error && (
        <span role="alert" className="text-red-700">
          Couldn’t download {name}: {error}
        </span>
      )}
    </>
  );
}
