import Image from "next/image";

export default function Loading() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center"
      aria-busy
    >
      <div className="loading-logo-wrapper">
        <Image
          src="/logo.png"
          alt="Narra Image"
          width={120}
          height={120}
          className="loading-logo"
          priority
        />
      </div>
      <div className="loading-dots mt-6">
        <span className="loading-dot" />
        <span className="loading-dot" />
        <span className="loading-dot" />
      </div>
    </main>
  );
}
