'use client';

import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Search, Upload } from 'lucide-react';

type ToolbarProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUploadClick: () => void;
};

export function Toolbar({ searchQuery, onSearchChange, onUploadClick }: ToolbarProps) {
  return (
    <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
      <div className="relative w-full md:w-1/3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <Input
          type="text"
          placeholder="ابحث عن مستند..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-full bg-slate-950/80 pl-4 pr-10"
        />
      </div>
      <Button onClick={onUploadClick} className="w-full md:w-auto">
        <Upload className="ml-2" size={16} />
        رفع مستند
      </Button>
    </div>
  );
}
