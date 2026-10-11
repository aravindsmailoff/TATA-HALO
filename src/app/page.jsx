'use client';

import dynamic from 'next/dynamic';

const HaloCarExperience = dynamic(
  () => import('@/components/HaloCarExperience'),
  {
    ssr: false,
    loading: () => (
      <div
        id="preloader"
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: '#fff',
        }}
      >
        <div className="odo">
          [&nbsp;
          <div className="odo-win">
            <div id="odometer-numbers"><div>000</div></div>
          </div>
          &nbsp;/ 100 ]
        </div>
      </div>
    ),
  }
);

export default function Page() {
  return <HaloCarExperience />;
}
