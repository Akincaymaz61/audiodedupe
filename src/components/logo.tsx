import { Disc3 } from 'lucide-react';

export function Logo() {
  return (
    <div className="flex items-center justify-center gap-3 text-3xl font-bold text-primary font-headline">
      <Disc3 className="h-10 w-10" />
      <h1 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
        Audio Dedupe
      </h1>
    </div>
  );
}
