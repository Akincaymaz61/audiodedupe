import { Disc3 } from 'lucide-react';

export function Logo() {
  return (
    <div className="flex items-center justify-center gap-2 text-xl font-bold text-primary group-data-[collapsible=icon]:justify-center">
      <Disc3 className="h-6 w-6" />
      <h1 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent group-data-[collapsible=icon]:hidden">
        AudioDebupe
      </h1>
    </div>
  );
}
