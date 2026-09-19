'use client';

import { useState } from 'react';
import { Monitor, Tablet, Smartphone } from 'lucide-react';

export function PreviewFrame({ url }: { url: string }) {
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const sizes = {
    desktop: { width: '100%', height: '100%' },
    tablet: { width: '768px', height: '1024px' },
    mobile: { width: '375px', height: '812px' },
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b border-border bg-bg">
        <button
          onClick={() => setDevice('desktop')}
          className={`p-2 rounded ${device === 'desktop' ? 'bg-accent text-white' : 'text-muted'}`}
          title="Desktop"
        >
          <Monitor size={16} />
        </button>
        <button
          onClick={() => setDevice('tablet')}
          className={`p-2 rounded ${device === 'tablet' ? 'bg-accent text-white' : 'text-muted'}`}
          title="Tablet"
        >
          <Tablet size={16} />
        </button>
        <button
          onClick={() => setDevice('mobile')}
          className={`p-2 rounded ${device === 'mobile' ? 'bg-accent text-white' : 'text-muted'}`}
          title="Mobile"
        >
          <Smartphone size={16} />
        </button>
        <span className="ml-auto text-xs text-muted">{device}</span>
      </div>
      <div className="flex-1 bg-gray-900 flex items-center justify-center overflow-auto">
        <iframe
          src={url}
          style={sizes[device]}
          className="border-0 bg-white"
          title="Page preview"
        />
      </div>
    </div>
  );
}
