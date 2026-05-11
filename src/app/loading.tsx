import Image from "next/image";

export default function Loading() {
  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--surface)] text-[var(--ink)]"
      aria-busy
      aria-live="polite"
    >
      {/* 流体渐变背景氛围层 */}
      <div className="absolute inset-0 z-0 pointer-events-none mix-blend-multiply opacity-50">
        <div 
          className="absolute top-[20%] left-[20%] h-[40vh] w-[40vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-rose-400 to-orange-300 blur-[80px] animate-pulse" 
          style={{ animationDuration: '4s' }} 
        />
        <div 
          className="absolute bottom-[20%] right-[20%] h-[50vh] w-[50vh] translate-x-1/4 translate-y-1/4 rounded-full bg-gradient-to-br from-sky-300 to-indigo-400 blur-[100px] animate-pulse" 
          style={{ animationDuration: '5s', animationDelay: '1s' }} 
        />
        <div 
          className="absolute top-1/2 left-1/2 h-[30vh] w-[30vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-amber-200 to-rose-200 blur-[60px] animate-pulse opacity-70" 
          style={{ animationDuration: '3.5s', animationDelay: '0.5s' }} 
        />
      </div>

      <section className="relative z-10 flex flex-col items-center gap-10" aria-label="Narra Image 正在加载">
        {/* 中心玻璃态载体 */}
        <div className="relative flex size-36 items-center justify-center rounded-[2.5rem] border border-white/60 bg-white/40 shadow-[0_32px_80px_rgba(217,100,58,0.18)] backdrop-blur-2xl transition-all duration-500 hover:scale-105">
          {/* 外圈光环旋转 */}
          <div className="absolute -inset-1 rounded-[2.75rem] bg-gradient-to-tr from-rose-400 via-amber-300 to-sky-400 opacity-60 blur-md animate-[spin_4s_linear_infinite]" />
          <div className="absolute inset-0 rounded-[2.5rem] border border-white/80" />
          
          <div className="relative z-10 flex size-full items-center justify-center rounded-[2.5rem] bg-white/20 backdrop-blur-md">
            <Image
              src="/logo.png"
              alt="Narra Image"
              width={76}
              height={76}
              className="animate-[pulse_2s_ease-in-out_infinite] drop-shadow-xl"
              priority
            />
          </div>
        </div>

        {/* 文本加载态 */}
        <div className="flex flex-col items-center gap-2.5 text-center">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-[var(--accent)]/90 drop-shadow-sm">
            Narra Image
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)] drop-shadow-sm">
            正在显影新画面<span className="animate-pulse">...</span>
          </h1>
          <div className="mt-2 h-1 w-24 overflow-hidden rounded-full bg-[var(--line)]/50">
            <div className="h-full w-full bg-gradient-to-r from-rose-400 via-amber-400 to-rose-400 animate-[shimmer_1.5s_infinite] bg-[length:200%_100%]" />
          </div>
        </div>
      </section>
    </main>
  );
}
