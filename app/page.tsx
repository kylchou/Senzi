import { AuthControls } from "./_components/auth-controls";

// Placeholder until Sahil's community homepage lands.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Senzi</h1>
        <AuthControls />
      </div>
      <p className="text-zinc-600 dark:text-zinc-400">
        Forecast measurable startup outcomes with virtual credits. Credits have no cash value.
      </p>
    </main>
  );
}
