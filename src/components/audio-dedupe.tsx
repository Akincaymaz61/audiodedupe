'use client';

import { useState, useMemo, useCallback, useTransition, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { findDuplicateFiles } from '@/app/actions';
import { FolderSearch, FileScan, Trash2, Loader2, Music2, Folder, AlertTriangle, Info } from 'lucide-react';
import type { AppFile, DuplicateGroup, DuplicateGroupWithSelection } from '@/lib/types';
import { Logo } from './logo';
import { ScrollArea } from './ui/scroll-area';

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|aac|aiff)$/i;

type FileSystemFileHandleStub = {
    name: string;
    kind: 'file';
    remove: () => Promise<void>;
};

type FileSystemDirectoryHandleStub = {
    name: string;
    kind: 'directory';
    entries: () => AsyncIterable<FileSystemFileHandleStub | FileSystemDirectoryHandleStub>;
    removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
};

export default function AudioDedupe() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [filesByPath, setFilesByPath] = useState<Map<string, AppFile>>(new Map());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupWithSelection[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  const handleSelectDirectoryClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;

    setError(null);
    setDuplicateGroups([]);

    startTransition(async () => {
        setLoadingMessage('Scanning for audio files...');
        const allFiles: AppFile[] = Array.from(selectedFiles)
            .filter(file => AUDIO_EXTENSIONS.test(file.name) && file.webkitRelativePath)
            .map(file => ({
                // The File System Access API is not used here, so we create stubs.
                // Deletion will be handled by a different mechanism if needed, or this can be adapted
                // if we can get directory handles another way. For now, deletion is not implemented with this method.
                handle: { name: file.name, kind: 'file', remove: async () => { console.error("Deletion not implemented for this file handle type.") } } as unknown as FileSystemFileHandle,
                parentHandle: { name: '', kind: 'directory' } as unknown as FileSystemDirectoryHandle,
                name: file.name,
                path: file.webkitRelativePath,
            }));

        setFiles(allFiles);
        setFilesByPath(new Map(allFiles.map(f => [f.path, f])));
        setLoadingMessage('');

        if (allFiles.length === 0) {
            setError("No audio files found in the selected directory.");
        }
    });

    // Reset the input value to allow selecting the same directory again
    event.target.value = '';
  };


  const handleAnalyze = () => {
    if (files.length === 0) {
      setError('No files to analyze. Please scan a directory first.');
      return;
    }
    startTransition(async () => {
      setLoadingMessage('Analyzing files with AI... This may take a while for large libraries.');
      setError(null);
      const input = { fileList: files.map(f => ({ filePath: f.path })) };
      const result = await findDuplicateFiles(input);

      if (result.success && result.data) {
        const groupsWithSelection = result.data.duplicateGroups
          .filter(g => g.files.length > 1)
          .map((group, index) => {
            const selection = new Set(group.files.slice(1));
            return { ...group, id: `group-${index}`, selection };
          });
        setDuplicateGroups(groupsWithSelection);
        if (groupsWithSelection.length === 0) {
            toast({ title: "No duplicates found", description: "The AI analysis completed, but no duplicate groups were identified." });
        }
      } else {
        setError(result.error || 'An unknown error occurred during analysis.');
      }
      setLoadingMessage('');
    });
  };

  const handleToggleSelection = (groupId: string, filePath: string) => {
    setDuplicateGroups(prev => prev.map(group => {
      if (group.id === groupId) {
        const newSelection = new Set(group.selection);
        if (newSelection.has(filePath)) {
          newSelection.delete(filePath);
        } else {
          newSelection.add(filePath);
        }
        return { ...group, selection: newSelection };
      }
      return group;
    }));
  };

  const handleDeleteSelected = async (groupsToDeleteFrom: DuplicateGroupWithSelection[]) => {
    toast({
        title: "Deletion Not Implemented",
        description: "Deleting files is not supported with this folder selection method.",
        variant: "destructive",
    });
    console.warn("File deletion was attempted, but it is not implemented for the input[type=file] method. The original implementation used showDirectoryPicker which has write access.");
  };

  const totalSelectedCount = useMemo(() => {
    return duplicateGroups.reduce((acc, group) => acc + group.selection.size, 0);
  }, [duplicateGroups]);
  
  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center text-center p-10 h-64">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <p className="text-lg font-semibold">{loadingMessage}</p>
      <p className="text-muted-foreground">Please wait...</p>
    </div>
  );

  const renderContent = () => {
    if (isPending) return renderLoading();

    if (duplicateGroups.length > 0) {
      return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Review Duplicates</h2>
                    <p className="text-muted-foreground">Found {duplicateGroups.length} groups of similar audio files.</p>
                </div>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                       <Button variant="destructive" disabled={totalSelectedCount === 0 || isPending}>
                         <Trash2 className="mr-2 h-4 w-4" /> Delete All Selected ({totalSelectedCount})
                       </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will permanently delete {totalSelectedCount} file(s). This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteSelected(duplicateGroups)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </header>
            <Accordion type="multiple" className="w-full">
            {duplicateGroups.map(group => (
              <Card key={group.id} className="mb-4 overflow-hidden">
                <AccordionItem value={group.id} className="border-b-0">
                  <AccordionTrigger className="p-4 hover:no-underline hover:bg-muted/50">
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-lg">{group.files.length} similar files found</p>
                      <div className="flex items-center text-sm text-muted-foreground mt-1">
                        <Info className="w-4 h-4 mr-2"/>
                        <span className="font-mono text-xs">{group.reason}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <div className="border-t">
                      <ScrollArea className="h-full max-h-[300px]">
                        <ul className="p-4 space-y-3">
                          {group.files.map(filePath => (
                            <li key={filePath} className="flex items-center gap-4 p-2 rounded-md hover:bg-muted/50 transition-colors">
                              <Checkbox
                                id={`${group.id}-${filePath}`}
                                checked={group.selection.has(filePath)}
                                onCheckedChange={() => handleToggleSelection(group.id, filePath)}
                                aria-label={`Select file ${filePath}`}
                              />
                              <div className="flex-1">
                                <label htmlFor={`${group.id}-${filePath}`} className="font-medium flex items-center gap-2 cursor-pointer">
                                  <Music2 className="w-4 h-4 text-primary" />
                                  <span>{filePath.split('/').pop()}</span>
                                </label>
                                <p className="text-xs text-muted-foreground flex items-center gap-2">
                                  <Folder className="w-3 h-3" />
                                  <span>{filePath.substring(0, filePath.lastIndexOf('/')) || '/'}</span>
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </ScrollArea>
                      <div className="p-4 border-t bg-muted/30 flex justify-end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={group.selection.size === 0 || isPending}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete selected in this group ({group.selection.size})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete {group.selection.size} file(s) from this group. This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteSelected([group])} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Card>
            ))}
          </Accordion>
        </div>
      );
    }
    
    if (files.length > 0) {
      return (
        <div className="text-center p-10">
          <FileScan className="h-16 w-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Scan Complete</h2>
          <p className="text-muted-foreground mb-6">Found {files.length} audio files. Ready to analyze for duplicates.</p>
          <Button size="lg" onClick={handleAnalyze} disabled={isPending} style={{backgroundColor: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))'}}>
            <FileScan className="mr-2 h-5 w-5" />
            Analyze for Duplicates
          </Button>
        </div>
      );
    }
    
    return (
      <div className="text-center p-10">
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileSelect}
          webkitdirectory="true"
          mozdirectory="true"
        />
        <FolderSearch className="h-16 w-16 text-primary mx-auto mb-4" />
        <h2 className="text-2xl font-bold">Start by scanning a folder</h2>
        <p className="text-muted-foreground mb-6">Select your main music directory to find duplicate audio files.</p>
        <Button size="lg" onClick={handleSelectDirectoryClick} disabled={isPending}>
          <FolderSearch className="mr-2 h-5 w-5" />
          Select Music Folder
        </Button>
      </div>
    );
  };
  
  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2 pt-8">
        <Logo />
        <p className="text-muted-foreground">
          Find and remove duplicate audio files from your library with the power of AI.
        </p>
      </header>
      <main className="w-full">
        <Card className="w-full shadow-lg">
            <CardContent className="p-6">
                {error && (
                    <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold">An Error Occurred</p>
                            <p className="text-sm">{error}</p>
                        </div>
                    </div>
                )}
                {renderContent()}
            </CardContent>
        </Card>
        <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Audio Dedupe. Clean your library, enjoy your music.</p>
        </footer>
      </main>
    </div>
  );
}
