import Image from "next/image";

export default function Loading() {
  return (
    <main
      className="loading-stage"
      aria-busy
      aria-live="polite"
    >
      <div className="loading-rail loading-rail-left" aria-hidden>
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="loading-rail loading-rail-right" aria-hidden>
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} />
        ))}
      </div>

      <div className="loading-beam loading-beam-cyan" aria-hidden />
      <div className="loading-beam loading-beam-coral" aria-hidden />

      <section className="loading-core" aria-label="Narra Image 正在加载">
        <div className="loading-orbit" aria-hidden>
          <span className="loading-chip loading-chip-a" />
          <span className="loading-chip loading-chip-b" />
          <span className="loading-chip loading-chip-c" />
          <span className="loading-chip loading-chip-d" />
        </div>

        <div className="loading-portal">
          <div className="loading-aperture" aria-hidden />
          <div className="loading-logo-wrapper">
            <Image
              src="/logo.png"
              alt="Narra Image"
              width={112}
              height={112}
              className="loading-logo"
              priority
            />
          </div>
        </div>

        <div className="loading-copy">
          <p className="loading-kicker">Narra Image</p>
          <h1>正在显影新画面</h1>
          <div className="loading-meter" aria-hidden>
            <span />
          </div>
        </div>
      </section>
    </main>
  );
}
